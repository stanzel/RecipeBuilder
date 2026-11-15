import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { calculateRecipe, formatNutrient, isValidPortionCount, type Ingredient } from "../shared/nutrition";
import { parseIngredientLine } from "../shared/parse";
import { api, ApiError } from "./api";
import { BarcodePanel } from "./BarcodePanel";
import { copyText, formatRecipeText, safeRecipeUrl } from "./format";
import { IngredientCard } from "./IngredientCard";
import { emptyRecipe, loadRecipe, newId, saveRecipe, type Recipe } from "./store";
import { ThemeToggle } from "./ThemeToggle";
import { Totals } from "./Totals";
import { ErrorBox } from "./ui";

/** Turn a typed line into an editable, not-yet-confirmed ingredient. */
function ingredientFromLine(line: string): Ingredient {
  const p = parseIngredientLine(line);
  let { quantity, unit } = p;
  if (!p.quantityGiven && !p.size && !p.countNoun) {
    // Name-only search ("chicken breast"): don't guess an amount.
    quantity = 0;
    unit = "g";
  }
  return { id: newId(), text: p.quantityGiven ? line.trim() : undefined, quantity, unit, size: p.size, countNoun: p.countNoun, food: p.food || line.trim() };
}

async function buildSampleRecipe(): Promise<Recipe> {
  const [potato, rice, chicken, mix] = await Promise.all([
    api.food("usda", "170026"),
    api.food("usda", "2708408"),
    api.food("usda", "2646170"),
    api.barcode("077034085228"),
  ]);
  const withRecord = (line: string, record: Ingredient["record"]) => ({ ...ingredientFromLine(line), record });
  const ingredients: Ingredient[] = [
    withRecord("4 large potatoes", potato),
    withRecord("1½ cups cooked rice", rice),
    withRecord("250 g chicken breast", chicken),
  ];
  if (mix.record) ingredients.push({ id: newId(), quantity: 2, unit: "serving", food: mix.record.name, record: mix.record });
  return { version: 1, name: "Sample check recipe", url: "", portions: 4, ingredients };
}

function App() {
  const [recipe, setRecipe] = useState<Recipe>(() => loadRecipe());
  const [line, setLine] = useState("");
  const [panel, setPanel] = useState<null | "barcode" | "scan">(null);
  const [portionsText, setPortionsText] = useState(String(recipe.portions));
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string>("");

  useEffect(() => setSaved(saveRecipe(recipe)), [recipe]);

  const result = useMemo(() => calculateRecipe(recipe.ingredients, recipe.portions), [recipe]);

  const update = (fn: (r: Recipe) => Recipe) => setRecipe((r) => fn(r));
  const setIngredients = (fn: (list: Ingredient[]) => Ingredient[]) => update((r) => ({ ...r, ingredients: fn(r.ingredients) }));

  function addLine(e: Event) {
    e.preventDefault();
    if (!line.trim()) return;
    const ing = ingredientFromLine(line);
    setIngredients((l) => [...l, ing]);
    setLine("");
    requestAnimationFrame(() => document.getElementById(`ing-${ing.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function setPortions(text: string) {
    setPortionsText(text);
    const n = Number(text);
    if (/^\d+$/.test(text.trim()) && isValidPortionCount(n)) update((r) => ({ ...r, portions: n }));
  }
  const portionsInvalid = !(/^\d+$/.test(portionsText.trim()) && isValidPortionCount(Number(portionsText)));

  async function loadSample() {
    if (recipe.ingredients.length && !confirm("Replace the current recipe with the sample recipe?")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await buildSampleRecipe();
      setRecipe(r);
      setPortionsText(String(r.portions));
    } catch (e) {
      setError(e instanceof ApiError ? `Could not load the sample: ${e.message}` : "Could not load the sample.");
    } finally {
      setBusy(false);
    }
  }

  const recipeUrl = safeRecipeUrl(recipe.url);
  const urlInvalid = !!recipe.url?.trim() && !recipeUrl;

  async function copyRecipe() {
    const ok = await copyText(formatRecipeText(recipe, result));
    setCopyStatus(ok ? "Copied to clipboard." : "Couldn't copy automatically — select the preview text below and copy it.");
    window.setTimeout(() => setCopyStatus(""), 4000);
  }

  function newRecipe() {
    if (recipe.ingredients.length && !confirm("Start a new recipe? The current one will be cleared from this browser.")) return;
    const r = emptyRecipe();
    setRecipe(r);
    setPortionsText(String(r.portions));
  }

  return (
    <>
      <header class="topbar">
        <div class="topbar-inner">
          <h1>Recipe nutrition</h1>
          <ThemeToggle />
        </div>
      </header>
      <main>
        <section class="card" aria-label="Recipe">
          <label class="field">
            <span>Recipe name</span>
            <input value={recipe.name} placeholder="Untitled recipe" onInput={(e) => update((r) => ({ ...r, name: (e.target as HTMLInputElement).value }))} />
          </label>
          <label class="field">
            <span>Recipe link (optional)</span>
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              value={recipe.url ?? ""}
              placeholder="https://…"
              aria-invalid={urlInvalid}
              onInput={(e) => update((r) => ({ ...r, url: (e.target as HTMLInputElement).value }))}
            />
          </label>
          {urlInvalid && <p class="field-error">Enter a web address, e.g. https://example.com/recipe.</p>}
          {recipeUrl && (
            <p class="small">
              <a href={recipeUrl} target="_blank" rel="noopener noreferrer">
                Open recipe ↗
              </a>
            </p>
          )}
          <div class="field">
            <label for="portions">Portions</label>
            <div class="stepper">
              <button type="button" class="btn btn-secondary" aria-label="Fewer portions" disabled={recipe.portions <= 1} onClick={() => setPortions(String(Math.max(1, recipe.portions - 1)))}>
                −
              </button>
              <input id="portions" inputMode="numeric" pattern="[0-9]*" value={portionsText} aria-invalid={portionsInvalid} onInput={(e) => setPortions((e.target as HTMLInputElement).value)} />
              <button type="button" class="btn btn-secondary" aria-label="More portions" onClick={() => setPortions(String(recipe.portions + 1))}>
                +
              </button>
            </div>
            {portionsInvalid && <p class="field-error">Enter a whole number of 1 or more. Using {recipe.portions}.</p>}
          </div>
        </section>

        <section class="card" aria-label="Add ingredient">
          <h2>Add ingredient</h2>
          <form class="row" onSubmit={addLine}>
            <input
              value={line}
              onInput={(e) => setLine((e.target as HTMLInputElement).value)}
              placeholder="e.g. 4 large potatoes"
              aria-label="Ingredient line or food name"
              enterKeyHint="go"
              autoComplete="off"
            />
            <button class="btn" type="submit">
              Add
            </button>
          </form>
          <p class="muted small">Type an amount and food (“1½ cups cooked rice”, “250 g chicken breast”) or just a food name to search.</p>
          <div class="row wrap">
            <button class="btn btn-secondary" type="button" onClick={() => setPanel("scan")}>
              Scan barcode
            </button>
            <button class="btn btn-secondary" type="button" onClick={() => setPanel("barcode")}>
              Type barcode
            </button>
          </div>
        </section>

        {panel && (
          <BarcodePanel
            key={panel}
            startWithCamera={panel === "scan"}
            onAdd={(ing) => setIngredients((l) => [...l, ing])}
            onSearchByName={() => {
              setPanel(null);
              document.querySelector<HTMLInputElement>('[aria-label="Ingredient line or food name"]')?.focus();
            }}
            onClose={() => setPanel(null)}
          />
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        <section aria-label="Ingredients">
          <h2 class="section-title">
            Ingredients <span class="muted">({recipe.ingredients.length})</span>
          </h2>
          {recipe.ingredients.length === 0 && <p class="muted">No ingredients yet.</p>}
          <ul class="ingredients">
            {recipe.ingredients.map((ing, idx) => (
              <IngredientCard
                key={ing.id}
                  ingredient={ing}
                  nutrition={result.perIngredient[idx]}
                  onChange={(patch) => setIngredients((l) => l.map((x) => (x.id === ing.id ? { ...x, ...patch } : x)))}
                  onRemove={() => setIngredients((l) => l.filter((x) => x.id !== ing.id))}
                  onDuplicate={() =>
                    setIngredients((l) => {
                      const i = l.findIndex((x) => x.id === ing.id);
                      const copy = { ...l[i], id: newId() };
                      return [...l.slice(0, i + 1), copy, ...l.slice(i + 1)];
                    })
                  }
              />
            ))}
          </ul>
        </section>

        <Totals result={result} />

        <section class="card" aria-labelledby="copy-h">
          <h2 id="copy-h">Copy recipe</h2>
          <p class="muted small">Copies the recipe name, link, ingredients and nutrition table as formatted text you can paste into notes, email or messages.</p>
          <button class="btn" type="button" onClick={copyRecipe}>
            Copy to clipboard
          </button>
          <p class="small" aria-live="polite">
            {copyStatus}
          </p>
          <details>
            <summary class="small">Preview</summary>
            <pre class="copy-preview">{formatRecipeText(recipe, result)}</pre>
          </details>
        </section>

        <section class="card small">
          <div class="row wrap">
            <button class="btn btn-secondary" type="button" onClick={newRecipe}>
              New recipe
            </button>
            <button class="btn btn-secondary" type="button" onClick={loadSample} disabled={busy}>
              {busy ? "Loading sample…" : "Load sample recipe"}
            </button>
          </div>
          <p class="muted">{saved ? "Saved in this browser — no account needed." : "Could not save in this browser (private mode or storage full)."}</p>
        </section>

        <footer class="attribution">
          <p>
            Food data: <a href="https://fdc.nal.usda.gov/" target="_blank" rel="noopener noreferrer">USDA FoodData Central</a> (public domain, CC0) and{" "}
            <a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener noreferrer">Open Food Facts</a> contributors, available under the{" "}
            <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">Open Database License</a>. Values are estimates; check labels for allergies or medical diets.
          </p>
          <p class="version">
            Version {__APP_VERSION__} · build {__BUILD_ID__} · {new Date(__BUILD_DATE__).toISOString().slice(0, 16).replace("T", " ")} UTC
          </p>
        </footer>
      </main>

      {recipe.ingredients.length > 0 && (
        <a class="summary-bar" href="#totals">
          {result.perIngredient.every((r) => r.status !== "ok") ? (
            "Confirm a food to see nutrition"
          ) : (
            <>
              Per portion: {formatNutrient("energyKcal", result.perPortion.energyKcal.value)}
              {result.perPortion.energyKcal.partial ? "*" : ""} · {formatNutrient("protein", result.perPortion.protein.value)} protein
              {result.perPortion.protein.partial ? "*" : ""}
              {result.needsReviewCount > 0 && <> · ⚠ {result.needsReviewCount} to review</>}
            </>
          )}
        </a>
      )}
    </>
  );
}

render(<App />, document.getElementById("app")!);
