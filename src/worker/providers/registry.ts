import type { SourceId } from "../../shared/types";
import { offProvider } from "./off";
import type { FoodProvider } from "./types";
import { usdaProvider } from "./usda";

/** All registered providers. Add a third source here. */
export const PROVIDERS: Record<string, FoodProvider> = {
  off: offProvider,
  usda: usdaProvider,
};

/** Barcode lookups: Open Food Facts first, then USDA Branded Foods (exact GTIN). */
export const BARCODE_ORDER: SourceId[] = ["off", "usda"];

/** Generic food search: USDA first; Open Food Facts on request for more candidates. */
export const SEARCH_ORDER: SourceId[] = ["usda", "off"];

export function getProvider(id: string): FoodProvider | undefined {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : undefined;
}
