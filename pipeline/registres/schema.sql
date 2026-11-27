DROP TABLE IF EXISTS gleif_exceptions;
DROP TABLE IF EXISTS gleif_liens;
DROP TABLE IF EXISTS gleif_entites;
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
  juridiction TEXT NOT NULL CHECK (juridiction IN ('qc', 'ca', 'lei')),
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
  fiche_json TEXT NOT NULL,
  lei TEXT
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

CREATE TABLE gleif_entites (
  lei TEXT PRIMARY KEY,
  is_canadian INTEGER NOT NULL DEFAULT 1,
  legal_name TEXT NOT NULL,
  legal_jurisdiction TEXT,
  entity_category TEXT,
  entity_status TEXT,
  legal_form_code TEXT,
  registration_status TEXT,
  initial_registration_date TEXT,
  next_renewal_date TEXT,
  last_update_date TEXT,
  managing_lou TEXT,
  validation_sources TEXT,
  ra_id TEXT,
  ra_entity_id TEXT,
  matched_neq TEXT,
  matched_corp_no TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  postal_code TEXT,
  fiche_json TEXT
);

CREATE TABLE gleif_liens (
  id INTEGER PRIMARY KEY,
  child_lei TEXT NOT NULL,
  parent_lei TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  relationship_status TEXT NOT NULL,
  accounting_standard TEXT,
  quantifier_amount REAL,
  quantifier_units TEXT,
  period_start TEXT,
  period_end TEXT,
  validation_sources TEXT
);

CREATE TABLE gleif_exceptions (
  lei TEXT NOT NULL,
  category TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  references_json TEXT,
  PRIMARY KEY (lei, category)
) WITHOUT ROWID;
