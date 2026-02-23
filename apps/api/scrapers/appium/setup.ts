import { spawn } from "node:child_process";

export interface AppiumSessionConfig {
  packageName: string;
  launchActivity: string;
  appiumUrl?: string;
}

export async function startAppiumServer(port = 4723): Promise<void> {
  const child = spawn("npx", ["appium", "--port", String(port)], {
    stdio: "inherit",
    detached: true
  });
  child.unref();
  await delay(5000);
}

export async function ensureAppLaunched(config: AppiumSessionConfig): Promise<void> {
  await runCommand("adb", ["shell", "am", "start", "-n", `${config.packageName}/${config.launchActivity}`]);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
