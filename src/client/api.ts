import type { ApiErrorBody, BarcodeLookupResponse, FoodRecord, SearchResponse, SourceId } from "../shared/types";

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody | null, message: string) {
    super(message);
  }
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new ApiError(0, null, name === "TimeoutError" ? "The request timed out. Check your connection and try again." : "You appear to be offline.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const b = body as ApiErrorBody | null;
    throw new ApiError(res.status, b, b?.message ?? `Request failed (HTTP ${res.status}).`);
  }
  return body as T;
}

export const api = {
  barcode: (code: string, opts: { format?: string; source?: SourceId | "auto" } = {}) => {
    const p = new URLSearchParams();
    if (opts.format) p.set("format", opts.format);
    if (opts.source && opts.source !== "auto") p.set("source", opts.source);
    const qs = p.toString();
    return getJson<BarcodeLookupResponse>(`/api/barcode/${encodeURIComponent(code)}${qs ? `?${qs}` : ""}`);
  },
  search: (q: string, source: SourceId = "usda", branded = false) =>
    getJson<SearchResponse>(`/api/search?${new URLSearchParams({ source, q, ...(branded ? { branded: "1" } : {}) })}`),
  food: (source: SourceId, id: string) => getJson<FoodRecord>(`/api/food/${source}/${encodeURIComponent(id)}`),
};
