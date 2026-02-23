import { fallbackParseStations, type AppScraperConfig } from "./base";

const kWattConfig: AppScraperConfig = {
  sourceId: "k-watt",
  packageName: "org.uicgroup.kwattapp",
  launchActivity: ".MainActivity",
  selectors: {
    phoneInputSelector: "tap:540:640",
    otpInputSelector: "tap:540:760",
    sendOtpSelector: "tap:540:880",
    verifyOtpSelector: "tap:540:980",
    mapTabSelector: "tap:540:1820"
  },
  parseResponse: (payload) => fallbackParseStations("k-watt", payload)
};

export default kWattConfig;
