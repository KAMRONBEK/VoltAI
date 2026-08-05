import { Router } from "express";
import { appScraperConfigs } from "../../scrapers/apps";
import { upsertRawStations } from "../repositories/rawStationRepo";
import { setMeta } from "../repositories/metaRepo";

/**
 * Ingestion endpoint for the on-device capture layer. The capture bridge POSTs
 * `{ source, payload }` (or `{ source, payloads }`) here; we run the source's existing
 * `parseResponse` (the same code the old Appium flow used) and upsert RawStations.
 *
 * SECURITY: this must never be reachable through the public tunnel. In production it runs
 * on a separate loopback-only listener; the token below is a second line of defense.
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
