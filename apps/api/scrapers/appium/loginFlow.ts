import { spawn } from "node:child_process";

export interface AppSelectors {
  phoneInputSelector: string;
  otpInputSelector: string;
  sendOtpSelector: string;
  verifyOtpSelector: string;
  mapTabSelector?: string;
}

export async function performOtpLogin(phone: string, otpCode: string, selectors: AppSelectors): Promise<void> {
  // Placeholder fallback uses adb input. Replace with full Appium element actions per app.
  await tapSelector(selectors.phoneInputSelector);
  await inputText(phone);
  await tapSelector(selectors.sendOtpSelector);
  await delay(1000);
  await tapSelector(selectors.otpInputSelector);
  await inputText(otpCode);
  await tapSelector(selectors.verifyOtpSelector);
}

export async function openMapAndZoomOut(selectors: AppSelectors): Promise<void> {
  if (selectors.mapTabSelector) {
    await tapSelector(selectors.mapTabSelector);
  }

  // 2 pinch-out gestures to widen coverage.
  await runAdb(["shell", "input", "swipe", "540", "960", "200", "350", "250"]);
  await runAdb(["shell", "input", "swipe", "540", "960", "880", "1570", "250"]);
  await delay(1500);
  await runAdb(["shell", "input", "swipe", "540", "960", "160", "250", "250"]);
  await runAdb(["shell", "input", "swipe", "540", "960", "920", "1670", "250"]);
}

async function tapSelector(selector: string): Promise<void> {
  // TODO: replace with Appium element lookup. For now we no-op if selector is not coordinate tuple.
  if (!selector.startsWith("tap:")) {
    return;
  }

  const [, x, y] = selector.split(":");
  await runAdb(["shell", "input", "tap", x, y]);
}

async function inputText(value: string): Promise<void> {
  const escaped = value.replace(/\s+/g, "%s");
  await runAdb(["shell", "input", "text", escaped]);
}

function runAdb(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("adb", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`adb ${args.join(" ")} failed with code ${code}`));
      }
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
