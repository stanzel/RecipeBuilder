import type { SourceId } from "../../shared/types";
import { ProviderError, type ProviderContext } from "./types";

export interface JsonResult<T> {
  status: number;
  body: T | null;
}

/**
 * GET JSON from a provider with a timeout. 404 is returned to the caller
 * (providers use it for "not found"); other failures become ProviderErrors.
 */
export async function getJson<T>(
  url: string,
  source: SourceId,
  ctx: ProviderContext,
  headers: Record<string, string> = {},
): Promise<JsonResult<T>> {
  let res: Response;
  try {
    res = await ctx.fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ProviderError("timeout", source, `${sourceLabel(source)} did not respond within ${Math.round(ctx.timeoutMs / 1000)} s.`);
    }
    throw new ProviderError("upstream_error", source, `Could not reach ${sourceLabel(source)}.`);
  }

  if (res.status === 429 || (source === "off" && res.status === 503)) {
    const ra = Number(res.headers.get("Retry-After"));
    throw new ProviderError("rate_limited", source, `${sourceLabel(source)} is rate limiting requests. Try again shortly.`, Number.isFinite(ra) && ra > 0 ? Math.min(ra, 3600) : 60);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError("misconfigured", source, `${sourceLabel(source)} rejected the request (HTTP ${res.status}). Check the API key / User-Agent configuration.`);
  }

  const text = await res.text().catch(() => "");
  let body: T | null = null;
  try {
    body = text ? (JSON.parse(text) as T) : null;
  } catch {
    body = null;
  }
  if (res.status === 404) return { status: 404, body };
  if (!res.ok) {
    const detail = upstreamDetail(text);
    console.error(`${source} HTTP ${res.status} for ${redact(url)}${detail ? `: ${detail}` : ""}`);
    throw new ProviderError("upstream_error", source, `${sourceLabel(source)} returned HTTP ${res.status}${detail ? ` (${detail})` : ""}.`);
  }
  if (body === null) throw new ProviderError("upstream_error", source, `${sourceLabel(source)} returned an unreadable response.`);
  return { status: res.status, body };
}

/** Remove API keys from a URL or text before logging or returning it. */
export function redact(s: string): string {
  return s.replace(/(api_key=)[^&\s"']+/gi, "$1[redacted]");
}

/** A short, safe excerpt of an upstream error body (USDA explains bad parameters here). */
function upstreamDetail(text: string): string {
  if (!text) return "";
  let msg = text;
  try {
    const j = JSON.parse(text);
    msg = j?.error?.message ?? j?.message ?? j?.error ?? (Array.isArray(j?.errors) ? j.errors.join("; ") : text);
    if (typeof msg !== "string") msg = JSON.stringify(msg);
  } catch {
    /* plain text */
  }
  return redact(msg.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 200);
}

/**
 * Build a query string with %20 for spaces (not "+"). FDC matches dataType values
 * such as "SR Legacy" and "Survey (FNDDS)" exactly; this is the form verified against the live API.
 */
export function queryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export function sourceLabel(source: SourceId): string {
  return source === "usda" ? "USDA FoodData Central" : source === "off" ? "Open Food Facts" : "Manual entry";
}

export async function ensureBudget(ctx: ProviderContext, bucket: Parameters<NonNullable<ProviderContext["allowUpstream"]>>[0], source: SourceId) {
  if (ctx.allowUpstream && !(await ctx.allowUpstream(bucket))) {
    throw new ProviderError("rate_limited", source, `This app's request budget for ${sourceLabel(source)} is used up for the moment. Try again in a minute.`, 60);
  }
}
