-- Index secondaires et tables virtuelles FTS5 (uniquement sur les ~80 000 odonymes, jamais sur les 5M d'adresses)

CREATE INDEX IF NOT EXISTS idx_mun_nom_norm
  ON municipalites(nom_normalise);

CREATE UNIQUE INDEX IF NOT EXISTS idx_odo_mun_seq
  ON odonymes(code_municipalite, seqodo);

CREATE INDEX IF NOT EXISTS idx_odo_mun_spec
  ON odonymes(code_municipalite, specifique_norm);

CREATE INDEX IF NOT EXISTS idx_odo_spec_norm
  ON odonymes(specifique_norm);

CREATE INDEX IF NOT EXISTS idx_odo_consonnes
  ON odonymes(cle_consonnes);

CREATE INDEX IF NOT EXISTS idx_civ_odo_num
  ON adresses_civiques(odo_id, numero_municipal, suffixe, numero_unite);

CREATE INDEX IF NOT EXISTS idx_civ_cp_num
  ON adresses_civiques(code_postal, numero_municipal)
  WHERE code_postal IS NOT NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS odonymes_fts USING fts5(
  specifique,
  odonyme_normal,
  renvois_recherche,
  content='odonymes',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS odonymes_trigram USING fts5(
  specifique_norm,
  content='odonymes',
  content_rowid='id',
  tokenize='trigram'
);
