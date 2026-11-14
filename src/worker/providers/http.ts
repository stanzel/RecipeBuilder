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

  let body: T | null = null;
  try {
    body = (await res.json()) as T;
  } catch {
    body = null;
  }
  if (res.status === 404) return { status: 404, body };
  if (!res.ok) {
    throw new ProviderError("upstream_error", source, `${sourceLabel(source)} returned HTTP ${res.status}.`);
  }
  if (body === null) throw new ProviderError("upstream_error", source, `${sourceLabel(source)} returned an unreadable response.`);
  return { status: res.status, body };
}

export function sourceLabel(source: SourceId): string {
  return source === "usda" ? "USDA FoodData Central" : source === "off" ? "Open Food Facts" : "Manual entry";
}

export async function ensureBudget(ctx: ProviderContext, bucket: Parameters<NonNullable<ProviderContext["allowUpstream"]>>[0], source: SourceId) {
  if (ctx.allowUpstream && !(await ctx.allowUpstream(bucket))) {
    throw new ProviderError("rate_limited", source, `This app's request budget for ${sourceLabel(source)} is used up for the moment. Try again in a minute.`, 60);
  }
}
