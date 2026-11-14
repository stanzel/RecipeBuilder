import { describe, expect, it } from "vitest";
import {
  calculateRecipe,
  completeSaltSodium,
  formatNutrient,
  ingredientNutrition,
  resolveAmount,
  saltFromSodiumMg,
  sodiumMgFromSalt,
} from "../src/shared/nutrition";
import { parseIngredientLine } from "../src/shared/parse";
import type { FoodRecord } from "../src/shared/types";
import { normalizeOffProduct } from "../src/worker/providers/off";
import { chicken, ing, karsOff, potato, rice } from "./helpers";

describe("4 large potatoes", () => {
  it("uses the selected potato record's weight for one large potato", () => {
    const p = parseIngredientLine("4 large potatoes");
    const record = potato();
    const large = record.portions.find((x) => x.size === "large")!;
    expect(large.gramWeight).toBe(369);

    const a = resolveAmount(ing({ ...p, record }), record);
    expect(a.ok).toBe(true);
    expect(a.gramsPerUnit).toBe(369);
    expect(a.grams).toBe(1476);
    expect(a.explanation).toContain("4 × 369 g");
    expect(a.perUnitSource).toMatch(/large/i);
  });

  it("calculates nutrients from 1476 g of raw potato", () => {
    const record = potato();
    const r = ingredientNutrition(ing({ ...parseIngredientLine("4 large potatoes"), record }));
    expect(r.status).toBe("ok");
    expect(r.values.energyKcal!.value).toBeCloseTo(1476 * 0.77, 6); // 77 kcal/100 g
    expect(r.values.protein!.value).toBeCloseTo(1476 * 0.0205, 6);
    expect(r.values.fiber!.value).toBeCloseTo(1476 * 0.021, 6);
    expect(r.values.sugars!.value).toBeCloseTo(1476 * 0.0082, 6);
    expect(r.values.sodiumMg!.value).toBeCloseTo(1476 * 0.06, 6);
  });

  it("honours a grams-per-potato override", () => {
    const record = potato();
    const a = resolveAmount(ing({ ...parseIngredientLine("4 large potatoes"), record, gramsPerUnitOverride: 300 }), record);
    expect(a.grams).toBe(1200);
    expect(a.perUnitSource).toBe("your override");
  });

  it("asks for a weight when the size doesn't exist in the record", () => {
    const record = potato();
    const a = resolveAmount(ing({ quantity: 2, unit: "each", size: "extra large", record }), record);
    expect(a.ok).toBe(false);
    expect(a.problem).toMatch(/no "extra large" size/);
    expect(a.problem).toMatch(/large \(369 g\)/);
    expect(a.problem).toMatch(/Enter grams per item/);
  });

  it("asks for a weight when the record has no per-item portion", () => {
    const record = chicken(); // Foundation chicken only has an RACC portion (skipped)
    const a = resolveAmount(ing({ quantity: 2, unit: "each", record }), record);
    expect(a.ok).toBe(false);
    expect(a.problem).toMatch(/no per-item weight/);
  });

  it("picks medium when no size is given and several sizes exist", () => {
    const record = potato();
    const a = resolveAmount(ing({ quantity: 1, unit: "each", record }), record);
    expect(a.gramsPerUnit).toBe(213);
  });
});

describe("volume and mixed fractions", () => {
  it("1½ cups cooked rice uses the record's own cup weight", () => {
    const p = parseIngredientLine("1½ cups cooked rice");
    const record = rice();
    const a = resolveAmount(ing({ ...p, record }), record);
    expect(a.ok).toBe(true);
    expect(a.gramsPerUnit).toBe(158);
    expect(a.grams).toBeCloseTo(237, 10);
  });

  it("'1 1/2 cups' and '1-1/2 cups' give the same result", () => {
    const record = rice();
    const g1 = resolveAmount(ing({ ...parseIngredientLine("1 1/2 cups rice"), record }), record).grams;
    const g2 = resolveAmount(ing({ ...parseIngredientLine("1-1/2 cups rice"), record }), record).grams;
    expect(g1).toBeCloseTo(237, 10);
    expect(g2).toBeCloseTo(237, 10);
  });

  it("converts tablespoons using the food-specific density from the cup measure", () => {
    const record = rice(); // 1 cup = 158 g → 158/236.588 g/ml
    const a = resolveAmount(ing({ quantity: 2, unit: "tbsp", record }), record);
    expect(a.ok).toBe(true);
    expect(a.grams).toBeCloseTo(2 * (158 / 16), 6); // 16 tbsp per US cup
    expect(a.perUnitSource).toMatch(/density from 1 cup, cooked/);
  });

  it("refuses volume when a record has no volume measure or density", () => {
    const record = chicken();
    const a = resolveAmount(ing({ quantity: 1, unit: "cup", record }), record);
    expect(a.ok).toBe(false);
    expect(a.problem).toMatch(/no volume measure or density/);
  });
});

describe("label data: per 100 g and per serving", () => {
  it("scales per-100 g label data by grams", () => {
    const record = karsOff();
    expect(record.basis).toBe("per100g");
    const r = ingredientNutrition(ing({ quantity: 56, unit: "g", record }));
    expect(r.values.energyKcal!.value).toBeCloseTo(280, 6);
    expect(r.values.fiber!.value).toBeCloseTo(0.56 * 7.1, 6);
  });

  it("uses label servings for a per-100 g product when the serving weight is known", () => {
    const record = karsOff(); // serving 28 g
    const a = resolveAmount(ing({ quantity: 2, unit: "serving", record }), record);
    expect(a.grams).toBe(56);
    expect(a.multiplier).toBeCloseTo(0.56, 10);
  });

  it("supports per-serving data with an unknown serving weight, in servings", () => {
    const manual: FoodRecord = {
      id: "manual:x", source: "manual", sourceId: "x", sourceName: "Manual entry", kind: "manual", name: "Grandma's sauce",
      basis: "perServing",
      nutrients: completeSaltSodium({ energyKcal: { value: 90 }, protein: { value: 2 }, saltG: { value: 0.5 } }),
      portions: [], attribution: "", license: "", fetchedAt: "",
    };
    const r = ingredientNutrition(ing({ quantity: 1.5, unit: "serving", record: manual }));
    expect(r.status).toBe("ok");
    expect(r.values.energyKcal!.value).toBeCloseTo(135, 10);
    expect(r.values.sodiumMg!.value).toBeCloseTo(300, 10); // 0.75 g salt → 300 mg sodium
    expect(r.values.sodiumMg!.derived).toBe(true);
    expect(r.missing).toEqual(["fiber", "sugars"]);

    // Grams can't be converted without a serving weight
    const g = resolveAmount(ing({ quantity: 100, unit: "g", record: manual }), manual);
    expect(g.ok).toBe(false);
    expect(g.problem).toMatch(/serving weight is unknown/);
  });

  it("handles OFF products that only have per-serving values", () => {
    const record = normalizeOffProduct({
      code: "0012345678905",
      product_name: "Protein bar",
      nutriments: { "energy-kcal_serving": 200, proteins_serving: 20, sodium_serving: 0.15 },
      serving_quantity: 50,
      serving_size: "1 bar (50 g)",
    });
    expect(record.basis).toBe("perServing");
    expect(record.nutrients.saltG).toMatchObject({ value: 0.375, derived: true });
    const r = ingredientNutrition(ing({ quantity: 75, unit: "g", record }));
    expect(r.values.energyKcal!.value).toBeCloseTo(300, 10); // 1.5 servings
    expect(r.values.sodiumMg!.value).toBeCloseTo(225, 10);
  });

  it("uses the package weight when known", () => {
    const record = { ...karsOff(), packageSize: { grams: 510 } };
    expect(resolveAmount(ing({ quantity: 0.5, unit: "package", record }), record).grams).toBe(255);
    const noPkg = karsOff();
    expect(resolveAmount(ing({ quantity: 1, unit: "package", record: noPkg }), noPkg).problem).toMatch(/package size is unknown/);
  });
});

describe("salt and sodium", () => {
  it("derives salt from sodium as mg × 2.5 ÷ 1000", () => {
    expect(saltFromSodiumMg(400)).toBe(1);
    expect(sodiumMgFromSalt(1)).toBe(400);
    const n = completeSaltSodium({ sodiumMg: { value: 245 } });
    expect(n.saltG).toMatchObject({ value: 0.6125, derived: true });
  });

  it("keeps a directly reported salt value", () => {
    const n = completeSaltSodium({ saltG: { value: 1.2 }, sodiumMg: { value: 400 } });
    expect(n.saltG).toEqual({ value: 1.2 });
    expect(n.sodiumMg).toEqual({ value: 400 });
  });

  it("derives sodium from salt when only salt is reported", () => {
    const n = completeSaltSodium({ saltG: { value: 1.5 } });
    expect(n.sodiumMg).toMatchObject({ value: 600, derived: true });
  });

  it("USDA records get derived salt; OFF records keep reported salt", () => {
    expect(rice().nutrients.saltG).toMatchObject({ value: 0.6125, derived: true });
    expect(karsOff().nutrients.saltG).toEqual({ value: 0 });
    expect(karsOff().nutrients.saltG!.derived).toBeUndefined();
  });

  it("leaves both missing when neither is reported", () => {
    expect(completeSaltSodium({ protein: { value: 1 } })).toEqual({ protein: { value: 1 } });
  });
});

describe("recipe totals", () => {
  it("never counts missing nutrients as zero and marks the total partial", () => {
    const res = calculateRecipe(
      [ing({ quantity: 250, unit: "g", record: chicken() }), ing({ quantity: 100, unit: "g", record: potato() })],
      1,
    );
    // Foundation chicken has no fiber or sugar values.
    expect(res.total.fiber.partial).toBe(true);
    expect(res.total.fiber.missingFrom).toEqual(["Chicken, breast, boneless, skinless, raw"]);
    expect(res.total.fiber.value).toBeCloseTo(2.1, 10); // potato only
    expect(res.total.protein.partial).toBe(false);
    expect(res.total.saltG.derived).toBe(true);
    expect(res.anyPartial).toBe(true);
  });

  it("marks every total partial when an ingredient's quantity can't be calculated", () => {
    const res = calculateRecipe(
      [ing({ quantity: 100, unit: "g", record: potato() }), ing({ quantity: 1, unit: "cup", record: chicken() })],
      2,
    );
    for (const k of ["energyKcal", "protein", "saltG"] as const) expect(res.total[k].partial).toBe(true);
    expect(res.perIngredient[1].status).toBe("needs_amount");
  });

  it("marks totals partial when an ingredient is not yet confirmed", () => {
    const res = calculateRecipe([ing({ quantity: 100, unit: "g", record: potato() }), ing({ quantity: 1, unit: "each", food: "onion" })], 1);
    expect(res.total.energyKcal.partial).toBe(true);
    expect(res.total.energyKcal.missingFrom).toEqual(["onion"]);
  });

  it("recalculates per portion when portions change", () => {
    const ings = [ing({ ...parseIngredientLine("4 large potatoes"), record: potato() })];
    const one = calculateRecipe(ings, 1);
    const four = calculateRecipe(ings, 4);
    const six = calculateRecipe(ings, 6);
    expect(one.total.energyKcal.value).toBeCloseTo(1136.52, 6);
    expect(four.total.energyKcal.value).toBeCloseTo(1136.52, 6);
    expect(four.perPortion.energyKcal.value).toBeCloseTo(284.13, 6);
    expect(six.perPortion.energyKcal.value).toBeCloseTo(189.42, 6);
  });

  it("rejects non-integer or non-positive portions", () => {
    expect(() => calculateRecipe([], 0)).toThrow(RangeError);
    expect(() => calculateRecipe([], 2.5)).toThrow(RangeError);
    expect(() => calculateRecipe([], -1)).toThrow(RangeError);
  });

  it("recalculates when an ingredient is edited, duplicated or removed", () => {
    const p = ing({ quantity: 100, unit: "g", record: potato() });
    let list = [p];
    expect(calculateRecipe(list, 1).total.energyKcal.value).toBeCloseTo(77, 10);
    list = [p, { ...p, id: "dup" }]; // duplicate
    expect(calculateRecipe(list, 1).total.energyKcal.value).toBeCloseTo(154, 10);
    list = [{ ...p, quantity: 200 }, list[1]]; // edit
    expect(calculateRecipe(list, 1).total.energyKcal.value).toBeCloseTo(231, 10);
    list = [list[1]]; // remove
    expect(calculateRecipe(list, 1).total.energyKcal.value).toBeCloseTo(77, 10);
  });

  it("rounds only for display", () => {
    expect(formatNutrient("energyKcal", 1136.52)).toBe("1137 kcal");
    expect(formatNutrient("saltG", 0.2214)).toBe("0.22 g");
    expect(formatNutrient("sodiumMg", 88.56)).toBe("89 mg");
    expect(formatNutrient("protein", 30.258)).toBe("30.3 g");
  });
});
