import { useEffect, useState } from "preact/hooks";
import { compatiblePortions, formatNutrient, type Ingredient, type IngredientNutrition } from "../shared/nutrition";
import { formatQuantity, parseQuantity } from "../shared/parse";
import type { FoodRecord, NutrientKey, SizeWord, UnitId } from "../shared/types";
import { NUTRIENT_KEYS } from "../shared/types";
import { ALL_UNITS, isMass, UNIT_LABELS } from "../shared/units";
import { ManualEntry } from "./ManualEntry";
import { MatchPanel } from "./MatchPanel";
import { basisText, KindBadge, round, servingText, SourceLink } from "./ui";

const SIZES: SizeWord[] = ["small", "medium", "large", "extra large"];
const SHORT: Record<NutrientKey, string> = { energyKcal: "", protein: "protein", fiber: "fiber", sugars: "sugars", saltG: "salt", sodiumMg: "sodium" };

interface Props {
  ingredient: Ingredient;
  nutrition: IngredientNutrition;
  onChange(patch: Partial<Ingredient>): void;
  onRemove(): void;
  onDuplicate(): void;
}

export function describeAmount(i: Ingredient): string {
  const q = i.quantity > 0 ? formatQuantity(i.quantity) : "?";
  if (i.unit === "each") return `${q}${i.size ? ` ${i.size}` : ""}${i.countNoun ? ` ${i.countNoun}${i.quantity === 1 ? "" : "s"}` : ""}`;
  const u = UNIT_LABELS[i.unit];
  return `${q} ${i.quantity === 1 ? u.one : u.many}`;
}

/** Units that make sense for this record (all units when unconfirmed). */
function unitOptions(record?: FoodRecord): UnitId[] {
  if (!record) return ALL_UNITS;
  return ALL_UNITS.filter((u) => {
    if (u === "package") return !!(record.packageSize?.grams || record.packageSize?.ml);
    if (u === "serving") return !!(record.serving?.grams || record.serving?.ml || record.basis === "perServing");
    return true;
  });
}

function AmountEditor({ ingredient: ing, onChange }: { ingredient: Ingredient; onChange(p: Partial<Ingredient>): void }) {
  const [qtyText, setQtyText] = useState(ing.quantity > 0 ? formatQuantity(ing.quantity) : "");
  const [qtyError, setQtyError] = useState(false);
  const [overrideText, setOverrideText] = useState(ing.gramsPerUnitOverride ? String(ing.gramsPerUnitOverride) : "");
  useEffect(() => setOverrideText(ing.gramsPerUnitOverride ? String(ing.gramsPerUnitOverride) : ""), [ing.gramsPerUnitOverride]);

  const portions = ing.record ? compatiblePortions(ing.record, ing.unit) : [];
  const unitLabel = UNIT_LABELS[ing.unit].one;

  return (
    <div class="amount-editor">
      <div class="grid3">
        <label class="field">
          <span>Quantity</span>
          <input
            inputMode="decimal"
            value={qtyText}
            aria-invalid={qtyError}
            placeholder="e.g. 1½"
            onInput={(e) => {
              const t = (e.target as HTMLInputElement).value;
              setQtyText(t);
              const q = parseQuantity(t);
              const ok = q !== null && q > 0;
              setQtyError(!ok && t.trim() !== "");
              if (ok) onChange({ quantity: q! });
            }}
          />
        </label>
        <label class="field">
          <span>Unit</span>
          <select
            value={ing.unit}
            onChange={(e) => onChange({ unit: (e.target as HTMLSelectElement).value as UnitId, portionLabel: undefined, gramsPerUnitOverride: undefined })}
          >
            {unitOptions(ing.record).map((u) => (
              <option value={u} key={u}>
                {u === "each" ? "item(s)" : UNIT_LABELS[u].many}
              </option>
            ))}
          </select>
        </label>
        {ing.unit === "each" ? (
          <label class="field">
            <span>Size</span>
            <select
              value={ing.size ?? ""}
              onChange={(e) => onChange({ size: ((e.target as HTMLSelectElement).value || undefined) as SizeWord | undefined, portionLabel: undefined })}
            >
              <option value="">—</option>
              {SIZES.map((s) => (
                <option value={s} key={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
      </div>
      {qtyError && <p class="field-error">Use a number, fraction or mixed number, e.g. 2, 0.5, 1/2 or 1 1/2.</p>}
      {portions.length > 1 && (
        <label class="field">
          <span>Measure from source</span>
          <select value={ing.portionLabel ?? ""} onChange={(e) => onChange({ portionLabel: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Automatic</option>
            {portions.map((p) => (
              <option value={p.label} key={p.label}>
                {p.label} = {round(p.gramWeight)} g
              </option>
            ))}
          </select>
        </label>
      )}
      {!isMass(ing.unit) && ing.record && (
        <label class="field">
          <span>Grams per {unitLabel} (override)</span>
          <input
            inputMode="decimal"
            value={overrideText}
            placeholder="from source"
            onInput={(e) => {
              const t = (e.target as HTMLInputElement).value;
              setOverrideText(t);
              const n = Number(t.replace(",", "."));
              if (t.trim() === "") onChange({ gramsPerUnitOverride: undefined });
              else if (n > 0) onChange({ gramsPerUnitOverride: n });
            }}
          />
        </label>
      )}
    </div>
  );
}

export function IngredientCard({ ingredient: ing, nutrition, onChange, onRemove, onDuplicate }: Props) {
  const [mode, setMode] = useState<"view" | "edit" | "match" | "manual">(ing.record ? "view" : "match");
  const [foodText, setFoodText] = useState(ing.food);
  const rec = ing.record;
  const amt = nutrition.amount;

  const title = ing.text || `${describeAmount(ing)} ${ing.food}`.trim();

  return (
    <li id={`ing-${ing.id}`} class={`card ingredient ${nutrition.status !== "ok" ? "needs-attention" : ""}`}>
      <div class="ing-head">
        <div>
          <div class="ing-amount">
            {describeAmount(ing)}{" "}
            <span class="ing-food">{rec ? rec.name : ing.food || "(no food yet)"}</span>
          </div>
          {ing.text && <div class="muted small">Typed: “{ing.text}”</div>}
        </div>
      </div>

      {rec && (
        <div class="ing-record">
          <div class="row wrap small">
            <KindBadge kind={rec.kind} dataType={rec.dataType} />
            {rec.brand && <span class="brand">{rec.brand}</span>}
            {rec.barcode && <span class="muted">Barcode {rec.barcode}</span>}
          </div>
          <div class="row wrap small">
            <SourceLink record={rec} />
            <span class="muted">{basisText(rec.basis)}</span>
            {rec.serving && <span class="muted">Serving: {servingText(rec)}</span>}
          </div>
        </div>
      )}

      {nutrition.status === "unconfirmed" && mode !== "match" && mode !== "manual" && (
        <p class="alert alert-note">Choose a matching food to include this ingredient.</p>
      )}

      {amt && amt.explanation && (
        <p class="amount-line">{amt.explanation}</p>
      )}
      {amt && !amt.ok && amt.problem && (
        <div class="alert alert-warn" role="status">
          {amt.problem}{" "}
          {mode === "view" && (
            <button class="link" type="button" onClick={() => setMode("edit")}>
              Fix amount
            </button>
          )}
        </div>
      )}

      {nutrition.status === "ok" && (
        <ul class="chips" aria-label="Nutrition for this ingredient">
          {NUTRIENT_KEYS.map((k) => {
            const v = nutrition.values[k];
            return (
              <li key={k} class={v ? "" : "missing"} title={v ? (v.derived ? "Derived value" : "") : "Not reported by the source"}>
                {v ? formatNutrient(k, v.value) : k === "energyKcal" ? "— kcal" : "—"} {SHORT[k]}
                {v?.derived ? "†" : ""}
              </li>
            );
          })}
        </ul>
      )}
      {nutrition.status === "ok" && nutrition.missing.length > 0 && (
        <p class="muted small">
          Not reported by this source: {nutrition.missing.map((k) => SHORT[k] || "calories").join(", ")}. Recipe totals for these are marked partial.
        </p>
      )}
      {rec?.warnings?.map((w) => (
        <p class="muted small" key={w}>
          {w}
        </p>
      ))}

      {(mode === "edit" || mode === "match") && (
        <AmountEditor ingredient={ing} onChange={onChange} />
      )}

      {mode === "match" && (
        <>
          <MatchPanel
            initialQuery={ing.food}
            onPick={(record) => {
              onChange({ record, portionLabel: undefined });
              setMode("view");
            }}
            onManual={(name) => {
              setFoodText(name);
              setMode("manual");
            }}
            onCancel={rec ? () => setMode("view") : undefined}
          />
        </>
      )}

      {mode === "manual" && (
        <ManualEntry
          initialName={foodText || ing.food}
          onSave={(record) => {
            onChange({ record, unit: record.basis === "perServing" && isMass(ing.unit) ? "serving" : ing.unit, portionLabel: undefined });
            setMode("view");
          }}
          onCancel={() => setMode(rec ? "view" : "match")}
        />
      )}

      <div class="row wrap actions">
        {mode === "edit" ? (
          <button class="btn" type="button" onClick={() => setMode("view")}>
            Done
          </button>
        ) : mode === "view" ? (
          <button class="btn btn-secondary" type="button" onClick={() => setMode("edit")}>
            Edit
          </button>
        ) : null}
        {mode !== "match" && mode !== "manual" && (
          <button class="btn btn-secondary" type="button" onClick={() => setMode("match")}>
            {rec ? "Change food" : "Find food"}
          </button>
        )}
        <button class="btn btn-secondary" type="button" onClick={onDuplicate} aria-label={`Duplicate ${title}`}>
          Duplicate
        </button>
        <button class="btn btn-danger" type="button" onClick={onRemove} aria-label={`Remove ${title}`}>
          Remove
        </button>
      </div>
    </li>
  );
}
