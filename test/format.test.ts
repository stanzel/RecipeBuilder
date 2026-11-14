import { describe, expect, it } from "vitest";
import { formatRecipeText, safeRecipeUrl } from "../src/client/format";
import { calculateRecipe } from "../src/shared/nutrition";
import { parseIngredientLine } from "../src/shared/parse";
import { chicken, ing, karsOff, potato, rice } from "./helpers";

describe("safeRecipeUrl", () => {
  it("accepts http(s) links and adds https:// when missing", () => {
    expect(safeRecipeUrl("https://example.com/soup")).toBe("https://example.com/soup");
    expect(safeRecipeUrl("example.com/soup?x=1")).toBe("https://example.com/soup?x=1");
    expect(safeRecipeUrl("  http://example.org  ")).toBe("http://example.org/");
  });

  it("rejects unsafe or invalid links", () => {
    expect(safeRecipeUrl("javascript:alert(1)")).toBeNull();
    expect(safeRecipeUrl("data:text/html,hi")).toBeNull();
    expect(safeRecipeUrl("not a url")).toBeNull();
    expect(safeRecipeUrl("")).toBeNull();
    expect(safeRecipeUrl(undefined)).toBeNull();
  });
});

describe("formatRecipeText", () => {
  const ingredients = [
    ing({ ...parseIngredientLine("4 large potatoes"), record: potato() }),
    ing({ ...parseIngredientLine("1½ cups cooked rice"), record: rice() }),
    ing({ ...parseIngredientLine("250 g chicken breast"), record: chicken() }),
    ing({ quantity: 2, unit: "serving", food: "nut mix", record: karsOff() }),
  ];
  const recipe = { name: "Sample check recipe", url: "example.com/recipe", portions: 4, ingredients };
  const text = formatRecipeText(recipe, calculateRecipe(ingredients, 4));

  it("includes the title, link, portions and ingredients", () => {
    expect(text).toContain("Sample check recipe\n===================");
    expect(text).toContain("Recipe: https://example.com/recipe");
    expect(text).toContain("Portions: 4");
    expect(text).toContain("- 4 large Potatoes, flesh and skin, raw (1476 g) [USDA FoodData Central, SR Legacy]");
    expect(text).toContain("- 1½ cups Rice, white, cooked, no added fat (237 g) [USDA FoodData Central, Survey (FNDDS)]");
    expect(text).toContain("- 250 g Chicken, breast, boneless, skinless, raw [USDA FoodData Central, Foundation]");
    expect(text).toContain("- 2 servings Nut 'n berry mix (56 g) [Open Food Facts]");
  });

  it("formats the nutrition table with aligned columns and markers", () => {
    const table = text.split("\n").filter((l) => /^(Nutrition|Calories|Protein|Fiber|Total sugars|Salt|Sodium)\b/.test(l));
    expect(table).toEqual([
      "Nutrition     Whole recipe  Per portion (1/4)",
      "Calories      2003 kcal     501 kcal",
      "Protein       100.9 g       25.2 g",
      "Fiber         35.9 g *      9.0 g *",
      "Total sugars  28.2 g *      7.1 g *",
      "Salt          2.08 g †      0.52 g †",
      "Sodium        834 mg        208 mg",
    ]);
    expect(text).toContain("Fiber: missing for Chicken, breast, boneless, skinless, raw");
    expect(text).toContain("† Includes derived values");
    expect(text).toContain("Data: USDA FoodData Central (public domain); Open Food Facts contributors (ODbL).");
  });

  it("handles unmatched ingredients and an empty recipe", () => {
    const pending = [ing({ quantity: 1, unit: "each", food: "onion" })];
    const t = formatRecipeText({ name: "", portions: 2, ingredients: pending }, calculateRecipe(pending, 2));
    expect(t).toContain("Untitled recipe");
    expect(t).toContain("- 1 onion (not matched; excluded from totals)");
    expect(t).toContain("Calories      —");
    expect(t).not.toContain("Recipe:");
    const empty = formatRecipeText({ name: "X", portions: 1, ingredients: [] }, calculateRecipe([], 1));
    expect(empty).toContain("- (none)");
  });
});
