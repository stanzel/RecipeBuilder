import { useState } from "preact/hooks";
import { completeSaltSodium } from "../shared/nutrition";
import type { FoodRecord, NutrientKey, NutrientMap, NutritionBasis } from "../shared/types";
import { newId } from "./store";
import { ErrorBox } from "./ui";

interface Props {
  initialName?: string;
  barcode?: string;
  onSave(record: FoodRecord): void;
  onCancel(): void;
}

const FIELDS: { key: NutrientKey; label: string; unit: string }[] = [
  { key: "energyKcal", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "fiber", label: "Fiber", unit: "g" },
  { key: "sugars", label: "Total sugars", unit: "g" },
  { key: "saltG", label: "Salt", unit: "g" },
  { key: "sodiumMg", label: "Sodium", unit: "mg" },
];

/** Manual nutrition entry per 100 g or per serving. Blank = unknown (never zero). */
export function ManualEntry({ initialName = "", barcode, onSave, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [basis, setBasis] = useState<NutritionBasis>("per100g");
  const [servingGrams, setServingGrams] = useState("");
  const [servingLabel, setServingLabel] = useState("");
  const [values, setValues] = useState<Partial<Record<NutrientKey, string>>>({});
  const [error, setError] = useState<string | null>(null);

  function save(e: Event) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the food a name.");
    const nutrients: NutrientMap = {};
    for (const f of FIELDS) {
      const raw = (values[f.key] ?? "").trim().replace(",", ".");
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return setError(`${f.label} must be a number of 0 or more (or left blank if unknown).`);
      nutrients[f.key] = { value: n };
    }
    if (!Object.keys(nutrients).length) return setError("Enter at least one nutrient value.");
    let grams: number | undefined;
    if (servingGrams.trim()) {
      grams = Number(servingGrams.replace(",", "."));
      if (!(grams > 0)) return setError("Serving weight must be greater than 0, or left blank.");
    }
    const id = newId();
    const record: FoodRecord = {
      id: `manual:${id}`,
      source: "manual",
      sourceId: id,
      sourceName: "Manual entry",
      kind: "manual",
      name: name.trim(),
      barcode,
      basis,
      nutrients: completeSaltSodium(nutrients),
      portions: [],
      attribution: "Entered by you",
      license: "",
      fetchedAt: new Date().toISOString(),
    };
    if (grams || servingLabel.trim()) record.serving = { grams, label: servingLabel.trim() || undefined };
    onSave(record);
  }

  return (
    <form class="manual" onSubmit={save}>
      <h3>Enter nutrition manually</h3>
      <label class="field">
        <span>Food name</span>
        <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} required />
      </label>
      <fieldset class="field">
        <legend>Values are</legend>
        <label class="check">
          <input type="radio" name="basis" checked={basis === "per100g"} onChange={() => setBasis("per100g")} /> per 100 g
        </label>
        <label class="check">
          <input type="radio" name="basis" checked={basis === "perServing"} onChange={() => setBasis("perServing")} /> per serving
        </label>
      </fieldset>
      <div class="grid2">
        <label class="field">
          <span>Serving weight (g){basis === "perServing" ? " — optional" : " — optional"}</span>
          <input inputMode="decimal" value={servingGrams} onInput={(e) => setServingGrams((e.target as HTMLInputElement).value)} placeholder="unknown" />
        </label>
        <label class="field">
          <span>Serving description</span>
          <input value={servingLabel} onInput={(e) => setServingLabel((e.target as HTMLInputElement).value)} placeholder="e.g. 1 bar" />
        </label>
      </div>
      <p class="muted small">Leave a value blank if you don't know it — it will be shown as missing, not zero. Enter salt or sodium; the other is derived.</p>
      <div class="grid2">
        {FIELDS.map((f) => (
          <label class="field" key={f.key}>
            <span>
              {f.label} ({f.unit})
            </span>
            <input
              inputMode="decimal"
              value={values[f.key] ?? ""}
              onInput={(e) => setValues({ ...values, [f.key]: (e.target as HTMLInputElement).value })}
              placeholder="unknown"
            />
          </label>
        ))}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div class="row">
        <button class="btn" type="submit">
          Use these values
        </button>
        <button class="btn btn-ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
