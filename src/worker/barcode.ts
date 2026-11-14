import type { NormalizedBarcode } from "../shared/gtin";
import { missingNutrients } from "../shared/nutrition";
import type { BarcodeLookupResponse, FoodRecord, ProviderAttempt, SourceId } from "../shared/types";
import { BARCODE_ORDER, getProvider } from "./providers/registry";
import { ProviderError, type ProviderContext } from "./providers/types";

const CORE = ["energyKcal", "protein", "fiber", "sugars", "saltG"] as const;

/**
 * Look up a barcode across providers in order. Every candidate interpretation of
 * the code (normally one) is tried per provider; only exact GTIN matches count.
 *
 * The response always carries exactly ONE record. If the first match lacks all
 * nutrition data, the next source is tried automatically; if it is merely
 * incomplete, the other sources are listed as `alternatives` so the user can
 * choose to replace it (records are never merged).
 */
export async function lookupBarcode(
  barcodes: NormalizedBarcode[],
  ctx: ProviderContext,
  only?: SourceId,
): Promise<BarcodeLookupResponse> {
  const order = only ? [only] : BARCODE_ORDER;
  const attempts: ProviderAttempt[] = [];
  let fallbackRecord: { record: FoodRecord; missing: ReturnType<typeof missingNutrients> } | undefined;
  const errors: ProviderError[] = [];

  for (const sourceId of order) {
    const provider = getProvider(sourceId);
    if (!provider?.lookupBarcode) {
      attempts.push({ source: sourceId, outcome: "skipped", message: "Barcode lookup not supported." });
      continue;
    }
    let record: FoodRecord | null = null;
    try {
      for (const b of barcodes) {
        record = await provider.lookupBarcode(b, ctx);
        if (record) break;
      }
    } catch (err) {
      if (err instanceof ProviderError) {
        errors.push(err);
        attempts.push({ source: sourceId, outcome: "error", message: err.message });
        continue;
      }
      throw err;
    }
    if (!record) {
      attempts.push({ source: sourceId, outcome: "not_found" });
      continue;
    }
    const missing = missingNutrients(record.nutrients);
    const hasNoNutrition = CORE.every((k) => missing.includes(k));
    if (hasNoNutrition && !only) {
      attempts.push({ source: sourceId, outcome: "incomplete", message: "Product found but it has no nutrition data; trying the next source." });
      fallbackRecord ??= { record, missing };
      continue;
    }
    attempts.push({ source: sourceId, outcome: missing.length ? "incomplete" : "found" });
    return {
      status: "found",
      gtin14: barcodes[0].gtin14,
      record,
      attempts,
      missing,
      alternatives: BARCODE_ORDER.filter((s) => s !== sourceId),
    };
  }

  if (fallbackRecord) {
    // Nothing better elsewhere: return the product so the user can still see it,
    // fill in nutrition manually, or pick an amount.
    return {
      status: "found",
      gtin14: barcodes[0].gtin14,
      record: fallbackRecord.record,
      attempts,
      missing: fallbackRecord.missing,
      alternatives: BARCODE_ORDER.filter((s) => s !== fallbackRecord!.record.source),
    };
  }

  // If every source failed with an error (rather than "not found"), surface the error.
  if (errors.length && errors.length === attempts.filter((a) => a.outcome !== "skipped").length) {
    throw errors.find((e) => e.kind === "rate_limited") ?? errors[0];
  }
  return { status: "not_found", gtin14: barcodes[0].gtin14, attempts, alternatives: [] };
}
