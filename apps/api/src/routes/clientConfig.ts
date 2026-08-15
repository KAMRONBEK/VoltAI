import { Router } from "express";
import { envBool, envInt, envStr } from "../env";

/**
 * GET /api/client-config — the one channel from the single-phone backend to installed apps.
 * There is no remote-config/kill-switch SDK in the app, so this is how a breaking backend change,
 * a maintenance window or a must-upgrade notice reaches users. The app fetches it at launch,
 * FAIL-OPEN (a missing/failed fetch never blocks the app). All values come from env so the
 * operator can flip them with a `.env` edit + `sv restart voltai-api`:
 *   CLIENT_MIN_VERSION   e.g. 1.0.0  — versions below get a blocking "update required" sheet
 *   CLIENT_MESSAGE       free text shown once (news, outage notice)
 *   CLIENT_MAINTENANCE   true/false — the app shows a maintenance banner and stops polling hard
 * Cached briefly at the edge so a launch storm does not hit the phone.
 */
const router = Router();

router.get("/", (_req, res) => {
  const maxAge = envInt("CLIENT_CONFIG_MAXAGE", 300);
  res.set("Cache-Control", `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-if-error=86400`);
  res.json({
    minAppVersion: envStr("CLIENT_MIN_VERSION", "0.0.0"),
    message: envStr("CLIENT_MESSAGE", "") || null,
    maintenance: envBool("CLIENT_MAINTENANCE", false),
    generatedAt: new Date().toISOString()
  });
});

export default router;
