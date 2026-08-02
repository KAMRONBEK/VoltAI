import { fallbackParseStations, type AppScraperConfig } from "./base";

const tokborConfig: AppScraperConfig = {
  sourceId: "tokbor",
  packageName: "uz.tokbor.tokbor",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: (payload) => fallbackParseStations("tokbor", payload)
};

export default tokborConfig;
