import { fallbackParseStations, type AppScraperConfig } from "./base";

const spectreEnergyConfig: AppScraperConfig = {
  sourceId: "spectre-energy",
  packageName: "uz.spectreEnergy.uz",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: (payload) => fallbackParseStations("spectre-energy", payload)
};

export default spectreEnergyConfig;
