-- Index secondaires et table virtuelle FTS5 — Domaine B : Registres d'entreprises

CREATE UNIQUE INDEX IF NOT EXISTS idx_entites_jur_ident
  ON entites(juridiction, identifiant_principal);

CREATE INDEX IF NOT EXISTS idx_entites_ident
  ON entites(identifiant_principal);

CREATE INDEX IF NOT EXISTS idx_entites_bn_ne
  ON entites(bn_ne) WHERE bn_ne IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opc_neq
  ON opc_permis(neq);

CREATE INDEX IF NOT EXISTS idx_rena_neq
  ON rena_inscriptions(neq) WHERE neq IS NOT NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS entites_fts USING fts5(
  nom_officiel,
  nom_recherche,
  content='entites',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
