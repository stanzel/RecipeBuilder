// Cloudflare Worker entry point.
// Static assets (the app) are served by Workers Static Assets; this Worker
// only runs for /api/* (see run_worker_first in wrangler.jsonc).

import { BarcodeError, normalizeBarcode, type BarcodeFormat } from "../shared/gtin";
import type { ApiErrorBody, SourceId } from "../shared/types";
import { lookupBarcode } from "./barcode";
import { getProvider, PROVIDERS } from "./providers/registry";
import { ProviderError, type ProviderContext, type UpstreamBucket } from "./providers/types";

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** Worker secret: data.gov API key for USDA FoodData Central. */
  FDC_API_KEY?: string;
  /** Optional: "AppName/1.0 (you@example.com)" for Open Food Facts. */
  OFF_USER_AGENT?: string;
  RL_CLIENT?: RateLimiter;
  RL_USDA?: RateLimiter;
  RL_OFF_PRODUCT?: RateLimiter;
  RL_OFF_SEARCH?: RateLimiter;
}

export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface Deps {
  fetch: typeof fetch;
  cache?: CacheLike;
  waitUntil?: (p: Promise<unknown>) => void;
  timeoutMs?: number;
}

const APP_UA = "RecipeNutritionCalculator/1.0";

/** Cache lifetimes (seconds). Both providers' licences allow caching; OFF data changes often, so keep it short. */
const TTL = {
  usdaFood: 7 * 24 * 3600,
  usdaSearch: 24 * 3600,
  offProduct: 6 * 3600,
  offSearch: 3600,
  barcodeFound: 6 * 3600,
};

const SEARCH_PAGE_SIZE = 25;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function errorResponse(body: ApiErrorBody, status: number): Response {
  const extra: Record<string, string> = {};
  if (body.retryAfter) extra["Retry-After"] = String(body.retryAfter);
  return json(body, status, extra);
}

function fromProviderError(err: ProviderError): Response {
  const status = { timeout: 504, rate_limited: 503, upstream_error: 502, misconfigured: 500 }[err.kind];
  return errorResponse({ error: err.kind, message: err.message, source: err.source, retryAfter: err.retryAfter }, status);
}

function cacheable(body: unknown, ttl: number): Response {
  return json(body, 200, { "Cache-Control": `public, max-age=${Math.min(ttl, 3600)}, s-maxage=${ttl}` });
}

async function withCache(
  request: Request,
  key: string,
  deps: Deps,
  produce: () => Promise<{ body: unknown; ttl: number } | Response>,
): Promise<Response> {
  const cacheKey = new Request(`https://api-cache.invalid/v1/${key}`, { method: "GET" });
  if (deps.cache) {
    try {
      const hit = await deps.cache.match(cacheKey);
      if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set("X-Cache", "HIT");
        return res;
      }
    } catch {
      // Cache is best-effort.
    }
  }
  const out = await produce();
  if (out instanceof Response) return out;
  const res = cacheable(out.body, out.ttl);
  if (deps.cache && out.ttl > 0) {
    const p = deps.cache.put(cacheKey, res.clone()).catch(() => undefined);
    deps.waitUntil ? deps.waitUntil(p) : await p;
  }
  return res;
}

function clientKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "local";
}

function cleanQuery(q: string | null): string | null {
  if (q === null) return null;
  // Strip control characters and collapse whitespace.
  const s = q.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 80) return null;
  return s;
}

const BARCODE_FORMATS: BarcodeFormat[] = ["upc_a", "upc_e", "ean_13", "ean_8", "gtin_14"];

export async function handleApi(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse({ error: "method_not_allowed", message: "Only GET is supported." }, 405);
  }

  // Per-client abuse limit (approximate, per Cloudflare location).
  if (env.RL_CLIENT) {
    const { success } = await env.RL_CLIENT.limit({ key: `client:${clientKey(request)}` });
    if (!success) {
      return errorResponse({ error: "rate_limited", message: "Too many requests. Please wait a minute and try again.", retryAfter: 60 }, 429);
    }
  }

  const limiters: Record<UpstreamBucket, RateLimiter | undefined> = {
    usda: env.RL_USDA,
    "off-product": env.RL_OFF_PRODUCT,
    "off-search": env.RL_OFF_SEARCH,
  };
  const ctx: ProviderContext = {
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs ?? 8000,
    fdcApiKey: env.FDC_API_KEY || undefined,
    offUserAgent: env.OFF_USER_AGENT || `${APP_UA} (+${url.origin})`,
    allowUpstream: async (bucket) => {
      const rl = limiters[bucket];
      if (!rl) return true;
      return (await rl.limit({ key: bucket })).success;
    },
  };

  try {
    // GET /api/health
    if (path === "/api/health") {
      return json({ ok: true, usdaConfigured: !!env.FDC_API_KEY, offUserAgentConfigured: !!env.OFF_USER_AGENT });
    }

    // GET /api/sources — what each provider supports
    if (path === "/api/sources") {
      return json(
        Object.values(PROVIDERS).map((p) => ({ id: p.id, name: p.name, supports: p.supports })),
        200,
        { "Cache-Control": "public, max-age=3600" },
      );
    }

    // GET /api/barcode/:code?format=ean_13&source=auto|off|usda
    let m = /^\/api\/barcode\/([^/]+)$/.exec(path);
    if (m) {
      const raw = decodeURIComponent(m[1]);
      const formatParam = url.searchParams.get("format") ?? undefined;
      const hint = formatParam && (BARCODE_FORMATS as string[]).includes(formatParam) ? formatParam : undefined;
      const sourceParam = url.searchParams.get("source") ?? "auto";
      if (!["auto", "off", "usda"].includes(sourceParam)) {
        return errorResponse({ error: "bad_request", message: "source must be auto, off or usda." }, 400);
      }
      let barcodes;
      try {
        barcodes = normalizeBarcode(raw, hint);
      } catch (e) {
        if (e instanceof BarcodeError) return errorResponse({ error: "bad_request", message: e.message }, 400);
        throw e;
      }
      const only = sourceParam === "auto" ? undefined : (sourceParam as SourceId);
      const key = `barcode/${sourceParam}/${barcodes.map((b) => b.gtin14).join("+")}`;
      return await withCache(request, key, deps, async () => {
        const result = await lookupBarcode(barcodes, ctx, only);
        // Don't cache "not found": products are added to the databases all the time.
        return result.status === "found" ? { body: result, ttl: TTL.barcodeFound } : json(result, 200);
      });
    }

    // GET /api/search?source=usda|off&q=...&branded=1
    if (path === "/api/search") {
      const source = url.searchParams.get("source") ?? "usda";
      const provider = getProvider(source);
      if (!provider?.search) return errorResponse({ error: "bad_request", message: "Unknown search source." }, 400);
      const q = cleanQuery(url.searchParams.get("q"));
      if (!q) return errorResponse({ error: "bad_request", message: "Search text must be 2–80 characters." }, 400);
      const branded = url.searchParams.get("branded") === "1";
      const key = `search/${source}/${branded ? 1 : 0}/${encodeURIComponent(q.toLowerCase())}`;
      return await withCache(request, key, deps, async () => {
        const result = await provider.search!(q, { branded, pageSize: SEARCH_PAGE_SIZE }, ctx);
        return { body: result, ttl: source === "usda" ? TTL.usdaSearch : TTL.offSearch };
      });
    }

    // GET /api/food/usda/:fdcId   GET /api/food/off/:code
    m = /^\/api\/food\/(usda|off)\/([^/]+)$/.exec(path);
    if (m) {
      const [, source, id] = m;
      const valid = source === "usda" ? /^\d{1,10}$/.test(id) : /^\d{6,14}$/.test(id);
      if (!valid) return errorResponse({ error: "bad_request", message: "Invalid food ID." }, 400);
      const provider = getProvider(source)!;
      return await withCache(request, `food/${source}/${id}`, deps, async () => {
        const record = await provider.getFood!(id, ctx);
        if (!record) return errorResponse({ error: "not_found", message: "That food was not found.", source: source as SourceId }, 404);
        return { body: record, ttl: source === "usda" ? TTL.usdaFood : TTL.offProduct };
      });
    }

    return errorResponse({ error: "not_found", message: "Unknown API route." }, 404);
  } catch (err) {
    if (err instanceof ProviderError) return fromProviderError(err);
    console.error("Unhandled API error", err);
    return errorResponse({ error: "upstream_error", message: "Unexpected server error." }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      // Cache API is a no-op on some hostnames (e.g. workers.dev); it is used opportunistically.
      const cache = typeof caches !== "undefined" ? ((caches as unknown as { default: CacheLike }).default ?? undefined) : undefined;
      return handleApi(request, env, { fetch: (...a) => fetch(...a), cache, waitUntil: (p) => ctx.waitUntil(p) });
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
