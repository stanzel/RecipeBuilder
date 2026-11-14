import type { ComponentChildren } from "preact";
import type { FoodCandidate, FoodRecord, NutritionBasis } from "../shared/types";

export function KindBadge({ kind, dataType }: { kind: FoodRecord["kind"] | FoodCandidate["kind"]; dataType?: string }) {
  const label = kind === "generic" ? "Generic" : kind === "branded" ? "Branded" : "Manual";
  return (
    <span class={`badge badge-${kind}`} title={dataType}>
      {label}
      {dataType && kind !== "manual" && dataType !== "Open Food Facts" ? ` · ${dataType}` : ""}
    </span>
  );
}

export function SourceLink({ record }: { record: FoodRecord }) {
  const label = record.source === "manual" ? "Entered manually" : `Source: ${record.sourceName}`;
  return record.sourceUrl ? (
    <a class="source" href={record.sourceUrl} target="_blank" rel="noopener noreferrer">
      {label} ↗
    </a>
  ) : (
    <span class="source">{label}</span>
  );
}

export function basisText(basis: NutritionBasis): string {
  return basis === "per100g" ? "Nutrition per 100 g" : basis === "per100ml" ? "Nutrition per 100 ml" : "Nutrition per serving";
}

/** Emphasise words that distinguish otherwise similar foods. */
const DISTINGUISHERS = /\b(raw|cooked|boiled|baked|roasted|fried|steamed|dried|canned|frozen|fresh|unsalted|salted|without salt|with salt|no salt added|low sodium|reduced sodium|skinless|with skin|boneless|bone-in|whole|skim|nonfat|low ?fat|reduced fat|unsweetened|sweetened|plain|enriched|unenriched|drained|undrained|peeled|unpeeled|flesh and skin|flesh only)\b/gi;

export function Highlighted({ text }: { text: string }) {
  const parts: ComponentChildren[] = [];
  let last = 0;
  for (const m of text.matchAll(DISTINGUISHERS)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push(<mark>{m[0]}</mark>);
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export function ErrorBox({ children }: { children: ComponentChildren }) {
  return (
    <div class="alert alert-error" role="alert">
      {children}
    </div>
  );
}

export function Note({ children }: { children: ComponentChildren }) {
  return <div class="alert alert-note">{children}</div>;
}

export const round = (n: number, d = 1) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** "1 ONZ (28 g)" — appends the weight only if the label doesn't already state it. */
export function servingText(r: FoodRecord): string {
  const s = r.serving;
  if (!s) return "Not available";
  const label = s.label ?? "";
  const amt = s.grams ? `${round(s.grams)} g` : s.ml ? `${round(s.ml)} ml` : "";
  if (!amt) return label ? `${label} (weight not stated)` : "Not available";
  if (label && label.replace(/\s+/g, "").toLowerCase().includes(amt.replace(/\s+/g, ""))) return label;
  return label ? `${label} (${amt})` : amt;
}
