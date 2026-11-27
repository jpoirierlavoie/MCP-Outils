DROP TABLE IF EXISTS meta_sources;
DROP TABLE IF EXISTS regles_contamination;
DROP TABLE IF EXISTS fiches_fts;
DROP TABLE IF EXISTS fiches_terminologiques;
DROP TABLE IF EXISTS articles_fr_fts;
DROP TABLE IF EXISTS articles_en_fts;
DROP TABLE IF EXISTS articles_bilingues;
DROP TABLE IF EXISTS lois_bilingues;

CREATE TABLE meta_sources (
  source_key   TEXT PRIMARY KEY,
  source_label TEXT NOT NULL,
  rang_source  INTEGER NOT NULL,
  licence      TEXT NOT NULL,
  version_date TEXT NOT NULL,
  row_count    INTEGER NOT NULL
);

CREATE TABLE fiches_terminologiques (
  id                      INTEGER PRIMARY KEY,
  slug                    TEXT,
  rang_source             INTEGER NOT NULL,
  source_nom              TEXT NOT NULL,
  licence_source          TEXT NOT NULL,
  terme_fr                TEXT NOT NULL,
  terme_en                TEXT NOT NULL,
  terme_fr_norm           TEXT NOT NULL,
  terme_en_norm           TEXT NOT NULL,
  synonymes_fr_json       TEXT NOT NULL DEFAULT '[]',
  synonymes_en_json       TEXT NOT NULL DEFAULT '[]',
  termes_deconseilles_json TEXT NOT NULL DEFAULT '[]',
  termes_recherche        TEXT NOT NULL,
  systeme_juridique       TEXT NOT NULL,
  domaine                 TEXT NOT NULL,
  note_ou_definition      TEXT NOT NULL DEFAULT '',
  base_legale             TEXT,
  url_fiche               TEXT,
  date_verification       TEXT NOT NULL
);

CREATE TABLE lois_bilingues (
  law_id           TEXT PRIMARY KEY,
  jurisdiction     TEXT NOT NULL,
  name_fr          TEXT NOT NULL,
  name_en          TEXT NOT NULL,
  official_cite    TEXT NOT NULL,
  official_cite_en TEXT,
  consol_date_fr   TEXT,
  consol_date_en   TEXT
);

CREATE TABLE articles_bilingues (
  id             INTEGER PRIMARY KEY,
  law_id         TEXT NOT NULL REFERENCES lois_bilingues(law_id),
  article_number TEXT NOT NULL,
  sort_key       INTEGER NOT NULL,
  text_fr        TEXT NOT NULL,
  text_en        TEXT NOT NULL
);

CREATE TABLE regles_contamination (
  id                    INTEGER PRIMARY KEY,
  code_regle            TEXT NOT NULL UNIQUE,
  lang                  TEXT NOT NULL,
  pattern_term          TEXT NOT NULL,
  pattern_norm          TEXT NOT NULL,
  case_sensitive        INTEGER NOT NULL DEFAULT 0,
  risk_category         TEXT NOT NULL,
  allowed_in_bijural_if TEXT,
  reason_fr             TEXT NOT NULL,
  suggested_replacement TEXT NOT NULL,
  legal_basis           TEXT NOT NULL
);
