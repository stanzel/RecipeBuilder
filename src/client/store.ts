import type { Ingredient } from "../shared/nutrition";
import { isValidPortionCount } from "../shared/nutrition";

export interface Recipe {
  version: 1;
  name: string;
  portions: number;
  ingredients: Ingredient[];
}

const KEY = "recipe-nutrition:current:v1";

export function emptyRecipe(): Recipe {
  return { version: 1, name: "", portions: 4, ingredients: [] };
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Load the saved recipe. Records (nutrition snapshots) are stored with it, so no refetch is needed. */
export function loadRecipe(): Recipe {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyRecipe();
    const r = JSON.parse(raw) as Partial<Recipe>;
    if (r.version !== 1 || !Array.isArray(r.ingredients)) return emptyRecipe();
    return {
      version: 1,
      name: typeof r.name === "string" ? r.name : "",
      portions: isValidPortionCount(r.portions) ? r.portions : 1,
      ingredients: r.ingredients.filter((i) => i && typeof i.id === "string" && typeof i.quantity === "number"),
    };
  } catch {
    return emptyRecipe();
  }
}

export function saveRecipe(r: Recipe): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
    return true;
  } catch {
    return false; // private mode / storage full: app still works, just not persisted
  }
}
