type CategorieForum = "administratif" | "federal";

export interface Forum {
  readonly name: string;
  readonly abbr: string;
  readonly category: CategorieForum;
}

export const LIBELLE_CATEGORIE: Readonly<Record<CategorieForum, string>> = {
  administratif: "Tribunaux administratifs du Québec",
  federal: "Cours et tribunaux fédéraux",
};

export const FORUMS: Readonly<Record<string, Forum>> = {
  taq: { name: "Tribunal administratif du Québec", abbr: "TAQ", category: "administratif" },
  tat: { name: "Tribunal administratif du travail", abbr: "TAT", category: "administratif" },
  tal: { name: "Tribunal administratif du logement", abbr: "TAL", category: "administratif" },
  tamf: {
    name: "Tribunal administratif des marchés financiers",
    abbr: "TAMF",
    category: "administratif",
  },
  tadp: {
    name: "Tribunal administratif de déontologie policière",
    abbr: "TADP",
    category: "administratif",
  },
  cai: { name: "Commission d'accès à l'information", abbr: "CAI", category: "administratif" },
  cfp: { name: "Commission de la fonction publique", abbr: "CFP", category: "administratif" },
  cptaq: {
    name: "Commission de protection du territoire agricole du Québec",
    abbr: "CPTAQ",
    category: "administratif",
  },
  ctq: { name: "Commission des transports du Québec", abbr: "CTQ", category: "administratif" },
  cmq: { name: "Commission municipale du Québec", abbr: "CMQ", category: "administratif" },
  cqlc: {
    name: "Commission québécoise des libérations conditionnelles",
    abbr: "CQLC",
    category: "administratif",
  },
  bpcd: {
    name: "Bureau des présidents des conseils de discipline",
    abbr: "BPCD",
    category: "administratif",
  },
  re: { name: "Régie de l'énergie", abbr: "RE", category: "administratif" },
  racj: {
    name: "Régie des alcools, des courses et des jeux",
    abbr: "RACJ",
    category: "administratif",
  },
  rmaaq: {
    name: "Régie des marchés agricoles et alimentaires du Québec",
    abbr: "RMAAQ",
    category: "administratif",
  },
  rbq: { name: "Régie du bâtiment du Québec", abbr: "RBQ", category: "administratif" },
  cour_federale: { name: "Cour fédérale", abbr: "C.F.", category: "federal" },
  cour_appel_federale: { name: "Cour d'appel fédérale", abbr: "C.A.F.", category: "federal" },
  cour_canadienne_impot: {
    name: "Cour canadienne de l'impôt",
    abbr: "C.C.I.",
    category: "federal",
  },
  cour_supreme_canada: { name: "Cour suprême du Canada", abbr: "C.S.C.", category: "federal" },
};

export const INDEX_PREFIXE_FORUM: Readonly<Record<string, string>> = (() => {
  const index: Record<string, string> = {};
  for (const [clef, forum] of Object.entries(FORUMS)) {
    index[forum.abbr.toUpperCase().replaceAll(".", "")] = clef;
    index[clef.toUpperCase()] = clef;
  }
  return index;
})();
