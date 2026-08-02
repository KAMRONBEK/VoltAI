import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import axios from "axios";
import * as cheerio from "cheerio";
import appsConfig from "../../apps.json";

interface AppEntry {
  apkpureUrl: string;
  packageName: string;
  launchActivity: string;
}

export async function downloadApkForApp(appName: string): Promise<string> {
  const app = (appsConfig as Record<string, AppEntry>)[appName];
  if (!app) {
    throw new Error(`Unknown app in apps.json: ${appName}`);
  }

  await fs.mkdir("tmp", { recursive: true });

  const detailHtml = await fetchText(app.apkpureUrl);
  const firstUrl = extractDownloadUrl(app.apkpureUrl, detailHtml);
  const downloadUrl = firstUrl.endsWith(".apk") || firstUrl.endsWith(".xapk")
    ? firstUrl
    : extractDirectBinaryUrl(firstUrl, await fetchText(firstUrl));

  const extension = downloadUrl.endsWith(".xapk") ? "xapk" : "apk";
  const archivePath = path.join("tmp", `${appName}.${extension}`);
  await downloadFile(downloadUrl, archivePath);

  if (extension === "xapk") {
    return extractBaseApkFromXapk(archivePath, appName);
  }

  return archivePath;
}

async function fetchText(url: string): Promise<string> {
  const response = await axios.get<string>(url, {
    responseType: "text",
    timeout: 60_000,
    headers: { "User-Agent": "Mozilla/5.0 (CI Bot)" }
  });
  return response.data;
}

function extractDownloadUrl(baseUrl: string, html: string): string {
  const $ = cheerio.load(html);
  const href =
    $("a[href*='/download?']").attr("href") ??
    $("a[href*='download-apk']").attr("href") ??
    $("a[href*='.apk']").attr("href") ??
    "";
  if (!href) {
    throw new Error("Could not find APKPure download link");
  }
  return new URL(href, baseUrl).toString();
}

function extractDirectBinaryUrl(baseUrl: string, html: string): string {
  const $ = cheerio.load(html);
  const href =
    $("a[href$='.apk']").attr("href") ??
    $("a[href$='.xapk']").attr("href") ??
    $("a[data-dt-file]").attr("data-dt-file") ??
    "";

  if (!href) {
    throw new Error("Could not resolve direct APK/XAPK URL");
  }

  return new URL(href, baseUrl).toString();
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 120_000,
    headers: { "User-Agent": "Mozilla/5.0 (CI Bot)" }
  });

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const writer = (await import("node:fs")).createWriteStream(destination);
  await new Promise<void>((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function extractBaseApkFromXapk(xapkPath: string, appName: string): Promise<string> {
  const outputDir = path.join("tmp", `${appName}-xapk`);
  await fs.mkdir(outputDir, { recursive: true });
  await runCommand("unzip", ["-o", xapkPath, "-d", outputDir]);

  const files = await fs.readdir(outputDir);
  const apkName = files.find((file) => file.endsWith(".apk"));
  if (!apkName) {
    throw new Error("No APK found inside XAPK archive");
  }
  return path.join(outputDir, apkName);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
