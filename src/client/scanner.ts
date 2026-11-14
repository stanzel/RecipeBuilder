// Camera barcode scanning. Frames are decoded on the device:
// - native BarcodeDetector where the browser supports the retail formats (e.g. Android Chrome)
// - otherwise the `barcode-detector` ponyfill (ZXing-C++ compiled to WebAssembly),
//   loaded on demand, with its .wasm served from this site (/build/zxing_reader.wasm).

import { BarcodeError, normalizeBarcode } from "../shared/gtin";

export const RETAIL_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface Detector {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

export type DetectorKind = "native" | "zxing-wasm";

let cached: Promise<{ detector: Detector; kind: DetectorKind }> | undefined;

export function getDetector(): Promise<{ detector: Detector; kind: DetectorKind }> {
  cached ??= (async () => {
    const Native = (globalThis as any).BarcodeDetector;
    if (Native && typeof Native.getSupportedFormats === "function") {
      try {
        const supported: string[] = await Native.getSupportedFormats();
        const formats = RETAIL_FORMATS.filter((f) => supported.includes(f));
        if (formats.includes("ean_13") && formats.includes("upc_a")) {
          return { detector: new Native({ formats }) as Detector, kind: "native" as const };
        }
      } catch {
        /* fall through to the ponyfill */
      }
    }
    const mod = await import("barcode-detector/ponyfill");
    mod.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? new URL(`/build/${path}`, location.href).href : prefix + path,
      },
    });
    return { detector: new mod.BarcodeDetector({ formats: [...RETAIL_FORMATS] }) as unknown as Detector, kind: "zxing-wasm" as const };
  })();
  cached.catch(() => (cached = undefined));
  return cached;
}

export type ScanErrorKind = "insecure" | "unsupported" | "denied" | "no_camera" | "in_use" | "failed";

export class ScanError extends Error {
  constructor(public kind: ScanErrorKind, message: string) {
    super(message);
  }
}

function cameraError(e: unknown): ScanError {
  const name = (e as DOMException)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new ScanError("denied", "Camera permission was denied. You can type the barcode instead, or allow camera access in your browser settings.");
    case "NotFoundError":
    case "OverconstrainedError":
      return new ScanError("no_camera", "No suitable camera was found. Type the barcode instead.");
    case "NotReadableError":
    case "AbortError":
      return new ScanError("in_use", "The camera is in use by another app or could not be started.");
    default:
      return new ScanError("failed", "The camera could not be started. Type the barcode instead.");
  }
}

export interface ScanSession {
  stop(): void;
  kind: DetectorKind;
}

/**
 * Start the rear camera and scan until one valid retail barcode is read twice in a row.
 * `onResult` is called at most once; the camera is stopped before it is called.
 */
export async function startScanner(
  video: HTMLVideoElement,
  onResult: (code: string, format: string) => void,
): Promise<ScanSession> {
  if (!window.isSecureContext) throw new ScanError("insecure", "Camera scanning needs HTTPS. Type the barcode instead.");
  if (!navigator.mediaDevices?.getUserMedia) throw new ScanError("unsupported", "This browser can't use the camera here. Type the barcode instead.");

  const { detector, kind } = await getDetector();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    throw cameraError(e);
  }

  let stopped = false;
  let timer: number | undefined;
  let last = "";
  let streak = 0;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    for (const t of stream.getTracks()) t.stop();
    video.pause();
    video.srcObject = null;
    document.removeEventListener("visibilitychange", onHidden);
  };
  const onHidden = () => {
    if (document.visibilityState === "hidden") stop();
  };
  document.addEventListener("visibilitychange", onHidden);

  video.setAttribute("playsinline", ""); // required on iOS Safari to avoid fullscreen
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    /* autoplay may resolve late on iOS; detection loop waits for frames */
  }

  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const results = await detector.detect(video);
        for (const r of results) {
          if (!(RETAIL_FORMATS as readonly string[]).includes(r.format)) continue;
          const code = r.rawValue.replace(/\D/g, "");
          try {
            normalizeBarcode(code, r.format);
          } catch (e) {
            if (e instanceof BarcodeError) continue; // misread: bad check digit
            throw e;
          }
          // Require two consecutive identical reads to avoid misreads.
          streak = code === last ? streak + 1 : 1;
          last = code;
          if (streak >= 2 && !stopped) {
            stop();
            onResult(code, r.format);
            return;
          }
          break;
        }
      }
    } catch {
      /* transient decode errors are ignored */
    }
    if (!stopped) timer = window.setTimeout(tick, 120);
  };
  tick();

  return { stop, kind };
}
