CREATE INDEX IF NOT EXISTS idx_fx_rates_date ON fx_rates(obs_date, currency_id);
CREATE INDEX IF NOT EXISTS idx_cpi_obs_period ON cpi_observations(period, series_id);
CREATE INDEX IF NOT EXISTS idx_cmhc_centres_norm ON cmhc_centres(is_quebec, search_norm);
CREATE INDEX IF NOT EXISTS idx_cmhc_rents_year ON cmhc_rents(year, geo_member_id);
