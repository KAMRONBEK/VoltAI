import * as beon from "./beon";
import * as proTok from "./pro-tok";
import * as tokbor from "./tokbor";
import { getTokens, jwtExpiryMs, listStoredSources, storePath, type SourceTokens } from "./tokenStore";
import fs from "node:fs";

/**
 * Auth dispatcher for login-replay sources. The http scraper uses
 * `getAccessTokenFor` / `refreshFor` to attach and rotate bearer tokens.
 *
 * Only sources with an automatable login live here. Megawatt is intentionally
 * absent: its send-code is gated by a puzzle captcha + hardware attestation, so
 * off-device login-replay is not viable (see docs/SCRAPERS.md).
 */

export interface AuthProvider {
  getAccessToken: () => string | null;
  refresh: () => Promise<string | null>;
}

const providers: Record<string, AuthProvider> = {
  tokbor: { getAccessToken: tokbor.getAccessToken, refresh: tokbor.refresh },
  beon: { getAccessToken: beon.getAccessToken, refresh: beon.refresh },
  "pro-tok": { getAccessToken: proTok.getAccessToken, refresh: proTok.refresh }
};

export function isAuthSource(source: string): boolean {
  return source in providers;
}

export function getAccessTokenFor(source: string): string | null {
  return providers[source]?.getAccessToken() ?? null;
}

export async function refreshFor(source: string): Promise<string | null> {
  return providers[source] ? providers[source].refresh() : null;
}

export function hasStoredLogin(source: string): boolean {
  return Boolean(getTokens(source).accessToken);
}

export interface AuthSourceStatus {
  hasToken: boolean;
  /** ISO expiry of the access token when it is a JWT (or the API told us), else null. */
  expiresAt: string | null;
  daysLeft: number | null;
  obtainedAt: string | null;
  /** Set when the operator API rejected the stored token (401/403) — a re-login is needed. */
  lastRejectedAt: string | null;
}

const lastRejected = new Map<string, string>();

/** Called by the scraper when a stored bearer is refused; surfaced in /api/health/detail. */
export function markTokenRejected(source: string): void {
  lastRejected.set(source, new Date().toISOString());
}

/** Called after a successful authenticated fetch so a past rejection stops being reported. */
export function clearTokenRejected(source: string): void {
  lastRejected.delete(source);
}

/** Health view of every login-replay source. Never includes token values. */
export function authStatus(): Record<string, AuthSourceStatus> {
  const stored = listStoredSources();
  const out: Record<string, AuthSourceStatus> = {};
  for (const source of Object.keys(providers)) {
    const t: SourceTokens = stored[source] ?? {};
    // The store is hand-copied JSON: tolerate any junk in accessExpiresAt (and any exp claim).
    const stored_ = t.accessExpiresAt;
    let expMs = typeof stored_ === "number" && Number.isFinite(stored_) ? stored_ : jwtExpiryMs(t.accessToken);
    if (expMs != null && (!Number.isFinite(expMs) || Math.abs(expMs) > 8.64e15)) expMs = undefined;
    const expDate = expMs != null ? new Date(expMs) : null;
    const expValid = expDate != null && !Number.isNaN(expDate.getTime());
    out[source] = {
      hasToken: Boolean(t.accessToken),
      expiresAt: expValid ? expDate.toISOString() : null,
      daysLeft: expValid ? Math.floor((expMs! - Date.now()) / 86_400_000) : null,
      obtainedAt: t.obtainedAt ?? null,
      lastRejectedAt: lastRejected.get(source) ?? null
    };
  }
  return out;
}

/** Where the store lives + whether it exists — logged once at boot so a wrong path is obvious. */
export function describeTokenStore(): { path: string; exists: boolean } {
  const p = storePath();
  return { path: p, exists: fs.existsSync(p) };
}
