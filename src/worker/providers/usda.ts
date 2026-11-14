// USDA FoodData Central provider.
// Docs: https://fdc.nal.usda.gov/api-guide  (data is CC0 / public domain; USDA asks for credit)
// Requires a data.gov API key (Worker secret FDC_API_KEY). Default limit 1,000 requests/hour per key.

import { sameGtin, type NormalizedBarcode } from "../../shared/gtin";
import { completeSaltSodium } from "../../shared/nutrition";
import { formatQuantity, parseQuantityPrefix } from "../../shared/parse";
import type { FoodCandidate, FoodRecord, NutrientMap, Portion, SearchResponse } from "../../shared/types";
import { findSizeWord, findVolumeUnit, looksLikeMass } from "../../shared/units";
import { ensureBudget, getJson } from "./http";
import { ProviderError, type FoodProvider, type ProviderContext, type SearchOptions } from "./types";

const BASE = "https://api.nal.usda.gov/fdc/v1";
export const USDA_GENERIC_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)"];

// Nutrient IDs (FDC "nutrient.id"); legacy numbers in comments.
const N = {
  energyKcal: 1008, // 208
  energyAtwaterSpecific: 2048, // 958
  energyAtwaterGeneral: 2047, // 957
  energyKj: 1062, // 268
  protein: 1003, // 203
  fiber: 1079, // 291
  fiberAoac: 2033, // 293
  sugarsTotal: 2000, // 269
  sugarsTotalNlea: 1063, // 269.3
  sodium: 1093, // 307
};

interface RawNutrient {
  // search result shape
  nutrientId?: number;
  value?: number;
  // detail shape
  nutrient?: { id?: number; unitName?: string };
  amount?: number;
  // shared
  unitName?: string;
}

interface RawPortion {
  amount?: number | null;
  modifier?: string | null;
  portionDescription?: string | null;
  gramWeight?: number | null;
  measureUnit?: { name?: string; abbreviation?: string } | null;
}

export interface RawFdcFood {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  packageWeight?: string;
  foodCategory?: string | { description?: string };
  brandedFoodCategory?: string;
  publishedDate?: string;
  publicationDate?: string;
  foodNutrients?: RawNutrient[];
  foodPortions?: RawPortion[];
}

interface RawSearch {
  totalHits?: number;
  foods?: RawFdcFood[];
}

function nutrientIndex(list: RawNutrient[] | undefined) {
  const map = new Map<number, { value: number; unit: string }>();
  for (const n of list ?? []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const value = n.value ?? n.amount;
    const unit = (n.unitName ?? n.nutrient?.unitName ?? "").toLowerCase();
    if (id === undefined || value === undefined || value === null || !Number.isFinite(Number(value))) continue;
    if (!map.has(id)) map.set(id, { value: Number(value), unit });
  }
  return map;
}

function toGrams(v: { value: number; unit: string }): number {
  if (v.unit === "mg") return v.value / 1000;
  if (v.unit === "ug" || v.unit === "µg") return v.value / 1e6;
  return v.value;
}
function toMg(v: { value: number; unit: string }): number {
  if (v.unit === "g") return v.value * 1000;
  if (v.unit === "ug" || v.unit === "µg") return v.value / 1000;
  return v.value;
}

/** Map FDC nutrients (per 100 g / 100 ml) to our nutrient keys. Missing stays missing. */
export function mapUsdaNutrients(list: RawNutrient[] | undefined): NutrientMap {
  const idx = nutrientIndex(list);
  const out: NutrientMap = {};

  const kcal = idx.get(N.energyKcal);
  const atwS = idx.get(N.energyAtwaterSpecific);
  const atwG = idx.get(N.energyAtwaterGeneral);
  const kj = idx.get(N.energyKj);
  if (kcal && kcal.unit !== "kj") out.energyKcal = { value: kcal.value };
  else if (atwS) out.energyKcal = { value: atwS.value, note: "Energy (Atwater specific factors)" };
  else if (atwG) out.energyKcal = { value: atwG.value, note: "Energy (Atwater general factors)" };
  else if (kj) out.energyKcal = { value: kj.value / 4.184, derived: true, note: "Calories derived from kJ ÷ 4.184" };

  const protein = idx.get(N.protein);
  if (protein) out.protein = { value: toGrams(protein) };

  const fiber = idx.get(N.fiber) ?? idx.get(N.fiberAoac);
  if (fiber) out.fiber = { value: toGrams(fiber) };

  const sugars = idx.get(N.sugarsTotal) ?? idx.get(N.sugarsTotalNlea);
  if (sugars) out.sugars = { value: toGrams(sugars) };

  const sodium = idx.get(N.sodium);
  if (sodium) out.sodiumMg = { value: toMg(sodium) };

  // FDC does not report salt; derive it from sodium and label it.
  return completeSaltSodium(out);
}

const SKIP_PORTION = /quantity not specified|\bnlea\b|\bracc\b|\bserving\b/i;

export function mapUsdaPortions(raw: RawPortion[] | undefined): Portion[] {
  const out: Portion[] = [];
  for (const p of raw ?? []) {
    const gramWeight = Number(p.gramWeight);
    if (!(gramWeight > 0)) continue;
    const unitName = p.measureUnit?.name && p.measureUnit.name !== "undetermined" ? p.measureUnit.name : "";
    let amount = p.amount ?? undefined;
    let label: string;
    if (p.portionDescription && !/^\d+$/.test(p.portionDescription)) {
      // FNDDS: "1 cup, cooked", "1 small"
      label = p.portionDescription;
      const q = parseQuantityPrefix(label);
      amount = q ? q.value : (amount ?? 1);
    } else {
      // SR Legacy / Foundation: amount + unit name + modifier ("Potato large (3" to 4-1/4" dia)", "cup, diced")
      const modifier = p.modifier && !/^\d+$/.test(p.modifier) ? p.modifier : "";
      label = [formatQuantity(amount ?? 1), unitName, modifier].filter((x) => x !== "" && x !== undefined).join(" ").replace(/\s+,/g, ",");
      amount = amount ?? 1;
    }
    if (!(amount! > 0)) amount = 1;
    if (SKIP_PORTION.test(label) || unitName.toUpperCase() === "RACC") continue;
    const volumeUnit = findVolumeUnit(label);
    const mass = !volumeUnit && looksLikeMass(label);
    out.push({
      label,
      gramWeight,
      amount: amount!,
      volumeUnit,
      size: volumeUnit || mass ? undefined : findSizeWord(label),
      countLike: !volumeUnit && !mass,
    });
  }
  return out;
}

/** Parse "18 oz/510 g", "1 LB", "12 fl oz/355 mL" into grams/ml. */
export function parsePackageWeight(text: string | undefined): FoodRecord["packageSize"] | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  const g = /(\d+(?:\.\d+)?)\s*(kg|g)\b/.exec(t);
  const ml = /(\d+(?:\.\d+)?)\s*(ml|l)\b/.exec(t);
  const oz = /(\d+(?:\.\d+)?)\s*oz\b/.exec(t);
  const floz = /(\d+(?:\.\d+)?)\s*fl\.?\s*oz\b/.exec(t);
  const lb = /(\d+(?:\.\d+)?)\s*lbs?\b/.exec(t);
  const out: NonNullable<FoodRecord["packageSize"]> = { label: text };
  if (g) out.grams = Number(g[1]) * (g[2] === "kg" ? 1000 : 1);
  else if (lb) out.grams = Number(lb[1]) * 453.59237;
  else if (oz && !floz) out.grams = Number(oz[1]) * 28.349523125;
  if (ml) out.ml = Number(ml[1]) * (ml[2] === "l" ? 1000 : 1);
  else if (floz) out.ml = Number(floz[1]) * 29.5735295625;
  return out.grams || out.ml ? out : undefined;
}

function isVolumeUnit(u: string | undefined) {
  return !!u && /^(ml|mlt|l|ltr)$/i.test(u);
}

export function normalizeUsdaFood(f: RawFdcFood, fetchedAt = new Date().toISOString()): FoodRecord {
  const branded = f.dataType === "Branded";
  const liquid = branded && isVolumeUnit(f.servingSizeUnit);
  const record: FoodRecord = {
    id: `usda:${f.fdcId}`,
    source: "usda",
    sourceId: String(f.fdcId),
    sourceName: "USDA FoodData Central",
    sourceUrl: `https://fdc.nal.usda.gov/food-details/${f.fdcId}/nutrients`,
    dataType: f.dataType,
    kind: branded ? "branded" : "generic",
    name: f.description,
    brand: branded ? f.brandName || f.brandOwner || undefined : undefined,
    barcode: f.gtinUpc || undefined,
    // FDC reports all nutrient amounts per 100 g (per 100 ml for liquids in Branded Foods).
    basis: liquid ? "per100ml" : "per100g",
    nutrients: mapUsdaNutrients(f.foodNutrients),
    portions: mapUsdaPortions(f.foodPortions),
    attribution: "USDA Agricultural Research Service, FoodData Central",
    license: "Public domain (CC0 1.0)",
    fetchedAt,
  };
  if (branded && f.servingSize && f.servingSize > 0) {
    record.serving = {
      label: f.householdServingFullText || undefined,
      ...(liquid ? { ml: f.servingSize } : /^(g|grm)$/i.test(f.servingSizeUnit ?? "") ? { grams: f.servingSize } : {}),
    };
    if (!record.serving.grams && !record.serving.ml) record.serving = { label: record.serving.label };
  }
  const pkg = parsePackageWeight(f.packageWeight);
  if (pkg) record.packageSize = pkg;
  if (branded) {
    record.warnings = ["USDA calculates branded per-100 g values from the label serving, so small rounding differences from the label are normal."];
  }
  return record;
}

function kcalOf(f: RawFdcFood): number | undefined {
  return mapUsdaNutrients(f.foodNutrients).energyKcal?.value;
}

function categoryText(f: RawFdcFood): string | undefined {
  if (typeof f.foodCategory === "string") return f.foodCategory;
  return f.foodCategory?.description ?? f.brandedFoodCategory;
}

function requireKey(ctx: ProviderContext): string {
  if (!ctx.fdcApiKey) {
    throw new ProviderError("misconfigured", "usda", "USDA FoodData Central is not configured: set the FDC_API_KEY Worker secret.");
  }
  return ctx.fdcApiKey;
}

export const usdaProvider: FoodProvider = {
  id: "usda",
  name: "USDA FoodData Central",
  supports: { barcode: true, search: true, detail: true },

  async search(query: string, opts: SearchOptions, ctx: ProviderContext): Promise<SearchResponse> {
    const key = requireKey(ctx);
    await ensureBudget(ctx, "usda", "usda");
    const types = opts.branded ? [...USDA_GENERIC_TYPES, "Branded"] : USDA_GENERIC_TYPES;
    const url = new URL(`${BASE}/foods/search`);
    url.searchParams.set("query", query);
    url.searchParams.set("dataType", types.join(","));
    url.searchParams.set("pageSize", String(opts.pageSize));
    url.searchParams.set("api_key", key);
    const { body } = await getJson<RawSearch>(url.toString(), "usda", ctx);
    const candidates: FoodCandidate[] = (body?.foods ?? []).map((f) => ({
      source: "usda",
      sourceId: String(f.fdcId),
      name: f.description,
      brand: f.dataType === "Branded" ? f.brandName || f.brandOwner : undefined,
      kind: f.dataType === "Branded" ? "branded" : "generic",
      dataType: f.dataType,
      barcode: f.gtinUpc,
      kcalPer100: kcalOf(f),
      detail: categoryText(f),
    }));
    return { source: "usda", query, candidates, total: body?.totalHits };
  },

  async getFood(id: string, ctx: ProviderContext): Promise<FoodRecord | null> {
    const key = requireKey(ctx);
    await ensureBudget(ctx, "usda", "usda");
    const url = `${BASE}/food/${encodeURIComponent(id)}?api_key=${encodeURIComponent(key)}`;
    const { status, body } = await getJson<RawFdcFood>(url, "usda", ctx);
    if (status === 404 || !body || !body.fdcId) return null;
    return normalizeUsdaFood(body);
  },

  async lookupBarcode(barcode: NormalizedBarcode, ctx: ProviderContext): Promise<FoodRecord | null> {
    const key = requireKey(ctx);
    // FDC stores gtinUpc as text of varying length (12, 13 or 14 digits). Search each
    // equivalent form and accept only an exact GTIN-14 match.
    for (const form of barcode.queryForms) {
      await ensureBudget(ctx, "usda", "usda");
      const url = new URL(`${BASE}/foods/search`);
      url.searchParams.set("query", form);
      url.searchParams.set("dataType", "Branded");
      url.searchParams.set("pageSize", "10");
      url.searchParams.set("api_key", key);
      const { body } = await getJson<RawSearch>(url.toString(), "usda", ctx);
      const exact = (body?.foods ?? []).filter((f) => sameGtin(f.gtinUpc, barcode.gtin14));
      if (exact.length) {
        // Several FDC records can share a GTIN across label revisions; use the newest.
        exact.sort((a, b) => String(b.publishedDate ?? "").localeCompare(String(a.publishedDate ?? "")) || b.fdcId - a.fdcId);
        return normalizeUsdaFood(exact[0]);
      }
    }
    return null;
  },
};
