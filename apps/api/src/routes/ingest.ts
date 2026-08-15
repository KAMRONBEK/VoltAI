import { Router } from "express";
import { appScraperConfigs } from "../../scrapers/apps";
import { upsertRawStations } from "../repositories/rawStationRepo";
import { setMeta } from "../repositories/metaRepo";

/**
 * Ingestion side door for pushing station payloads in from OFF-device scrapers. It was written for
 * the on-device capture bridge, which was abandoned (Flutter + cert pinning — docs/SCRAPERS.md);
 * the phone now feeds itself from the in-process HTTP scrapers, and the only caller left in the
 * repo is `npm run scrape:http -- --ingest` (scrapers/http/run.ts:43-55), run from a dev box.
 * A client POSTs `{ source, payload }` (or `{ source, payloads }`) here; we run the source's
 * existing `parseResponse` (the same code the old Appium flow used) and upsert RawStations.
 *
 * SECURITY — what is actually true today (verified 2026-08-15):
 * This router is mounted on the SINGLE public Express app (src/app.ts:86), served by the one
 * listener src/index.ts:13 opens on PORT — the same port cloudflared fronts. There is no separate
 * loopback-only listener, and INGEST_PORT is read by no code. The token check below is therefore
 * the FIRST and ONLY application-layer defence (it does at least fail closed when INGEST_TOKEN is
 * unset). The only other protection is the cloudflared ingress rule
 * `path: ^/ingest -> http_status:404` in scripts/cloudflared/config.example.yml — which is a
 * CASE-SENSITIVE regex, while Express routing is case-INSENSITIVE, so `POST /INGEST` slips past
 * the rule and reaches this router.
 *
 * Hardening still missing: (1) bind a second Express app to 127.0.0.1 and move /ingest onto it
 * (or at minimum `app.listen(port, "127.0.0.1")` — today Node binds 0.0.0.0, so anything on the
 * phone's LAN can POST here directly, bypassing cloudflared entirely); (2) make the ingress rule
 * case-insensitive, e.g. `path: (?i)^/ingest`; (3) rate-limit this route.
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
