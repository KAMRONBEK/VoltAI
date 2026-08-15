import { Database } from "node-sqlite3-wasm";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema";
import { envOpt } from "../env";

/**
 * Single embedded SQLite connection for the on-device backend (replaces the Mongoose
 * connection). Exposes connectDatabase/disconnectDatabase under the same names the rest
 * of the app already imports, so call sites only change their import path.
 */

/**
 * Read the DB path lazily (at connect time), not at import time, so SQLITE_PATH set after this
 * module loads — dotenv, tests, a supervisor — is honored. A BLANK `SQLITE_PATH=` counts as unset:
 * the phone once ran for days on a temporary database because `??` honoured the empty string.
 */
export function resolveDbPath(): string {
  return envOpt("SQLITE_PATH") ?? path.join(process.cwd(), "data", "voltai.sqlite");
}

let db: Database | null = null;
let ownedLockPidFile: string | null = null;

/** A live lock is held only for the duration of one statement/transaction; anything older is stale. */
const STALE_LOCK_AGE_MS = 60_000;

/**
 * node-sqlite3-wasm's VFS (SQLITE_OS_OTHER, no fcntl) takes its file lock as a `<db>.lock`
 * DIRECTORY on disk — for reads as well as writes. Any unclean death while a statement is in
 * flight (SIGKILL from Android's phantom-process killer, OOM, a reboot, a `sv restart` that
 * lands mid-merge) leaves that directory behind, and every later open then throws
 * `SQLite3Error: database is locked` — the classic "phone comes back from a reboot serving
 * nothing while runit restart-loops forever" failure. The data itself is safe (TRUNCATE journal +
 * synchronous=FULL, crash-tested), only the lock is stale.
 *
 * The long-lived owner (the API server) records its pid next to the DB (`<db>.pid`). On open, an
 * existing lock is treated as stale when (a) the recorded owner is not a live Node process of ours,
 * or (b) there is no owner on record AND the lock directory is older than one statement could
 * plausibly take (STALE_LOCK_AGE_MS). CLIs that open the same file (merge, plan-check, enrich…)
 * never claim the pid file when a live owner already holds it, and never remove someone else's.
 */
function clearStaleLock(dbPath: string): void {
  const lockDir = `${dbPath}.lock`;
  const pidFile = `${dbPath}.pid`;
  if (!fs.existsSync(lockDir)) return;

  const ownerPid = readPidFile(pidFile);
  if (ownerPid && ownerPid !== process.pid && isOurNodeProcess(ownerPid)) {
    // A live process holds it — do NOT touch it; the open below waits busy_timeout, then fails.
    // eslint-disable-next-line no-console
    console.warn(`[db] ${lockDir} is held by live pid ${ownerPid}; not clearing`);
    return;
  }
  if (!ownerPid) {
    // Nobody on record (a CLI, or a pre-pid-file build). Only a lock older than any real
    // statement is safe to remove — a young one belongs to a live process without a pid file.
    let ageMs = Number.POSITIVE_INFINITY;
    try {
      ageMs = Date.now() - fs.statSync(lockDir).mtimeMs;
    } catch {
      /* vanished — fine */
    }
    if (ageMs < STALE_LOCK_AGE_MS) {
      // eslint-disable-next-line no-console
      console.warn(`[db] ${lockDir} is ${Math.round(ageMs)}ms old with no recorded owner; leaving it (busy_timeout will wait)`);
      return;
    }
  }
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
    // eslint-disable-next-line no-console
    console.warn(`[db] cleared stale lock ${lockDir} (owner pid ${ownerPid ?? "unknown"} is gone)`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[db] failed to clear stale lock ${lockDir}`, error);
  }
}

function readPidFile(pidFile: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Is `pid` a live Node process we could plausibly own? After a reboot Android reuses pids for
 * OTHER uids' processes; kill(pid,0) then answers EPERM. Every Termux process shares one uid, so
 * EPERM can never be our own API — treat it (and any non-node cmdline) as "not ours" = stale.
 */
function isOurNodeProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false; // ESRCH (gone) or EPERM (someone else's) — not ours either way
  }
  if (process.platform === "win32") return true; // no /proc; a signalable pid is the best we have
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return /node|tsx/.test(cmdline);
  } catch {
    return false;
  }
}

/** Claim `<db>.pid` unless a live Node process already owns it (a CLI beside the server must not). */
function writePidFile(dbPath: string): void {
  const pidFile = `${dbPath}.pid`;
  const existing = readPidFile(pidFile);
  if (existing && existing !== process.pid && isOurNodeProcess(existing)) {
    ownedLockPidFile = null;
    return;
  }
  try {
    fs.writeFileSync(pidFile, String(process.pid));
    ownedLockPidFile = pidFile;
  } catch {
    ownedLockPidFile = null;
  }
}

export function getDb(): Database {
  if (db && db.isOpen) {
    return db;
  }
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  clearStaleLock(dbPath);
  writePidFile(dbPath);

  const database = new Database(dbPath);
  try {
    // busy_timeout FIRST so a transient lock stalls briefly instead of throwing immediately.
    database.exec("PRAGMA busy_timeout = 5000");
    // WAL is unavailable under node-sqlite3-wasm's SQLITE_OS_OTHER VFS (no shared memory),
    // so use TRUNCATE + FULL sync — the phone can be OOM-killed or unplugged, and writes are
    // infrequent (a few times an hour), so durability is worth the fsync. Crash-tested
    // (2026-08-15): SIGKILL mid-transaction, the journal rolled back cleanly on reopen,
    // integrity_check = ok, all rows intact.
    database.exec("PRAGMA journal_mode = TRUNCATE");
    database.exec("PRAGMA synchronous = FULL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(SCHEMA_SQL);
  } catch (error) {
    try {
      database.close();
    } catch {
      /* ignore */
    }
    throw error;
  }

  db = database;
  return db;
}

/** Kept for API compatibility with the old Mongoose config/database.ts. */
export async function connectDatabase(): Promise<void> {
  getDb();
}

export async function disconnectDatabase(): Promise<void> {
  if (db) {
    try {
      db.close();
    } finally {
      db = null;
    }
  }
  if (ownedLockPidFile) {
    try {
      // Only remove it if it is still ours — a server that started after us must keep its record.
      if (readPidFile(ownedLockPidFile) === process.pid) fs.rmSync(ownedLockPidFile, { force: true });
    } catch {
      /* ignore */
    }
    ownedLockPidFile = null;
  }
}

/**
 * Consistent point-in-time copy of the live database, produced IN-PROCESS with `VACUUM INTO`.
 * This is the only safe way to snapshot this DB: the `sqlite3` CLI uses POSIX locks the wasm VFS
 * never sees (and vice-versa), so a CLI `.backup` against the live file can read a torn copy — or
 * worse, "recover" our in-flight journal underneath us. The backup script therefore tars this
 * snapshot instead of touching the live file. Written to a temp name and renamed atomically.
 */
export function snapshotDatabase(destPath: string): { path: string; bytes: number } {
  const database = getDb();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.tmp`;
  // A crash mid-VACUUM leaves the output file AND its VFS lock dir/journal behind; all three must go
  // or every later snapshot fails with "database is locked" after busy_timeout.
  fs.rmSync(tmp, { force: true });
  fs.rmSync(`${tmp}.lock`, { recursive: true, force: true });
  fs.rmSync(`${tmp}-journal`, { force: true });
  // VACUUM INTO refuses to overwrite; single quotes escaped for the SQL literal.
  database.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.renameSync(tmp, destPath);
  return { path: destPath, bytes: fs.statSync(destPath).size };
}

export const nowIso = (): string => new Date().toISOString();
