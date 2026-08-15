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
  //
  // This covers the DATA and it was crash-tested (2026-08-15): SIGKILL mid-transaction, the
  // journal rolled back cleanly on reopen, integrity_check = ok, all 1226 rows intact.
  //
  // ⚠️ It does NOT cover STARTUP. This VFS takes its write lock as a `<db>.lock` DIRECTORY on
  // disk, not an advisory fcntl lock, so an unclean kill during a write transaction leaves that
  // directory behind. Every subsequent open then throws `SQLite3Error: database is locked` — the
  // phone comes back from a reboot serving nothing, and runit will restart-loop the process
  // forever, because nothing here clears a stale lock. Recovery today is manual:
  // `rmdir "$SQLITE_PATH.lock"` (safe only when no other node process is running). Clearing it
  // automatically in getDb() is the obvious fix and is not implemented.
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
