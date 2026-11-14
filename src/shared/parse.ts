import type { SizeWord, UnitId } from "./types";
import { matchSizePrefix, matchUnitPrefix } from "./units";

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4,
  "⅕": 1 / 5, "⅖": 2 / 5, "⅗": 3 / 5, "⅘": 4 / 5, "⅙": 1 / 6, "⅚": 5 / 6,
  "⅐": 1 / 7, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8, "⅑": 1 / 9, "⅒": 1 / 10,
};
const FRAC_CLASS = Object.keys(UNICODE_FRACTIONS).join("");

export interface ParsedQuantity {
  value: number;
  rest: string;
}

/**
 * Parse a leading quantity: decimals ("1.5", "0,5"), fractions ("1/2", "1⁄2"),
 * unicode fractions ("½"), and mixed numbers ("1 1/2", "1-1/2", "1½", "1 ½").
 */
export function parseQuantityPrefix(input: string): ParsedQuantity | null {
  const s = input.replace(/⁄/g, "/").trimStart();
  let m: RegExpExecArray | null;

  // Mixed number with ASCII fraction: "1 1/2" or "1-1/2"
  if ((m = /^(\d+)(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+)(?![\d/])/.exec(s))) {
    const den = Number(m[3]);
    if (den === 0) return null;
    return { value: Number(m[1]) + Number(m[2]) / den, rest: s.slice(m[0].length) };
  }
  // Mixed number with unicode fraction: "1½" or "1 ½"
  if ((m = new RegExp(`^(\\d+)\\s*([${FRAC_CLASS}])`).exec(s))) {
    return { value: Number(m[1]) + UNICODE_FRACTIONS[m[2]], rest: s.slice(m[0].length) };
  }
  // Simple fraction "1/2"
  if ((m = /^(\d+)\s*\/\s*(\d+)(?![\d/])/.exec(s))) {
    const den = Number(m[2]);
    if (den === 0) return null;
    return { value: Number(m[1]) / den, rest: s.slice(m[0].length) };
  }
  // Lone unicode fraction "½"
  if ((m = new RegExp(`^([${FRAC_CLASS}])`).exec(s))) {
    return { value: UNICODE_FRACTIONS[m[1]], rest: s.slice(m[0].length) };
  }
  // Decimal "1.5", ".5", or decimal comma "0,5" (only when 1-2 digits follow, so "1,000" is not misread)
  if ((m = /^(\d*\.\d+|\d+,\d{1,2}(?!\d)|\d+)/.exec(s))) {
    return { value: Number(m[1].replace(",", ".")), rest: s.slice(m[0].length) };
  }
  // "a"/"an" as one
  if ((m = /^(an?)\s+/i.exec(s))) {
    return { value: 1, rest: s.slice(m[0].length) };
  }
  return null;
}

/** Parse a free-form quantity field (used by the editable quantity input). */
export function parseQuantity(text: string): number | null {
  const p = parseQuantityPrefix(text.trim());
  if (!p || p.rest.trim() !== "") return null;
  return Number.isFinite(p.value) ? p.value : null;
}

export interface ParsedLine {
  quantity: number;
  /** True when the line contained an explicit quantity. */
  quantityGiven: boolean;
  unit: UnitId;
  size?: SizeWord;
  countNoun?: string;
  food: string;
}

/**
 * Turn "4 large potatoes", "1½ cups cooked rice" or "250 g chicken breast"
 * into editable fields. The food text is what we search for.
 */
export function parseIngredientLine(line: string): ParsedLine {
  let rest = line.trim().replace(/\s+/g, " ");
  const q = parseQuantityPrefix(rest);
  let quantity = 1;
  let quantityGiven = false;
  if (q) {
    quantity = q.value;
    quantityGiven = true;
    rest = q.rest.trim();
    // "2 x 400 g" style multiplier is not supported; strip a lone "x".
    rest = rest.replace(/^x\s+/i, "");
  }

  let unit: UnitId | undefined;
  let size: SizeWord | undefined;
  let countNoun: string | undefined;

  const takeUnit = () => {
    const u = matchUnitPrefix(rest);
    if (!u) return false;
    if ("unit" in u) unit = u.unit;
    else countNoun = u.countNoun;
    rest = u.rest;
    return true;
  };

  if (!takeUnit()) {
    const s = matchSizePrefix(rest);
    if (s) {
      size = s.size;
      rest = s.rest;
      takeUnit(); // "2 large cloves garlic"
    }
  }

  rest = rest.replace(/^of\s+/i, "").replace(/^[,.\s]+|[,.\s]+$/g, "");
  return {
    quantity,
    quantityGiven,
    unit: unit ?? "each",
    size,
    countNoun,
    food: rest,
  };
}

/** Format a number as a friendly fraction for display (e.g. 1.5 → "1½"). Display only. */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n)) return "";
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const nice: [number, string][] = [[1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"], [1 / 8, "⅛"]];
  for (const [v, sym] of nice) {
    if (Math.abs(frac - v) < 1e-6) return (whole ? String(whole) : "") + sym;
  }
  return String(Math.round(n * 1000) / 1000);
}
