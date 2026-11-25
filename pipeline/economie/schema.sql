DROP TABLE IF EXISTS boc_rates;
DROP TABLE IF EXISTS fx_rates;
DROP TABLE IF EXISTS fx_currencies;
DROP TABLE IF EXISTS meta_sources;

CREATE TABLE meta_sources (
  source_key TEXT PRIMARY KEY,
  source_label TEXT NOT NULL,
  licence TEXT NOT NULL,
  version_date TEXT NOT NULL,
  row_count INTEGER NOT NULL
);

CREATE TABLE fx_currencies (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_fr TEXT NOT NULL DEFAULT '',
  active_daily INTEGER NOT NULL DEFAULT 0,
  first_date INTEGER NOT NULL,
  last_date INTEGER NOT NULL
);

CREATE TABLE fx_rates (
  currency_id INTEGER NOT NULL REFERENCES fx_currencies(id),
  obs_date INTEGER NOT NULL,
  regime INTEGER NOT NULL CHECK (regime IN (1, 2)),
  rate_micros INTEGER NOT NULL,
  PRIMARY KEY (currency_id, obs_date, regime)
) WITHOUT ROWID;

CREATE TABLE boc_rates (
  series_id TEXT NOT NULL CHECK (series_id IN ('V39079', 'V122530', 'V80691311')),
  obs_date INTEGER NOT NULL,
  rate_bps INTEGER NOT NULL,
  PRIMARY KEY (series_id, obs_date)
) WITHOUT ROWID;
