import axios from "axios";
import type { AppScraperConfig, HttpEndpoint } from "../apps/base";
import { appScraperConfigs } from "../apps";
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

export interface SourceScrapeResult {
  source: string;
  ok: boolean;
  stations: RawStationInput[];
  error?: string;
}

async function fetchEndpoint(endpoint: HttpEndpoint): Promise<unknown> {
  const response = await axios.request({
    url: endpoint.url,
    method: endpoint.method ?? "GET",
    headers: { ...DEFAULT_HEADERS, ...endpoint.headers },
    data: endpoint.body,
    timeout: REQUEST_TIMEOUT_MS,
    // Operator APIs are all HTTPS with valid public certs; keep validation on.
    responseType: "json",
    // Accept 2xx only; anything else is a scrape failure worth surfacing.
    validateStatus: (status) => status >= 200 && status < 300
  });
  return response.data;
}

/** Fetch every endpoint for one source and return the raw (unparsed) payloads. */
export async function fetchSourcePayloads(config: AppScraperConfig): Promise<unknown[]> {
  if (!config.http?.length) {
    return [];
  }
  const payloads: unknown[] = [];
  for (const endpoint of config.http) {
    payloads.push(await fetchEndpoint(endpoint));
  }
  return payloads;
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
        const message = error instanceof Error ? error.message : String(error);
        return { source: name, ok: false, stations: [], error: message };
      }
    })
  );

  return results;
}
