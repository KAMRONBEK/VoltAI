import fs from "node:fs";
import path from "node:path";

/**
 * Tiny JSON token store for authenticated operator sources (login-replay).
 *
 * Lives OUTSIDE version control — default is `apps/api/data/auth-tokens.json`
 * (the whole `data/` dir is gitignored). Never log token values.
 */

export interface SourceTokens {
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

function storePath(): string {
  return (
    process.env.AUTH_TOKENS_PATH ?? path.join(process.cwd(), "data", "auth-tokens.json")
  );
}

function readStore(): Store {
  const file = storePath();
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export function getTokens(source: string): SourceTokens {
  return readStore()[source] ?? {};
}

export function setTokens(source: string, patch: Partial<SourceTokens>): SourceTokens {
  const store = readStore();
  const next = { ...(store[source] ?? {}), ...patch };
  store[source] = next;
  writeStore(store);
  return next;
}

export function clearTokens(source: string): void {
  const store = readStore();
  delete store[source];
  writeStore(store);
}
