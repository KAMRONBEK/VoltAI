import dotenv from "dotenv";

/**
 * Environment loading + parsing, in ONE place, imported FIRST by every entrypoint.
 *
 * Two lessons from the phone deployment drove this module:
 *
 * 1. `dotenv.config()` used to run inside `src/app.ts`, i.e. AFTER modules such as
 *    `routes/stations` and `services/routing/mytaxi` had already evaluated their env-derived
 *    constants at import time. Values in `.env` therefore only worked when something else
 *    (the runit service) had exported them into the process environment first. Importing this
 *    module first from `src/index.ts` (and any other entrypoint) fixes the ordering.
 *
 * 2. `KEY=` (an EMPTY assignment — exactly what `cp .env.example .env` produces) is exported as
 *    the empty string by both dotenv and a shell `set -a; . ./.env`. `process.env.KEY ?? default`
 *    honours that empty string, so `SQLITE_PATH=` opened a TEMP database on the phone (all data
 *    lost on every restart) and `AUTH_TOKENS_PATH=` made two operators look "not logged in".
 *    Everything below treats blank/whitespace as "unset". Never read `process.env.X ?? y` for a
 *    tunable — use these helpers.
 */

dotenv.config({ quiet: true });

/** String env var; blank/whitespace counts as unset. */
export function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const value = raw.trim();
  return value ? value : fallback;
}

/** Optional string env var; returns undefined when unset or blank. */
export function envOpt(name: string): string | undefined {
  const raw = process.env[name];
  if (raw == null) return undefined;
  const value = raw.trim();
  return value ? value : undefined;
}

/**
 * Integer env var with a fallback. Blank, non-numeric and negative values fall back.
 * `min`/`max` clamp the accepted range (a `MYTAXI_TIMEOUT_MS=0` must not mean "abort instantly").
 */
export function envInt(name: string, fallback: number, opts?: { min?: number; max?: number }): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  let value = Math.floor(n);
  if (opts?.min != null && value < opts.min) value = fallback;
  if (opts?.max != null && value > opts.max) value = fallback;
  return value < 0 ? fallback : value;
}

/** Boolean env var: "false"/"0"/"no"/"off" (any case) → false, blank → fallback, else true. */
export function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return !/^(false|0|no|off)$/i.test(raw.trim());
}

export function isProduction(): boolean {
  return envStr("NODE_ENV", "development") === "production";
}
