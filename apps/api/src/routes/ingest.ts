import { Router } from "express";
import { appScraperConfigs } from "../../scrapers/apps";
import { upsertRawStations } from "../repositories/rawStationRepo";
import { setMeta } from "../repositories/metaRepo";

/**
 * Ingestion side door for pushing station payloads in from OFF-device scrapers. It was written for
 * the on-device capture bridge, which was abandoned (Flutter + cert pinning — docs/SCRAPERS.md);
 * the phone now feeds itself from the in-process HTTP scrapers, and the only caller left in the
 * repo is `npm run scrape:http -- --ingest` (scrapers/http/run.ts), run from a dev box.
 * A client POSTs `{ source, payload }` (or `{ source, payloads }`) here; we run the source's
 * existing `parseResponse` and upsert RawStations.
 *
 * SECURITY (2026-08-16): three independent layers, all in code —
 *  1. the API binds 127.0.0.1 unless HOST is set (src/index.ts), so the phone's LAN cannot reach it;
 *  2. src/app.ts refuses any /ingest request that did not arrive from loopback OR that carries the
 *     Cloudflare `cf-connecting-ip`/`cf-ray` headers (i.e. came through the tunnel) with a 404 —
 *     regardless of the cloudflared ingress rule, and case-insensitively (Express routing);
 *  3. this router's shared-secret check (fails closed when INGEST_TOKEN is unset).
 * The JSON body parser is mounted only on this path.
 */
const router = Router();

router.use((req, res, next) => {
  const expected = process.env.INGEST_TOKEN;
  if (!expected || req.get("x-ingest-token") !== expected) {
    return res.status(401).json({ message: "unauthorized" });
  }
  return next();
});

router.post("/", (req, res, next) => {
  try {
    const source = req.body?.source as string | undefined;
    const config = source ? appScraperConfigs[source] : undefined;
    if (!source || !config) {
      return res.status(400).json({ message: `unknown source: ${source}` });
    }

    const payloads: unknown[] = Array.isArray(req.body?.payloads)
      ? req.body.payloads
      : [req.body?.payload];

    const parsed = payloads.flatMap((payload) => config.parseResponse(payload));
    if (!parsed.length) {
      return res.status(200).json({ source, upserted: 0, note: "no stations parsed" });
    }

    const upserted = upsertRawStations(parsed);
    setMeta(`lastIngestAt:${source}`, new Date().toISOString());
    return res.json({ source, upserted });
  } catch (error) {
    return next(error);
  }
});

export default router;
