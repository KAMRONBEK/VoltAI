import { API_BASE_URL } from '@/lib/apiBaseUrl';
import { getJson, setJson } from '@/lib/storage/jsonStorage';
import { StorageKeys } from '@/lib/storage/storageKeys';

/**
 * `GET /api/client-config` — the one channel from the backend to installed apps.
 *
 * There is no remote-config SDK in this app. This is how a maintenance window, a one-off notice
 * or a must-upgrade floor reaches phones that already have the app. Fetched once at launch and
 * FAIL-OPEN throughout: a timeout, a 404 from an older backend, or garbage in the body all mean
 * "behave as if nothing was said" — the last good copy is kept on-device so a phone that cannot
 * reach the server still honours an update floor it has already seen.
 */

export type ClientConfig = {
  /** Versions below this get a blocking "update required" sheet. `0.0.0` = no floor. */
  minAppVersion: string;
  /** Free text shown once (news, an outage notice). */
  message: string | null;
  /** The app shows a non-blocking "under maintenance" banner. */
  maintenance: boolean;
  generatedAt: string;
};

export const CLIENT_CONFIG_URL = `${API_BASE_URL}/api/client-config`;

const TIMEOUT_MS = 6_000;

const SEMVER = /^\d+(\.\d+){0,2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseClientConfig(json: unknown): ClientConfig | null {
  if (!isRecord(json)) return null;
  const minAppVersion = typeof json.minAppVersion === 'string' && SEMVER.test(json.minAppVersion.trim())
    ? json.minAppVersion.trim()
    : '0.0.0';
  const message = typeof json.message === 'string' && json.message.trim() ? json.message.trim() : null;
  return {
    minAppVersion,
    message,
    maintenance: json.maintenance === true,
    generatedAt: typeof json.generatedAt === 'string' ? json.generatedAt : new Date().toISOString(),
  };
}

/**
 * Fetch the config, falling back to the last good copy, then to null. Never throws.
 */
export async function loadClientConfig(): Promise<ClientConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CLIENT_CONFIG_URL, { signal: controller.signal });
    if (res.ok) {
      const parsed = parseClientConfig((await res.json()) as unknown);
      if (parsed) {
        setJson(StorageKeys.clientConfig, parsed).catch(() => {});
        return parsed;
      }
    }
    // A 404 is an older backend without the route: nothing to say, and nothing to remember.
    if (res.status === 404) return null;
  } catch {
    // offline / timeout — fall through to the cache
  } finally {
    clearTimeout(timer);
  }
  // The cache goes through the same validation as a network body: a corrupt or hand-edited copy
  // must never hand `compareVersions` a non-string and throw during render.
  const cached = await getJson<unknown>(StorageKeys.clientConfig).catch(() => null);
  return parseClientConfig(cached);
}

/** Numeric compare of dotted versions: negative if `a < b`, 0 if equal, positive if `a > b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** True when the installed `currentVersion` is below the server's floor. */
export function isUpdateRequired(config: ClientConfig | null, currentVersion: string | undefined): boolean {
  if (!config || !currentVersion) return false;
  return compareVersions(currentVersion, config.minAppVersion) < 0;
}

/** Cheap stable hash so "seen" survives a reinstall of the same message text, not its identity. */
export function messageHash(message: string): string {
  let h = 0;
  for (let i = 0; i < message.length; i += 1) h = (Math.imul(h, 31) + message.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function hasSeenMessage(message: string): Promise<boolean> {
  const seen = await getJson<string>(StorageKeys.clientMessageSeen).catch(() => null);
  return seen === messageHash(message);
}

export async function markMessageSeen(message: string): Promise<void> {
  await setJson(StorageKeys.clientMessageSeen, messageHash(message)).catch(() => {});
}
