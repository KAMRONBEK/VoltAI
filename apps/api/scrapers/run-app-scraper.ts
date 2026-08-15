import "../src/env";
import { upsertRawStations } from "../src/repositories/rawStationRepo";
import { appScraperConfigs } from "./apps";
import { openMapAndZoomOut, performOtpLogin } from "./appium/loginFlow";
import { ensureAppLaunched } from "./appium/setup";
import { downloadApkForApp } from "./apk/downloader";
import { parseHarCandidates } from "./proxy/mitmparser";
import { GrizzlySmsClient } from "./sms/grizzlysms";
import { withDatabase } from "./utils/db";


async function main(): Promise<void> {
  const appName = process.argv[2];
  if (!appName) {
    throw new Error("Usage: npm run scrape:app -- <app-name>");
  }

  const config = appScraperConfigs[appName];
  if (!config) {
    throw new Error(`Unknown app config: ${appName}`);
  }

  await downloadApkForApp(appName);
  await ensureAppLaunched({
    packageName: config.packageName,
    launchActivity: config.launchActivity
  });

  const sms = new GrizzlySmsClient();
  const number = await sms.getNumber(config.grizzlyServiceCode ?? "ot", config.grizzlyCountryCode ?? "0");
  await performOtpLogin(number.phoneNumber, await sms.waitForCode(number.activationId), config.selectors);
  await openMapAndZoomOut(config.selectors);
  await sms.setStatus(number.activationId, 6);

  const candidates = await parseHarCandidates("traffic.har");
  const parsed = candidates.flatMap((candidate) => config.parseResponse(candidate.payload));
  if (!parsed.length) {
    // eslint-disable-next-line no-console
    console.warn(`No stations parsed for ${appName}`);
  }

  await withDatabase(async () => {
    if (parsed.length > 0) {
      upsertRawStations(parsed);
    }
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
