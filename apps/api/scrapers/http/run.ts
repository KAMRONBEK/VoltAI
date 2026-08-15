import axios from "axios";
import "../../src/env";
import { appScraperConfigs } from "../apps";
import {
  fetchSourcePayloads,
  httpEnabledSources,
  scrapeHttpSource
} from "./httpScraper";


/**
 * CLI for the off-device HTTP scrapers.
 *
 *   npm run scrape:http                 # dry-run: fetch + parse every source, print a report
 *   npm run scrape:http -- spectre-energy   # limit to one/some sources
 *   npm run scrape:http -- --ingest     # POST raw payloads to $API_BASE/ingest (server parses + upserts)
 *
 * Dry-run never writes anything. `--ingest` targets a running API (default
 * http://127.0.0.1:8080) using INGEST_TOKEN, so the DB stays owned by the API
 * process (node-sqlite3-wasm is single-process).
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ingest = args.includes("--ingest");
  const only = args.filter((arg) => !arg.startsWith("--"));
  const sources = (only.length ? only : httpEnabledSources()).filter(
    (name) => appScraperConfigs[name]?.http?.length
  );

  if (!sources.length) {
    // eslint-disable-next-line no-console
    console.log("No HTTP-enabled sources. Add `http` endpoints to a config in scrapers/apps/.");
    return;
  }

  const apiBase = process.env.SCRAPE_INGEST_URL ?? "http://127.0.0.1:8080";
  const token = process.env.INGEST_TOKEN;

  for (const source of sources) {
    const config = appScraperConfigs[source];
    try {
      if (ingest) {
        if (!token) {
          throw new Error("INGEST_TOKEN is not set (required for --ingest)");
        }
        const payloads = await fetchSourcePayloads(config);
        const parsedCount = payloads.flatMap((p) => config.parseResponse(p)).length;
        const response = await axios.post(
          `${apiBase}/ingest`,
          { source, payloads },
          { headers: { "x-ingest-token": token }, timeout: 30000 }
        );
        // eslint-disable-next-line no-console
        console.log(`[${source}] parsed ${parsedCount} → ingested`, response.data);
      } else {
        const stations = await scrapeHttpSource(config);
        const sample = stations[0];
        // eslint-disable-next-line no-console
        console.log(
          `[${source}] ${stations.length} stations` +
            (sample ? ` — e.g. "${sample.name}" @ ${sample.location.coordinates.join(",")}` : "")
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error(`[${source}] FAILED: ${message}`);
    }
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
