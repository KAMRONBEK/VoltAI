import fs from "node:fs";
import path from "node:path";
import { envOpt } from "../../src/env";

/**
 * Tiny JSON token store for authenticated operator sources (login-replay).
 *
 * Lives OUTSIDE version control — default is `apps/api/data/auth-tokens.json`
 * (the whole `data/` dir is gitignored). Never log token values.
 */

export interface SourceTokens {
  /** The phone number an OTP was requested for (some `verify` steps need it back). */
  phoneNumber?: string;
  /** Short-lived session token returned by the "send OTP" step. */
  tempToken?: string;
  /** Long-lived tokens returned after OTP verification. */
  accessToken?: string;
  refreshToken?: string;
  /** ISO timestamp of the last successful auth/refresh. */
  obtainedAt?: string;
  /** Optional epoch-ms expiry for the access token, if the API tells us. */
  accessExpiresAt?: number;
}

type Store = Record<string, SourceTokens>;

/** Blank `AUTH_TOKENS_PATH=` counts as unset (it once made two operators look "not logged in"). */
export function storePath(): string {
  return envOpt("AUTH_TOKENS_PATH") ?? path.join(process.cwd(), "data", "auth-tokens.json");
}

/** True when the file exists but is not valid JSON — we must never overwrite it in that state. */
let storeCorrupt = false;
let warnedCorrupt = false;

function readStore(): Store {
  const file = storePath();
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    storeCorrupt = false;
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    storeCorrupt = false;
    warnedCorrupt = false;
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    storeCorrupt = true;
    if (!warnedCorrupt) {
      warnedCorrupt = true;
      // eslint-disable-next-line no-console
      console.error(`[auth] ${file} is not valid JSON — refusing to use or overwrite it`);
    }
    return {};
  }
}

function writeStore(store: Store): void {
  const file = storePath();
  if (storeCorrupt) {
    throw new Error(`refusing to overwrite corrupt token store ${file}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Atomic replace: the phone holds the ONLY copy of these logins, so a crash mid-write must not
  // leave a half-written file behind.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Decode a JWT `exp` claim (seconds) to epoch-ms without verifying the signature. */
export function jwtExpiryMs(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Every stored source, for health/monitoring — token VALUES are never returned. */
export function listStoredSources(): Record<string, SourceTokens> {
  return readStore();
}

export function getTokens(source: string): SourceTokens {
  return readStore()[source] ?? {};
}

export function setTokens(source: string, patch: Partial<SourceTokens>): SourceTokens {
  const store = readStore();
  const next = { ...(store[source] ?? {}), ...patch };
  if (patch.accessToken) {
    // Recompute on every NEW access token (a re-login/refresh must not inherit the old expiry).
    next.accessExpiresAt = patch.accessExpiresAt ?? jwtExpiryMs(patch.accessToken);
  }
  store[source] = next;
  writeStore(store);
  return next;
}

export function clearTokens(source: string): void {
  const store = readStore();
  delete store[source];
  writeStore(store);
}
