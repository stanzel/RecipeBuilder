import type { NormalizedBarcode } from "../../shared/gtin";
import type { FoodRecord, SearchResponse, SourceId } from "../../shared/types";

/** Everything a provider needs from the outside world (injected so tests can mock it). */
export interface ProviderContext {
  fetch: typeof fetch;
  timeoutMs: number;
  /** USDA FoodData Central API key (Worker secret). */
  fdcApiKey?: string;
  /** User-Agent sent to Open Food Facts, which asks apps to identify themselves. */
  offUserAgent: string;
  /** Optional upstream throttle; returns false when this provider's budget is spent. */
  allowUpstream?: (bucket: UpstreamBucket) => Promise<boolean>;
}

export type UpstreamBucket = "usda" | "off-product" | "off-search";

export interface SearchOptions {
  /** Include branded/packaged foods (USDA only; OFF is always branded). */
  branded: boolean;
  pageSize: number;
}

/**
 * The common interface every food data source implements.
 * To add a third source: implement this, register it in registry.ts, and add
 * its ID to SourceId in shared/types.ts.
 */
export interface FoodProvider {
  id: SourceId;
  name: string;
  supports: {
    barcode: boolean;
    search: boolean;
    detail: boolean;
  };
  /** Exact barcode lookup. Must return null unless the product's GTIN equals `barcode.gtin14`. */
  lookupBarcode?(barcode: NormalizedBarcode, ctx: ProviderContext): Promise<FoodRecord | null>;
  search?(query: string, opts: SearchOptions, ctx: ProviderContext): Promise<SearchResponse>;
  /** Fetch one full record by the provider's own ID. */
  getFood?(id: string, ctx: ProviderContext): Promise<FoodRecord | null>;
}

export type ProviderErrorKind = "timeout" | "rate_limited" | "upstream_error" | "misconfigured";

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    public source: SourceId,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
