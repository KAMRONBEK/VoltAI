/**
 * Gate 1 — static APK pre-screen (no apktool / no Java required).
 *
 * Given one .apk (or a directory of them), it inspects the archive to predict how
 * hard on-device TLS interception will be, BEFORE you install/patch anything:
 *   - which UI framework the app uses (Flutter / React Native / native), and
 *   - whether it carries certificate-pinning signals.
 *
 * Why this matters (see ARCHITECTURE.md §5.1):
 *   - Flutter apps ignore Android's user-CA trust store entirely (bundled BoringSSL),
 *     so `apk-mitm` NSC patching is NOT enough — they need reFlutter even with no pinning.
 *   - Native/RN apps with common pinning (OkHttp CertificatePinner / TrustKit) are
 *     usually handled by `apk-mitm`; if TLS still resets, escalate to objection/Frida.
 *
 * Usage:
 *   npx tsx scripts/gate/screen-apk.ts <path-to.apk | dir-of-apks>
 *
 * Requires: `unzip` on PATH (already present on this box). Uses only Node + unzip.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Difficulty = "EASY" | "MEDIUM" | "HARD";

interface Screen {
  file: string;
  sizeMb: number;
  framework: "flutter" | "react-native" | "native/other";
  abis: string[];
  hasNetworkSecurityConfig: boolean;
  bundlesNativeTls: boolean; // libssl.so / libconscrypt etc. → harder
  pinningSignals: string[]; // strings found in dex
  difficulty: Difficulty;
  recommendation: string;
}

// ASCII substrings we look for inside classes*.dex (dex stores strings as MUTF-8,
// so ASCII fragments are directly searchable in the raw bytes).
const PINNING_STRINGS: string[] = [
  "CertificatePinner",
  "okhttp3/CertificatePinner",
  "com/datatheorem/android/trustkit",
  "TrustKit",
  "X509TrustManagerExtensions",
  "setCertificatePinner",
  "certificateTransparency",
  "network_security_config",
];

function listEntries(apk: string): string[] {
  // -Z1 = one entry name per line (Info-ZIP).
  const out = execFileSync("unzip", ["-Z1", apk], { maxBuffer: 64 * 1024 * 1024 });
  return out.toString("utf8").split(/\r?\n/).filter(Boolean);
}

function readEntry(apk: string, entry: string): Buffer {
  return execFileSync("unzip", ["-p", apk, entry], { maxBuffer: 512 * 1024 * 1024 });
}

function detectFramework(entries: string[]): Screen["framework"] {
  const has = (re: RegExp) => entries.some((e) => re.test(e));
  if (has(/lib\/[^/]+\/libflutter\.so$/) || has(/assets\/flutter_assets\//)) return "flutter";
  if (
    has(/assets\/index\.android\.bundle$/) ||
    has(/lib\/[^/]+\/libreactnativejni\.so$/) ||
    has(/lib\/[^/]+\/libhermes\.so$/) ||
    has(/lib\/[^/]+\/libjsc\.so$/)
  ) {
    return "react-native";
  }
  return "native/other";
}

function abisOf(entries: string[]): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    const m = /^lib\/([^/]+)\//.exec(e);
    if (m) set.add(m[1]);
  }
  return [...set].sort();
}

function scanDexForPinning(apk: string, entries: string[]): string[] {
  const dexes = entries.filter((e) => /^classes\d*\.dex$/.test(e));
  const found = new Set<string>();
  for (const dex of dexes) {
    let buf: Buffer;
    try {
      buf = readEntry(apk, dex);
    } catch {
      continue;
    }
    const hay = buf.toString("latin1"); // byte-preserving; fine for ASCII substring search
    for (const needle of PINNING_STRINGS) {
      if (hay.includes(needle)) found.add(needle);
    }
  }
  return [...found];
}

function verdict(s: Omit<Screen, "difficulty" | "recommendation">): {
  difficulty: Difficulty;
  recommendation: string;
} {
  if (s.framework === "flutter") {
    return {
      difficulty: "HARD",
      recommendation:
        "Flutter — ignores Android user-CA store. apk-mitm alone will NOT decrypt. Use reFlutter (patch libflutter.so) or a Frida BoringSSL-hook; if it also enforces Play Integrity, this source is lost on-device → maps-scraper fallback.",
    };
  }
  const pinned = s.pinningSignals.length > 0 || s.bundlesNativeTls;
  if (pinned) {
    return {
      difficulty: "MEDIUM",
      recommendation:
        "Pinning signals present. apk-mitm strips common OkHttp/TrustKit pinning + adds user-CA trust. If TLS still resets at runtime, escalate to `objection patchapk` (Frida gadget, no root).",
    };
  }
  return {
    difficulty: "EASY",
    recommendation:
      "No framework/pinning red flags. `apk-mitm <apk>` (NSC user-CA patch + re-sign) should decrypt after reinstall. Confirm at runtime.",
  };
}

function screenApk(apk: string): Screen {
  const entries = listEntries(apk);
  const framework = detectFramework(entries);
  const base = {
    file: path.basename(apk),
    sizeMb: Math.round((fs.statSync(apk).size / 1024 / 1024) * 10) / 10,
    framework,
    abis: abisOf(entries),
    hasNetworkSecurityConfig: entries.some((e) => /res\/.*network_security_config/i.test(e)),
    bundlesNativeTls: entries.some((e) => /lib\/[^/]+\/(libssl|libconscrypt|libcrypto)[^/]*\.so$/.test(e)),
    pinningSignals: scanDexForPinning(apk, entries),
  };
  return { ...base, ...verdict(base) };
}

function collectApks(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(target)
      .filter((f) => f.toLowerCase().endsWith(".apk"))
      .map((f) => path.join(target, f));
  }
  return [target];
}

function main(): void {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npx tsx scripts/gate/screen-apk.ts <path-to.apk | dir-of-apks>");
    console.error("Tip: pull APKs off your phone first with scripts/gate/pull-apks.sh");
    process.exit(2);
  }
  const apks = collectApks(target);
  if (!apks.length) {
    console.error(`No .apk files found at: ${target}`);
    process.exit(1);
  }

  const results: Screen[] = [];
  for (const apk of apks) {
    try {
      results.push(screenApk(apk));
    } catch (e) {
      console.error(`! failed to screen ${apk}: ${(e as Error).message}`);
    }
  }

  for (const r of results) {
    console.log("\n" + "=".repeat(72));
    console.log(`${r.file}  (${r.sizeMb} MB)  [${r.difficulty}]`);
    console.log(`  framework : ${r.framework}`);
    console.log(`  abis      : ${r.abis.join(", ") || "(none)"}`);
    console.log(`  NSC xml   : ${r.hasNetworkSecurityConfig ? "present" : "absent"}`);
    console.log(`  native TLS: ${r.bundlesNativeTls ? "YES (libssl/conscrypt bundled)" : "no"}`);
    console.log(`  pinning   : ${r.pinningSignals.length ? r.pinningSignals.join(", ") : "none in dex"}`);
    console.log(`  → ${r.recommendation}`);
  }

  const order: Record<Difficulty, number> = { EASY: 0, MEDIUM: 1, HARD: 2 };
  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY (sorted easiest → hardest):");
  for (const r of [...results].sort((a, b) => order[a.difficulty] - order[b.difficulty])) {
    console.log(`  ${r.difficulty.padEnd(6)}  ${r.framework.padEnd(14)}  ${r.file}`);
  }
  const hard = results.filter((r) => r.difficulty === "HARD").length;
  const med = results.filter((r) => r.difficulty === "MEDIUM").length;
  console.log(
    `\n${results.length} app(s): ${results.length - hard - med} easy, ${med} medium, ${hard} hard.` +
      (hard ? `  Plan on ${hard} needing reFlutter/Frida or the maps-scraper fallback.` : "")
  );
}

main();
