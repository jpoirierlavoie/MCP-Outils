-- Schéma D1 lecture seule — Domaine B : Registres d'entreprises (QC + Canada)

DROP TABLE IF EXISTS entites_fts;
DROP TABLE IF EXISTS rena_inscriptions;
DROP TABLE IF EXISTS opc_permis;
DROP TABLE IF EXISTS rbq_licences;
DROP TABLE IF EXISTS entites;
DROP TABLE IF EXISTS domaine_valeur;
DROP TABLE IF EXISTS meta_sources;

CREATE TABLE meta_sources (
  source_key TEXT PRIMARY KEY,
  source_label TEXT NOT NULL,
  licence TEXT NOT NULL,
  version_date TEXT NOT NULL,
  row_count INTEGER NOT NULL
);

CREATE TABLE domaine_valeur (
  typ_dom_val TEXT NOT NULL,
  cod_dom_val TEXT NOT NULL,
  libelle_fr TEXT NOT NULL,
  PRIMARY KEY (typ_dom_val, cod_dom_val)
);

CREATE TABLE entites (
  id INTEGER PRIMARY KEY,
  juridiction TEXT NOT NULL CHECK (juridiction IN ('qc', 'ca')),
  identifiant_principal TEXT NOT NULL,
  bn_ne TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  nom_officiel TEXT NOT NULL,
  nom_recherche TEXT NOT NULL DEFAULT '',
  autres_noms_appercu TEXT,
  forme_code TEXT,
  statut_code TEXT NOT NULL,
  date_constitution TEXT,
  ville TEXT,
  flags INTEGER NOT NULL DEFAULT 0,
  fiche_json TEXT NOT NULL
);

CREATE TABLE rbq_licences (
  neq TEXT NOT NULL,
  numero_licence TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (neq, numero_licence)
);

CREATE TABLE opc_permis (
  id INTEGER PRIMARY KEY,
  neq TEXT NOT NULL,
  numero_permis TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE rena_inscriptions (
  id INTEGER PRIMARY KEY,
  neq TEXT,
  nom_entreprise TEXT NOT NULL,
  nom_norm TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
