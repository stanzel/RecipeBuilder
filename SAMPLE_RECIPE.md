# Sample check recipe

Use this to check a deployed site end to end (USDA search/detail, OFF barcode, portions, partial totals, derived salt). The numbers are pinned by `test/sample-recipe.test.ts`, which uses responses recorded from the live APIs on 2026-11-13.

**Fast path:** tap **Load sample recipe** at the bottom of the app. It loads exactly these records.

**Manual path** (exercises every input method). Set **Portions = 4**, then:

| # | Enter | Pick / do | Source record | Expected amount |
|---|---|---|---|---|
| 1 | `4 large potatoes` | **Potatoes, flesh and skin, raw** (Generic · SR Legacy) | USDA FDC 170026 | 4 × 369 g = **1476 g** |
| 2 | `1½ cups cooked rice` | **Rice, white, cooked, no added fat** (Generic · Survey (FNDDS)) | USDA FDC 2708408 | 1½ × 158 g = **237 g** |
| 3 | `250 g chicken breast` | **Chicken, breast, boneless, skinless, raw** (Generic · Foundation) | USDA FDC 2646170 | **250 g** |
| 4 | Type barcode `077034085228` | Nut 'n berry mix → **2 label servings** | Open Food Facts 0077034085228 | 2 × 28 g = **56 g** |

## Expected totals

| Nutrient | Whole recipe | Per portion (÷ 4) |
|---|---|---|
| Calories | **2003 kcal** | **501 kcal** |
| Protein | **100.9 g** | **25.2 g** |
| Fiber | **35.9 g \*** | **9.0 g \*** |
| Total sugars | **28.2 g \*** | **7.1 g \*** |
| Salt | **2.08 g †** | **0.52 g †** |
| Sodium | **834 mg** | **208 mg** |

\* **Partial**: the Foundation chicken record reports no fiber or sugars. The app must list *"missing for Chicken, breast, boneless, skinless, raw"* and must **not** treat them as 0.
† Includes salt derived from USDA sodium (mg × 2.5 ÷ 1000). The nut mix's salt (0 g) is reported by Open Food Facts.

Per-ingredient contributions (unrounded inputs, per 100 g):

| Ingredient | kcal | protein g | fiber g | sugars g | sodium mg |
|---|---|---|---|---|---|
| Potato 170026 | 77 | 2.05 | 2.1 | 0.82 | 6 |
| Rice 2708408 | 129 | 2.67 | 0.4 | 0.05 | 245 |
| Chicken 2646170 | 112.2 (Atwater specific) | 22.525 | — | — | 65.75 |
| Nut mix (OFF) | 500 | 14.29 | 7.1 | 28.57 | 0 (salt 0) |

**Extra checks**

- Change portions to 2: per-portion calories become **1001 kcal**, and the whole recipe stays 2003 kcal.
- Duplicate the potatoes, and the recipe gains 1137 kcal. Remove the duplicate to go back.
- Change the potato size to *extra large*: the app reports that the record has no "extra large" size and asks for grams per item.
- Refresh the page, and the recipe is still there.
- Type barcode `077034085229` (bad check digit): you get an error asking you to re-check the digits.

If USDA or Open Food Facts revise these records, the totals can drift slightly. Re-record the fixtures (`test/fixtures/`) and update this file and the test together.
