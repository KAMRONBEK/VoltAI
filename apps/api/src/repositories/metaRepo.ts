import { getDb } from "../db/sqlite";

/** Small key/value table for operational metadata (lastMergeAt, lastIngestAt:<source>, …). */

export function getMeta(key: string): string | null {
  const row = getDb().get("SELECT v FROM meta WHERE k = ?", [key]) as { v: string } | null;
  return row ? row.v : null;
}

export function setMeta(key: string, value: string): void {
  getDb().run(
    "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    [key, value]
  );
}
