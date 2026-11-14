import type { MassUnit, SizeWord, UnitId, VolumeUnit } from "./types";

/** Grams per mass unit (avoirdupois). */
export const MASS_G: Record<MassUnit, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

/** Millilitres per volume unit (US customary for tsp/tbsp/cup/fl oz). */
export const VOLUME_ML: Record<VolumeUnit, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892159375,
  tbsp: 14.78676478125,
  cup: 236.5882365,
  floz: 29.5735295625,
};

export const UNIT_LABELS: Record<UnitId, { one: string; many: string }> = {
  g: { one: "g", many: "g" },
  kg: { one: "kg", many: "kg" },
  oz: { one: "oz", many: "oz" },
  lb: { one: "lb", many: "lb" },
  ml: { one: "ml", many: "ml" },
  l: { one: "l", many: "l" },
  tsp: { one: "tsp", many: "tsp" },
  tbsp: { one: "tbsp", many: "tbsp" },
  cup: { one: "cup", many: "cups" },
  floz: { one: "fl oz", many: "fl oz" },
  serving: { one: "serving", many: "servings" },
  package: { one: "package", many: "packages" },
  each: { one: "item", many: "items" },
};

export const ALL_UNITS: UnitId[] = ["g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "cup", "floz", "each", "serving", "package"];

export function isMass(u: UnitId): u is MassUnit {
  return u in MASS_G;
}
export function isVolume(u: UnitId): u is VolumeUnit {
  return u in VOLUME_ML;
}

/** Single-word unit aliases (lower-case, no trailing period). */
const UNIT_ALIASES: Record<string, UnitId> = {
  g: "g", gr: "g", gm: "g", gms: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  tsp: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp", tbl: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  cup: "cup", cups: "cup", c: "cup",
  floz: "floz",
  serving: "serving", servings: "serving", portion: "serving",
  package: "package", packages: "package", pkg: "package", pkgs: "package", pack: "package", packs: "package", packet: "package", packets: "package",
  each: "each", whole: "each",
};

/** Multi-word unit aliases checked before single words. */
const MULTI_WORD_UNITS: [RegExp, UnitId][] = [
  [/^(fl\.?\s*oz\.?|fluid\s+ounces?)(?=\s|$)/i, "floz"],
  [/^(label\s+servings?)(?=\s|$)/i, "serving"],
];

/** Count nouns: "2 cloves garlic" → unit each, countNoun "clove". */
const COUNT_NOUNS: Record<string, string> = {
  clove: "clove", cloves: "clove",
  slice: "slice", slices: "slice",
  piece: "piece", pieces: "piece",
  stalk: "stalk", stalks: "stalk",
  sprig: "sprig", sprigs: "sprig",
  can: "can", cans: "can",
  head: "head", heads: "head",
  fillet: "fillet", fillets: "fillet",
  leaf: "leaf", leaves: "leaf",
};

const SIZE_ALIASES: [RegExp, SizeWord][] = [
  [/^(extra[\s-]?large|x-?large|xl|jumbo)(?=\s|$)/i, "extra large"],
  [/^(large|big|lg)(?=\s|$)/i, "large"],
  [/^(medium|med|mid-?sized?)(?=\s|$)/i, "medium"],
  [/^(small|sm)(?=\s|$)/i, "small"],
];

export function matchUnitPrefix(text: string): { unit: UnitId; rest: string } | { countNoun: string; rest: string } | null {
  for (const [re, unit] of MULTI_WORD_UNITS) {
    const m = re.exec(text);
    if (m) return { unit, rest: text.slice(m[0].length).trim() };
  }
  const m = /^([a-zA-Z]+)\.?(?=\s|$|[^a-zA-Z])/.exec(text);
  if (!m) return null;
  const word = m[1].toLowerCase();
  // A single-letter "c" or "l" only counts as a unit if more text follows.
  const rest = text.slice(m[0].length).trim();
  if (UNIT_ALIASES[word] && !((word === "c" || word === "l") && !rest)) {
    return { unit: UNIT_ALIASES[word], rest };
  }
  if (COUNT_NOUNS[word]) return { countNoun: COUNT_NOUNS[word], rest };
  return null;
}

export function matchSizePrefix(text: string): { size: SizeWord; rest: string } | null {
  for (const [re, size] of SIZE_ALIASES) {
    const m = re.exec(text);
    if (m) return { size, rest: text.slice(m[0].length).trim() };
  }
  return null;
}

/** Find a size word anywhere in a portion description. */
export function findSizeWord(text: string): SizeWord | undefined {
  const t = text.toLowerCase();
  if (/\b(extra[\s-]?large|jumbo)\b/.test(t)) return "extra large";
  if (/\blarge\b/.test(t)) return "large";
  if (/\bmedium\b/.test(t)) return "medium";
  if (/\bsmall\b/.test(t)) return "small";
  return undefined;
}

/** Find a volume unit in a portion description like "1 cup, diced" or "tbsp". */
export function findVolumeUnit(text: string): VolumeUnit | undefined {
  const t = text.toLowerCase();
  if (/\b(fl\.?\s*oz|fluid ounces?)\b/.test(t)) return "floz";
  if (/\b(tbsp|tablespoons?)\b/.test(t)) return "tbsp";
  if (/\b(tsp|teaspoons?)\b/.test(t)) return "tsp";
  if (/\bcups?\b/.test(t)) return "cup";
  if (/\b(ml|milliliters?|millilitres?)\b/.test(t)) return "ml";
  if (/\b(liters?|litres?)\b/.test(t)) return "l";
  return undefined;
}

/** Mass words in a portion description; such portions are neither count nor volume. */
export function looksLikeMass(text: string): boolean {
  return /\b(oz|ounces?|lbs?|pounds?|grams?|g|kg)\b/i.test(text) && !/\bfl\.?\s*oz\b/i.test(text);
}
