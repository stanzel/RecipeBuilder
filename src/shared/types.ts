// Shared domain types used by both the Worker (API) and the browser client.

/** The nutrients this app tracks. Each is stored per the record's basis. */
export type NutrientKey = "energyKcal" | "protein" | "fiber" | "sugars" | "saltG" | "sodiumMg";

export const NUTRIENT_KEYS: NutrientKey[] = ["energyKcal", "protein", "fiber", "sugars", "saltG", "sodiumMg"];

export interface NutrientValue {
  /** Amount per basis (kcal, g, or mg for sodium). Never rounded. */
  value: number;
  /** True when computed from another value (e.g. salt from sodium, kcal from kJ). */
  derived?: boolean;
  /** Short note on how it was derived. */
  note?: string;
}

export type NutrientMap = Partial<Record<NutrientKey, NutrientValue>>;

/**
 * What the nutrient values in a record are expressed against.
 * - per100g / per100ml: values per 100 g (or 100 ml) of food
 * - perServing: values per one label serving (serving weight may be unknown)
 */
export type NutritionBasis = "per100g" | "per100ml" | "perServing";

export type SourceId = "usda" | "off" | "manual";

export type FoodKind = "generic" | "branded" | "manual";

export type SizeWord = "small" | "medium" | "large" | "extra large";

/** A household measure from the source, e.g. "1 large potato = 369 g". */
export interface Portion {
  label: string;
  gramWeight: number;
  /** Quantity the gramWeight refers to (e.g. 0.5 for "1/2 cup"). */
  amount: number;
  /** Recognised unit if this is a volume measure (tsp/tbsp/cup/ml/l/floz), else undefined. */
  volumeUnit?: VolumeUnit;
  /** Size word if the portion is a count measure (e.g. "large"). */
  size?: SizeWord;
  /** True if this looks like a count measure ("1 potato", "1 large", "1 egg"). */
  countLike: boolean;
}

export type MassUnit = "g" | "kg" | "oz" | "lb";
export type VolumeUnit = "ml" | "l" | "tsp" | "tbsp" | "cup" | "floz";
export type UnitId = MassUnit | VolumeUnit | "serving" | "package" | "each";

/**
 * One normalized nutrition record from exactly one source record.
 * A confirmed ingredient always points at exactly one of these, so data from
 * different products is never merged.
 */
export interface FoodRecord {
  /** `${source}:${sourceId}` */
  id: string;
  source: SourceId;
  sourceId: string;
  sourceName: string;
  sourceUrl?: string;
  /** e.g. "SR Legacy", "Foundation", "Survey (FNDDS)", "Branded", "Open Food Facts" */
  dataType?: string;
  kind: FoodKind;
  name: string;
  brand?: string;
  barcode?: string;
  basis: NutritionBasis;
  nutrients: NutrientMap;
  /** Label serving, when known. `grams`/`ml` may be missing for per-serving manual data. */
  serving?: { label?: string; grams?: number; ml?: number };
  /** Net package contents, when known. */
  packageSize?: { grams?: number; ml?: number; label?: string };
  portions: Portion[];
  /** Notes about data quality shown in the UI. */
  warnings?: string[];
  attribution: string;
  license: string;
  fetchedAt: string;
}

/** A search hit; confirming it fetches the full FoodRecord. */
export interface FoodCandidate {
  source: SourceId;
  sourceId: string;
  name: string;
  brand?: string;
  kind: FoodKind;
  dataType?: string;
  barcode?: string;
  /** kcal per 100 g, for display only. */
  kcalPer100?: number;
  detail?: string;
}

export interface ProviderAttempt {
  source: SourceId;
  outcome: "found" | "not_found" | "incomplete" | "error" | "skipped";
  message?: string;
}

export interface BarcodeLookupResponse {
  status: "found" | "not_found";
  /** Normalized GTIN-14 used for exact comparison. */
  gtin14: string;
  record?: FoodRecord;
  attempts: ProviderAttempt[];
  /** Missing nutrient keys when the record is incomplete. */
  missing?: NutrientKey[];
  /** Other sources that support barcode lookup and were not used for this result. */
  alternatives: SourceId[];
}

export interface SearchResponse {
  source: SourceId;
  query: string;
  candidates: FoodCandidate[];
  total?: number;
}

export interface ApiErrorBody {
  error: "bad_request" | "not_found" | "rate_limited" | "timeout" | "upstream_error" | "misconfigured" | "method_not_allowed";
  message: string;
  source?: SourceId;
  retryAfter?: number;
}
