/**
 * On-device SQLite schema (replaces the Mongoose RawStation/Station models).
 *
 * Inlined as a string constant on purpose: `tsc` does not copy `.sql` files into `dist/`,
 * so reading a sibling `schema.sql` at runtime would break the built server. Kept in one
 * place so the shape stays the single source of truth.
 *
 * Notes:
 * - lng/lat are separate indexed REAL columns (bounding-box prefilter needs indexable
 *   scalars); GeoJSON `[lng,lat]` is reassembled at the serialization boundary.
 * - stations._id is a content-derived 24-hex string (see repositories/objectId.ts) so it
 *   stays ObjectId-shaped and stable across merges — the mobile offline cache keys on it.
 * - stations_fts is an external-content FTS5 index over stations(name,address); it is
 *   repopulated with `INSERT INTO stations_fts(stations_fts) VALUES('rebuild')` after a merge.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS raw_stations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  address       TEXT,
  lng           REAL NOT NULL,
  lat           REAL NOT NULL,
  connectors    TEXT NOT NULL DEFAULT '[]',
  working_hours TEXT,
  rating        REAL,
  raw_data      TEXT,
  scraped_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_raw_source_external ON raw_stations (source, external_id);
CREATE INDEX IF NOT EXISTS ix_raw_lat_lng ON raw_stations (lat, lng);

CREATE TABLE IF NOT EXISTS stations (
  _id            TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  address        TEXT,
  lng            REAL NOT NULL,
  lat            REAL NOT NULL,
  connectors     TEXT NOT NULL DEFAULT '[]',
  working_hours  TEXT,
  rating         REAL,
  description    TEXT,
  images         TEXT NOT NULL DEFAULT '[]',
  sources        TEXT NOT NULL DEFAULT '[]',
  primary_source TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_stations_lat_lng ON stations (lat, lng);
CREATE INDEX IF NOT EXISTS ix_stations_updated ON stations (updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS stations_fts USING fts5(
  name, address,
  content='stations', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;
