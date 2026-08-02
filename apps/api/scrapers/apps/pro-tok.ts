import { fallbackParseStations, type AppScraperConfig } from "./base";

const proTokConfig: AppScraperConfig = {
  sourceId: "pro-tok",
  packageName: "com.fintech_projects.fintech_project1",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: (payload) => fallbackParseStations("pro-tok", payload)
};

export default proTokConfig;
