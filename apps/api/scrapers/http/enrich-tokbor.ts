import axios from "axios";
import dotenv from "dotenv";
import * as tokborAuth from "../auth/tokbor";
import { saveTokborDetails, type TokborDetail } from "../apps/tokborDetailCache";

dotenv.config();

/**
 * One-time (occasional) Tokbor detail enrichment.
 *
 *   npm run enrich:tokbor
 *
 * Fetches /charging-station (list) then /charging-station/{id} for every station to cache
 * name/address/price/power (the list has none of these). Writes data/tokbor-details.json,
 * which the tokbor scraper merges with the live status list on each cron tick.
 * Requires a stored Tokbor login (npm run auth:tokbor -- send/verify).
 */

const API_BASE = process.env.TOKBOR_API_BASE ?? "https://api.newtokbor.uz";
const APP_VERSION = process.env.TOKBOR_APP_VERSION ?? "3.1.1";
const CONCURRENCY = 8;

function client(token: string) {
  return axios.create({
    baseURL: API_BASE,
    timeout: 20000,
    headers: {
      Authorization: `Bearer ${token}`,
      "app-version": APP_VERSION,
      "User-Agent": "Dart/3.5 (dart:io)",
      Accept: "application/json",
    },
    validateStatus: (s) => s >= 200 && s < 300,
  });
}

async function runPool<T>(items: T[], worker: (item: T, i: number) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        await worker(items[i], i);
      } catch {
        // skip failures; a missing detail just falls back to the synthesized name
      }
    }
  });
  await Promise.all(runners);
}

async function main(): Promise<void> {
  const token = tokborAuth.getAccessToken();
  if (!token) {
    throw new Error("No Tokbor login. Run: npm run auth:tokbor -- send/verify");
  }
  const http = client(token);

  const list = (await http.get("/charging-station")).data as { data?: { id: number }[] };
  const ids = (list.data ?? []).map((r) => r.id).filter((id) => id != null);
  // eslint-disable-next-line no-console
  console.log(`[enrich:tokbor] ${ids.length} stations to fetch…`);

  const out: Record<string, TokborDetail> = {};
  let done = 0;
  await runPool(ids, async (id) => {
    const d = (await http.get(`/charging-station/${id}`)).data as Record<string, unknown>;
    out[String(id)] = {
      name: typeof d.name === "string" ? d.name : undefined,
      address: typeof d.address === "string" ? d.address : undefined,
      capacity: typeof d.capacity === "number" ? d.capacity : undefined,
      electricityFee: typeof d.electricityFee === "number" ? d.electricityFee : undefined,
      idleFee: typeof d.idleFee === "number" ? d.idleFee : undefined,
      connectorCount: Array.isArray(d.connectors) ? d.connectors.length : undefined,
    };
    done += 1;
    if (done % 100 === 0) {
      // eslint-disable-next-line no-console
      console.log(`[enrich:tokbor] ${done}/${ids.length}`);
    }
  });

  saveTokborDetails(out);
  // eslint-disable-next-line no-console
  console.log(`[enrich:tokbor] cached ${Object.keys(out).length} details → data/tokbor-details.json`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
