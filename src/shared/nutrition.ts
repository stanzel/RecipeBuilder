import type { FoodRecord, NutrientKey, NutrientMap, Portion, SizeWord, UnitId } from "./types";
import { NUTRIENT_KEYS } from "./types";
import { formatQuantity } from "./parse";
import { isMass, isVolume, MASS_G, UNIT_LABELS, VOLUME_ML } from "./units";

// ---------------------------------------------------------------------------
// Salt / sodium
// ---------------------------------------------------------------------------

/** Salt equivalent (g) = sodium (mg) × 2.5 ÷ 1000. */
export function saltFromSodiumMg(sodiumMg: number): number {
  return (sodiumMg * 2.5) / 1000;
}
/** Sodium (mg) = salt (g) × 1000 ÷ 2.5. */
export function sodiumMgFromSalt(saltG: number): number {
  return (saltG * 1000) / 2.5;
}

/**
 * Fill in salt from sodium (or sodium from salt) when only one is reported.
 * A directly reported value is always kept. Derived values are flagged.
 */
export function completeSaltSodium(n: NutrientMap): NutrientMap {
  const out: NutrientMap = { ...n };
  if (out.saltG === undefined && out.sodiumMg !== undefined) {
    out.saltG = { value: saltFromSodiumMg(out.sodiumMg.value), derived: true, note: "Salt derived from sodium (mg × 2.5 ÷ 1000)" };
  } else if (out.sodiumMg === undefined && out.saltG !== undefined) {
    out.sodiumMg = { value: sodiumMgFromSalt(out.saltG.value), derived: true, note: "Sodium derived from salt (g × 1000 ÷ 2.5)" };
  }
  return out;
}

export function missingNutrients(n: NutrientMap): NutrientKey[] {
  return NUTRIENT_KEYS.filter((k) => n[k] === undefined || !Number.isFinite(n[k]!.value));
}

// ---------------------------------------------------------------------------
// Ingredients and amounts
// ---------------------------------------------------------------------------

export interface Ingredient {
  id: string;
  /** Original typed line, if any. */
  text?: string;
  quantity: number;
  unit: UnitId;
  size?: SizeWord;
  countNoun?: string;
  /** Food search text. */
  food: string;
  /** Label of a specific household portion chosen by the user. */
  portionLabel?: string;
  /** User override: grams for ONE unit (one potato, one cup, one serving...). */
  gramsPerUnitOverride?: number;
  /** The single confirmed nutrition record. Never merged with another. */
  record?: FoodRecord;
  /**
   * Record id whose zero/missing calories the user marked as reviewed.
   * Tied to the record so choosing a different food brings the flag back.
   */
  caloriesReviewedFor?: string;
}

// ---------------------------------------------------------------------------
// Calorie review flag (display only; never affects totals)
// ---------------------------------------------------------------------------

export interface CalorieReview {
  /** Why calories look suspicious; undefined when they look fine. */
  reason?: "zero" | "missing";
  /** The user confirmed this entry's calories for its current record. */
  reviewed: boolean;
  /** Show the "Needs review" flag. */
  needsReview: boolean;
}

/**
 * Flag an entry whose food lists 0 kcal, or whose calories are missing, blank,
 * null or not a finite number. Checks the record's own value (per its basis),
 * so a small amount of a caloric food is not flagged. Entries without a chosen
 * food are not flagged here: they already show their own prompt and aren't counted.
 */
export function calorieReview(ing: Ingredient): CalorieReview {
  const rec = ing.record;
  if (!rec) return { reviewed: false, needsReview: false };
  const v: unknown = rec.nutrients?.energyKcal?.value;
  const reason = typeof v !== "number" || !Number.isFinite(v) ? "missing" : v === 0 ? "zero" : undefined;
  const reviewed = !!reason && ing.caloriesReviewedFor === rec.id;
  return { reason, reviewed, needsReview: !!reason && !reviewed };
}

export interface AmountResult {
  ok: boolean;
  /** Total weight used, if known. */
  grams?: number;
  /** Total volume used, if known. */
  ml?: number;
  /** Grams for one unit (one potato, one cup...), if applicable. */
  gramsPerUnit?: number;
  /** Where the per-unit weight came from. */
  perUnitSource?: string;
  /** Factor applied to the record's per-basis nutrient values. */
  multiplier?: number;
  /** Human explanation, e.g. "4 × 369 g (Potato large) = 1476 g". */
  explanation: string;
  /** When !ok: what the user needs to provide. */
  problem?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function unitWord(unit: UnitId, qty: number) {
  const l = UNIT_LABELS[unit];
  return qty === 1 ? l.one : l.many;
}

/** Pick the household portion for a count quantity ("4 large potatoes"). */
export function pickCountPortion(
  portions: Portion[],
  size: SizeWord | undefined,
  countNoun: string | undefined,
): { portion?: Portion; problem?: string } {
  const counts = portions.filter((p) => p.countLike);
  if (!counts.length) return { problem: "This food record has no per-item weight." };
  if (size) {
    const match = counts.find((p) => p.size === size);
    if (match) return { portion: match };
    const sizes = counts.filter((p) => p.size).map((p) => `${p.size} (${round1(p.gramWeight / p.amount)} g)`);
    return {
      problem: sizes.length
        ? `This record has no "${size}" size. Available: ${sizes.join(", ")}.`
        : `This record has no "${size}" size.`,
    };
  }
  if (countNoun) {
    const m = counts.find((p) => p.label.toLowerCase().includes(countNoun));
    if (m) return { portion: m };
  }
  const unsized = counts.filter((p) => !p.size);
  if (unsized.length === 1) return { portion: unsized[0] };
  const medium = counts.find((p) => p.size === "medium");
  if (medium) return { portion: medium };
  if (counts.length === 1) return { portion: counts[0] };
  return { problem: "Choose a size or a portion for this item." };
}

/** Grams per ml for this record, from a volume portion or serving, if any. */
export function densityFor(record: FoodRecord): { gPerMl: number; source: string } | undefined {
  const vp = record.portions.find((p) => p.volumeUnit && p.amount > 0 && p.gramWeight > 0);
  if (vp) return { gPerMl: vp.gramWeight / (vp.amount * VOLUME_ML[vp.volumeUnit!]), source: `${vp.label} = ${round1(vp.gramWeight)} g` };
  const s = record.serving;
  if (s?.grams && s.ml) return { gPerMl: s.grams / s.ml, source: `serving ${s.grams} g = ${s.ml} ml` };
  const pk = record.packageSize;
  if (pk?.grams && pk.ml) return { gPerMl: pk.grams / pk.ml, source: `package ${pk.grams} g = ${pk.ml} ml` };
  return undefined;
}

/** Portions that make sense for a given unit, for the "measure" picker in the UI. */
export function compatiblePortions(record: FoodRecord, unit: UnitId): Portion[] {
  if (unit === "each") return record.portions.filter((p) => p.countLike);
  if (isVolume(unit)) return record.portions.filter((p) => p.volumeUnit);
  return [];
}

/**
 * Resolve how much of the record's basis an ingredient represents.
 * Never guesses: when a weight, size or density is missing it returns ok=false
 * with a problem the UI turns into a prompt.
 */
export function resolveAmount(ing: Ingredient, record: FoodRecord): AmountResult {
  const q = ing.quantity;
  if (!(q > 0) || !Number.isFinite(q)) {
    return { ok: false, explanation: "", problem: "Enter a quantity greater than zero." };
  }
  const qText = formatQuantity(q);
  let grams: number | undefined;
  let ml: number | undefined;
  let servings: number | undefined;
  let gramsPerUnit: number | undefined;
  let perUnitSource: string | undefined;
  let explanation = "";

  const override = ing.gramsPerUnitOverride;
  if (override !== undefined && override > 0 && !isMass(ing.unit)) {
    gramsPerUnit = override;
    perUnitSource = "your override";
    grams = q * override;
    explanation = `${qText} × ${round1(override)} g (your override) = ${round1(grams)} g`;
  } else if (isMass(ing.unit)) {
    grams = q * MASS_G[ing.unit];
    explanation = ing.unit === "g" ? `${round1(grams)} g` : `${qText} ${unitWord(ing.unit, q)} = ${round1(grams)} g`;
  } else if (isVolume(ing.unit)) {
    ml = q * VOLUME_ML[ing.unit];
    const unit = ing.unit;
    // 1) A household measure in the same unit ("1 cup, cooked = 158 g").
    const sameUnit = record.portions.filter((p) => p.volumeUnit === unit && p.amount > 0);
    const chosen =
      sameUnit.find((p) => p.label === ing.portionLabel) ??
      record.portions.find((p) => p.volumeUnit && p.label === ing.portionLabel) ??
      sameUnit[0];
    if (chosen && chosen.volumeUnit === unit) {
      gramsPerUnit = chosen.gramWeight / chosen.amount;
      perUnitSource = chosen.label;
      grams = q * gramsPerUnit;
      explanation = `${qText} ${unitWord(unit, q)} × ${round1(gramsPerUnit)} g (${chosen.label}) = ${round1(grams)} g`;
    } else if (record.basis === "per100ml" || (record.basis === "perServing" && record.serving?.ml)) {
      explanation = `${qText} ${unitWord(unit, q)} = ${round1(ml)} ml`;
    } else {
      // 2) Food-specific density from another volume measure.
      const vp = chosen ?? record.portions.find((p) => p.volumeUnit && p.amount > 0);
      const d = vp
        ? { gPerMl: vp.gramWeight / (vp.amount * VOLUME_ML[vp.volumeUnit!]), source: `${vp.label} = ${round1(vp.gramWeight)} g` }
        : densityFor(record);
      if (!d) {
        return {
          ok: false,
          ml,
          explanation: `${qText} ${unitWord(unit, q)} = ${round1(ml)} ml`,
          problem: `This record has no volume measure or density, so ${UNIT_LABELS[unit].many} can't be converted to grams. Enter grams per ${UNIT_LABELS[unit].one}, or use a weight.`,
        };
      }
      gramsPerUnit = d.gPerMl * VOLUME_ML[unit];
      perUnitSource = `density from ${d.source}`;
      grams = q * gramsPerUnit;
      explanation = `${qText} ${unitWord(unit, q)} × ${round1(gramsPerUnit)} g (${perUnitSource}) = ${round1(grams)} g`;
    }
  } else if (ing.unit === "serving") {
    servings = q;
    const s = record.serving;
    if (s?.grams) {
      gramsPerUnit = s.grams;
      perUnitSource = `label serving${s.label ? ` (${s.label})` : ""}`;
      grams = q * s.grams;
      explanation = `${qText} ${unitWord("serving", q)} × ${round1(s.grams)} g = ${round1(grams)} g`;
    } else if (s?.ml) {
      ml = q * s.ml;
      explanation = `${qText} ${unitWord("serving", q)} × ${round1(s.ml)} ml = ${round1(ml)} ml`;
    } else if (record.basis === "perServing") {
      explanation = `${qText} ${unitWord("serving", q)} (serving weight not stated)`;
    } else {
      return { ok: false, explanation: "", problem: "This record has no serving weight. Enter grams per serving, or use a weight." };
    }
  } else if (ing.unit === "package") {
    const pk = record.packageSize;
    if (pk?.grams) {
      gramsPerUnit = pk.grams;
      perUnitSource = "package weight";
      grams = q * pk.grams;
      explanation = `${qText} ${unitWord("package", q)} × ${round1(pk.grams)} g = ${round1(grams)} g`;
    } else if (pk?.ml) {
      ml = q * pk.ml;
      explanation = `${qText} ${unitWord("package", q)} × ${round1(pk.ml)} ml = ${round1(ml)} ml`;
    } else {
      return { ok: false, explanation: "", problem: "The package size is unknown. Enter grams per package, or use grams or servings." };
    }
  } else {
    // each / count
    const chosen = ing.portionLabel ? record.portions.find((p) => p.countLike && p.label === ing.portionLabel) : undefined;
    const pick = chosen ? { portion: chosen } : pickCountPortion(record.portions, ing.size, ing.countNoun);
    if (!pick.portion) {
      return { ok: false, explanation: "", problem: `${pick.problem} Enter grams per item, or use a weight or another measure.` };
    }
    gramsPerUnit = pick.portion.gramWeight / pick.portion.amount;
    perUnitSource = pick.portion.label;
    grams = q * gramsPerUnit;
    explanation = `${qText} × ${round1(gramsPerUnit)} g (${pick.portion.label}) = ${round1(grams)} g`;
  }

  // Convert to the record's basis.
  let multiplier: number | undefined;
  if (record.basis === "per100g") {
    if (grams === undefined && ml !== undefined) {
      const d = densityFor(record);
      if (d) grams = ml * d.gPerMl;
    }
    if (grams !== undefined) multiplier = grams / 100;
  } else if (record.basis === "per100ml") {
    if (ml === undefined && grams !== undefined) {
      const d = densityFor(record);
      if (d) ml = grams / d.gPerMl;
    }
    if (ml !== undefined) multiplier = ml / 100;
  } else {
    // perServing
    if (servings !== undefined && (ing.unit === "serving")) multiplier = servings;
    else if (grams !== undefined && record.serving?.grams) multiplier = grams / record.serving.grams;
    else if (ml !== undefined && record.serving?.ml) multiplier = ml / record.serving.ml;
  }

  if (multiplier === undefined) {
    const need =
      record.basis === "perServing"
        ? "This record's nutrition is per serving, but the serving weight is unknown. Use servings, or enter grams per serving."
        : record.basis === "per100ml"
          ? "This record's nutrition is per 100 ml and there is no density to convert from weight. Use a volume measure."
          : "Enter a weight for this ingredient.";
    return { ok: false, grams, ml, gramsPerUnit, perUnitSource, explanation, problem: need };
  }
  return { ok: true, grams, ml, gramsPerUnit, perUnitSource, multiplier, explanation };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface NutrientTotal {
  /** Sum over ingredients that report this nutrient. Unrounded. */
  value: number;
  /** True if any ingredient lacked this nutrient or could not be calculated. */
  partial: boolean;
  /** True if any contributing value was derived (e.g. salt from sodium). */
  derived: boolean;
  /** Names of ingredients that are missing this nutrient or could not be calculated. */
  missingFrom: string[];
}

export type NutrientTotals = Record<NutrientKey, NutrientTotal>;

export interface IngredientNutrition {
  ingredient: Ingredient;
  amount?: AmountResult;
  /** Nutrients for the amount used; undefined entry = not reported by the source. */
  values: Partial<Record<NutrientKey, { value: number; derived: boolean }>>;
  missing: NutrientKey[];
  status: "ok" | "unconfirmed" | "needs_amount";
  /** Zero/missing-calorie review flag. Informational only. */
  calories: CalorieReview;
}

export function ingredientNutrition(ing: Ingredient): IngredientNutrition {
  const calories = calorieReview(ing);
  if (!ing.record) return { ingredient: ing, values: {}, missing: [...NUTRIENT_KEYS], status: "unconfirmed", calories };
  const amount = resolveAmount(ing, ing.record);
  if (!amount.ok || amount.multiplier === undefined) {
    return { ingredient: ing, amount, values: {}, missing: [...NUTRIENT_KEYS], status: "needs_amount", calories };
  }
  const values: IngredientNutrition["values"] = {};
  const missing: NutrientKey[] = [];
  for (const k of NUTRIENT_KEYS) {
    const nv = ing.record.nutrients[k];
    if (nv === undefined || !Number.isFinite(nv.value)) {
      missing.push(k); // never treated as zero
    } else {
      values[k] = { value: nv.value * amount.multiplier, derived: !!nv.derived };
    }
  }
  return { ingredient: ing, amount, values, missing, status: "ok", calories };
}

export interface RecipeResult {
  perIngredient: IngredientNutrition[];
  total: NutrientTotals;
  perPortion: NutrientTotals;
  portions: number;
  /** True if any nutrient total is partial. */
  anyPartial: boolean;
  /** Entries flagged for calorie review (zero or missing kcal, not yet reviewed). */
  needsReviewCount: number;
}

export function isValidPortionCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

function labelFor(ing: Ingredient): string {
  return ing.record?.name ?? (ing.food || ing.text || "Unnamed ingredient");
}

export function calculateRecipe(ingredients: Ingredient[], portions: number): RecipeResult {
  if (!isValidPortionCount(portions)) throw new RangeError("Portions must be a positive whole number.");
  const perIngredient = ingredients.map(ingredientNutrition);
  const total = {} as NutrientTotals;
  const perPortion = {} as NutrientTotals;
  let anyPartial = false;
  for (const k of NUTRIENT_KEYS) {
    let value = 0;
    let derived = false;
    const missingFrom: string[] = [];
    for (const r of perIngredient) {
      const v = r.values[k];
      if (v) {
        value += v.value;
        derived ||= v.derived;
      } else {
        missingFrom.push(labelFor(r.ingredient));
      }
    }
    const partial = missingFrom.length > 0;
    anyPartial ||= partial;
    total[k] = { value, partial, derived, missingFrom };
    perPortion[k] = { value: value / portions, partial, derived, missingFrom };
  }
  const needsReviewCount = perIngredient.filter((r) => r.calories.needsReview).length;
  return { perIngredient, total, perPortion, portions, anyPartial, needsReviewCount };
}

// ---------------------------------------------------------------------------
// Display helpers (rounding happens ONLY here)
// ---------------------------------------------------------------------------

export const NUTRIENT_META: Record<NutrientKey, { label: string; unit: string; decimals: number }> = {
  energyKcal: { label: "Calories", unit: "kcal", decimals: 0 },
  protein: { label: "Protein", unit: "g", decimals: 1 },
  fiber: { label: "Fiber", unit: "g", decimals: 1 },
  sugars: { label: "Total sugars", unit: "g", decimals: 1 },
  saltG: { label: "Salt", unit: "g", decimals: 2 },
  sodiumMg: { label: "Sodium", unit: "mg", decimals: 0 },
};

export function formatNutrient(k: NutrientKey, value: number): string {
  const { decimals, unit } = NUTRIENT_META[k];
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return `${r.toFixed(decimals)} ${unit}`;
}
