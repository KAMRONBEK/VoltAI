// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// This app lives in a monorepo alongside `apps/api`, which writes a rapidly created/deleted
// SQLite lock file at apps/api/data/voltai.sqlite.lock (the charger DB refreshes every ~5 min).
// On Windows without watchman, Metro's fallback file watcher crashes with ENOENT when that
// transient file disappears mid-watch — taking the whole dev server down. Exclude the API's
// data directory from Metro's crawl + watch so it never tries to watch those churning files.
const apiDataBlock = /[\\/]apps[\\/]api[\\/]data[\\/]/;
const existing = config.resolver.blockList;
const existingList = existing == null ? [] : Array.isArray(existing) ? existing : [existing];
config.resolver.blockList = [...existingList, apiDataBlock];

module.exports = config;
