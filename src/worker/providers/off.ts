// Open Food Facts provider.
// Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/
// - Reads need no key, but apps must send a descriptive User-Agent ("AppName/Version (contact)").
// - Limits per IP: 15 product reads/min, 10 search requests/min.
// - Data: ODbL 1.0 (database) / DbCL 1.0 (contents); attribution with a link is required.
// Search uses Search-a-licious (search.openfoodfacts.org), the full-text search service.

import { sameGtin, type NormalizedBarcode } from "../../shared/gtin";
import { completeSaltSodium } from "../../shared/nutrition";
import type { FoodCandidate, FoodRecord, NutrientMap, SearchResponse } from "../../shared/types";
import { ensureBudget, getJson } from "./http";
import type { FoodProvider, ProviderContext, SearchOptions } from "./types";

const PRODUCT_BASE = "https://world.openfoodfacts.org/api/v3/product";
const SEARCH_BASE = "https://search.openfoodfacts.org/search";
export const OFF_FIELDS = [
  "code",
  "product_name",
  "product_name_en",
  "generic_name",
  "brands",
  "nutriments",
  "nutrition_data_per",
  "serving_size",
  "serving_quantity",
  "serving_quantity_unit",
  "product_quantity",
  "product_quantity_unit",
  "quantity",
].join(",");

export interface RawOffProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string | string[];
  nutriments?: Record<string, number | string | undefined>;
  nutrition_data_per?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
  quantity?: string;
}

interface RawProductResponse {
  code?: string;
  status?: "success" | "success_with_warnings" | "failure" | number;
  product?: RawOffProduct;
}

interface RawSearchResponse {
  hits?: RawOffProduct[];
  count?: number;
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Map OFF nutriments for one suffix ("_100g" or "_serving"). Missing keys stay missing. */
export function mapOffNutrients(n: RawOffProduct["nutriments"], suffix: "_100g" | "_serving"): NutrientMap {
  const out: NutrientMap = {};
  if (!n) return out;
  const kcal = num(n[`energy-kcal${suffix}`]);
  const kj = num(n[`energy-kj${suffix}`]);
  const energy = num(n[`energy${suffix}`]); // OFF stores generic "energy" in kJ
  if (kcal !== undefined) out.energyKcal = { value: kcal };
  else if (kj !== undefined) out.energyKcal = { value: kj / 4.184, derived: true, note: "Calories derived from kJ ÷ 4.184" };
  else if (energy !== undefined) out.energyKcal = { value: energy / 4.184, derived: true, note: "Calories derived from kJ ÷ 4.184" };

  const protein = num(n[`proteins${suffix}`]);
  if (protein !== undefined) out.protein = { value: protein };
  const fiber = num(n[`fiber${suffix}`]);
  if (fiber !== undefined) out.fiber = { value: fiber };
  const sugars = num(n[`sugars${suffix}`]);
  if (sugars !== undefined) out.sugars = { value: sugars };
  const salt = num(n[`salt${suffix}`]);
  if (salt !== undefined) out.saltG = { value: salt };
  const sodiumG = num(n[`sodium${suffix}`]); // OFF reports sodium in grams
  if (sodiumG !== undefined) out.sodiumMg = { value: sodiumG * 1000 };
  return completeSaltSodium(out);
}

function brandText(b: RawOffProduct["brands"]): string | undefined {
  if (!b) return undefined;
  const s = Array.isArray(b) ? b.join(", ") : b;
  return s.trim() || undefined;
}

function isMl(u: string | undefined) {
  return !!u && /^(ml|cl|l)$/i.test(u.trim());
}
function toMl(v: number, u: string) {
  const unit = u.trim().toLowerCase();
  return unit === "l" ? v * 1000 : unit === "cl" ? v * 10 : v;
}
function toG(v: number, u: string | undefined) {
  const unit = (u ?? "g").trim().toLowerCase();
  return unit === "kg" ? v * 1000 : v;
}

export function normalizeOffProduct(p: RawOffProduct, fetchedAt = new Date().toISOString()): FoodRecord {
  const code = String(p.code ?? "");
  const per100 = mapOffNutrients(p.nutriments, "_100g");
  const perServing = mapOffNutrients(p.nutriments, "_serving");
  const has100 = Object.keys(per100).length > 0;

  const servingQty = num(p.serving_quantity);
  const servingUnit = p.serving_quantity_unit;
  const productQty = num(p.product_quantity);
  const productUnit = p.product_quantity_unit;
  const liquid = isMl(productUnit) || (isMl(servingUnit) && !productUnit);

  const record: FoodRecord = {
    id: `off:${code}`,
    source: "off",
    sourceId: code,
    sourceName: "Open Food Facts",
    sourceUrl: `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}`,
    dataType: "Open Food Facts",
    kind: "branded",
    name: p.product_name || p.product_name_en || p.generic_name || `Product ${code}`,
    brand: brandText(p.brands),
    barcode: code || undefined,
    // OFF "_100g" means per 100 g, or per 100 ml for liquids.
    basis: has100 ? (liquid ? "per100ml" : "per100g") : "perServing",
    nutrients: has100 ? per100 : perServing,
    portions: [],
    attribution: "Open Food Facts contributors (openfoodfacts.org)",
    license: "ODbL 1.0 (database), DbCL 1.0 (contents)",
    fetchedAt,
  };

  if (servingQty && servingQty > 0) {
    record.serving = isMl(servingUnit)
      ? { label: p.serving_size, ml: toMl(servingQty, servingUnit!) }
      : { label: p.serving_size, grams: toG(servingQty, servingUnit) };
  } else if (p.serving_size) {
    record.serving = { label: p.serving_size };
  }
  if (productQty && productQty > 0) {
    record.packageSize = isMl(productUnit)
      ? { label: p.quantity, ml: toMl(productQty, productUnit!) }
      : { label: p.quantity, grams: toG(productQty, productUnit) };
  }

  const warnings: string[] = [];
  if (!has100 && Object.keys(perServing).length) warnings.push("Only per-serving nutrition is available for this product.");
  if (!Object.keys(record.nutrients).length) warnings.push("Open Food Facts has no nutrition data for this product.");
  if (warnings.length) record.warnings = warnings;
  return record;
}

export const offProvider: FoodProvider = {
  id: "off",
  name: "Open Food Facts",
  supports: { barcode: true, search: true, detail: true },

  async lookupBarcode(barcode: NormalizedBarcode, ctx: ProviderContext): Promise<FoodRecord | null> {
    // OFF normalizes codes itself (e.g. UPC-A → EAN-13), so one request is normally enough.
    // For UPC-E we also try the 8-digit form under which some products are stored.
    const forms = barcode.format === "upc_e" ? [barcode.queryForms[0], barcode.input] : [barcode.queryForms[0]];
    for (const form of [...new Set(forms)]) {
      await ensureBudget(ctx, "off-product", "off");
      const url = `${PRODUCT_BASE}/${encodeURIComponent(form)}?fields=${OFF_FIELDS}`;
      const { status, body } = await getJson<RawProductResponse>(url, "off", ctx, { "User-Agent": ctx.offUserAgent });
      if (status === 404 || !body?.product || body.status === "failure") continue;
      const product = body.product;
      const code = product.code ?? body.code;
      // Exact match only: OFF may return a product under a different normalized code.
      if (!sameGtin(code, barcode.gtin14)) continue;
      return normalizeOffProduct({ ...product, code });
    }
    return null;
  },

  async getFood(code: string, ctx: ProviderContext): Promise<FoodRecord | null> {
    await ensureBudget(ctx, "off-product", "off");
    const url = `${PRODUCT_BASE}/${encodeURIComponent(code)}?fields=${OFF_FIELDS}`;
    const { status, body } = await getJson<RawProductResponse>(url, "off", ctx, { "User-Agent": ctx.offUserAgent });
    if (status === 404 || !body?.product || body.status === "failure") return null;
    return normalizeOffProduct({ ...body.product, code: body.product.code ?? body.code ?? code });
  },

  async search(query: string, opts: SearchOptions, ctx: ProviderContext): Promise<SearchResponse> {
    await ensureBudget(ctx, "off-search", "off");
    const url = new URL(SEARCH_BASE);
    url.searchParams.set("q", query);
    url.searchParams.set("page_size", String(opts.pageSize));
    url.searchParams.set("langs", "en");
    url.searchParams.set("fields", "code,product_name,product_name_en,brands,nutriments");
    const { body } = await getJson<RawSearchResponse>(url.toString(), "off", ctx, { "User-Agent": ctx.offUserAgent });
    const candidates: FoodCandidate[] = (body?.hits ?? [])
      .filter((h) => h.code)
      .map((h) => ({
        source: "off",
        sourceId: String(h.code),
        name: h.product_name || h.product_name_en || `Product ${h.code}`,
        brand: brandText(h.brands),
        kind: "branded",
        dataType: "Open Food Facts",
        barcode: String(h.code),
        kcalPer100: num(h.nutriments?.["energy-kcal_100g"]),
      }));
    return { source: "off", query, candidates, total: body?.count };
  },
};
