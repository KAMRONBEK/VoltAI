import { fallbackParseStations, type AppScraperConfig } from "./base";

const beonConfig: AppScraperConfig = {
  sourceId: "beon",
  packageName: "uz.beonapp.uz",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: (payload) => fallbackParseStations("beon", payload)
};

export default beonConfig;
