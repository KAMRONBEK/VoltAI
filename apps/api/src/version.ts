import fs from "node:fs";
import path from "node:path";

export interface BuildInfo {
  commit: string;
  dirty?: boolean;
  branch?: string;
  builtAt?: string;
  pkgVersion?: string;
}

let cached: BuildInfo | null = null;

/**
 * Which build is running — stamped into dist/version.json by `npm run build`
 * (scripts/stamp-version.cjs). Under tsx (dev) there is no stamp, so it reports "dev".
 * Surfaced by /api/health/detail so an operator can tell a stale deploy from a fresh one.
 */
export function buildInfo(): BuildInfo {
  if (cached) return cached;
  // dist/src/version.js → dist/version.json ; src/version.ts (tsx) → apps/api/version.json (absent)
  const candidate = path.join(__dirname, "..", "version.json");
  try {
    cached = JSON.parse(fs.readFileSync(candidate, "utf8")) as BuildInfo;
  } catch {
    cached = { commit: "dev", pkgVersion: safePkgVersion() };
  }
  return cached;
}

function safePkgVersion(): string | undefined {
  try {
    return (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")) as { version?: string })
      .version;
  } catch {
    return undefined;
  }
}
