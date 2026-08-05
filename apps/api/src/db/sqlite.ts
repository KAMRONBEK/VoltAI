import { Database } from "node-sqlite3-wasm";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema";

/**
 * Single embedded SQLite connection for the on-device backend (replaces the Mongoose
 * connection). Exposes connectDatabase/disconnectDatabase under the same names the rest
 * of the app already imports, so call sites only change their import path.
 */

/** Read the DB path lazily (at connect time), not at import time, so SQLITE_PATH set after
 * this module loads — dotenv, tests, a supervisor — is honored. */
function resolveDbPath(): string {
  return process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "voltai.sqlite");
}

let db: Database | null = null;

export function getDb(): Database {
  if (db && db.isOpen) {
    return db;
  }
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new Database(dbPath);

  // WAL is unavailable under node-sqlite3-wasm's SQLITE_OS_OTHER VFS (no shared memory),
  // so use TRUNCATE + FULL sync — the phone can be OOM-killed or unplugged, and writes are
  // infrequent (a few times an hour), so durability is worth the fsync.
  database.exec("PRAGMA journal_mode = TRUNCATE");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");

  database.exec(SCHEMA_SQL);

  db = database;
  return db;
}

/** Kept for API compatibility with the old Mongoose config/database.ts. */
export async function connectDatabase(): Promise<void> {
  getDb();
}

export async function disconnectDatabase(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
}

export const nowIso = (): string => new Date().toISOString();
