import { formatNutrient, NUTRIENT_META, type RecipeResult } from "../shared/nutrition";
import type { NutrientKey } from "../shared/types";

const ROWS: NutrientKey[] = ["energyKcal", "protein", "fiber", "sugars", "saltG", "sodiumMg"];

export function Totals({ result }: { result: RecipeResult }) {
  const partial = ROWS.filter((k) => result.total[k].partial);
  const derived = ROWS.some((k) => result.total[k].derived);
  const count = result.perIngredient.length;

  return (
    <section class="card totals" id="totals" aria-labelledby="totals-h">
      <h2 id="totals-h">Nutrition</h2>
      {count === 0 ? (
        <p class="muted">Add ingredients to see totals.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th scope="col">Nutrient</th>
                <th scope="col">Whole recipe</th>
                <th scope="col">
                  Per portion <span class="muted">(1/{result.portions})</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((k) => {
                const t = result.total[k];
                const p = result.perPortion[k];
                const none = t.missingFrom.length === count; // nothing contributes: don't show a misleading 0
                const mark = none ? "" : `${t.partial ? "*" : ""}${t.derived ? "†" : ""}`;
                return (
                  <tr key={k} class={`${t.partial ? "partial" : ""} ${k === "sodiumMg" ? "sub" : ""}`}>
                    <th scope="row">{k === "sodiumMg" ? "Sodium" : NUTRIENT_META[k].label}</th>
                    <td>
                      {none ? "—" : formatNutrient(k, t.value)}
                      {mark && <sup>{mark}</sup>}
                    </td>
                    <td>
                      {none ? "—" : formatNutrient(k, p.value)}
                      {mark && <sup>{mark}</sup>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {partial.length > 0 && (
            <div class="footnote">
              <strong>* Partial:</strong> these totals only include ingredients that report the nutrient and have a calculable amount. Missing values are not counted as zero.
              <ul>
                {partial.map((k) => (
                  <li key={k}>
                    {NUTRIENT_META[k].label}: missing for {result.total[k].missingFrom.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {derived && (
            <p class="footnote">
              <strong>†</strong> Includes derived values: salt = sodium (mg) × 2.5 ÷ 1000, or sodium from salt; calories from kJ where kcal was not reported.
            </p>
          )}
          <p class="footnote muted">Values are rounded for display only.</p>
        </>
      )}
    </section>
  );
}
