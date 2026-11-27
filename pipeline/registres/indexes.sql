CREATE UNIQUE INDEX IF NOT EXISTS idx_entites_jur_ident
  ON entites(juridiction, identifiant_principal);

CREATE INDEX IF NOT EXISTS idx_entites_ident
  ON entites(identifiant_principal);

CREATE INDEX IF NOT EXISTS idx_entites_bn_ne
  ON entites(bn_ne) WHERE bn_ne IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entites_lei
  ON entites(lei) WHERE lei IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opc_neq
  ON opc_permis(neq);

CREATE INDEX IF NOT EXISTS idx_rena_neq
  ON rena_inscriptions(neq) WHERE neq IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gleif_ent_neq
  ON gleif_entites(matched_neq) WHERE matched_neq IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gleif_ent_corp
  ON gleif_entites(matched_corp_no) WHERE matched_corp_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gleif_liens_child
  ON gleif_liens(child_lei, relationship_status);

CREATE INDEX IF NOT EXISTS idx_gleif_liens_parent
  ON gleif_liens(parent_lei, relationship_status);

CREATE VIRTUAL TABLE IF NOT EXISTS entites_fts USING fts5(
  nom_officiel,
  nom_recherche,
  content='entites',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
