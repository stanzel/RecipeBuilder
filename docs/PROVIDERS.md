# Food data providers

Checked against the providers' documentation on 2026-11-13.

| Lookup type | Open Food Facts (`off`) | USDA FoodData Central (`usda`) |
|---|---|---|
| Barcode (exact GTIN) | ✅ **1st choice** | ✅ fallback (Branded Foods, exact `gtinUpc` comparison) |
| Generic food search (household weights) | — (packaged products only) | ✅ **1st choice** (Foundation, SR Legacy, Survey/FNDDS) |
| Branded food search | ✅ "Search Open Food Facts instead" | ✅ "Include branded foods" |
| Full record by ID | ✅ `/api/food/off/:code` | ✅ `/api/food/usda/:fdcId` |
| Household portions (e.g. 1 large potato) | ❌ | ✅ generic foods (`foodPortions`) |
| Label serving size | ✅ `serving_quantity` / `serving_size` | ✅ Branded `servingSize` / `householdServingFullText` |
| Package size | ✅ `product_quantity` | ✅ Branded `packageWeight` (parsed) |
| Salt | ✅ reported (`salt_100g`) | ❌ derived from sodium |

## USDA FoodData Central

- **Docs:** https://fdc.nal.usda.gov/api-guide (OpenAPI: https://fdc.nal.usda.gov/api-spec/fdc_api.html)
- **Setup:** free data.gov API key from https://fdc.nal.usda.gov/api-key-signup, stored as the Worker secret `FDC_API_KEY`. Keys found published online are deactivated.
- **Quota:** 1,000 requests/hour per key by default; exceeding it blocks the key for 1 hour (HTTP 429). `DEMO_KEY`: 30/hour, 50/day per IP. The app caps itself at 15/min per Cloudflare location (`RL_USDA`).
- **License / attribution:** public domain (CC0 1.0). USDA asks for credit: *U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.* The app footer and each ingredient's source link provide it.
- **Caching:** no restriction stated. The Worker caches food details 7 days and searches 1 day.
- **Endpoints used:** `GET /fdc/v1/foods/search` (`query`, `dataType`, `pageSize`, `api_key`), `GET /fdc/v1/food/{fdcId}`.
- **Normalization:**
  - Nutrient amounts are per 100 g (per 100 ml for Branded foods with ml servings). Energy is taken from nutrient 1008 (kcal), else 2048 (Atwater specific), else 2047 (Atwater general), else kJ ÷ 4.184 (marked derived).
  - Fiber 1079/2033, sugars 2000/1063, protein 1003, sodium 1093 (mg).
  - Portions come from `foodPortions`: SR Legacy uses `amount` + `modifier`, Foundation uses `measureUnit`, and FNDDS uses `portionDescription`. "Quantity not specified", NLEA serving and RACC entries are skipped.
- **Barcode:** `foods/search` with `dataType=Branded` and `query=<digits>`. FDC stores `gtinUpc` as text of varying length (12/13/14 digits), so the Worker tries the UPC-A, EAN-13 and GTIN-14 forms and accepts a hit only if the zero-padded GTIN-14 is identical. If several FDC records share a GTIN (label revisions), the newest `publishedDate` wins.
- **Limitations:**
  - Some Foundation foods omit fiber/sugars (e.g. raw chicken breast), so those totals show as partial.
  - Branded per-100 g values are computed by USDA from the label serving, so small rounding differences are normal.
  - Branded foods rarely have household portions.

## Open Food Facts

- **Docs:** https://openfoodfacts.github.io/openfoodfacts-server/api/ · search: https://search.openfoodfacts.org/docs
- **Setup:** no key for reads. OFF asks apps to send a descriptive `User-Agent: AppName/Version (contact)`. Set the optional secret `OFF_USER_AGENT`. Otherwise the Worker sends `RecipeNutritionCalculator/1.0 (+https://<your site>)`.
- **Quota:** 15 product reads/min and 10 searches/min per IP (exceeding them can get the IP banned; global overload returns 503). All visitors share the Worker's egress, so the app caps itself at 12 product reads and 8 searches per minute per location, and OFF is never called for search-as-you-type.
- **License / attribution:** database under ODbL 1.0, contents under DbCL 1.0, images CC BY-SA (the app shows no images). Re-users must credit Open Food Facts with a link. The footer links openfoodfacts.org and the ODbL, and each OFF ingredient links its product page. ODbL share-alike applies if you redistribute a derived *database*.
- **Caching:** no restriction stated (bulk users are pointed to the data exports). The Worker caches products 6 hours and searches 1 hour, because OFF data is edited frequently.
- **Endpoints used:** `GET https://world.openfoodfacts.org/api/v3/product/{code}?fields=…` (v3 is current; v2 is deprecated) and `GET https://search.openfoodfacts.org/search?q=…&page_size=…&fields=…` (Search-a-licious; full-text search is not in the v2 server API).
- **Normalization:**
  - `_100g` values (per 100 g, or per 100 ml for liquids) are used when present, else `_serving` values with a per-serving basis.
  - Sodium is reported in grams and converted to mg.
  - `energy-kcal` is used directly; otherwise kJ ÷ 4.184 (marked derived).
- **Barcode:** OFF normalizes codes itself (a 12-digit UPC-A comes back as a 13-digit code with a leading 0). The Worker still checks that the returned code is the same GTIN.
- **Limitations:**
  - OFF is crowd-sourced, so data can be incomplete or wrong. A product with *no* nutrition triggers an automatic USDA lookup; a product missing only some nutrients is shown with a **Try USDA FoodData Central instead** button.
  - OFF stores both salt and sodium and computes one from the other on its side, so the app can't tell which one the contributor typed. Both are treated as reported.
  - No household portions.

## Adding a third source

1. Implement `FoodProvider` (`src/worker/providers/types.ts`): `id`, `name`, `supports`, and any of `lookupBarcode` (must return only exact GTIN matches; use `sameGtin`), `search`, `getFood`. Normalize to `FoodRecord` (one record per source product, nutrients on a known basis, `completeSaltSodium`).
2. Add its ID to `SourceId` in `src/shared/types.ts`, register it in `src/worker/providers/registry.ts`, and add it to `BARCODE_ORDER` / `SEARCH_ORDER` if it should take part in fallbacks.
3. Extend the ID validation for `/api/food/:source/:id` in `src/worker/index.ts`, and add a rate limiter bucket if the source has quotas.
4. Add recorded fixtures and tests under `test/`.
