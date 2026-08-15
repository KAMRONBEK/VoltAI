import axios from "axios";
import type { AppScraperConfig, HttpEndpoint } from "../apps/base";
import { appScraperConfigs } from "../apps";
import { getAccessTokenFor, refreshFor, isAuthSource, markTokenRejected, clearTokenRejected } from "../auth";
import type { RawStationInput } from "../../src/types/station";

/**
 * Off-device HTTP scraping (the "hybrid" path). For each source that declares
 * `http` endpoints, GET the operator's own public API and run the bytes through
 * the source's `parseResponse`. This is a pure fetch+parse module — it never
 * touches the database, so it is safe to call from either the API process
 * (in-process cron) or a standalone CLI.
 */

const DEFAULT_HEADERS: Record<string, string> = {
  // Mimic the Flutter/Dart HTTP client the real apps use.
  "User-Agent": "Dart/3.5 (dart:io)",
  Accept: "application/json"
};

const REQUEST_TIMEOUT_MS = 20000;
/** Cap on `nextPage` follow-ups so a misbehaving paginated API can never loop forever. */
const MAX_PAGES = 20;

export interface SourceScrapeResult {
  source: string;
  ok: boolean;
  stations: RawStationInput[];
  error?: string;
  /** True when the source was skipped because it isn't logged in yet (not a real failure). */
  skipped?: boolean;
}

async function fetchEndpoint(endpoint: HttpEndpoint, bearer?: string): Promise<unknown> {
  const headers: Record<string, string> = { ...DEFAULT_HEADERS, ...endpoint.headers };
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  const response = await axios.request({
    url: endpoint.url,
    method: endpoint.method ?? "GET",
    headers,
    data: endpoint.body,
    timeout: REQUEST_TIMEOUT_MS,
    // Operator APIs are all HTTPS with valid public certs; keep validation on.
    responseType: "json",
    // A non-JSON body (WAF challenge page, HTML error) must be an ERROR, not a silently-empty
    // parse: axios' default silentJSONParsing hands the raw string to parseResponse → 0 stations.
    transitional: { silentJSONParsing: false, forcedJSONParsing: true, clarifyTimeoutError: true },
    // Accept 2xx only; anything else is a scrape failure worth surfacing.
    validateStatus: (status) => status >= 200 && status < 300
  });
  const data = response.data as unknown;
  if (data === null || (typeof data !== "object" && !Array.isArray(data))) {
    const snippet = typeof data === "string" ? data.slice(0, 80).replace(/\s+/g, " ") : typeof data;
    throw new Error(`non-JSON response from ${endpoint.url}: ${snippet}`);
  }
  return data;
}

/** Fetch an endpoint and, if it declares `nextPage`, follow the pagination chain (bounded). */
async function fetchEndpointAllPages(endpoint: HttpEndpoint, bearer?: string): Promise<unknown[]> {
  const first = await fetchEndpoint(endpoint, bearer);
  const pages: unknown[] = [first];
  if (!endpoint.nextPage) return pages;
  const origin = new URL(endpoint.url).origin;
  let next = endpoint.nextPage(first);
  while (next && pages.length < MAX_PAGES) {
    // Never follow an operator-supplied "next" off-origin or to plain http — the bearer rides along.
    let nextUrl: URL;
    try {
      nextUrl = new URL(next);
    } catch {
      break;
    }
    if (nextUrl.origin !== origin || nextUrl.protocol !== "https:") {
      // eslint-disable-next-line no-console
      console.warn(`[scrape] ${endpoint.url}: refusing to follow off-origin page ${nextUrl.origin}`);
      break;
    }
    const page = await fetchEndpoint({ ...endpoint, url: next, nextPage: undefined }, bearer);
    pages.push(page);
    next = endpoint.nextPage(page);
  }
  if (next) {
    // eslint-disable-next-line no-console
    console.warn(`[scrape] ${endpoint.url}: pagination cut off after ${MAX_PAGES} pages`);
  }
  return pages;
}

/**
 * Sentinel error so a source that simply hasn't been logged in yet is skipped
 * cleanly instead of counting as a hard failure.
 */
export class NotLoggedInError extends Error {
  constructor(source: string) {
    super(`${source}: no stored login (run npm run auth:${source} -- send/verify)`);
    this.name = "NotLoggedInError";
  }
}

/** The stored bearer exists but the operator API refused it (expired/revoked) — re-login needed. */
export class TokenRejectedError extends Error {
  constructor(source: string, status: number | undefined) {
    super(`${source}: stored token rejected (HTTP ${status ?? "?"}) — re-run npm run auth:${source} and copy auth-tokens.json`);
    this.name = "TokenRejectedError";
  }
}

/** Fetch every endpoint for one source and return the raw (unparsed) payloads. */
export async function fetchSourcePayloads(config: AppScraperConfig): Promise<unknown[]> {
  if (!config.http?.length) {
    return [];
  }
  const source = config.sourceId;
  const payloads: unknown[] = [];

  for (const endpoint of config.http) {
    if (!endpoint.auth) {
      payloads.push(...(await fetchEndpointAllPages(endpoint)));
      continue;
    }

    // Authenticated endpoint: attach the stored bearer, refresh once on 401.
    if (!isAuthSource(source)) {
      throw new Error(`${source}: endpoint marked auth but no auth provider registered`);
    }
    let token = getAccessTokenFor(source);
    if (!token) {
      throw new NotLoggedInError(source);
    }
    try {
      payloads.push(...(await fetchEndpointAllPages(endpoint, token)));
      clearTokenRejected(source);
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      // 401 = the token itself was refused. A 403 is only an auth verdict when the API answered
      // with JSON — an HTML 403 is a WAF/bot challenge, not a revoked login.
      const body = axios.isAxiosError(error) ? error.response?.data : undefined;
      const authVerdict = status === 401 || (status === 403 && body !== null && typeof body === "object");
      if (!authVerdict) {
        throw describeHttpError(error);
      }
      const refreshed = await refreshFor(source);
      if (!refreshed) {
        markTokenRejected(source);
        throw new TokenRejectedError(source, status);
      }
      token = refreshed;
      try {
        payloads.push(...(await fetchEndpointAllPages(endpoint, token)));
        clearTokenRejected(source);
      } catch (retryError) {
        const retryStatus = axios.isAxiosError(retryError) ? retryError.response?.status : undefined;
        if (retryStatus === 401 || retryStatus === 403) {
          markTokenRejected(source);
          throw new TokenRejectedError(source, retryStatus);
        }
        throw describeHttpError(retryError);
      }
    }
  }
  return payloads;
}

/** Make an axios error message useful in the phone log: status + a body snippet, no headers. */
function describeHttpError(error: unknown): unknown {
  if (!axios.isAxiosError(error) || !error.response) return error;
  const body = error.response.data;
  const snippet =
    typeof body === "string"
      ? body.slice(0, 120)
      : body && typeof body === "object"
        ? JSON.stringify(body).slice(0, 120)
        : "";
  return new Error(`HTTP ${error.response.status}${snippet ? ` — ${snippet}` : ""}`);
}

/** Fetch every endpoint for one source and normalise via its parseResponse. */
export async function scrapeHttpSource(config: AppScraperConfig): Promise<RawStationInput[]> {
  const payloads = await fetchSourcePayloads(config);
  return payloads.flatMap((payload) => config.parseResponse(payload));
}

/** The names of every source that supports off-device HTTP scraping. */
export function httpEnabledSources(): string[] {
  return Object.entries(appScraperConfigs)
    .filter(([, config]) => config.http?.length)
    .map(([name]) => name);
}

/**
 * Scrape all HTTP-enabled sources (or a subset). Failures are isolated per
 * source so one dead operator API never blocks the others.
 */
export async function scrapeAllHttpSources(only?: string[]): Promise<SourceScrapeResult[]> {
  const names = (only?.length ? only : httpEnabledSources()).filter(
    (name) => appScraperConfigs[name]?.http?.length
  );

  const results = await Promise.all(
    names.map(async (name): Promise<SourceScrapeResult> => {
      try {
        const stations = await scrapeHttpSource(appScraperConfigs[name]);
        return { source: name, ok: true, stations };
      } catch (error) {
        if (error instanceof NotLoggedInError) {
          return { source: name, ok: false, stations: [], skipped: true, error: error.message };
        }
        // A rejected token is a REAL failure (data will go stale), not a skip.
        const message = error instanceof Error ? error.message : String(error);
        return { source: name, ok: false, stations: [], error: message };
      }
    })
  );

  return results;
}
