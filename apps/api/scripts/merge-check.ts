/**
 * Merge regression guard.
 *
 * Asserts the invariant `merge(raw_stations) === stations`: re-running the merge over the raw
 * captures must reproduce the canonical table exactly. Any change to the dedup — the spatial
 * index, the name similarity, the priority ordering — that alters which rows collapse together
 * shows up here as a row difference, instead of silently reshaping the catalog on the next
 * scrape cycle.
 *
 * This matters because the merge is the one place where a bug is invisible: the output is still
 * a plausible-looking list of stations, just with the wrong ones combined.
 *
 * Run: npm run merge:check   (from apps/api)
 */

import fs from "node:fs";
import path from "node:path";
import { Database } from "node-sqlite3-wasm";

const SRC = process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "voltai.sqlite");
const SCRATCH = path.join(process.cwd(), "tmp", "merge-check.sqlite");

const COLUMNS =
  "_id,name,lng,lat,connectors,sources,primary_source,address,working_hours,rating,description,images";

async function main(): Promise<void> {
  if (!fs.existsSync(SRC)) {
    console.error(`merge-check: no database at ${SRC}`);
    process.exit(1);
  }

  const ref = new Database(SRC);
  const golden = ref.all(`SELECT ${COLUMNS} FROM stations ORDER BY _id`) as Record<string, any>[];
  const rawCount = (ref.all("SELECT COUNT(*) c FROM raw_stations")[0] as Record<string, any>).c;
  ref.close();

  if (!golden.length) {
    console.log("merge-check: stations table is empty, nothing to compare against — skipping");
    return;
  }

  // Merge into a throwaway copy so the real catalog is never touched by a check.
  fs.mkdirSync(path.dirname(SCRATCH), { recursive: true });
  fs.copyFileSync(SRC, SCRATCH);
  process.env.SQLITE_PATH = SCRATCH;

  const { connectDatabase, disconnectDatabase } = await import("../src/db/sqlite");
  const { mergeStations } = await import("../src/services/mergeService");

  await connectDatabase();
  const started = process.hrtime.bigint();
  const { mergedCount } = await mergeStations();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  await disconnectDatabase();

  const out = new Database(SCRATCH);
  const fresh = out.all(`SELECT ${COLUMNS} FROM stations ORDER BY _id`) as Record<string, any>[];
  out.close();
  fs.rmSync(SCRATCH, { force: true });

  console.log(`raw ${rawCount} -> merged ${mergedCount} in ${elapsedMs.toFixed(0)} ms`);

  const byId = new Map(golden.map((r) => [String(r._id), r]));
  const diffs: string[] = [];

  for (const f of fresh) {
    const g = byId.get(String(f._id));
    if (!g) {
      diffs.push(`only after merge: ${f._id} "${f.name}"`);
      continue;
    }
    for (const key of Object.keys(f)) {
      if (JSON.stringify(f[key]) !== JSON.stringify(g[key])) {
        diffs.push(`${f._id} "${f.name}" field ${key}: ${JSON.stringify(g[key])} -> ${JSON.stringify(f[key])}`);
        break;
      }
    }
  }
  const freshIds = new Set(fresh.map((f) => String(f._id)));
  for (const g of golden) {
    if (!freshIds.has(String(g._id))) diffs.push(`disappeared: ${g._id} "${g.name}"`);
  }

  if (diffs.length) {
    console.error(`FAIL  merge output differs from the canonical table in ${diffs.length} row(s):`);
    diffs.slice(0, 10).forEach((d) => console.error(`  ${d}`));
    if (diffs.length > 10) console.error(`  ...and ${diffs.length - 10} more`);
    console.error(
      "\nIf this change is intentional, re-run the merge against the real DB to adopt the new " +
        "output, then re-run this check."
    );
    process.exit(1);
  }

  console.log(`PASS  all ${fresh.length} rows identical to the canonical table`);
}

void main();
