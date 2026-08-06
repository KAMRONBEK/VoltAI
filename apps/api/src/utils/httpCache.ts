import type { Request, Response } from "express";

/**
 * HTTP caching for the read endpoints. The API origin is a single phone CPU, so both the
 * Cloudflare edge and consumer apps must be able to cache aggressively — while still seeing
 * fresh charger statuses within one scrape cycle. We drive both with the same version token
 * (the canonical table's `lastMergeAt`): the edge/browser gets a short TTL, and pollers get
 * cheap 304s via ETag / If-Modified-Since when nothing changed since the last merge.
 */

export interface CachePolicy {
  /** Browser/client freshness, seconds (Cache-Control max-age). */
  maxAge: number;
  /** Shared cache (CDN/edge) freshness, seconds (Cache-Control s-maxage). */
  sMaxAge: number;
  /** Serve stale up to N seconds while revalidating in the background. */
  swr?: number;
  /** Serve stale up to N seconds if the origin (the phone) is unreachable. */
  sie?: number;
}

export function cacheControl(policy: CachePolicy): string {
  const parts = ["public", `max-age=${policy.maxAge}`, `s-maxage=${policy.sMaxAge}`];
  if (policy.swr != null) parts.push(`stale-while-revalidate=${policy.swr}`);
  if (policy.sie != null) parts.push(`stale-if-error=${policy.sie}`);
  return parts.join(", ");
}

/** Read an integer env var with a fallback (used for tunable cache TTLs). */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

/**
 * Apply cache + conditional-GET headers keyed off a version token (use `lastMergeAt`).
 * Returns true if a 304 Not Modified was sent — the caller must then stop and not send a body.
 */
export function applyCache(
  req: Request,
  res: Response,
  policy: CachePolicy,
  version: { lastModified?: string | null; tag: string }
): boolean {
  res.set("Cache-Control", cacheControl(policy));
  res.set("Vary", "Accept-Encoding");

  const etag = `W/"${version.tag}"`;
  res.set("ETag", etag);

  let lastModifiedHttp: string | undefined;
  if (version.lastModified) {
    const parsed = Date.parse(version.lastModified);
    if (!Number.isNaN(parsed)) {
      lastModifiedHttp = new Date(parsed).toUTCString();
      res.set("Last-Modified", lastModifiedHttp);
    }
  }

  const ifNoneMatch = req.headers["if-none-match"];
  if (typeof ifNoneMatch === "string" && ifNoneMatch.split(",").some((t) => t.trim() === etag)) {
    res.status(304).end();
    return true;
  }

  const ifModifiedSince = req.headers["if-modified-since"];
  if (typeof ifModifiedSince === "string" && lastModifiedHttp) {
    const since = Date.parse(ifModifiedSince);
    const modified = Date.parse(lastModifiedHttp);
    if (!Number.isNaN(since) && !Number.isNaN(modified) && modified <= since) {
      res.status(304).end();
      return true;
    }
  }

  return false;
}
