-- Schéma D1 normalisé en lecture seule — Domaine C : Référentiel québécois des adresses (RQA)
-- Conçu en 3 tables compactes afin de maintenir ~5M d'adresses sous ~1,5 à 2,2 Go (aucun FTS5 sur adresses_civiques).

DROP TABLE IF EXISTS odonymes_trigram;
DROP TABLE IF EXISTS odonymes_fts;
DROP TABLE IF EXISTS lots_cadastraux_index;
DROP TABLE IF EXISTS adresses_civiques;
DROP TABLE IF EXISTS odonymes;
DROP TABLE IF EXISTS municipalites;
DROP TABLE IF EXISTS meta_sources;

CREATE TABLE meta_sources (
  source_key TEXT PRIMARY KEY,
  source_label TEXT NOT NULL,
  licence TEXT NOT NULL,
  version_date TEXT NOT NULL,
  row_count INTEGER NOT NULL
);

CREATE TABLE municipalites (
  code_municipalite TEXT PRIMARY KEY,
  nom_municipalite TEXT NOT NULL,
  nom_normalise TEXT NOT NULL,
  aliases_recherche TEXT NOT NULL DEFAULT '',
  mrc TEXT,
  region_administrative TEXT
);

CREATE TABLE odonymes (
  id INTEGER PRIMARY KEY,
  code_municipalite TEXT NOT NULL,
  seqodo TEXT NOT NULL,
  generique TEXT,
  particule TEXT,
  specifique TEXT NOT NULL,
  cardinal TEXT,
  odonyme_normal TEXT NOT NULL,
  odonyme_long TEXT NOT NULL,
  specifique_norm TEXT NOT NULL,
  cle_consonnes TEXT NOT NULL,
  renvois_recherche TEXT NOT NULL DEFAULT ''
);

CREATE TABLE adresses_civiques (
  id INTEGER PRIMARY KEY,
  odo_id INTEGER NOT NULL,
  numero_municipal INTEGER NOT NULL,
  suffixe TEXT NOT NULL DEFAULT '',
  numero_unite TEXT NOT NULL DEFAULT '',
  type_unite TEXT,
  code_postal TEXT,
  etat TEXT NOT NULL,
  categorie TEXT,
  numero_lot TEXT,
  matricule TEXT,
  latitude REAL,
  longitude REAL
);

CREATE TABLE lots_cadastraux_index (
  lot_num INTEGER NOT NULL,
  civ_id INTEGER NOT NULL,
  PRIMARY KEY (lot_num, civ_id)
) WITHOUT ROWID;
