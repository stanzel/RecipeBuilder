# Recipe Nutrition Calculator

A mobile-first web app that totals **calories, protein, fiber, total sugars, salt and sodium** for a recipe and per portion. It deploys as **one Cloudflare Worker** that serves the static app and a small API proxying the food databases.

- Add ingredients by **scanning a barcode**, **typing a barcode**, **searching a food name**, or typing a line such as `4 large potatoes`, `1½ cups cooked rice`, or `250 g chicken breast`.
- Confirm the exact food (raw vs cooked, salted vs unsalted…). Generic and branded foods are labelled, and every ingredient shows its source.
- Edit, duplicate or remove ingredients; totals recalculate immediately. The recipe is saved in your browser's localStorage (no account).
- Optionally save a link to the original recipe (only `http`/`https` links are accepted and shown).
- **Copy recipe** puts a formatted plain-text version on the clipboard: name, link, portions, ingredients with weights and sources, the nutrition table with partial/derived markers, and data credits.
- The footer shows the app version, build (git commit; `+dirty` for local builds with uncommitted changes) and build date (UTC), injected at build time by `scripts/build-client.mjs`.

Stack: TypeScript, Preact (UI), esbuild (client bundle), Vitest (tests), Wrangler (dev/deploy). No database.

---

## Quick start (exact commands)

Requires Node.js 20+ (tested with Node 24.18 / npm 12) and a free Cloudflare account.

```sh
# 1. Install
npm install
#    npm 12 blocks dependency install scripts by default. The project works without them,
#    but if esbuild or `wrangler dev` complains about a missing binary, run:
#    npm install-scripts approve esbuild workerd && npm rebuild

# 2. Local secrets (USDA key). DEMO_KEY works for a quick try (30 requests/hour, 50/day).
cp .dev.vars.example .dev.vars
#    Get your own free key at https://fdc.nal.usda.gov/api-key-signup and put it in .dev.vars

# 3. Run locally → http://localhost:8787
npm run dev            # = wrangler dev (builds the client first via wrangler.jsonc "build")

# 4. Tests and type checks
npm test               # = vitest run (mocked providers; no network)
npm run typecheck      # = tsc --noEmit
npm run check          # typecheck + tests + build + `wrangler deploy --dry-run`
```

### Deploy to your workers.dev URL

```sh
npx wrangler login                          # opens a browser to authorize Wrangler
npx wrangler secret put FDC_API_KEY         # paste your data.gov / FoodData Central key
npx wrangler secret put OFF_USER_AGENT      # optional, e.g.: RecipeNutritionCalculator/1.0 (you@example.com)
npx wrangler deploy                         # builds the client, uploads Worker + assets
```

Wrangler prints the URL, e.g. `https://recipe-nutrition.<your-subdomain>.workers.dev`. (On a brand-new account Wrangler asks you to pick a workers.dev subdomain first.) You can also set secrets *before* the first deploy; Wrangler creates the Worker if needed.

Check it:

```sh
curl https://recipe-nutrition.<your-subdomain>.workers.dev/api/health
# {"ok":true,"usdaConfigured":true,"offUserAgentConfigured":true}
```

Then open the site on your phone, tap **Load sample recipe**, and compare against [SAMPLE_RECIPE.md](SAMPLE_RECIPE.md).

Other useful commands:

```sh
npx wrangler tail                 # live logs from the deployed Worker
npx wrangler secret list          # confirm secrets are set (values are hidden)
npx wrangler deployments list     # deployment history
npx wrangler rollback             # roll back to the previous deployment
```

> **Rate limiting binding.** `wrangler.jsonc` declares four [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) bindings (requires Wrangler ≥ 4.36). I could not find an explicit statement of plan availability in Cloudflare's docs. If `wrangler deploy` rejects the `ratelimits` block on your account, delete that block. The code treats the bindings as optional and keeps working, just without throttling.

---

## How it works

```
Browser (Preact app, static assets)            Cloudflare Worker (/api/* only)
 ├─ parse "1½ cups cooked rice"   ── GET ──▶   /api/search?source=usda|off&q=…
 ├─ barcode (camera / typed)      ── GET ──▶   /api/barcode/:code   (OFF → USDA, exact GTIN)
 ├─ confirm a food                ── GET ──▶   /api/food/usda/:fdcId | /api/food/off/:code
 └─ all math happens client-side              validates input, rate-limits, adds API key,
    (src/shared/nutrition.ts)                  calls providers with timeouts, caches, normalizes
```

| Path | What |
|---|---|
| `src/shared/` | Code used by both sides: types, GTIN normalization, line parser, units, nutrition math |
| `src/worker/index.ts` | Worker router: validation, rate limits, caching, error mapping |
| `src/worker/barcode.ts` | Barcode lookup order and fallback logic |
| `src/worker/providers/` | `FoodProvider` interface, `usda.ts`, `off.ts`, `registry.ts` |
| `src/client/` | Preact UI, scanner, API client, localStorage |
| `public/` | `index.html`, `styles.css`, `_headers` (CSP etc.); `public/build/` is generated |
| `test/` | Vitest suites + `fixtures/` recorded from real provider responses |

API endpoints (all `GET`; anything else gets `405`):

| Endpoint | Notes |
|---|---|
| `/api/barcode/:code?format=&source=auto\|off\|usda` | 8/12/13/14 digits, check digit verified. `format` (`upc_a`, `upc_e`, `ean_13`, `ean_8`) disambiguates 8-digit codes |
| `/api/search?q=&source=usda\|off&branded=1` | `q` 2–80 chars. USDA defaults to generic data types; `branded=1` adds Branded Foods |
| `/api/food/usda/:fdcId`, `/api/food/off/:code` | Full record with household portions / serving / package size |
| `/api/health`, `/api/sources` | Config check; provider capabilities |

Errors are JSON `{ error, message, source?, retryAfter? }`: `400` bad request, `404` not found, `429` client rate-limited, `502` upstream error, `503` upstream rate limit, `504` upstream timeout, `500` misconfigured (e.g. missing `FDC_API_KEY`).

See **[docs/PROVIDERS.md](docs/PROVIDERS.md)** for which source supports what, setup requirements, licensing, caching and limitations.

### Nutrition rules (implemented in `src/shared/nutrition.ts`)

- Every confirmed ingredient points to **exactly one** source record (`usda:…`, `off:…` or `manual:…`). Records from different sources or products are never merged. "Try the other source" *replaces* the record.
- Nutrients are normalized to a known basis (per 100 g, per 100 ml, or per serving) before scaling.
- **Missing ≠ zero.** If an ingredient lacks a nutrient, or its amount can't be calculated, or it isn't confirmed yet, that total is marked **partial (\*)** and the footnote lists which ingredients are missing.
- **Salt/sodium:** a reported salt value is used as is. Sodium-only → salt = sodium mg × 2.5 ÷ 1000; salt-only → sodium = salt g × 1000 ÷ 2.5. Derived values are marked **†**. USDA never reports salt, so USDA salt is always derived.
- **Counts** ("4 large potatoes") use the selected record's household portion for that size (e.g. *1 Potato large = 369 g*). The app shows grams per item and the total, and you can override grams per item. If the record has no matching size, measure or density, the app says so and asks for a weight or another measure. It doesn't guess.
- **Volume** uses the record's own measure for that unit (e.g. *1 cup, cooked = 158 g*), else a food-specific density derived from another volume measure of the same record. Generic water-density conversion is never used.
- Rounding happens only for display (kcal and sodium to whole numbers, grams to 0.1, salt to 0.01).

### Units and quantities

Quantities: `2`, `0.5`, `0,5`, `1/2`, `½`, `1½`, `1 1/2`, `1-1/2`. Units: g, kg, oz, lb, ml, l, tsp, tbsp, cup, fl oz (US customary), label servings, packages (when package size is known) and items (counts, optionally small/medium/large/extra large, plus count nouns such as cloves or slices).

### Barcode scanning

- Uses the native [`BarcodeDetector`](https://developer.mozilla.org/docs/Web/API/Barcode_Detection_API) when it supports EAN-13 and UPC-A (e.g. Android Chrome). Otherwise it lazy-loads [`barcode-detector`](https://www.npmjs.com/package/barcode-detector) (ZXing-C++ compiled to WebAssembly, v3.2.3), with the `.wasm` self-hosted at `/build/zxing_reader.wasm`. No CDN is involved, and the CSP allows only `'self'`.
- Formats: UPC-A, UPC-E, EAN-13, EAN-8. The rear camera is requested (`facingMode: environment`), and frames are decoded on the device.
- A code is accepted only after two identical consecutive reads with a valid check digit. The camera is stopped **before** the result is handled, and also on close, on unmount and when the page is hidden.
- Duplicate protection: the scanner fires once, lookups are single-flight, and adding a product requires an explicit **Add to recipe** that is also guarded against double taps.
- Typed barcode entry is always available, and the app points you to it when the camera is denied, missing, or not on HTTPS.
- A barcode only identifies the product. You choose separately how much went in (grams, ounces, label servings, or packages when the package weight is known).

### Security and abuse controls

- The USDA key lives only in a Worker secret, and only fixed server-side endpoints are exposed (no open proxy).
- Input validation happens before any upstream call: barcode digits and check digit, numeric FDC IDs, query length, allowed `source` values, `GET` only.
- Throttling: per-visitor limit (`RL_CLIENT`, 60/min keyed by client IP) and shared upstream budgets that stay under provider limits (`RL_USDA` 15/min ≈ 900/h < 1,000/h; `RL_OFF_PRODUCT` 12/min < 15; `RL_OFF_SEARCH` 8/min < 10). Cloudflare's limits are per-location and approximate.
- Upstream timeout is 8 s. Provider 429/503 responses are passed on as `rate_limited` with `Retry-After`.
- `_headers` sets the CSP (`'wasm-unsafe-eval'` is needed only for the decoder), `Permissions-Policy: camera=(self)`, `nosniff` and `frame-ancestors 'none'`.

---

## Verification status

| Area | Status |
|---|---|
| Unit/integration tests (100) | ✅ `npm test`. Mocked providers. Covers *4 large potatoes*, mixed fractions, per-serving and per-100 g label data, OFF→USDA exact barcode fallback, leading zeros, UPC-E, missing nutrients, sodium↔salt, provider timeouts/429/5xx/network errors, portion recalculation, caching, validation |
| `wrangler dev` smoke test | ✅ Live Open Food Facts barcode lookup and search, validation, 405, CSP headers, wasm served |
| Live USDA through the Worker | ⚠️ Not verified: the shared `DEMO_KEY` was exhausted during development. USDA response shapes were verified directly against the live API, and the tests use those recorded responses. Verify with your own key (`/api/health`, then the sample recipe) |
| Mobile layout (headless Chrome, iPhone-size 390×844 and 320×640) | ✅ No horizontal scroll. Typed-line match, typed barcode, double-tap guard, edit/duplicate/remove, portions validation, reload persistence and the sample totals all checked |
| Barcode **typed** fallback | ✅ Including when no camera is available (headless: "No suitable camera was found…" and the typed field stays available) |
| Camera scanning on **physical devices** | ❌ **Not tested on any physical device.** Needs: iPhone Safari (uses the WASM decoder; iOS Safari doesn't expose `BarcodeDetector` by default) and Android Chrome (native detector). Test over HTTPS (the deployed workers.dev URL) |

Device test checklist (on the deployed HTTPS URL):

1. iPhone Safari → **Scan barcode** → allow camera → rear camera shows → scan a UPC-A product → camera light turns off → product card appears once.
2. Repeat on Android Chrome. The status line should say "built-in detector".
3. Try an EAN-13 (European) product, an EAN-8 and a UPC-E (small packages).
4. Deny camera permission → message plus typed barcode entry works.
5. Open the scanner and press **Stop camera** → the camera indicator turns off. Switch apps while scanning → the camera stops.
6. Hold the barcode steady after a successful scan → still only one product card, and no duplicate ingredient.

Testing the camera against `wrangler dev` from a phone needs HTTPS. The simplest route is to deploy and test the workers.dev URL. Alternatively run `npx wrangler dev --ip 0.0.0.0 --local-protocol https` and accept the self-signed certificate on the phone (iOS can be stubborn about this).
