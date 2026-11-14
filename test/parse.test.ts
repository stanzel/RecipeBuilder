import { describe, expect, it } from "vitest";
import { formatQuantity, parseIngredientLine, parseQuantity, parseQuantityPrefix } from "../src/shared/parse";

describe("parseQuantityPrefix", () => {
  it.each([
    ["4", 4],
    ["1.5", 1.5],
    [".5", 0.5],
    ["0,5", 0.5],
    ["1/2", 0.5],
    ["3/4", 0.75],
    ["1 1/2", 1.5],
    ["1-1/2", 1.5],
    ["2 3/4", 2.75],
    ["½", 0.5],
    ["1½", 1.5],
    ["1 ½", 1.5],
    ["2⅓", 2 + 1 / 3],
    ["1⁄4", 0.25], // fraction slash
    ["an", 1],
  ])("parses %s", (text, expected) => {
    const r = parseQuantityPrefix(text + " cup");
    expect(r).not.toBeNull();
    expect(r!.value).toBeCloseTo(expected, 10);
  });

  it("does not read a thousands separator as a decimal comma", () => {
    expect(parseQuantity("1,000")).toBeNull();
  });

  it("rejects division by zero and junk", () => {
    expect(parseQuantity("1/0")).toBeNull();
    expect(parseQuantity("abc")).toBeNull();
    expect(parseQuantity("1 1/2 extra")).toBeNull();
  });
});

describe("parseIngredientLine", () => {
  it("parses '4 large potatoes' as a count with a size", () => {
    expect(parseIngredientLine("4 large potatoes")).toEqual({
      quantity: 4,
      quantityGiven: true,
      unit: "each",
      size: "large",
      countNoun: undefined,
      food: "potatoes",
    });
  });

  it("parses '1½ cups cooked rice' with a unicode mixed number", () => {
    const p = parseIngredientLine("1½ cups cooked rice");
    expect(p.quantity).toBe(1.5);
    expect(p.unit).toBe("cup");
    expect(p.food).toBe("cooked rice");
  });

  it("parses '1 1/2 cups cooked rice' with an ASCII mixed number", () => {
    const p = parseIngredientLine("1 1/2 cups cooked rice");
    expect(p.quantity).toBe(1.5);
    expect(p.unit).toBe("cup");
  });

  it("parses '250 g chicken breast' and '250g chicken breast'", () => {
    for (const line of ["250 g chicken breast", "250g chicken breast", "250 grams of chicken breast"]) {
      const p = parseIngredientLine(line);
      expect(p).toMatchObject({ quantity: 250, unit: "g", food: "chicken breast" });
    }
  });

  it.each([
    ["2 lb ground beef", 2, "lb", "ground beef"],
    ["1.5 kg flour", 1.5, "kg", "flour"],
    ["8 oz cheddar", 8, "oz", "cheddar"],
    ["12 fl oz milk", 12, "floz", "milk"],
    ["2 tbsp olive oil", 2, "tbsp", "olive oil"],
    ["½ tsp salt", 0.5, "tsp", "salt"],
    ["500 ml stock", 500, "ml", "stock"],
    ["1 l water", 1, "l", "water"],
    ["2 servings granola", 2, "serving", "granola"],
    ["1 package tofu", 1, "package", "tofu"],
    ["3 eggs", 3, "each", "eggs"],
  ] as const)("parses %s", (line, q, unit, food) => {
    expect(parseIngredientLine(line)).toMatchObject({ quantity: q, unit, food });
  });

  it("keeps count nouns for portion matching", () => {
    expect(parseIngredientLine("2 large cloves garlic")).toMatchObject({ quantity: 2, unit: "each", size: "large", countNoun: "clove", food: "garlic" });
  });

  it("defaults to 1 item when no quantity is given", () => {
    expect(parseIngredientLine("banana")).toMatchObject({ quantity: 1, quantityGiven: false, unit: "each", food: "banana" });
  });

  it("does not treat a food starting with 'l' or 'c' as a unit", () => {
    expect(parseIngredientLine("2 lemons")).toMatchObject({ unit: "each", food: "lemons" });
    expect(parseIngredientLine("3 carrots")).toMatchObject({ unit: "each", food: "carrots" });
  });
});

describe("formatQuantity", () => {
  it("shows friendly fractions", () => {
    expect(formatQuantity(1.5)).toBe("1½");
    expect(formatQuantity(0.25)).toBe("¼");
    expect(formatQuantity(4)).toBe("4");
    expect(formatQuantity(1.2345)).toBe("1.235");
  });
});
