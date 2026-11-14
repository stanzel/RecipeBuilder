import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Ingredient } from "../src/shared/nutrition";
import type { FoodRecord } from "../src/shared/types";
import { normalizeUsdaFood, type RawFdcFood } from "../src/worker/providers/usda";
import { normalizeOffProduct } from "../src/worker/providers/off";

const here = dirname(fileURLToPath(import.meta.url));

export function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(here, "fixtures", name), "utf8")) as T;
}

export const FIXED_TIME = "2026-11-13T00:00:00.000Z";

export const potato = (): FoodRecord => normalizeUsdaFood(fixture<RawFdcFood>("usda-food-170026-potato.json"), FIXED_TIME);
export const chicken = (): FoodRecord => normalizeUsdaFood(fixture<RawFdcFood>("usda-food-2646170-chicken.json"), FIXED_TIME);
export const rice = (): FoodRecord => normalizeUsdaFood(fixture<RawFdcFood>("usda-food-2708408-rice.json"), FIXED_TIME);
export const karsOff = (): FoodRecord => normalizeOffProduct(fixture("off-product-0077034085228.json").product, FIXED_TIME);

let n = 0;
export function ing(partial: Partial<Ingredient> & Pick<Ingredient, "quantity" | "unit">): Ingredient {
  return { id: `i${++n}`, food: "", ...partial };
}

type Route = [match: string | RegExp, respond: (url: string) => Response | Promise<Response>];

/** A fetch mock that answers by URL pattern and records calls. Unmatched URLs fail the test. */
export function mockFetch(routes: Route[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    calls.push({ url, headers });
    for (const [m, respond] of routes) {
      if (typeof m === "string" ? url.includes(m) : m.test(url)) return respond(url);
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
