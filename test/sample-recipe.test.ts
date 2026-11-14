// Pins the numbers published in SAMPLE_RECIPE.md. If USDA or Open Food Facts
// revise these records, refresh the fixtures and update both files.
import { describe, expect, it } from "vitest";
import { calculateRecipe, formatNutrient } from "../src/shared/nutrition";
import { parseIngredientLine } from "../src/shared/parse";
import { NUTRIENT_KEYS } from "../src/shared/types";
import { chicken, ing, karsOff, potato, rice } from "./helpers";

describe("sample recipe (SAMPLE_RECIPE.md)", () => {
  const ingredients = [
    ing({ ...parseIngredientLine("4 large potatoes"), record: potato() }), // USDA 170026
    ing({ ...parseIngredientLine("1½ cups cooked rice"), record: rice() }), // USDA 2708408
    ing({ ...parseIngredientLine("250 g chicken breast"), record: chicken() }), // USDA 2646170
    ing({ quantity: 2, unit: "serving", food: "barcode 077034085228", record: karsOff() }), // OFF 0077034085228
  ];
  const res = calculateRecipe(ingredients, 4);

  it("resolves each ingredient's weight", () => {
    expect(res.perIngredient.map((r) => r.amount?.grams)).toEqual([1476, 237, 250, 56]);
  });

  it("matches the published totals", () => {
    const shown = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, [formatNutrient(k, res.total[k].value), formatNutrient(k, res.perPortion[k].value)]]));
    expect(shown).toEqual({
      energyKcal: ["2003 kcal", "501 kcal"],
      protein: ["100.9 g", "25.2 g"],
      fiber: ["35.9 g", "9.0 g"],
      sugars: ["28.2 g", "7.1 g"],
      saltG: ["2.08 g", "0.52 g"],
      sodiumMg: ["834 mg", "208 mg"],
    });
    expect(res.total.fiber.partial).toBe(true);
    expect(res.total.sugars.partial).toBe(true);
    expect(res.total.energyKcal.partial).toBe(false);
    expect(res.total.saltG.derived).toBe(true);
  });
});
