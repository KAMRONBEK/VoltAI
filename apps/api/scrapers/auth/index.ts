import * as beon from "./beon";
import * as proTok from "./pro-tok";
import * as tokbor from "./tokbor";
import { getTokens } from "./tokenStore";

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
