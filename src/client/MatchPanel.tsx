import { useEffect, useRef, useState } from "preact/hooks";
import type { FoodCandidate, FoodRecord, SourceId } from "../shared/types";
import { api, ApiError } from "./api";
import { ErrorBox, Highlighted, KindBadge, Note } from "./ui";

interface Props {
  initialQuery: string;
  onPick(record: FoodRecord): void;
  onManual(name: string): void;
  onCancel?(): void;
}

/** Search for a food and confirm one record. USDA first; Open Food Facts on request. */
export function MatchPanel({ initialQuery, onPick, onManual, onCancel }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [source, setSource] = useState<SourceId>("usda");
  const [branded, setBranded] = useState(true); // branded foods included by default
  const [results, setResults] = useState<FoodCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  async function run(q = query, s = source, b = branded) {
    const text = q.trim();
    if (text.length < 2) {
      setError("Type at least 2 characters to search.");
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    setSource(s);
    try {
      const r = await api.search(text, s, b);
      if (my !== seq.current) return;
      setResults(r.candidates);
    } catch (e) {
      if (my !== seq.current) return;
      setResults(null);
      setError(e instanceof ApiError ? e.message : "Search failed.");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (initialQuery.trim().length >= 2) run(initialQuery, "usda", true);
  }, []);

  async function pick(c: FoodCandidate) {
    if (picking) return;
    setPicking(`${c.source}:${c.sourceId}`);
    setError(null);
    try {
      const record = await api.food(c.source, c.sourceId);
      onPick(record);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load that food.");
    } finally {
      setPicking(null);
    }
  }

  const sourceName = source === "usda" ? "USDA FoodData Central" : "Open Food Facts";

  return (
    <div class="match">
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          type="search"
          aria-label="Food to search for"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          placeholder="e.g. potatoes raw"
          enterKeyHint="search"
        />
        <button type="submit" class="btn" disabled={loading}>
          Search
        </button>
      </form>
      <div class="row wrap small">
        <span>Searching {sourceName}</span>
        {source === "usda" && (
          <label class="check">
            <input
              type="checkbox"
              checked={branded}
              onChange={(e) => {
                const b = (e.target as HTMLInputElement).checked;
                setBranded(b);
                run(query, "usda", b);
              }}
            />
            Include branded foods
          </label>
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {loading && <p class="muted">Searching…</p>}

      {!loading && results && results.length === 0 && <Note>No matches in {sourceName}.</Note>}

      {!loading && results && results.length > 0 && (
        <ul class="candidates" aria-label="Matching foods">
          {results.map((c) => {
            const key = `${c.source}:${c.sourceId}`;
            return (
              <li key={key}>
                <button type="button" class="candidate" onClick={() => pick(c)} disabled={!!picking}>
                  <span class="cand-name">
                    <Highlighted text={c.name} />
                  </span>
                  <span class="cand-meta">
                    <KindBadge kind={c.kind} dataType={c.dataType} />
                    {c.brand && <span class="brand">{c.brand}</span>}
                    {c.kcalPer100 !== undefined && <span>{Math.round(c.kcalPer100)} kcal/100 g</span>}
                    {c.detail && <span class="muted">{c.detail}</span>}
                  </span>
                  {picking === key && <span class="muted">Loading…</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div class="row wrap">
        {source === "usda" ? (
          <button type="button" class="btn btn-secondary" onClick={() => run(query, "off", false)} disabled={loading}>
            Search Open Food Facts instead
          </button>
        ) : (
          <button type="button" class="btn btn-secondary" onClick={() => run(query, "usda", branded)} disabled={loading}>
            Back to USDA results
          </button>
        )}
        <button type="button" class="btn btn-secondary" onClick={() => onManual(query)}>
          Enter nutrition manually
        </button>
        {onCancel && (
          <button type="button" class="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
