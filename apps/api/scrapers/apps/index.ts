import type { AppScraperConfig } from "./base";
import beon from "./beon";
import kWatt from "./k-watt";
import megawatt from "./megawatt-energy";
import proTok from "./pro-tok";
import spectre from "./spectre-energy";
import tokbor from "./tokbor";

export const appScraperConfigs: Record<string, AppScraperConfig> = {
  tokbor,
  "spectre-energy": spectre,
  "megawatt-energy": megawatt,
  "k-watt": kWatt,
  "pro-tok": proTok,
  beon
};
