// Plain-text recipe for the clipboard. Pure functions so they can be unit-tested.

import { formatNutrient, NUTRIENT_META, type RecipeResult } from "../shared/nutrition";
import { formatQuantity } from "../shared/parse";
import type { Ingredient } from "../shared/nutrition";
import type { NutrientKey } from "../shared/types";
import { UNIT_LABELS } from "../shared/units";

const ROWS: NutrientKey[] = ["energyKcal", "protein", "fiber", "sugars", "saltG", "sodiumMg"];

/** Return a safe http(s) URL, or null. Adds https:// when the scheme is omitted. Never allows javascript: etc. */
export function safeRecipeUrl(raw: string | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.href;
  } catch {
    return null;
  }
}

export function ingredientAmountText(i: Ingredient): string {
  const q = i.quantity > 0 ? formatQuantity(i.quantity) : "?";
  if (i.unit === "each") {
    const noun = i.countNoun ? ` ${i.countNoun}${i.quantity === 1 ? "" : "s"}` : "";
    return `${q}${i.size ? ` ${i.size}` : ""}${noun}`;
  }
  const u = UNIT_LABELS[i.unit];
  return `${q} ${i.quantity === 1 ? u.one : u.many}`;
}

const pad = (s: string, n: number) => s + " ".repeat(Math.max(1, n - s.length));

export interface RecipeTextInput {
  name: string;
  url?: string;
  portions: number;
  ingredients: Ingredient[];
}

/** Format the recipe, its ingredients and the nutrition table as plain text. */
export function formatRecipeText(recipe: RecipeTextInput, result: RecipeResult): string {
  const lines: string[] = [];
  const title = recipe.name.trim() || "Untitled recipe";
  lines.push(title, "=".repeat(Math.min(title.length, 60)));
  const url = safeRecipeUrl(recipe.url);
  if (url) lines.push(`Recipe: ${url}`);
  lines.push(`Portions: ${result.portions}`, "");

  lines.push("Ingredients");
  if (!recipe.ingredients.length) lines.push("- (none)");
  result.perIngredient.forEach((r) => {
    const i = r.ingredient;
    const amount = ingredientAmountText(i);
    if (!i.record) {
      lines.push(`- ${amount} ${i.food || i.text || ""}`.trimEnd() + " (not matched; excluded from totals)");
      return;
    }
    const grams = r.amount?.grams !== undefined ? `${Math.round(r.amount.grams)} g` : r.amount?.ml !== undefined ? `${Math.round(r.amount.ml)} ml` : "";
    const brand = i.record.brand ? `${i.record.brand} ` : "";
    const src = [i.record.sourceName, i.record.dataType && i.record.dataType !== i.record.sourceName ? i.record.dataType : ""].filter(Boolean).join(", ");
    let line = `- ${amount} ${brand}${i.record.name}`;
    if (grams && !/^\d+(\.\d+)? (g|ml)$/.test(amount)) line += ` (${grams})`;
    line += ` [${src}]`;
    if (r.status === "needs_amount") line += " (amount incomplete; excluded from totals)";
    lines.push(line);
  });
  lines.push("");

  const count = result.perIngredient.length;
  const cells = ROWS.map((k) => {
    const t = result.total[k];
    const p = result.perPortion[k];
    const none = count === 0 || t.missingFrom.length === count;
    const mark = none ? "" : `${t.partial ? " *" : ""}${t.derived ? " †" : ""}`;
    const label = k === "sodiumMg" ? "Sodium" : NUTRIENT_META[k].label;
    return [label, none ? "—" : formatNutrient(k, t.value) + mark, none ? "—" : formatNutrient(k, p.value) + mark];
  });
  const header = ["Nutrition", "Whole recipe", `Per portion (1/${result.portions})`];
  const w0 = Math.max(header[0].length, ...cells.map((c) => c[0].length)) + 2;
  const w1 = Math.max(header[1].length, ...cells.map((c) => c[1].length)) + 2;
  lines.push(pad(header[0], w0) + pad(header[1], w1) + header[2]);
  for (const c of cells) lines.push((pad(c[0], w0) + pad(c[1], w1) + c[2]).trimEnd());

  const partial = ROWS.filter((k) => result.total[k].partial && result.total[k].missingFrom.length < count);
  if (partial.length) {
    lines.push("", "* Partial total (missing values are not counted as zero):");
    for (const k of partial) lines.push(`  ${NUTRIENT_META[k].label}: missing for ${result.total[k].missingFrom.join(", ")}`);
  }
  if (ROWS.some((k) => result.total[k].derived)) {
    lines.push("", "† Includes derived values (salt = sodium mg × 2.5 ÷ 1000, or sodium from salt).");
  }

  const sources = new Set(recipe.ingredients.map((i) => i.record?.source).filter(Boolean));
  const credits: string[] = [];
  if (sources.has("usda")) credits.push("USDA FoodData Central (public domain)");
  if (sources.has("off")) credits.push("Open Food Facts contributors (ODbL)");
  if (sources.has("manual")) credits.push("manual entries");
  lines.push("", `Values are estimates.${credits.length ? ` Data: ${credits.join("; ")}.` : ""}`);
  return lines.join("\n");
}

/** Copy text, with a fallback for browsers without the async Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
