/**
 * One-shot backfill: re-derive per-gun connector power for already-captured Tokbor rows.
 *
 * The scraper fix (scrapers/apps/tokbor.ts) only takes effect on the next authenticated scrape.
 * This applies the same derivation to rows already in `raw_stations`, using the on-disk detail
 * cache, so the catalog stops overstating multi-gun power immediately instead of at the next
 * successful capture.
 *
 * Safe to re-run: it is idempotent, and the next scrape overwrites these rows with the scraper's
 * own (now identical) output anyway.
 *
 *   npm run backfill:pergun -- --dry     report what would change, write nothing
 *   npm run backfill:pergun              apply, then rebuild the canonical table
 */

import path from "node:path";
import { derivePerGunPower } from "../src/services/perGunPower";
import { getTokborDetail } from "../scrapers/apps/tokborDetailCache";

const DRY = process.argv.includes("--dry");

interface WireConnector {
  type: string;
  power?: number;
  siteMaxKw?: number;
  sharedCabinet?: boolean;
  powerBasis?: string;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  process.env.SQLITE_PATH =
    process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "voltai.sqlite");

  const { connectDatabase, disconnectDatabase, getDb } = await import("../src/db/sqlite");
  await connectDatabase();
  const db = getDb();

  const rows = db.all(
    "SELECT id, external_id, connectors FROM raw_stations WHERE source = 'tokbor'"
  ) as unknown as { id: number; external_id: string; connectors: string }[];

  let updated = 0;
  let skipped = 0;
  let powerChanged = 0;
  const examples: string[] = [];

  for (const row of rows) {
    const detail = getTokborDetail(row.external_id);
    if (!detail) {
      skipped++;
      continue;
    }

    let connectors: WireConnector[];
    try {
      connectors = JSON.parse(row.connectors) as WireConnector[];
    } catch {
      skipped++;
      continue;
    }
    if (!Array.isArray(connectors) || !connectors.length) {
      skipped++;
      continue;
    }

    const plugs = detail.plugs?.length ? detail.plugs : undefined;
    const guns = derivePerGunPower({
      name: detail.name,
      siteKw: detail.capacity,
      plugs: Array.from({ length: connectors.length }, (_unused, i) => plugs?.[i]),
    });

    const before = connectors.map((c) => c.power);
    const next = connectors.map((c, i) => {
      const gun = guns[i] ?? guns[guns.length - 1];
      return {
        ...c,
        power: gun?.kw ?? undefined,
        siteMaxKw: gun?.siteMaxKw ?? undefined,
        sharedCabinet: gun?.sharedCabinet || undefined,
        powerBasis: gun?.basis,
      };
    });

    const serialized = JSON.stringify(next);
    if (serialized === row.connectors) continue;

    if (before.some((b, i) => b !== next[i].power)) {
      powerChanged++;
      if (examples.length < 8) {
        examples.push(
          `  [${before.join(",")}] -> [${next.map((c) => c.power).join(",")}]  ${(detail.name ?? "").slice(0, 40)}`
        );
      }
    }

    if (!DRY) {
      db.run("UPDATE raw_stations SET connectors = ?, updated_at = ? WHERE id = ?", [
        serialized,
        new Date().toISOString(),
        row.id,
      ]);
    }
    updated++;
  }

  console.log(`tokbor rows: ${rows.length} (no cached detail: ${skipped})`);
  console.log(`${DRY ? "would update" : "updated"}: ${updated}; of those, power actually changed on ${powerChanged}`);
  if (examples.length) {
    console.log("sites whose per-gun power was corrected:");
    examples.forEach((e) => console.log(e));
  }

  if (!DRY && updated) {
    const { mergeStations } = await import("../src/services/mergeService");
    const { mergedCount } = await mergeStations();
    console.log(`rebuilt canonical table: ${mergedCount} stations`);
  }

  await disconnectDatabase();
}

void main();
