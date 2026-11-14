import { describe, expect, it } from "vitest";
import type { BarcodeLookupResponse, FoodRecord, SearchResponse } from "../src/shared/types";
import { handleApi, type Env, type RateLimiter } from "../src/worker/index";
import { fixture, jsonResponse, mockFetch } from "./helpers";

const ENV: Env = { FDC_API_KEY: "test-key" };
const OFF_PRODUCT = "world.openfoodfacts.org/api/v3/product/";
const USDA_SEARCH = "api.nal.usda.gov/fdc/v1/foods/search";

function call(path: string, fetchFn: typeof fetch, env: Env = ENV, init?: RequestInit) {
  return handleApi(new Request(`https://app.example${path}`, init), env, { fetch: fetchFn, timeoutMs: 50 });
}

describe("barcode lookup", () => {
  it("returns an Open Food Facts exact match first", async () => {
    const m = mockFetch([[OFF_PRODUCT, () => jsonResponse(fixture("off-product-0077034085228.json"))]]);
    const res = await call("/api/barcode/077034085228", m.fetch);
    const body = (await res.json()) as BarcodeLookupResponse;
    expect(res.status).toBe(200);
    expect(body.status).toBe("found");
    expect(body.record!.source).toBe("off");
    expect(body.record!.barcode).toBe("0077034085228"); // leading zero preserved
    expect(body.attempts).toEqual([{ source: "off", outcome: "found" }]);
    expect(body.alternatives).toEqual(["usda"]);
    // Only one provider call, and it identified the app.
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].url).toContain("/product/077034085228?"); // sent as entered; OFF normalizes to EAN-13
    expect(m.calls[0].headers["user-agent"]).toMatch(/^RecipeNutritionCalculator\/1\.0/);
  });

  it("falls back to USDA Branded Foods with an exact GTIN comparison when OFF has no match", async () => {
    const m = mockFetch([
      [OFF_PRODUCT, () => jsonResponse(fixture("off-product-not-found.json"), 404)],
      [USDA_SEARCH, () => jsonResponse(fixture("usda-search-gtin-077034085228.json"))],
    ]);
    const res = await call("/api/barcode/077034085228", m.fetch);
    const body = (await res.json()) as BarcodeLookupResponse;
    expect(body.status).toBe("found");
    expect(body.record!.source).toBe("usda");
    expect(body.record!.sourceId).toBe("2105222");
    expect(body.record!.barcode).toBe("077034085228");
    expect(body.record!.kind).toBe("branded");
    expect(body.record!.serving).toEqual({ label: "1 ONZ", grams: 28 });
    expect(body.record!.packageSize?.grams).toBe(510);
    expect(body.attempts.map((a) => a.outcome)).toEqual(["not_found", "found"]);
    const usdaUrl = new URL(m.calls[1].url);
    expect(usdaUrl.searchParams.get("query")).toBe("077034085228"); // as a string, zeros intact
    expect(usdaUrl.searchParams.get("dataType")).toBe("Branded");
  });

  it("matches the same product when the user types the EAN-13 form", async () => {
    const m = mockFetch([
      [OFF_PRODUCT, () => jsonResponse(fixture("off-product-not-found.json"), 404)],
      [USDA_SEARCH, () => jsonResponse(fixture("usda-search-gtin-077034085228.json"))],
    ]);
    const body = (await (await call("/api/barcode/0077034085228", m.fetch)).json()) as BarcodeLookupResponse;
    expect(body.status).toBe("found");
    expect(body.gtin14).toBe("00077034085228");
  });

  it("rejects USDA results whose GTIN only resembles the barcode", async () => {
    const search = fixture("usda-search-gtin-077034085228.json");
    search.foods[0].gtinUpc = "770340852280"; // different product that happens to contain the digits
    const m = mockFetch([
      [OFF_PRODUCT, () => jsonResponse(fixture("off-product-not-found.json"), 404)],
      [USDA_SEARCH, () => jsonResponse(search)],
    ]);
    const body = (await (await call("/api/barcode/077034085228", m.fetch)).json()) as BarcodeLookupResponse;
    expect(body.status).toBe("not_found");
    // Tried each equivalent form (UPC-A, EAN-13, GTIN-14) before giving up.
    expect(m.calls.filter((c) => c.url.includes(USDA_SEARCH)).map((c) => new URL(c.url).searchParams.get("query"))).toEqual([
      "077034085228",
      "0077034085228",
      "00077034085228",
    ]);
  });

  it("rejects an OFF product returned under a different code", async () => {
    const other = fixture("off-product-0077034085228.json");
    other.product.code = "0077034085235";
    const m = mockFetch([
      [OFF_PRODUCT, () => jsonResponse(other)],
      [USDA_SEARCH, () => jsonResponse({ totalHits: 0, foods: [] })],
    ]);
    const body = (await (await call("/api/barcode/077034085228", m.fetch)).json()) as BarcodeLookupResponse;
    expect(body.status).toBe("not_found");
  });

  it("falls back to USDA when OFF times out, and reports the OFF error", async () => {
    const m = mockFetch([
      [OFF_PRODUCT, () => new Promise<Response>(() => {})], // never resolves → our timeout fires
      [USDA_SEARCH, () => jsonResponse(fixture("usda-search-gtin-077034085228.json"))],
    ]);
    // The mock ignores AbortSignal, so emulate fetch honouring it:
    const fetchWithAbort = ((url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        Promise.resolve(m.fetch(url, init)).then(resolve, reject);
      })) as typeof fetch;
    const body = (await (await call("/api/barcode/077034085228", fetchWithAbort)).json()) as BarcodeLookupResponse;
    expect(body.status).toBe("found");
    expect(body.record!.source).toBe("usda");
    expect(body.attempts[0]).toMatchObject({ source: "off", outcome: "error" });
    expect(body.attempts[0].message).toMatch(/did not respond/);
  });

  it("automatically tries USDA when the OFF product has no nutrition data", async () => {
    const empty = fixture("off-product-0077034085228.json");
    empty.product.nutriments = {};
    const m = mockFetch([
      [OFF_PRODUCT, () => jsonResponse(empty)],
      [USDA_SEARCH, () => jsonResponse(fixture("usda-search-gtin-077034085228.json"))],
    ]);
    const body = (await (await call("/api/barcode/077034085228", m.fetch)).json()) as BarcodeLookupResponse;
    expect(body.record!.source).toBe("usda");
    expect(body.attempts.map((a) => a.outcome)).toEqual(["incomplete", "found"]);
  });

  it("returns an incomplete match with alternatives instead of mixing sources", async () => {
    const partial = fixture("off-product-0077034085228.json");
    for (const k of Object.keys(partial.product.nutriments)) if (k.startsWith("fiber")) delete partial.product.nutriments[k];
    const m = mockFetch([[OFF_PRODUCT, () => jsonResponse(partial)]]);
    const body = (await (await call("/api/barcode/077034085228", m.fetch)).json()) as BarcodeLookupResponse;
    expect(body.status).toBe("found");
    expect(body.record!.source).toBe("off");
    expect(body.missing).toEqual(["fiber"]);
    expect(body.record!.nutrients.fiber).toBeUndefined(); // not filled in from another source
    expect(body.alternatives).toEqual(["usda"]);
    expect(m.calls).toHaveLength(1);
  });

  it("can be asked for a specific source (the 'try USDA instead' button)", async () => {
    const m = mockFetch([[USDA_SEARCH, () => jsonResponse(fixture("usda-search-gtin-077034085228.json"))]]);
    const body = (await (await call("/api/barcode/077034085228?source=usda", m.fetch)).json()) as BarcodeLookupResponse;
    expect(body.record!.source).toBe("usda");
    expect(m.calls.every((c) => c.url.includes("nal.usda.gov"))).toBe(true);
  });

  it("returns not_found when no source has the product", async () => {
    const m = mockFetch([
      [OFF_PRODUCT, () => jsonResponse(fixture("off-product-not-found.json"), 404)],
      [USDA_SEARCH, () => jsonResponse({ totalHits: 0, foods: [] })],
    ]);
    const res = await call("/api/barcode/3017624010701", m.fetch);
    const body = (await res.json()) as BarcodeLookupResponse;
    expect(res.status).toBe(200);
    expect(body.status).toBe("not_found");
    expect(body.attempts.map((a) => a.outcome)).toEqual(["not_found", "not_found"]);
  });

  it("surfaces an error when every source fails", async () => {
    const m = mockFetch([
      [OFF_PRODUCT, () => new Response("busy", { status: 503 })],
      [USDA_SEARCH, () => jsonResponse(fixture("usda-rate-limit.json"), 429)],
    ]);
    const res = await call("/api/barcode/077034085228", m.fetch);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("validates barcodes before calling any provider", async () => {
    const m = mockFetch([]);
    for (const bad of ["abc", "12345", "077034085229"]) {
      const res = await call(`/api/barcode/${bad}`, m.fetch);
      expect(res.status).toBe(400);
    }
    expect((await call("/api/barcode/077034085228?source=evil", m.fetch)).status).toBe(400);
    expect(m.calls).toHaveLength(0);
  });
});

describe("search and food detail", () => {
  it("searches USDA generic foods by default and labels kinds", async () => {
    const m = mockFetch([[USDA_SEARCH, () => jsonResponse(fixture("usda-search-potato-raw.json"))]]);
    const res = await call("/api/search?q=potato%20raw", m.fetch);
    const body = (await res.json()) as SearchResponse;
    expect(body.candidates[0]).toMatchObject({ source: "usda", sourceId: "170032", kind: "generic", dataType: "SR Legacy" });
    const url = new URL(m.calls[0].url);
    expect(url.searchParams.get("dataType")).toBe("Foundation,SR Legacy,Survey (FNDDS)");
    expect(url.searchParams.get("api_key")).toBe("test-key");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage");
  });

  it("encodes USDA dataType values with %20, never '+' (FDC matches them exactly)", async () => {
    const m = mockFetch([[USDA_SEARCH, () => jsonResponse({ foods: [] })]]);
    await call("/api/search?q=white%20sugar", m.fetch);
    const raw = m.calls[0].url;
    expect(raw).toContain("query=white%20sugar");
    expect(raw).toContain("dataType=Foundation%2CSR%20Legacy%2CSurvey%20(FNDDS)");
    expect(raw).not.toContain("+");
  });

  it("explains a USDA 400 without leaking the API key", async () => {
    const m = mockFetch([
      [USDA_SEARCH, () => jsonResponse({ error: { code: "BAD_REQUEST", message: "Invalid dataType for api_key=test-key" } }, 400)],
    ]);
    const res = await call("/api/search?q=white%20sugar", m.fetch);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.message).toContain("HTTP 400 (Invalid dataType");
    expect(body.message).not.toContain("test-key");
  });

  it("includes branded foods on request", async () => {
    const m = mockFetch([[USDA_SEARCH, () => jsonResponse({ foods: [] })]]);
    await call("/api/search?q=yogurt&branded=1", m.fetch);
    expect(new URL(m.calls[0].url).searchParams.get("dataType")).toContain("Branded");
  });

  it("searches Open Food Facts for more candidates", async () => {
    const m = mockFetch([["search.openfoodfacts.org/search", () => jsonResponse(fixture("off-search-greek-yogurt.json"))]]);
    const body = (await (await call("/api/search?source=off&q=greek%20yogurt", m.fetch)).json()) as SearchResponse;
    expect(body.candidates[0]).toMatchObject({ source: "off", sourceId: "0894700010137", kind: "branded", brand: "Chobani" });
  });

  it("fetches a USDA food with household portions", async () => {
    const m = mockFetch([["/fdc/v1/food/170026", () => jsonResponse(fixture("usda-food-170026-potato.json"))]]);
    const record = (await (await call("/api/food/usda/170026", m.fetch)).json()) as FoodRecord;
    expect(record.name).toBe("Potatoes, flesh and skin, raw");
    expect(record.portions.map((p) => [p.size, p.gramWeight])).toContainEqual(["large", 369]);
    expect(record.nutrients.saltG?.derived).toBe(true);
  });

  it("returns 404 for an unknown food", async () => {
    const m = mockFetch([["/fdc/v1/food/1", () => jsonResponse({}, 404)]]);
    expect((await call("/api/food/usda/1", m.fetch)).status).toBe(404);
  });

  it("validates search text and IDs", async () => {
    const m = mockFetch([]);
    expect((await call("/api/search?q=a", m.fetch)).status).toBe(400);
    expect((await call(`/api/search?q=${"x".repeat(81)}`, m.fetch)).status).toBe(400);
    expect((await call("/api/search?q=rice&source=nope", m.fetch)).status).toBe(400);
    expect((await call("/api/food/usda/abc", m.fetch)).status).toBe(400);
    expect((await call("/api/food/off/12", m.fetch)).status).toBe(400);
    expect(m.calls).toHaveLength(0);
  });
});

describe("errors, limits and configuration", () => {
  it("maps a USDA 429 to a rate-limited error", async () => {
    const m = mockFetch([[USDA_SEARCH, () => jsonResponse(fixture("usda-rate-limit.json"), 429)]]);
    const res = await call("/api/search?q=rice", m.fetch);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "rate_limited", source: "usda" });
  });

  it("maps an upstream 500 to upstream_error", async () => {
    const m = mockFetch([[USDA_SEARCH, () => new Response("oops", { status: 500 })]]);
    const res = await call("/api/search?q=rice", m.fetch);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_error", source: "usda" });
  });

  it("maps a network failure to upstream_error", async () => {
    const failing = (async () => {
      throw new TypeError("network down");
    }) as typeof fetch;
    const res = await call("/api/search?q=rice", failing);
    expect(res.status).toBe(502);
  });

  it("reports a missing USDA key clearly", async () => {
    const res = await call("/api/search?q=rice", mockFetch([]).fetch, {});
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "misconfigured" });
  });

  it("applies the per-client rate limit", async () => {
    const deny: RateLimiter = { limit: async () => ({ success: false }) };
    const res = await call("/api/search?q=rice", mockFetch([]).fetch, { ...ENV, RL_CLIENT: deny });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("protects the shared upstream budget", async () => {
    const deny: RateLimiter = { limit: async () => ({ success: false }) };
    const m = mockFetch([]);
    const res = await call("/api/search?q=rice", m.fetch, { ...ENV, RL_USDA: deny });
    expect(res.status).toBe(503);
    expect(m.calls).toHaveLength(0);
  });

  it("only allows GET", async () => {
    const res = await call("/api/search?q=rice", mockFetch([]).fetch, ENV, { method: "POST", body: "{}" });
    expect(res.status).toBe(405);
  });

  it("serves cached responses without calling the provider", async () => {
    const store = new Map<string, Response>();
    const cache = {
      match: async (r: Request) => store.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => void store.set(r.url, res),
    };
    const m = mockFetch([["/fdc/v1/food/170026", () => jsonResponse(fixture("usda-food-170026-potato.json"))]]);
    const deps = { fetch: m.fetch, cache, timeoutMs: 50 };
    await handleApi(new Request("https://app.example/api/food/usda/170026"), ENV, deps);
    const second = await handleApi(new Request("https://app.example/api/food/usda/170026"), ENV, deps);
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(m.calls).toHaveLength(1);
  });
});
