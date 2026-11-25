DROP TABLE IF EXISTS cmhc_rents;
DROP TABLE IF EXISTS cmhc_centres;
DROP TABLE IF EXISTS cpi_observations;
DROP TABLE IF EXISTS cpi_series;
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

CREATE TABLE cpi_series (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL CHECK (product_id IN (18100004, 18100005)),
  frequency TEXT NOT NULL CHECK (frequency IN ('M', 'A')),
  geo_code TEXT NOT NULL CHECK (geo_code IN ('canada', 'quebec', 'quebec_rmr', 'montreal_rmr')),
  geo_en TEXT NOT NULL,
  geo_fr TEXT NOT NULL,
  product_code TEXT NOT NULL CHECK (product_code IN ('all_items', 'shelter', 'rented_accommodation', 'rent', 'health_care_services')),
  product_en TEXT NOT NULL,
  product_fr TEXT NOT NULL,
  coordinate TEXT NOT NULL,
  vector_id INTEGER NOT NULL UNIQUE,
  uom TEXT NOT NULL,
  first_period INTEGER NOT NULL,
  last_period INTEGER NOT NULL,
  UNIQUE (frequency, geo_code, product_code, uom)
);

CREATE TABLE cpi_observations (
  series_id INTEGER NOT NULL REFERENCES cpi_series(id),
  period INTEGER NOT NULL,
  value_milli INTEGER NOT NULL,
  PRIMARY KEY (series_id, period)
) WITHOUT ROWID;

CREATE TABLE cmhc_centres (
  geo_member_id INTEGER PRIMARY KEY,
  geo_key TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_fr TEXT NOT NULL,
  search_norm TEXT NOT NULL,
  province_code TEXT NOT NULL DEFAULT '',
  is_quebec INTEGER NOT NULL DEFAULT 0,
  uom TEXT NOT NULL DEFAULT 'Dollars',
  first_year INTEGER NOT NULL,
  last_year INTEGER NOT NULL
);

CREATE TABLE cmhc_rents (
  geo_member_id INTEGER NOT NULL REFERENCES cmhc_centres(geo_member_id),
  structure_id INTEGER NOT NULL CHECK (structure_id BETWEEN 1 AND 4),
  unit_id INTEGER NOT NULL CHECK (unit_id BETWEEN 1 AND 4),
  year INTEGER NOT NULL,
  rent_dollars INTEGER NOT NULL,
  PRIMARY KEY (geo_member_id, structure_id, unit_id, year)
) WITHOUT ROWID;
