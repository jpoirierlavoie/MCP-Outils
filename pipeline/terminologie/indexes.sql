-- Index secondaires et tables virtuelles FTS5 pour DB_TERMINOLOGIE.

CREATE INDEX IF NOT EXISTS idx_fiches_rang_fr ON fiches_terminologiques(terme_fr_norm, rang_source);
CREATE INDEX IF NOT EXISTS idx_fiches_rang_en ON fiches_terminologiques(terme_en_norm, rang_source);
CREATE INDEX IF NOT EXISTS idx_fiches_domaine ON fiches_terminologiques(domaine, rang_source);
CREATE INDEX IF NOT EXISTS idx_articles_law_sort ON articles_bilingues(law_id, sort_key);
CREATE INDEX IF NOT EXISTS idx_regles_lang ON regles_contamination(lang);

CREATE VIRTUAL TABLE fiches_fts USING fts5(
  terme_fr,
  terme_en,
  termes_recherche,
  domaine,
  content='fiches_terminologiques',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE articles_fr_fts USING fts5(
  text_fr,
  content='articles_bilingues',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE articles_en_fts USING fts5(
  text_en,
  content='articles_bilingues',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
