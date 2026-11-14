import { useEffect, useRef, useState } from "preact/hooks";
import { BarcodeError, normalizeBarcode } from "../shared/gtin";
import { NUTRIENT_META, type Ingredient } from "../shared/nutrition";
import { parseQuantity } from "../shared/parse";
import type { BarcodeLookupResponse, FoodRecord, SourceId, UnitId } from "../shared/types";
import { api, ApiError } from "./api";
import { ManualEntry } from "./ManualEntry";
import { ScanError, startScanner, type ScanSession } from "./scanner";
import { newId } from "./store";
import { basisText, ErrorBox, KindBadge, Note, round, servingText, SourceLink } from "./ui";

interface Props {
  startWithCamera: boolean;
  onAdd(ing: Ingredient): void;
  onSearchByName(): void;
  onClose(): void;
}

const SOURCE_NAMES: Record<SourceId, string> = { off: "Open Food Facts", usda: "USDA FoodData Central", manual: "Manual entry" };

function Scanner({ onCode, onCancel }: { onCode(code: string, format: string): void; onCancel(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Starting camera…");

  useEffect(() => {
    let session: ScanSession | undefined;
    let cancelled = false;
    startScanner(video.current!, (code, format) => {
      if (!cancelled) onCode(code, format);
    })
      .then((s) => {
        if (cancelled) s.stop();
        else {
          session = s;
          setStatus(`Point the camera at the barcode (${s.kind === "native" ? "built-in detector" : "on-device decoder"}).`);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ScanError ? e.message : "The scanner could not start. Type the barcode instead.");
      });
    return () => {
      cancelled = true;
      session?.stop(); // always release the camera
    };
  }, []);

  return (
    <div class="scanner">
      {error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : (
        <>
          <div class="viewfinder">
            <video ref={video} playsInline muted autoPlay aria-label="Camera preview" />
            <div class="reticle" aria-hidden="true" />
          </div>
          <p class="muted small" aria-live="polite">
            {status}
          </p>
        </>
      )}
      <button type="button" class="btn btn-secondary" onClick={onCancel}>
        {error ? "OK" : "Stop camera"}
      </button>
    </div>
  );
}

function defaultUnit(r: FoodRecord): UnitId {
  if (r.serving?.grams || r.serving?.ml || r.basis === "perServing") return "serving";
  return r.basis === "per100ml" ? "ml" : "g";
}

function amountUnits(r: FoodRecord): UnitId[] {
  const out: UnitId[] = [];
  if (r.serving?.grams || r.serving?.ml || r.basis === "perServing") out.push("serving");
  if (r.packageSize?.grams || r.packageSize?.ml) out.push("package");
  out.push("g", "oz");
  if (r.basis === "per100ml" || r.serving?.ml) out.push("ml", "floz");
  return out;
}
const UNIT_TEXT: Partial<Record<UnitId, string>> = { serving: "label servings", package: "packages", g: "grams", oz: "ounces", ml: "ml", floz: "fl oz" };

export function BarcodePanel({ startWithCamera, onAdd, onSearchByName, onClose }: Props) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(startWithCamera);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BarcodeLookupResponse | null>(null);
  const [qtyText, setQtyText] = useState("1");
  const [unit, setUnit] = useState<UnitId>("serving");
  const [manual, setManual] = useState(false);
  const busy = useRef(false); // guards against duplicate lookups/adds from repeated scans or taps
  const added = useRef(false);

  async function lookup(raw: string, format?: string, source?: SourceId) {
    if (busy.current) return;
    setError(null);
    try {
      normalizeBarcode(raw, format); // validate locally first (check digit, length)
    } catch (e) {
      setError(e instanceof BarcodeError ? e.message : "Invalid barcode.");
      return;
    }
    busy.current = true;
    setLoading(true);
    added.current = false;
    try {
      const r = await api.barcode(raw, { format, source });
      setResult(r);
      if (r.record) {
        setUnit(defaultUnit(r.record));
        setQtyText("1");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Lookup failed.");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  function add(record: FoodRecord) {
    if (added.current) return;
    const q = parseQuantity(qtyText);
    if (q === null || !(q > 0)) {
      setError("Enter how much of the product went into the recipe.");
      return;
    }
    added.current = true;
    onAdd({ id: newId(), quantity: q, unit, food: record.name, record, text: undefined });
    onClose();
  }

  const record = result?.record;

  return (
    <section class="card panel" aria-label="Barcode">
      <div class="panel-head">
        <h2>Barcode</h2>
        <button type="button" class="btn btn-ghost" onClick={onClose} aria-label="Close barcode panel">
          Close
        </button>
      </div>

      {scanning && (
        <Scanner
          onCode={(c, f) => {
            setScanning(false);
            setCode(c);
            lookup(c, f);
          }}
          onCancel={() => setScanning(false)}
        />
      )}

      {!scanning && (
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            lookup(code.trim());
          }}
        >
          <input
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9 \-]*"
            aria-label="Barcode number"
            placeholder="Type the barcode digits"
            value={code}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
          />
          <button class="btn" type="submit" disabled={loading}>
            Look up
          </button>
        </form>
      )}
      {!scanning && (
        <button type="button" class="btn btn-secondary" onClick={() => { setResult(null); setScanning(true); }}>
          Scan with camera
        </button>
      )}

      {loading && <p class="muted">Looking up {code}…</p>}
      {error && <ErrorBox>{error}</ErrorBox>}

      {result?.status === "not_found" && !manual && (
        <div>
          <Note>
            No exact match for barcode {code}. Checked: {result.attempts.map((a) => `${SOURCE_NAMES[a.source]} (${a.outcome.replace("_", " ")}${a.message ? `: ${a.message}` : ""})`).join("; ")}.
          </Note>
          <div class="row wrap">
            <button class="btn btn-secondary" type="button" onClick={onSearchByName}>
              Search by name
            </button>
            <button class="btn btn-secondary" type="button" onClick={() => setManual(true)}>
              Enter nutrition manually
            </button>
          </div>
        </div>
      )}

      {manual && (
        <ManualEntry
          barcode={code.replace(/\D/g, "")}
          onSave={(r) => {
            setManual(false);
            setResult({ status: "found", gtin14: result?.gtin14 ?? "", record: r, attempts: [], alternatives: [] });
            setUnit(defaultUnit(r));
          }}
          onCancel={() => setManual(false)}
        />
      )}

      {record && !manual && (
        <div class="product">
          <h3>{record.name}</h3>
          <div class="row wrap small">
            <KindBadge kind={record.kind} dataType={record.dataType} />
            {record.brand ? <span class="brand">{record.brand}</span> : <span class="muted">Brand not listed</span>}
          </div>
          <dl class="facts">
            <dt>Barcode</dt>
            <dd>{record.barcode ?? code}</dd>
            <dt>Nutrition basis</dt>
            <dd>{basisText(record.basis)}</dd>
            <dt>Serving size</dt>
            <dd>{servingText(record)}</dd>
            <dt>Package</dt>
            <dd>
              {record.packageSize?.grams ? `${round(record.packageSize.grams)} g` : record.packageSize?.ml ? `${round(record.packageSize.ml)} ml` : "Size not available"}
            </dd>
          </dl>
          <SourceLink record={record} />
          {result?.missing && result.missing.length > 0 && (
            <Note>
              This record doesn't report: {result.missing.map((k) => NUTRIENT_META[k].label.toLowerCase()).join(", ")}.
              {result.alternatives.length > 0 &&
                result.alternatives.map((s) => (
                  <span key={s}>
                    {" "}
                    <button class="link" type="button" onClick={() => lookup(code, undefined, s)}>
                      Try {SOURCE_NAMES[s]} instead
                    </button>
                  </span>
                ))}
            </Note>
          )}
          {record.warnings?.map((w) => (
            <p class="muted small" key={w}>
              {w}
            </p>
          ))}

          <h4>How much went into the recipe?</h4>
          <div class="grid2">
            <label class="field">
              <span>Amount</span>
              <input inputMode="decimal" value={qtyText} onInput={(e) => setQtyText((e.target as HTMLInputElement).value)} />
            </label>
            <label class="field">
              <span>Unit</span>
              <select value={unit} onChange={(e) => setUnit((e.target as HTMLSelectElement).value as UnitId)}>
                {amountUnits(record).map((u) => (
                  <option value={u} key={u}>
                    {UNIT_TEXT[u]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button class="btn" type="button" onClick={() => add(record)}>
            Add to recipe
          </button>
        </div>
      )}
    </section>
  );
}
