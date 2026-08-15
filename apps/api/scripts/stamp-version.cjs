// Write dist/version.json after `tsc` so /api/health/detail can report which commit is running.
// Runs on the dev box (git present); tolerant when git is unavailable.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

const dist = path.join(__dirname, "..", "dist");
fs.mkdirSync(dist, { recursive: true });
const commit = git("rev-parse --short HEAD") ?? "unknown";
const dirty = git("status --porcelain -- .") ? true : false;
const version = {
  commit,
  dirty,
  branch: git("rev-parse --abbrev-ref HEAD") ?? "unknown",
  builtAt: new Date().toISOString(),
  pkgVersion: require("../package.json").version
};
fs.writeFileSync(path.join(dist, "version.json"), JSON.stringify(version, null, 2) + "\n");
console.log(`[build] stamped dist/version.json ${commit}${dirty ? "+dirty" : ""}`);
