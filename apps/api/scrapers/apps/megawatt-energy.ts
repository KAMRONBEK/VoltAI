import { fallbackParseStations, type AppScraperConfig } from "./base";

const megawattEnergyConfig: AppScraperConfig = {
  sourceId: "megawatt-energy",
  packageName: "com.charging123.megawatt",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: (payload) => fallbackParseStations("megawatt-energy", payload)
};

export default megawattEnergyConfig;
