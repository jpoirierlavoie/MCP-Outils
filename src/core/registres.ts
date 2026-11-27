import { z } from "zod";
import { type Garde, GardeSchema, makeGarde, ProvenanceSchema } from "./gardes.js";
import {
  expandLigatureFtsTokenVariants,
  foldAsciiAlnum,
  foldLatinDiacritics,
} from "./normalize.js";

const FLAG_RBQ = 1;
const FLAG_OPC = 2;
const FLAG_RENA = 4;
const FLAG_FAILLITE = 8;

const LEGAL_SUFFIX_TOKENS = new Set([
  "inc",
  "incorporee",
  "incorporated",
  "ltee",
  "limitee",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "cie",
  "compagnie",
  "co",
  "senc",
  "sencrl",
  "sec",
  "sep",
  "lp",
  "llp",
  "ulc",
  "srl",
  "enr",
  "enrg",
]);

const KNOWN_STATUTORY_CROWN_CORPS = new Set([
  "hydro quebec",
  "loto quebec",
  "societe des alcools du quebec",
  "saq",
  "societe de l assurance automobile du quebec",
  "saaq",
  "caisse de depot et placement du quebec",
  "cdpq",
  "investissement quebec",
  "commission des normes de l equite de la sante et de la securite du travail",
  "cnesst",
  "regie de l assurance maladie du quebec",
  "ramq",
  "societe quebecoise des infrastructures",
  "sqi",
  "societe des traversiers du quebec",
  "agence du revenu du quebec",
  "revenu quebec",
  "office de la protection du consommateur",
  "autorite des marches financiers",
  "amf",
  "poste canada",
  "postes canada",
  "canada post",
  "radio canada",
  "cbc",
  "via rail",
  "via rail canada",
  "banque du canada",
  "bank of canada",
]);

function isCorporateForm(forme: string | null | undefined): boolean {
  return /soci[ée]t[ée]\s+par\s+actions|corporation|personne\s+morale|constitu[ée]e?\s+(?:en\s+vertu\s+d['’]une\s+)?loi|compagnie|company/i.test(
    forme ?? "",
  );
}

const DOTTED_ACRONYM_RE =
  /(?<![\p{L}\p{N}])(?:\p{L}\.){2,}\p{L}?(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:\p{L}\.)+\p{L}(?![\p{L}\p{N}])/gu;

function normalizeEntitySearch(raw: string): string {
  const collapsedAcronyms = raw.replace(DOTTED_ACRONYM_RE, (m) => m.replace(/\./g, ""));
  return foldAsciiAlnum(collapsedAcronyms);
}

function buildRegistreFtsQuery(rawQuery: string): string | null {
  const collapsed = rawQuery.replace(DOTTED_ACRONYM_RE, (m) => m.replace(/\./g, ""));
  const folded = foldLatinDiacritics(collapsed);

  const groups: string[] = [];
  let working = folded;

  working = working.replace(/\b(\d{4})[-\s]+(\d{4})\b/g, (_m, a: string, b: string) => {
    groups.push(`("${a}${b}" OR ("${a}" AND "${b}"))`);
    return " ";
  });
  working = working.replace(/\b(\d{8})\b/g, (_m, eight: string) => {
    const a = eight.slice(0, 4);
    const b = eight.slice(4, 8);
    groups.push(`("${eight}" OR ("${a}" AND "${b}"))`);
    return " ";
  });

  const rawTokens = (working.match(/[a-z0-9]+/g) ?? []).slice(0, 14);
  const coreTokens = rawTokens.filter((t) => !LEGAL_SUFFIX_TOKENS.has(t));
  const chosenTokens = coreTokens.length > 0 || groups.length > 0 ? coreTokens : rawTokens;

  for (const tok of chosenTokens) {
    if (/^\d+$/.test(tok)) {
      groups.push(`"${tok}"`);
    } else if (tok.length >= 4) {
      const clauses = expandLigatureFtsTokenVariants(tok).map((v) => `"${v}"*`);
      groups.push(clauses.length === 1 ? clauses[0]! : `(${clauses.join(" OR ")})`);
    } else if (tok.length >= 2) {
      const clauses = expandLigatureFtsTokenVariants(tok).map((v) => `"${v}"`);
      groups.push(clauses.length === 1 ? clauses[0]! : `(${clauses.join(" OR ")})`);
    }
  }

  if (groups.length === 0 && chosenTokens.length > 0) {
    for (const tok of chosenTokens) {
      groups.push(`"${tok}"`);
    }
  }

  return groups.length > 0 ? groups.join(" AND ") : null;
}

export const RegistreSearchEntitiesInputSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .describe(
      "Nom d'entreprise, autre nom utilisé, numéro de société à numéro (p. ex. '9123-4567 Québec inc.'), NEQ (10 chiffres), numéro fédéral ou LEI (20 caractères).",
    ),
  jurisdiction: z
    .enum(["qc", "ca", "gleif", "all"])
    .optional()
    .describe(
      "Périmètre juridictionnel : 'qc' (Registraire des entreprises du Québec + RBQ/OPC/RENA), 'ca' (Corporations Canada), 'gleif' (entités titulaires d'un LEI canadien GLEIF) ou 'all' (défaut : REQ, Corporations Canada et LEI canadiens autonomes).",
    ),
  active_only: z
    .boolean()
    .optional()
    .describe(
      "Si true, restreint les résultats aux entités actives / immatriculées (défaut : false, inclut aussi les entités radiées ou dissoutes utiles en litige).",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Nombre maximal de candidats retournés (1 à 25, défaut 10)."),
});
type RegistreSearchEntitiesInput = z.infer<typeof RegistreSearchEntitiesInputSchema>;

const CandidatRegistreSchema = z.object({
  jurisdiction: z.enum(["qc", "ca", "gleif"]),
  neq: z.string().nullable(),
  corporation_number: z.string().nullable(),
  bn_ne: z.string().nullable(),
  has_lei: z.boolean(),
  lei: z.string().nullable(),
  nom_officiel: z.string(),
  autres_noms: z.array(z.string()),
  forme_juridique: z.string().nullable(),
  statut: z.string(),
  is_active: z.boolean(),
  faillite_declaree: z.boolean(),
  date_constitution: z.string().nullable(),
  ville: z.string().nullable(),
  has_rbq_licence: z.boolean(),
  has_opc_permit: z.boolean(),
  in_rena: z.boolean(),
});

export const RegistreSearchEntitiesOutputSchema = z.object({
  query: z.string(),
  jurisdiction: z.enum(["qc", "ca", "gleif", "all"]),
  active_only: z.boolean(),
  count: z.number().int(),
  exact_match_found: z.boolean(),
  snapshots: z.record(z.string(), z.string()),
  entities: z.array(CandidatRegistreSchema),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
type RegistreSearchEntitiesOutput = z.infer<typeof RegistreSearchEntitiesOutputSchema>;

export const RegistreGetEntityInputSchema = z.strictObject({
  neq: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Numéro d'entreprise du Québec (NEQ à 10 chiffres, p. ex. '1140030355'). Fournir exactement l'un des quatre identifiants : neq, corporation_number, bn_ne ou lei.",
    ),
  corporation_number: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Numéro de société fédérale de Corporations Canada (p. ex. '8284083'). Fournir exactement l'un des quatre identifiants : neq, corporation_number, bn_ne ou lei.",
    ),
  bn_ne: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Numéro d'entreprise fédéral à 9 chiffres (NE / BN, p. ex. '801423500'). Fournir exactement l'un des quatre identifiants : neq, corporation_number, bn_ne ou lei.",
    ),
  lei: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .optional()
    .describe(
      "Identifiant d'entité juridique GLEIF (LEI ISO 17442 à 20 caractères alphanumériques, p. ex. '5493001KJTIIGC8Y1R12'). Fournir exactement l'un des quatre identifiants : neq, corporation_number, bn_ne ou lei.",
    ),
});
type RegistreGetEntityInput = z.infer<typeof RegistreGetEntityInputSchema>;

const RbqLicenceSchema = z.object({
  numero_licence: z.string(),
  statut: z.string(),
  type_licence: z.string(),
  categorie: z.string(),
  sous_categories: z.array(z.string()),
  restriction: z.boolean(),
  date_delivrance: z.string().nullable(),
  date_paiement_annuel: z.string().nullable(),
  cautionnement_montant: z.string().nullable(),
});

const OpcPermisSchema = z.object({
  numero_permis: z.string(),
  categorie_permis: z.string(),
  nom_commercant: z.string(),
  adresse_etablissement: z.string().nullable(),
  ville_etablissement: z.string().nullable(),
  code_postal: z.string().nullable(),
  autres_noms: z.string().nullable(),
});

const RenaInscriptionSchema = z.object({
  nom_entreprise: z.string(),
  categorie: z.string().nullable(),
  adresse: z.string().nullable(),
  date_debut: z.string().nullable(),
  date_fin: z.string().nullable(),
  infraction: z.string().nullable(),
  decision_amp: z.string().nullable(),
});

const ProfilQuebecSchema = z.object({
  neq: z.string(),
  nom_officiel: z.string(),
  is_active: z.boolean(),
  statut_immatriculation: z.object({
    code: z.string(),
    libelle: z.string(),
    date_statut: z.string().nullable(),
  }),
  forme_juridique: z.object({
    code: z.string().nullable(),
    libelle: z.string().nullable(),
  }),
  regime_juridique: z.object({
    code: z.string().nullable(),
    libelle: z.string().nullable(),
  }),
  regime_constitutif: z.object({
    code: z.string().nullable(),
    libelle: z.string().nullable(),
    lieu_constitution: z.string().nullable(),
  }),
  dates: z.object({
    date_immatriculation: z.string().nullable(),
    date_constitution: z.string().nullable(),
    date_cessation_prevue: z.string().nullable(),
    annee_declaration_courante: z.string().nullable(),
  }),
  indicateurs: z.object({
    faillite_declaree: z.boolean(),
    convention_unanime_actionnaires: z.boolean(),
    tranche_employes_quebec: z.string().nullable(),
  }),
  domicile_declare: z.object({
    dispense_adresse: z.boolean(),
    adresse: z.string().nullable(),
    ville: z.string().nullable(),
    code_postal: z.string().nullable(),
  }),
  activites_economiques: z.array(
    z.object({
      code_cae: z.string(),
      description: z.string(),
    }),
  ),
  autres_noms: z.array(
    z.object({
      nom: z.string(),
      nom_langue_etrangere: z.string().nullable(),
      statut: z.string(),
      type_nom: z.string(),
      date_debut: z.string().nullable(),
      date_fin: z.string().nullable(),
    }),
  ),
  etablissements: z.array(
    z.object({
      numero_suffixe: z.string(),
      nom: z.string().nullable(),
      principal: z.boolean(),
      adresse: z.string().nullable(),
      code_postal: z.string().nullable(),
      activite: z.string().nullable(),
    }),
  ),
  fusions_scissions: z.array(
    z.object({
      relation: z.string(),
      neq_relie: z.string().nullable(),
      denomination: z.string(),
      date_prise_effet: z.string().nullable(),
      adresse: z.string().nullable(),
    }),
  ),
  continuations_transformations: z.array(
    z.object({
      type_changement: z.string(),
      regime_juridique: z.string().nullable(),
      localite: z.string().nullable(),
      date_prise_effet: z.string().nullable(),
    }),
  ),
  rbq_licences: z.array(RbqLicenceSchema),
  opc_permis: z.array(OpcPermisSchema),
  rena_inscriptions: z.array(RenaInscriptionSchema),
});

const ProfilFederalSchema = z.object({
  corporation_number: z.string(),
  bn_ne: z.string().nullable(),
  nom_officiel: z.string(),
  autres_denominations: z.array(z.string()),
  is_active: z.boolean(),
  regime_legislatif: z.string(),
  statut: z.string(),
  detail_statut: z.string().nullable(),
  dates: z.object({
    date_constitution_ou_anniversaire: z.string().nullable(),
    annee_dernier_depot_annuel: z.string().nullable(),
    date_derniere_assemblee: z.string().nullable(),
  }),
  adresse_siege: z.object({
    rue: z.string().nullable(),
    ville: z.string().nullable(),
    province: z.string().nullable(),
    pays: z.string().nullable(),
    code_postal: z.string().nullable(),
  }),
  administrateurs: z.object({
    min: z.number().int().nullable(),
    max: z.number().int().nullable(),
  }),
});

const GleifParentSchema = z.object({
  lei: z.string(),
  nom_legal: z.string().nullable(),
  pays: z.string().nullable(),
  legal_jurisdiction: z.string().nullable(),
  statut_entite: z.string().nullable(),
  relationship_status: z.string(),
  accounting_standard: z.string().nullable(),
  quantifier_amount: z.number().nullable(),
  quantifier_units: z.string().nullable(),
  validation_sources: z.string().nullable(),
  in_canadian_snapshot: z.boolean(),
  matched_neq: z.string().nullable(),
  matched_corporation_number: z.string().nullable(),
});

const GleifExceptionSchema = z.object({
  categorie: z.string(),
  raisons: z.array(z.string()),
  libelle_fr: z.string(),
});

const GleifFilialeSchema = z.object({
  lei: z.string(),
  nom_legal: z.string(),
  type_lien: z.enum(["direct", "ultime", "direct_et_ultime"]),
  legal_jurisdiction: z.string().nullable(),
  statut_entite: z.string().nullable(),
  matched_neq: z.string().nullable(),
  matched_corporation_number: z.string().nullable(),
});

const ProfilGleifSchema = z.object({
  lei: z.string(),
  is_canadian: z.boolean(),
  nom_legal: z.string(),
  autres_noms: z.array(z.string()),
  statut_entite: z.string(),
  registration_status: z.string(),
  next_renewal_date: z.string().nullable(),
  initial_registration_date: z.string().nullable(),
  last_update_date: z.string().nullable(),
  legal_jurisdiction: z.string().nullable(),
  entity_category: z.string().nullable(),
  registration_authority_id: z.string().nullable(),
  registration_authority_entity_id: z.string().nullable(),
  matched_neq: z.string().nullable(),
  matched_corporation_number: z.string().nullable(),
  adresse_legale: z
    .object({
      ville: z.string().nullable(),
      region: z.string().nullable(),
      pays: z.string().nullable(),
      code_postal: z.string().nullable(),
    })
    .nullable(),
  parent_direct: GleifParentSchema.nullable(),
  parent_ultime: GleifParentSchema.nullable(),
  exceptions_declaration: z.array(GleifExceptionSchema),
  filiales_canadiennes: z.array(GleifFilialeSchema),
  filiales_canadiennes_total: z.number().int(),
});

const PortailOfficielLienSchema = z.object({
  url: z.string(),
  portal_info_url: z.string().optional(),
  search_url: z.string().optional(),
  libelle_fr: z.string(),
  objet_fr: z.string(),
});

const PortailsOfficielsSchema = z.object({
  req: PortailOfficielLienSchema.nullable(),
  corporations_canada: PortailOfficielLienSchema.nullable(),
  isc_pisc: PortailOfficielLienSchema.nullable(),
  gleif: PortailOfficielLienSchema.nullable(),
});

export const RegistreGetEntityOutputSchema = z.object({
  lookup_by: z.enum(["neq", "corporation_number", "bn_ne", "lei"]),
  lookup_value: z.string(),
  snapshots: z.record(z.string(), z.string()),
  quebec: ProfilQuebecSchema.nullable(),
  federal: ProfilFederalSchema.nullable(),
  gleif: ProfilGleifSchema.nullable(),
  portails_officiels: PortailsOfficielsSchema,
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
type RegistreGetEntityOutput = z.infer<typeof RegistreGetEntityOutputSchema>;

interface RawEntiteRow {
  id: number;
  juridiction: "qc" | "ca" | "lei";
  identifiant_principal: string;
  bn_ne: string | null;
  is_active: number;
  nom_officiel: string;
  nom_recherche: string;
  autres_noms_appercu: string | null;
  forme_code: string | null;
  statut_code: string;
  date_constitution: string | null;
  ville: string | null;
  flags: number;
  fiche_json: string;
  lei: string | null;
}

interface RawGleifEntiteRow {
  lei: string;
  is_canadian: number;
  legal_name: string;
  legal_jurisdiction: string | null;
  entity_category: string | null;
  entity_status: string | null;
  legal_form_code: string | null;
  registration_status: string | null;
  initial_registration_date: string | null;
  next_renewal_date: string | null;
  last_update_date: string | null;
  managing_lou: string | null;
  validation_sources: string | null;
  ra_id: string | null;
  ra_entity_id: string | null;
  matched_neq: string | null;
  matched_corp_no: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  postal_code: string | null;
  fiche_json: string | null;
}

interface RawGleifLienRow {
  id: number;
  child_lei: string;
  parent_lei: string;
  relationship_type: string;
  relationship_status: string;
  accounting_standard: string | null;
  quantifier_amount: number | null;
  quantifier_units: string | null;
  validation_sources: string | null;
}

interface RawGleifExceptionRow {
  lei: string;
  category: string;
  reasons_json: string;
}

interface RegistreDbCapabilities {
  hasEntitesLeiCol: boolean;
  hasGleifEntites: boolean;
  hasGleifLiens: boolean;
  hasGleifExceptions: boolean;
}

async function loadRegistreDbCapabilities(db: D1Database): Promise<RegistreDbCapabilities> {
  const res = await db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('entites', 'gleif_entites', 'gleif_liens', 'gleif_exceptions')",
    )
    .all<{ name: string; sql: string | null }>();
  const byName = new Map<string, string | null>();
  for (const r of res.results) {
    byName.set(r.name, r.sql);
  }
  const entSql = byName.get("entites") ?? "";
  return {
    hasEntitesLeiCol: /\blei\b/i.test(entSql),
    hasGleifEntites: byName.has("gleif_entites"),
    hasGleifLiens: byName.has("gleif_liens"),
    hasGleifExceptions: byName.has("gleif_exceptions"),
  };
}

interface QcFicheCompact {
  im?: string;
  ds?: string;
  dc?: string;
  rj?: string;
  rc?: string;
  lc?: string;
  ap?: string;
  cu?: number;
  tr?: string;
  da?: number;
  ad?: string;
  cp?: string;
  ac?: Array<[string, string]>;
  nm?: Array<[string, string | null, string, string, string | null, string | null]>;
  et?: Array<[string, string | null, number, string | null, string | null, string | null]>;
  fs?: Array<[string, string | null, string, string | null, string | null]>;
  ct?: Array<[string, string | null, string | null, string | null]>;
}

interface CaFicheCompact {
  n2?: string[];
  rl?: string;
  ds?: string;
  an?: string;
  ag?: string;
  ad?: string;
  pr?: string;
  py?: string;
  cp?: string;
  dmin?: number;
  dmax?: number;
}

async function loadMetaSnapshots(db: D1Database): Promise<Record<string, string>> {
  const res = await db
    .prepare("SELECT source_key, version_date FROM meta_sources")
    .all<{ source_key: string; version_date: string }>();
  const out: Record<string, string> = {};
  for (const r of res.results) {
    out[r.source_key] = r.version_date;
  }
  return out;
}

async function loadDomaineValeurForPairs(
  db: D1Database,
  pairs: ReadonlyArray<readonly [string, string | null | undefined]>,
): Promise<Map<string, string>> {
  const unique: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const [typ, code] of pairs) {
    if (!code) continue;
    const key = `${typ}\0${code}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push([typ, code]);
    }
  }
  const map = new Map<string, string>();
  if (unique.length === 0) {
    return map;
  }

  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const whereClause = chunk.map(() => "(typ_dom_val = ? AND cod_dom_val = ?)").join(" OR ");
    const params: string[] = [];
    for (const [typ, code] of chunk) {
      params.push(typ, code);
    }
    const res = await db
      .prepare(
        `SELECT typ_dom_val, cod_dom_val, libelle_fr FROM domaine_valeur WHERE ${whereClause}`,
      )
      .bind(...params)
      .all<{ typ_dom_val: string; cod_dom_val: string; libelle_fr: string }>();
    for (const r of res.results) {
      map.set(`${r.typ_dom_val}:${r.cod_dom_val}`, r.libelle_fr);
    }
  }
  return map;
}

function decodeDv(
  dv: Map<string, string>,
  typ: string,
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return dv.get(`${typ}:${code}`) ?? code;
}

const QC_UNIT_OR_FLOOR_FOLDED_RE =
  /\b(?:etage|etages|bureau|bureaux|bur|suite|ste|appartement|app|apt|local|loc|unite|case postale|succursale|succ)\b|(?:^|\s)c\s*p(?:\s|$)|^\s*\d+\s*$/;

function isUnitOrFloorLine(raw: string): boolean {
  if (/^\s*#\s*\d+/.test(raw)) return true;
  const folded = foldAsciiAlnum(raw);
  return !folded || QC_UNIT_OR_FLOOR_FOLDED_RE.test(folded);
}

function resolveQcVille(rawVille: string | null | undefined, fiche: QcFicheCompact): string | null {
  if (fiche.da === 1) {
    return null;
  }
  const trimmedVille = rawVille?.trim() ?? "";
  if (trimmedVille && !isUnitOrFloorLine(trimmedVille)) {
    return trimmedVille;
  }
  if (fiche.ad) {
    const segments = fiche.ad
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (let i = segments.length - 1; i >= 1; i--) {
      const cleaned = segments[i]!.replace(/\b[A-Za-z]\d[A-Za-z]\s*-?\s*\d[A-Za-z]\d\b/g, " ")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .replace(/\s+(?:qc|canada)\s*$/iu, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned.length >= 2 && !/^\d+\b/.test(cleaned) && !isUnitOrFloorLine(cleaned)) {
        return cleaned;
      }
    }
  }
  return trimmedVille && !isUnitOrFloorLine(trimmedVille) ? trimmedVille : null;
}

function parseJsonSafe<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const GLEIF_EXCEPTION_LABELS_FR: Record<string, string> = {
  NO_LEI: "Société mère sans identifiant LEI attribué",
  NATURAL_PERSONS:
    "Contrôle exercé par une ou plusieurs personnes physiques (exclues du périmètre LEI)",
  NON_CONSOLIDATING: "Entité non consolidée selon les normes comptables applicables",
  NO_KNOWN_PERSON: "Aucune personne physique ou morale consolidante connue",
  NON_PUBLIC: "Information non publique ou empêchement de divulgation",
  CONSENT_NOT_OBTAINED: "Consentement de la société mère non obtenu",
  DISCLOSURE_DETRIMENTAL: "Divulgation considérée préjudiciable",
  BINDING_LEGAL_COMMITMENTS: "Engagements juridiques contraignants empêchant la divulgation",
  LEGAL_OBSTACLES: "Obstacles juridiques empêchant la divulgation",
};

const GLEIF_CATEGORY_LABELS_FR: Record<string, string> = {
  DIRECT_ACCOUNTING_CONSOLIDATION_PARENT: "Société mère consolidante directe",
  ULTIMATE_ACCOUNTING_CONSOLIDATION_PARENT: "Société mère consolidante ultime",
};

function formatGleifExceptionFr(category: string, reasons: string[]): string {
  const catLabel = GLEIF_CATEGORY_LABELS_FR[category] ?? category;
  const reasonLabels = reasons.map((r) => GLEIF_EXCEPTION_LABELS_FR[r] ?? r);
  return `${catLabel} : ${reasonLabels.join(" ; ") || "aucun motif précisé"}`;
}

function makeRegistreGardes(includeNcSa: boolean, includeGleif: boolean): Garde[] {
  const gardes: Garde[] = [
    makeGarde("REGISTRE_ABSENCE_PERSONNES_PHYSIQUES"),
    makeGarde("REGISTRE_FRAICHEUR_ET_OPPOSABILITE_LPLE"),
    makeGarde("REGISTRE_ABSENCE_NON_PROBANTE_ANCILLAIRES"),
  ];
  if (includeGleif) {
    gardes.push(makeGarde("REGISTRE_GLEIF_DECLARATIF_CONSOLIDATION"));
  }
  if (includeNcSa) {
    gardes.push(makeGarde("LICENCE_DONNEES_OUVERTES_NC_SA"));
  }
  return gardes;
}

function corpNumberCandidates(rawVal: string): string[] {
  const rawTrim = rawVal.trim();
  const stripped = rawTrim.replace(/[\s-]+/g, "");
  const cleanCorp = stripped.replace(/^0+(?=\d)/, "");
  const out = [rawTrim, stripped, cleanCorp];
  if (/^[0-9]+$/.test(cleanCorp) && cleanCorp.length < 7) {
    out.push(cleanCorp.padStart(7, "0"));
  }
  return Array.from(new Set(out.filter((v) => v.length > 0)));
}

function appendJurisdictionFilter(
  jurisdiction: "qc" | "ca" | "gleif" | "all",
  alias: string,
  hasEntitesLeiCol: boolean,
): string {
  const p = alias ? `${alias}.` : "";
  if (jurisdiction === "qc") return ` AND ${p}juridiction = 'qc'`;
  if (jurisdiction === "ca") return ` AND ${p}juridiction = 'ca'`;
  if (jurisdiction === "gleif") {
    return hasEntitesLeiCol
      ? ` AND (${p}juridiction = 'lei' OR ${p}lei IS NOT NULL)`
      : ` AND ${p}juridiction = 'lei'`;
  }
  return "";
}

function buildGleifLikePattern(token: string): string {
  const consonants = token.replace(/[aeiouy]/g, "");
  if (token.length >= 4 && consonants.length >= 2) {
    const pattern = token
      .replace(/oe/g, "_")
      .replace(/ae/g, "_")
      .replace(/[aeiouy]/g, "_");
    return `%${pattern}%`;
  }
  return `%${token}%`;
}

function buildSyntheticGleifRow(g: RawGleifEntiteRow, syntheticId: number): RawEntiteRow {
  const gFiche = parseJsonSafe<{ autres_noms?: string[] }>(g.fiche_json, {});
  const autres = Array.isArray(gFiche.autres_noms) ? gFiche.autres_noms : [];
  return {
    id: syntheticId,
    juridiction: "lei",
    identifiant_principal: g.lei,
    bn_ne: null,
    is_active: g.entity_status === "ACTIVE" ? 1 : 0,
    nom_officiel: g.legal_name,
    nom_recherche: "",
    autres_noms_appercu: autres.length > 0 ? JSON.stringify(autres) : null,
    forme_code: g.entity_category,
    statut_code: g.registration_status ?? g.entity_status ?? "ACTIVE",
    date_constitution: null,
    ville: g.city,
    flags: 0,
    fiche_json: "{}",
    lei: g.lei,
  };
}

export async function registreSearchEntities(
  db: D1Database,
  input: RegistreSearchEntitiesInput,
): Promise<{ structured: RegistreSearchEntitiesOutput; text: string }> {
  const jurisdiction = input.jurisdiction ?? "all";
  const activeOnly = input.active_only ?? false;
  const limit = input.limit ?? 10;

  const [snapshots, caps] = await Promise.all([
    loadMetaSnapshots(db),
    loadRegistreDbCapabilities(db),
  ]);
  const leiColExpr = caps.hasEntitesLeiCol ? "lei" : "NULL AS lei";
  const eLeiColExpr = caps.hasEntitesLeiCol ? "e.lei" : "NULL AS lei";

  const digitsOnly = input.query.replace(/[\s-]/g, "");
  const alnumOnly = input.query.replace(/[\s-]+/g, "").toUpperCase();
  const isLeiQuery = /^[A-Z0-9]{20}$/.test(alnumOnly);
  const byId = new Map<number, { row: RawEntiteRow; score: number }>();

  if (/^\d{5,10}$/.test(digitsOnly)) {
    let idSql = `
      SELECT id, juridiction, identifiant_principal, bn_ne, is_active, nom_officiel,
             nom_recherche, autres_noms_appercu, forme_code, statut_code,
             date_constitution, ville, flags, fiche_json, ${leiColExpr}
        FROM entites
       WHERE (identifiant_principal = ? OR bn_ne = ?)
    `;
    idSql += appendJurisdictionFilter(jurisdiction, "", caps.hasEntitesLeiCol);
    if (activeOnly) {
      idSql += " AND is_active = 1";
    }
    idSql += " LIMIT 10";
    const directRes = await db.prepare(idSql).bind(digitsOnly, digitsOnly).all<RawEntiteRow>();
    for (const r of directRes.results) {
      byId.set(Number(r.id), { row: r, score: -1000 });
    }
  }

  if (isLeiQuery && caps.hasEntitesLeiCol) {
    let leiSql = `
      SELECT id, juridiction, identifiant_principal, bn_ne, is_active, nom_officiel,
             nom_recherche, autres_noms_appercu, forme_code, statut_code,
             date_constitution, ville, flags, fiche_json, lei
        FROM entites
       WHERE (lei = ? OR identifiant_principal = ?)
    `;
    leiSql += appendJurisdictionFilter(jurisdiction, "", caps.hasEntitesLeiCol);
    if (activeOnly) {
      leiSql += " AND is_active = 1";
    }
    leiSql += " LIMIT 10";
    const leiRes = await db.prepare(leiSql).bind(alnumOnly, alnumOnly).all<RawEntiteRow>();
    for (const r of leiRes.results) {
      byId.set(Number(r.id), { row: r, score: -1000 });
    }
  }

  let nextSyntheticId = -1;
  if (isLeiQuery && caps.hasGleifEntites && (jurisdiction === "gleif" || jurisdiction === "all")) {
    const alreadyHasLei = Array.from(byId.values()).some(
      ({ row }) => row.lei === alnumOnly || row.identifiant_principal === alnumOnly,
    );
    if (!alreadyHasLei) {
      const gRow = await db
        .prepare(
          `SELECT lei, is_canadian, legal_name, legal_jurisdiction, entity_category, entity_status,
                  legal_form_code, registration_status, initial_registration_date, next_renewal_date,
                  last_update_date, managing_lou, validation_sources, ra_id, ra_entity_id,
                  matched_neq, matched_corp_no, country, region, city, postal_code, fiche_json
             FROM gleif_entites
            WHERE lei = ? AND is_canadian = 1${activeOnly ? " AND entity_status = 'ACTIVE'" : ""}
            LIMIT 1`,
        )
        .bind(alnumOnly)
        .first<RawGleifEntiteRow>();
      if (gRow) {
        const synId = nextSyntheticId--;
        byId.set(synId, { row: buildSyntheticGleifRow(gRow, synId), score: -950 });
      }
    }
  }

  const ftsQuery = buildRegistreFtsQuery(input.query);
  if (ftsQuery) {
    let ftsSql = `
      SELECT e.id, e.juridiction, e.identifiant_principal, e.bn_ne, e.is_active, e.nom_officiel,
             e.nom_recherche, e.autres_noms_appercu, e.forme_code, e.statut_code,
             e.date_constitution, e.ville, e.flags, e.fiche_json, ${eLeiColExpr},
             bm25(entites_fts, 3.0, 1.0) AS rank_score
        FROM entites_fts f
        JOIN entites e ON e.id = f.rowid
       WHERE entites_fts MATCH ?
    `;
    ftsSql += appendJurisdictionFilter(jurisdiction, "e", caps.hasEntitesLeiCol);
    if (activeOnly) {
      ftsSql += " AND e.is_active = 1";
    }
    ftsSql += " ORDER BY rank_score ASC LIMIT 80";

    const ftsRes = await db
      .prepare(ftsSql)
      .bind(ftsQuery)
      .all<RawEntiteRow & { rank_score: number }>();

    const qNormFull = normalizeEntitySearch(input.query);
    for (const r of ftsRes.results) {
      const id = Number(r.id);
      if (byId.has(id)) continue;
      const officialNorm = normalizeEntitySearch(r.nom_officiel);
      let bonus = 0;
      if (officialNorm === qNormFull) bonus -= 50;
      else if (officialNorm.startsWith(qNormFull)) bonus -= 15;
      if (r.is_active === 1 || r.statut_code === "NI") bonus -= 40;
      byId.set(id, { row: r, score: Number(r.rank_score) + bonus });
    }
  }

  if (caps.hasGleifEntites && (jurisdiction === "gleif" || jurisdiction === "all") && !isLeiQuery) {
    const qNormFull = normalizeEntitySearch(input.query);
    const rawTokens = qNormFull.split(" ").filter(Boolean);
    const coreTokens = rawTokens.filter((t) => !LEGAL_SUFFIX_TOKENS.has(t));
    const matchTokens = (coreTokens.length > 0 ? coreTokens : rawTokens)
      .filter((t) => t.length >= 2)
      .slice(0, 6);

    if (matchTokens.length > 0) {
      const likeClauses = matchTokens.map(
        () => "(legal_name LIKE ? OR COALESCE(fiche_json, '') LIKE ?)",
      );
      const likeParams: string[] = [];
      for (const tok of matchTokens) {
        const pat = buildGleifLikePattern(tok);
        likeParams.push(pat, pat);
      }

      const gFallbackSql = `
        SELECT lei, is_canadian, legal_name, legal_jurisdiction, entity_category, entity_status,
               legal_form_code, registration_status, initial_registration_date, next_renewal_date,
               last_update_date, managing_lou, validation_sources, ra_id, ra_entity_id,
               matched_neq, matched_corp_no, country, region, city, postal_code, fiche_json
          FROM gleif_entites
         WHERE is_canadian = 1${activeOnly ? " AND entity_status = 'ACTIVE'" : ""}
           AND ${likeClauses.join(" AND ")}
         LIMIT 60
      `;
      const gFallbackRes = await db
        .prepare(gFallbackSql)
        .bind(...likeParams)
        .all<RawGleifEntiteRow>();

      const seenLeis = new Set<string>();
      const seenNeqs = new Set<string>();
      const seenCorps = new Set<string>();
      for (const { row } of byId.values()) {
        if (row.lei) seenLeis.add(row.lei);
        if (row.juridiction === "lei") seenLeis.add(row.identifiant_principal);
        if (row.juridiction === "qc") seenNeqs.add(row.identifiant_principal);
        if (row.juridiction === "ca") {
          for (const variant of corpNumberCandidates(row.identifiant_principal)) {
            seenCorps.add(variant);
          }
        }
      }

      for (const g of gFallbackRes.results) {
        if (seenLeis.has(g.lei)) continue;
        if (g.matched_neq && seenNeqs.has(g.matched_neq)) continue;
        if (
          g.matched_corp_no &&
          corpNumberCandidates(g.matched_corp_no).some((v) => seenCorps.has(v))
        ) {
          continue;
        }
        const gFiche = parseJsonSafe<{ autres_noms?: string[] }>(g.fiche_json, {});
        const altNames = Array.isArray(gFiche.autres_noms) ? gFiche.autres_noms : [];
        const hayTokens = new Set<string>([
          ...normalizeEntitySearch(g.legal_name).split(" "),
          ...altNames.flatMap((a) => normalizeEntitySearch(a).split(" ")),
        ]);
        const tokensMatched = matchTokens.every((tok) => {
          for (const ht of hayTokens) {
            if (tok.length >= 4 ? ht.startsWith(tok) : ht === tok) {
              return true;
            }
          }
          return false;
        });
        if (!tokensMatched) continue;

        const officialNorm = normalizeEntitySearch(g.legal_name);
        let score = 0;
        if (officialNorm === qNormFull) score -= 50;
        else if (officialNorm.startsWith(qNormFull)) score -= 15;
        if (g.entity_status === "ACTIVE") score -= 40;
        const synId = nextSyntheticId--;
        seenLeis.add(g.lei);
        byId.set(synId, { row: buildSyntheticGleifRow(g, synId), score });
      }
    }
  }

  const sorted = Array.from(byId.values())
    .sort((a, b) => a.score - b.score || a.row.id - b.row.id)
    .slice(0, limit);

  const dvPairs: Array<[string, string | null | undefined]> = [];
  const unresolvedNeqs: string[] = [];
  const corpLookupSet = new Set<string>();
  const caOrLeiLeisSet = new Set<string>();
  for (const { row } of sorted) {
    if (row.juridiction === "qc") {
      dvPairs.push(["FORM_JURI", row.forme_code], ["STAT_IMMAT", row.statut_code]);
      if (!row.lei && caps.hasGleifEntites) {
        unresolvedNeqs.push(row.identifiant_principal);
      }
    } else if (row.juridiction === "ca") {
      if (caps.hasGleifEntites) {
        for (const variant of corpNumberCandidates(row.identifiant_principal)) {
          corpLookupSet.add(variant);
        }
        if (row.lei) {
          caOrLeiLeisSet.add(row.lei);
        }
      }
    } else if (row.juridiction === "lei") {
      if (caps.hasGleifEntites) {
        caOrLeiLeisSet.add(row.lei ?? row.identifiant_principal);
      }
    }
  }
  const dv = await loadDomaineValeurForPairs(db, dvPairs);

  const leiByNeq = new Map<string, string>();
  const leiByCorp = new Map<string, string>();
  const neqsByLei = new Map<string, Set<string>>();
  const neqsByCorp = new Map<string, Set<string>>();
  const uniqueUnresolvedNeqs = Array.from(new Set(unresolvedNeqs));
  const corpLookup = Array.from(corpLookupSet);
  const caOrLeiLeis = Array.from(caOrLeiLeisSet);
  if (
    caps.hasGleifEntites &&
    (uniqueUnresolvedNeqs.length > 0 || corpLookup.length > 0 || caOrLeiLeis.length > 0)
  ) {
    const clauses: string[] = [];
    const params: string[] = [];
    if (uniqueUnresolvedNeqs.length > 0) {
      clauses.push(`matched_neq IN (${uniqueUnresolvedNeqs.map(() => "?").join(",")})`);
      params.push(...uniqueUnresolvedNeqs);
    }
    if (corpLookup.length > 0) {
      clauses.push(`matched_corp_no IN (${corpLookup.map(() => "?").join(",")})`);
      params.push(...corpLookup);
    }
    if (caOrLeiLeis.length > 0) {
      clauses.push(`lei IN (${caOrLeiLeis.map(() => "?").join(",")})`);
      params.push(...caOrLeiLeis);
    }
    const gRes = await db
      .prepare(
        `SELECT lei, matched_neq, matched_corp_no FROM gleif_entites
          WHERE ${clauses.join(" OR ")}
          ORDER BY CASE registration_status WHEN 'ISSUED' THEN 0 WHEN 'LAPSED' THEN 1 ELSE 2 END,
                   next_renewal_date DESC, lei ASC`,
      )
      .bind(...params)
      .all<{ lei: string; matched_neq: string | null; matched_corp_no: string | null }>();
    for (const g of gRes.results) {
      if (g.matched_neq && !leiByNeq.has(g.matched_neq)) {
        leiByNeq.set(g.matched_neq, g.lei);
      }
      if (g.matched_corp_no) {
        for (const variant of corpNumberCandidates(g.matched_corp_no)) {
          if (!leiByCorp.has(variant)) {
            leiByCorp.set(variant, g.lei);
          }
        }
      }
      if (g.matched_neq) {
        let sLei = neqsByLei.get(g.lei);
        if (!sLei) {
          sLei = new Set();
          neqsByLei.set(g.lei, sLei);
        }
        sLei.add(g.matched_neq);
        if (g.matched_corp_no) {
          for (const variant of corpNumberCandidates(g.matched_corp_no)) {
            let sCorp = neqsByCorp.get(variant);
            if (!sCorp) {
              sCorp = new Set();
              neqsByCorp.set(variant, sCorp);
            }
            sCorp.add(g.matched_neq);
          }
        }
      }
    }
  }

  const daMaskedLeis = new Set<string>();
  const daMaskedNeqs = new Set<string>();
  const checkLeisSet = new Set<string>();
  const checkNeqsSet = new Set<string>();

  for (const { row } of sorted) {
    if (row.juridiction === "qc") {
      const qcFiche = parseJsonSafe<QcFicheCompact>(row.fiche_json, {});
      if (qcFiche.da === 1) {
        daMaskedNeqs.add(row.identifiant_principal);
        const qcLei = row.lei ?? leiByNeq.get(row.identifiant_principal) ?? null;
        if (qcLei) {
          daMaskedLeis.add(qcLei);
        }
      }
    } else {
      const candLei =
        row.juridiction === "ca"
          ? (row.lei ?? leiByCorp.get(row.identifiant_principal) ?? null)
          : (row.lei ?? row.identifiant_principal);
      if (candLei) {
        checkLeisSet.add(candLei);
        for (const neq of neqsByLei.get(candLei) ?? []) {
          checkNeqsSet.add(neq);
        }
      }
      if (row.juridiction === "ca") {
        for (const neq of neqsByCorp.get(row.identifiant_principal) ?? []) {
          checkNeqsSet.add(neq);
        }
      }
    }
  }

  const qcDaClauses: string[] = [];
  const qcDaParams: string[] = [];
  if (caps.hasEntitesLeiCol && checkLeisSet.size > 0) {
    const leis = Array.from(checkLeisSet);
    qcDaClauses.push(`lei IN (${leis.map(() => "?").join(",")})`);
    qcDaParams.push(...leis);
  }
  if (checkNeqsSet.size > 0) {
    const neqs = Array.from(checkNeqsSet);
    qcDaClauses.push(`identifiant_principal IN (${neqs.map(() => "?").join(",")})`);
    qcDaParams.push(...neqs);
  }
  if (qcDaClauses.length > 0) {
    const qcLinkedRes = await db
      .prepare(
        `SELECT identifiant_principal, ${leiColExpr}, fiche_json
           FROM entites
          WHERE juridiction = 'qc'
            AND (${qcDaClauses.join(" OR ")})`,
      )
      .bind(...qcDaParams)
      .all<{ identifiant_principal: string; lei: string | null; fiche_json: string }>();
    for (const q of qcLinkedRes.results) {
      const qFiche = parseJsonSafe<QcFicheCompact>(q.fiche_json, {});
      if (qFiche.da === 1) {
        daMaskedNeqs.add(q.identifiant_principal);
        if (q.lei) {
          daMaskedLeis.add(q.lei);
        }
        const mappedLei = leiByNeq.get(q.identifiant_principal);
        if (mappedLei) {
          daMaskedLeis.add(mappedLei);
        }
      }
    }
  }

  const entities = sorted.map(({ row }) => {
    const isQc = row.juridiction === "qc";
    const isCa = row.juridiction === "ca";
    const isLei = row.juridiction === "lei";
    const forme = isQc ? decodeDv(dv, "FORM_JURI", row.forme_code) : row.forme_code;
    const statut = isQc
      ? (decodeDv(dv, "STAT_IMMAT", row.statut_code) ?? row.statut_code)
      : row.statut_code;
    const autresNoms = parseJsonSafe<string[]>(row.autres_noms_appercu, []);
    const flags = Number(row.flags);
    const qcFiche = isQc ? parseJsonSafe<QcFicheCompact>(row.fiche_json, {}) : null;
    const effectiveLei =
      row.lei ??
      (isQc
        ? (leiByNeq.get(row.identifiant_principal) ?? null)
        : isCa
          ? (leiByCorp.get(row.identifiant_principal) ?? null)
          : row.identifiant_principal);
    const isLinkedDaMasked =
      !isQc &&
      ((effectiveLei !== null && daMaskedLeis.has(effectiveLei)) ||
        (effectiveLei !== null &&
          Array.from(neqsByLei.get(effectiveLei) ?? []).some((n) => daMaskedNeqs.has(n))) ||
        (isCa &&
          Array.from(neqsByCorp.get(row.identifiant_principal) ?? []).some((n) =>
            daMaskedNeqs.has(n),
          )));
    const effectiveVille =
      isQc && qcFiche
        ? resolveQcVille(row.ville, qcFiche)
        : isLinkedDaMasked
          ? null
          : (row.ville ?? null);

    return {
      jurisdiction: (isLei ? "gleif" : row.juridiction) as "qc" | "ca" | "gleif",
      neq: isQc ? row.identifiant_principal : null,
      corporation_number: isCa ? row.identifiant_principal : null,
      bn_ne: row.bn_ne ?? null,
      has_lei: Boolean(effectiveLei),
      lei: effectiveLei,
      nom_officiel: row.nom_officiel,
      autres_noms: autresNoms,
      forme_juridique: forme ?? null,
      statut,
      is_active: row.is_active === 1,
      faillite_declaree: (flags & FLAG_FAILLITE) !== 0,
      date_constitution: row.date_constitution ?? null,
      ville: effectiveVille,
      has_rbq_licence: (flags & FLAG_RBQ) !== 0,
      has_opc_permit: (flags & FLAG_OPC) !== 0,
      in_rena: (flags & FLAG_RENA) !== 0,
    };
  });

  const qNormFull = normalizeEntitySearch(input.query);
  const isStatutoryCrownQuery = KNOWN_STATUTORY_CROWN_CORPS.has(qNormFull);
  const exactMatchFound = entities.some((e) => {
    if (
      /^\d{5,10}$/.test(digitsOnly) &&
      (e.neq === digitsOnly || e.corporation_number === digitsOnly || e.bn_ne === digitsOnly)
    ) {
      return true;
    }
    if (isLeiQuery && e.lei === alnumOnly) {
      return true;
    }
    const isExemptCorporate = e.statut === "Non immatriculée" && isCorporateForm(e.forme_juridique);
    if (qNormFull.length === 0 || (!e.is_active && !isExemptCorporate)) {
      return false;
    }
    if (isStatutoryCrownQuery) {
      return (
        isCorporateForm(e.forme_juridique) && normalizeEntitySearch(e.nom_officiel) === qNormFull
      );
    }
    return (
      normalizeEntitySearch(e.nom_officiel) === qNormFull ||
      e.autres_noms.some((alt) => normalizeEntitySearch(alt) === qNormFull)
    );
  });

  const hasQc =
    jurisdiction !== "ca" &&
    (entities.some((e) => e.jurisdiction === "qc") || Boolean(snapshots.req));
  const hasGleif = entities.some((e) => e.has_lei);
  const gardes = makeRegistreGardes(hasQc, hasGleif);
  const verifiedAt =
    snapshots.req ?? snapshots.corp_ca ?? snapshots.gleif ?? snapshots.rbq ?? "2026-11-15";

  const provenanceSource =
    hasGleif || snapshots.gleif
      ? "Instantanés ouverts locaux : REQ (CC BY-NC-SA 4.0), RBQ / OPC / RENA (CC BY 4.0), Corporations Canada (OGL-Canada), GLEIF Golden Copy L1/L2/REPEX (CC0 1.0)"
      : "Instantanés ouverts locaux : REQ (CC BY-NC-SA 4.0), RBQ / OPC / RENA (CC BY 4.0), Corporations Canada (OGL-Canada)";

  const structured: RegistreSearchEntitiesOutput = {
    query: input.query,
    jurisdiction,
    active_only: activeOnly,
    count: entities.length,
    exact_match_found: exactMatchFound,
    snapshots,
    entities,
    provenance: {
      source: provenanceSource,
      verified_at: verifiedAt,
    },
    gardes,
  };

  const lines = entities.map((e) => {
    const idLabel =
      e.jurisdiction === "qc"
        ? `NEQ ${e.neq}`
        : e.jurisdiction === "ca"
          ? `Soc. féd. ${e.corporation_number}${e.bn_ne ? ` (NE ${e.bn_ne})` : ""}`
          : `LEI ${e.lei}`;
    const badges: string[] = [];
    if (e.has_rbq_licence) badges.push("RBQ active");
    if (e.has_opc_permit) badges.push("Permis OPC");
    if (e.in_rena) badges.push("INSCRITE AU RENA");
    if (e.faillite_declaree) badges.push("Faillite déclarée");
    if (e.has_lei && e.jurisdiction !== "gleif" && e.lei) badges.push(`LEI ${e.lei}`);
    const badgeStr = badges.length > 0 ? ` [${badges.join(" · ")}]` : "";
    const altStr =
      e.autres_noms.length > 0 ? `\n  Autres noms : ${e.autres_noms.slice(0, 4).join(" ; ")}` : "";
    return `- [${e.jurisdiction.toUpperCase()} · ${idLabel}] ${e.nom_officiel} — ${e.statut}${e.forme_juridique ? ` (${e.forme_juridique})` : ""}${e.ville ? `, ${e.ville}` : ""}${e.date_constitution ? `, const. ${e.date_constitution}` : ""}${badgeStr}${altStr}`;
  });

  const snapSummary = Object.entries(snapshots)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  const noExactNote = !exactMatchFound
    ? [
        "",
        `⚠ Aucune correspondance exacte normalisée trouvée pour « ${input.query} » : le jeu de données ouvert du REQ peut omettre certaines entités constituées par loi spéciale (p. ex. sociétés d'État telles qu'Hydro-Québec, organismes publics, municipalités ou ordres professionnels) ou comporter une graphie légèrement différente. Vérifier directement au portail officiel du Registraire des entreprises ou dans la loi constitutive applicable.`,
      ]
    : [];

  const text = [
    `Recherche aux registres d'entreprises pour « ${input.query} » (${entities.length} résultat(s))`,
    ...(lines.length > 0
      ? lines
      : ["Aucune entreprise correspondante repérée dans les instantanés locaux."]),
    ...noExactNote,
    "",
    `Dates d'instantanés : ${snapSummary || verifiedAt}`,
    "",
    "Gardes :",
    ...gardes.map((g) => `- [${g.code}] ${g.message}`),
  ].join("\n");

  return { structured, text };
}

export async function registreGetEntity(
  db: D1Database,
  input: RegistreGetEntityInput,
): Promise<
  { ok: true; structured: RegistreGetEntityOutput; text: string } | { ok: false; text: string }
> {
  const provided = [
    input.neq ? (["neq", input.neq] as const) : null,
    input.corporation_number ? (["corporation_number", input.corporation_number] as const) : null,
    input.bn_ne ? (["bn_ne", input.bn_ne] as const) : null,
    input.lei ? (["lei", input.lei] as const) : null,
  ].filter(
    (x): x is readonly ["neq" | "corporation_number" | "bn_ne" | "lei", string] => x !== null,
  );

  if (provided.length !== 1) {
    return {
      ok: false,
      text: "Paramètres invalides : fournir exactement l'un des quatre identifiants (`neq`, `corporation_number`, `bn_ne` ou `lei`).",
    };
  }

  const [lookupBy, rawVal] = provided[0]!;
  const cleanDigits = rawVal.replace(/[\s-]/g, "");
  const cleanLei = rawVal.replace(/[\s-]+/g, "").toUpperCase();

  if (lookupBy === "neq" && !/^\d{10}$/.test(cleanDigits)) {
    return {
      ok: false,
      text: `Format de NEQ invalide (« ${rawVal} ») : un numéro d'entreprise du Québec comporte exactement 10 chiffres.`,
    };
  }
  if (lookupBy === "bn_ne" && !/^\d{9}$/.test(cleanDigits)) {
    return {
      ok: false,
      text: `Format de NE/BN invalide (« ${rawVal} ») : le numéro d'entreprise fédéral comporte exactement 9 chiffres.`,
    };
  }
  if (lookupBy === "lei" && !/^[A-Z0-9]{20}$/.test(cleanLei)) {
    return {
      ok: false,
      text: `Format de LEI invalide (« ${rawVal} ») : un identifiant d'entité juridique (LEI ISO 17442) comporte exactement 20 caractères alphanumériques (A–Z, 0–9).`,
    };
  }

  const [snapshots, caps] = await Promise.all([
    loadMetaSnapshots(db),
    loadRegistreDbCapabilities(db),
  ]);
  if (lookupBy === "lei" && !caps.hasGleifEntites) {
    return {
      ok: false,
      text: "Les tables GLEIF (LEI) ne sont pas chargées dans cet instantané local de DB_REGISTRES.",
    };
  }

  const leiColExpr = caps.hasEntitesLeiCol ? "lei" : "NULL AS lei";

  let qcRow: RawEntiteRow | null = null;
  let caRow: RawEntiteRow | null = null;
  let gleifRow: RawGleifEntiteRow | null = null;

  const selectEntiteCols = `
    SELECT id, juridiction, identifiant_principal, bn_ne, is_active, nom_officiel,
           nom_recherche, autres_noms_appercu, forme_code, statut_code,
           date_constitution, ville, flags, fiche_json, ${leiColExpr}
      FROM entites
  `;

  if (lookupBy === "neq") {
    qcRow = await db
      .prepare(`${selectEntiteCols} WHERE juridiction = 'qc' AND identifiant_principal = ? LIMIT 1`)
      .bind(cleanDigits)
      .first<RawEntiteRow>();
  } else if (lookupBy === "corporation_number") {
    const corpCandidates = corpNumberCandidates(rawVal);
    if (corpCandidates.length > 0) {
      caRow =
        (await db
          .prepare(
            `${selectEntiteCols} WHERE juridiction = 'ca' AND identifiant_principal IN (${corpCandidates.map(() => "?").join(", ")}) LIMIT 1`,
          )
          .bind(...corpCandidates)
          .first<RawEntiteRow>()) ?? null;
    }
  } else if (lookupBy === "bn_ne") {
    caRow = await db
      .prepare(
        `${selectEntiteCols} WHERE juridiction = 'ca' AND bn_ne = ? ORDER BY is_active DESC, id ASC LIMIT 1`,
      )
      .bind(cleanDigits)
      .first<RawEntiteRow>();
  } else {
    gleifRow = await db
      .prepare("SELECT * FROM gleif_entites WHERE lei = ? LIMIT 1")
      .bind(cleanLei)
      .first<RawGleifEntiteRow>();
  }

  if (caps.hasGleifEntites && !gleifRow) {
    if (qcRow?.lei) {
      gleifRow = await db
        .prepare("SELECT * FROM gleif_entites WHERE lei = ? LIMIT 1")
        .bind(qcRow.lei)
        .first<RawGleifEntiteRow>();
    } else if (caRow?.lei) {
      gleifRow = await db
        .prepare("SELECT * FROM gleif_entites WHERE lei = ? LIMIT 1")
        .bind(caRow.lei)
        .first<RawGleifEntiteRow>();
    } else if (lookupBy === "neq") {
      gleifRow = await db
        .prepare(
          `SELECT * FROM gleif_entites
            WHERE matched_neq = ?
            ORDER BY CASE registration_status WHEN 'ISSUED' THEN 0 WHEN 'LAPSED' THEN 1 ELSE 2 END,
                     next_renewal_date DESC, lei ASC
            LIMIT 1`,
        )
        .bind(cleanDigits)
        .first<RawGleifEntiteRow>();
    } else if (caRow) {
      const corpCandidates = corpNumberCandidates(caRow.identifiant_principal);
      if (corpCandidates.length > 0) {
        gleifRow = await db
          .prepare(
            `SELECT * FROM gleif_entites
              WHERE matched_corp_no IN (${corpCandidates.map(() => "?").join(", ")})
              ORDER BY CASE registration_status WHEN 'ISSUED' THEN 0 WHEN 'LAPSED' THEN 1 ELSE 2 END,
                       next_renewal_date DESC, lei ASC
              LIMIT 1`,
          )
          .bind(...corpCandidates)
          .first<RawGleifEntiteRow>();
      }
    }
  }

  if (gleifRow) {
    if (!qcRow && (gleifRow.matched_neq || caps.hasEntitesLeiCol)) {
      if (gleifRow.matched_neq) {
        qcRow = await db
          .prepare(
            `${selectEntiteCols} WHERE juridiction = 'qc' AND identifiant_principal = ? LIMIT 1`,
          )
          .bind(gleifRow.matched_neq)
          .first<RawEntiteRow>();
      } else if (caps.hasEntitesLeiCol) {
        qcRow = await db
          .prepare(`${selectEntiteCols} WHERE juridiction = 'qc' AND lei = ? LIMIT 1`)
          .bind(gleifRow.lei)
          .first<RawEntiteRow>();
      }
    }
    if (!caRow && (gleifRow.matched_corp_no || caps.hasEntitesLeiCol)) {
      if (gleifRow.matched_corp_no) {
        const corpCandidates = corpNumberCandidates(gleifRow.matched_corp_no);
        if (corpCandidates.length > 0) {
          caRow = await db
            .prepare(
              `${selectEntiteCols} WHERE juridiction = 'ca' AND identifiant_principal IN (${corpCandidates.map(() => "?").join(", ")}) LIMIT 1`,
            )
            .bind(...corpCandidates)
            .first<RawEntiteRow>();
        }
      } else if (caps.hasEntitesLeiCol) {
        caRow = await db
          .prepare(`${selectEntiteCols} WHERE juridiction = 'ca' AND lei = ? LIMIT 1`)
          .bind(gleifRow.lei)
          .first<RawEntiteRow>();
      }
    }
  }

  let rbqRows: Array<{ numero_licence: string; payload_json: string }> = [];
  let opcRows: Array<{ numero_permis: string; payload_json: string }> = [];
  let renaRows: Array<{ nom_entreprise: string; payload_json: string }> = [];

  const targetNeq =
    lookupBy === "neq"
      ? cleanDigits
      : (qcRow?.identifiant_principal ?? gleifRow?.matched_neq ?? null);

  if (targetNeq) {
    const [rbqRes, opcRes, renaRes] = await db.batch([
      db
        .prepare("SELECT numero_licence, payload_json FROM rbq_licences WHERE neq = ?")
        .bind(targetNeq),
      db
        .prepare("SELECT numero_permis, payload_json FROM opc_permis WHERE neq = ?")
        .bind(targetNeq),
      db
        .prepare("SELECT nom_entreprise, payload_json FROM rena_inscriptions WHERE neq = ?")
        .bind(targetNeq),
    ]);
    rbqRows = (rbqRes?.results ?? []) as Array<{ numero_licence: string; payload_json: string }>;
    opcRows = (opcRes?.results ?? []) as Array<{ numero_permis: string; payload_json: string }>;
    renaRows = (renaRes?.results ?? []) as Array<{ nom_entreprise: string; payload_json: string }>;
  }

  if (
    !qcRow &&
    !caRow &&
    !gleifRow &&
    rbqRows.length === 0 &&
    opcRows.length === 0 &&
    renaRows.length === 0
  ) {
    return {
      ok: false,
      text: `Aucune entité trouvée pour ${lookupBy}=« ${lookupBy === "lei" ? cleanLei : rawVal} » dans les instantanés locaux (${Object.keys(snapshots).join(", ") || "aucune source"}).`,
    };
  }

  const qcFiche = parseJsonSafe<QcFicheCompact>(qcRow?.fiche_json ?? null, {});
  const dispenseAdresse = qcFiche.da === 1;

  let quebec: z.infer<typeof ProfilQuebecSchema> | null = null;
  if (targetNeq && (qcRow || rbqRows.length > 0 || opcRows.length > 0 || renaRows.length > 0)) {
    const f = qcFiche;
    const statCode = qcRow?.statut_code ?? "ND";

    const dvPairs: Array<[string, string | null | undefined]> = [
      ["STAT_IMMAT", statCode === "ND" ? null : statCode],
      ["FORM_JURI", qcRow?.forme_code],
      ["REGIM_JURI", f.rj],
      ["REGIM_JURI", f.rc],
      ["INTVAL_EMPLO_QUE", f.tr],
    ];
    for (const [, , st, typ] of f.nm ?? []) {
      dvPairs.push(["STAT_NOM", st], ["TYP_NOM", typ]);
    }
    for (const [rel] of f.fs ?? []) {
      dvPairs.push(["RELA_ASSUJ", rel]);
    }
    for (const [typ, reg] of f.ct ?? []) {
      dvPairs.push(["TYP_CHANG", typ], ["REGIM_JURI", reg]);
    }
    const dv = await loadDomaineValeurForPairs(db, dvPairs);

    const rbqParsed = rbqRows.map((r) => {
      const p = parseJsonSafe<Record<string, unknown>>(r.payload_json, {});
      return {
        numero_licence: r.numero_licence,
        statut: String(p.statut ?? "Active"),
        type_licence: String(p.type_licence ?? ""),
        categorie: String(p.categorie ?? ""),
        sous_categories: Array.isArray(p.sous_categories) ? (p.sous_categories as string[]) : [],
        restriction: Boolean(p.restriction),
        date_delivrance: (p.date_delivrance as string | null) ?? null,
        date_paiement_annuel: (p.date_paiement_annuel as string | null) ?? null,
        cautionnement_montant: (p.cautionnement_montant as string | null) ?? null,
      };
    });

    const opcParsed = opcRows.map((r) => {
      const p = parseJsonSafe<Record<string, unknown>>(r.payload_json, {});
      return {
        numero_permis: r.numero_permis,
        categorie_permis: String(p.categorie_permis ?? ""),
        nom_commercant: String(p.nom_commercant ?? ""),
        adresse_etablissement: dispenseAdresse
          ? null
          : ((p.adresse_etablissement as string | null) ?? null),
        ville_etablissement: dispenseAdresse
          ? null
          : ((p.ville_etablissement as string | null) ?? null),
        code_postal: dispenseAdresse ? null : ((p.code_postal as string | null) ?? null),
        autres_noms: (p.autres_noms as string | null) ?? null,
      };
    });

    const renaParsed = renaRows.map((r) => {
      const p = parseJsonSafe<Record<string, unknown>>(r.payload_json, {});
      return {
        nom_entreprise: r.nom_entreprise,
        categorie: (p.categorie as string | null) ?? null,
        adresse: dispenseAdresse ? null : ((p.adresse as string | null) ?? null),
        date_debut: (p.date_debut as string | null) ?? null,
        date_fin: (p.date_fin as string | null) ?? null,
        infraction: (p.infraction as string | null) ?? null,
        decision_amp: (p.decision_amp as string | null) ?? null,
      };
    });

    const fallbackName =
      qcRow?.nom_officiel ??
      opcParsed[0]?.nom_commercant ??
      renaParsed[0]?.nom_entreprise ??
      `Entité NEQ ${targetNeq}`;

    quebec = {
      neq: targetNeq,
      nom_officiel: fallbackName,
      is_active: qcRow ? qcRow.is_active === 1 : true,
      statut_immatriculation: {
        code: statCode,
        libelle:
          statCode === "ND"
            ? "Non disponible (fiche REQ absente, volets complémentaires seulement)"
            : (decodeDv(dv, "STAT_IMMAT", statCode) ?? statCode),
        date_statut: f.ds ?? null,
      },
      forme_juridique: {
        code: qcRow?.forme_code ?? null,
        libelle: decodeDv(dv, "FORM_JURI", qcRow?.forme_code),
      },
      regime_juridique: {
        code: f.rj ?? null,
        libelle: decodeDv(dv, "REGIM_JURI", f.rj),
      },
      regime_constitutif: {
        code: f.rc ?? null,
        libelle: decodeDv(dv, "REGIM_JURI", f.rc),
        lieu_constitution: f.lc ?? null,
      },
      dates: {
        date_immatriculation: f.im ?? null,
        date_constitution: qcRow?.date_constitution ?? null,
        date_cessation_prevue: f.dc ?? null,
        annee_declaration_courante: f.ap ?? null,
      },
      indicateurs: {
        faillite_declaree: qcRow ? (Number(qcRow.flags) & FLAG_FAILLITE) !== 0 : false,
        convention_unanime_actionnaires: f.cu === 1,
        tranche_employes_quebec: decodeDv(dv, "INTVAL_EMPLO_QUE", f.tr),
      },
      domicile_declare: {
        dispense_adresse: dispenseAdresse,
        adresse: dispenseAdresse ? null : (f.ad ?? null),
        ville: resolveQcVille(qcRow?.ville, f),
        code_postal: dispenseAdresse ? null : (f.cp ?? null),
      },
      activites_economiques: (f.ac ?? []).map(([code_cae, description]) => ({
        code_cae,
        description,
      })),
      autres_noms: (f.nm ?? []).map(([nom, etr, st, typ, deb, fin]) => ({
        nom,
        nom_langue_etrangere: etr,
        statut: decodeDv(dv, "STAT_NOM", st) ?? st,
        type_nom: decodeDv(dv, "TYP_NOM", typ) ?? typ,
        date_debut: deb,
        date_fin: fin,
      })),
      etablissements: (f.et ?? []).map(([no_suf, nom, princ, adr, cp, act]) => ({
        numero_suffixe: no_suf,
        nom,
        principal: princ === 1,
        adresse: dispenseAdresse ? null : adr,
        code_postal: dispenseAdresse ? null : cp,
        activite: act,
      })),
      fusions_scissions: (f.fs ?? []).map(([rel, neq_rel, denom, dtEf, adr]) => ({
        relation: decodeDv(dv, "RELA_ASSUJ", rel) ?? rel,
        neq_relie: neq_rel,
        denomination: denom,
        date_prise_effet: dtEf,
        adresse: dispenseAdresse ? null : adr,
      })),
      continuations_transformations: (f.ct ?? []).map(([typ, reg, loc, dtEf]) => ({
        type_changement: decodeDv(dv, "TYP_CHANG", typ) ?? typ,
        regime_juridique: decodeDv(dv, "REGIM_JURI", reg) ?? reg,
        localite: loc,
        date_prise_effet: dtEf,
      })),
      rbq_licences: rbqParsed,
      opc_permis: opcParsed,
      rena_inscriptions: renaParsed,
    };
  }

  let federal: z.infer<typeof ProfilFederalSchema> | null = null;
  if (caRow) {
    const f = parseJsonSafe<CaFicheCompact>(caRow.fiche_json, {});
    federal = {
      corporation_number: caRow.identifiant_principal,
      bn_ne: caRow.bn_ne ?? null,
      nom_officiel: caRow.nom_officiel,
      autres_denominations: f.n2 ?? [],
      is_active: caRow.is_active === 1,
      regime_legislatif: f.rl ?? caRow.forme_code ?? "Fédéral",
      statut: caRow.statut_code,
      detail_statut: f.ds ?? null,
      dates: {
        date_constitution_ou_anniversaire: caRow.date_constitution ?? null,
        annee_dernier_depot_annuel: f.an ?? null,
        date_derniere_assemblee: f.ag ?? null,
      },
      adresse_siege: dispenseAdresse
        ? { rue: null, ville: null, province: null, pays: null, code_postal: null }
        : {
            rue: f.ad ?? null,
            ville: caRow.ville ?? null,
            province: f.pr ?? null,
            pays: f.py ?? null,
            code_postal: f.cp ?? null,
          },
      administrateurs: {
        min: f.dmin ?? null,
        max: f.dmax ?? null,
      },
    };
  }

  let gleif: z.infer<typeof ProfilGleifSchema> | null = null;
  if (gleifRow) {
    const gleifFiche = parseJsonSafe<{ autres_noms?: string[] }>(gleifRow.fiche_json, {});
    let parentDirect: z.infer<typeof GleifParentSchema> | null = null;
    let parentUltime: z.infer<typeof GleifParentSchema> | null = null;

    if (caps.hasGleifLiens) {
      const parentEdgesRes = await db
        .prepare(
          `SELECT id, child_lei, parent_lei, relationship_type, relationship_status,
                  accounting_standard, quantifier_amount, quantifier_units, validation_sources
             FROM gleif_liens
            WHERE child_lei = ?
              AND relationship_type IN ('IS_DIRECTLY_CONSOLIDATED_BY', 'IS_ULTIMATELY_CONSOLIDATED_BY')
            ORDER BY CASE relationship_status WHEN 'ACTIVE' THEN 0 ELSE 1 END, id ASC`,
        )
        .bind(gleifRow.lei)
        .all<RawGleifLienRow>();

      const directEdge = parentEdgesRes.results.find(
        (r) => r.relationship_type === "IS_DIRECTLY_CONSOLIDATED_BY",
      );
      const ultimeEdge = parentEdgesRes.results.find(
        (r) => r.relationship_type === "IS_ULTIMATELY_CONSOLIDATED_BY",
      );

      const parentLeis = Array.from(
        new Set(
          [directEdge?.parent_lei, ultimeEdge?.parent_lei].filter((x): x is string => Boolean(x)),
        ),
      );
      const parentByLei = new Map<string, RawGleifEntiteRow>();
      if (parentLeis.length > 0) {
        const pRes = await db
          .prepare(
            `SELECT * FROM gleif_entites WHERE lei IN (${parentLeis.map(() => "?").join(",")})`,
          )
          .bind(...parentLeis)
          .all<RawGleifEntiteRow>();
        for (const p of pRes.results) {
          parentByLei.set(p.lei, p);
        }
      }

      const mapParent = (
        edge: RawGleifLienRow | undefined,
      ): z.infer<typeof GleifParentSchema> | null => {
        if (!edge) return null;
        const pEnt = parentByLei.get(edge.parent_lei);
        return {
          lei: edge.parent_lei,
          nom_legal: pEnt?.legal_name ?? null,
          pays: pEnt?.country ?? null,
          legal_jurisdiction: pEnt?.legal_jurisdiction ?? null,
          statut_entite: pEnt?.entity_status ?? null,
          relationship_status: edge.relationship_status,
          accounting_standard: edge.accounting_standard ?? null,
          quantifier_amount: edge.quantifier_amount ?? null,
          quantifier_units: edge.quantifier_units ?? null,
          validation_sources: edge.validation_sources ?? null,
          in_canadian_snapshot: pEnt ? pEnt.is_canadian === 1 : false,
          matched_neq: pEnt?.matched_neq ?? null,
          matched_corporation_number: pEnt?.matched_corp_no ?? null,
        };
      };

      parentDirect = mapParent(directEdge);
      parentUltime = mapParent(ultimeEdge);
    }

    let exceptionsDeclaration: Array<z.infer<typeof GleifExceptionSchema>> = [];
    if (caps.hasGleifExceptions) {
      const excRes = await db
        .prepare(
          "SELECT lei, category, reasons_json FROM gleif_exceptions WHERE lei = ? ORDER BY category ASC",
        )
        .bind(gleifRow.lei)
        .all<RawGleifExceptionRow>();
      exceptionsDeclaration = excRes.results.map((r) => {
        const raisons = parseJsonSafe<string[]>(r.reasons_json, []);
        return {
          categorie: r.category,
          raisons,
          libelle_fr: formatGleifExceptionFr(r.category, raisons),
        };
      });
    }

    const filialesCanadiennes: Array<z.infer<typeof GleifFilialeSchema>> = [];
    let filialesTotal = 0;
    if (caps.hasGleifLiens) {
      const countRow = await db
        .prepare(
          `SELECT COUNT(DISTINCT l.child_lei) AS total
             FROM gleif_liens l
             JOIN gleif_entites c ON c.lei = l.child_lei
            WHERE l.parent_lei = ?
              AND l.relationship_status = 'ACTIVE'
              AND l.relationship_type IN ('IS_DIRECTLY_CONSOLIDATED_BY', 'IS_ULTIMATELY_CONSOLIDATED_BY')
              AND c.is_canadian = 1`,
        )
        .bind(gleifRow.lei)
        .first<{ total: number }>();
      filialesTotal = Number(countRow?.total ?? 0);

      if (filialesTotal > 0) {
        const filRes = await db
          .prepare(
            `SELECT c.lei, c.legal_name, c.legal_jurisdiction, c.entity_status,
                    c.matched_neq, c.matched_corp_no,
                    MAX(CASE WHEN l.relationship_type = 'IS_DIRECTLY_CONSOLIDATED_BY' THEN 1 ELSE 0 END) AS is_direct,
                    MAX(CASE WHEN l.relationship_type = 'IS_ULTIMATELY_CONSOLIDATED_BY' THEN 1 ELSE 0 END) AS is_ultime
               FROM gleif_liens l
               JOIN gleif_entites c ON c.lei = l.child_lei
              WHERE l.parent_lei = ?
                AND l.relationship_status = 'ACTIVE'
                AND l.relationship_type IN ('IS_DIRECTLY_CONSOLIDATED_BY', 'IS_ULTIMATELY_CONSOLIDATED_BY')
                AND c.is_canadian = 1
              GROUP BY c.lei, c.legal_name, c.legal_jurisdiction, c.entity_status, c.matched_neq, c.matched_corp_no
              ORDER BY c.legal_name ASC, c.lei ASC
              LIMIT 50`,
          )
          .bind(gleifRow.lei)
          .all<{
            lei: string;
            legal_name: string;
            legal_jurisdiction: string | null;
            entity_status: string | null;
            matched_neq: string | null;
            matched_corp_no: string | null;
            is_direct: number;
            is_ultime: number;
          }>();
        for (const r of filRes.results) {
          const typeLien: "direct" | "ultime" | "direct_et_ultime" =
            r.is_direct && r.is_ultime ? "direct_et_ultime" : r.is_direct ? "direct" : "ultime";
          filialesCanadiennes.push({
            lei: r.lei,
            nom_legal: r.legal_name,
            type_lien: typeLien,
            legal_jurisdiction: r.legal_jurisdiction ?? null,
            statut_entite: r.entity_status ?? null,
            matched_neq: r.matched_neq ?? null,
            matched_corporation_number: r.matched_corp_no ?? null,
          });
        }
      }
    }

    gleif = {
      lei: gleifRow.lei,
      is_canadian: gleifRow.is_canadian === 1,
      nom_legal: gleifRow.legal_name,
      autres_noms: Array.isArray(gleifFiche.autres_noms) ? gleifFiche.autres_noms : [],
      statut_entite: gleifRow.entity_status ?? "n/d",
      registration_status: gleifRow.registration_status ?? "n/d",
      next_renewal_date: gleifRow.next_renewal_date ?? null,
      initial_registration_date: gleifRow.initial_registration_date ?? null,
      last_update_date: gleifRow.last_update_date ?? null,
      legal_jurisdiction: gleifRow.legal_jurisdiction ?? null,
      entity_category: gleifRow.entity_category ?? null,
      registration_authority_id: gleifRow.ra_id ?? null,
      registration_authority_entity_id: gleifRow.ra_entity_id ?? null,
      matched_neq: gleifRow.matched_neq ?? null,
      matched_corporation_number: gleifRow.matched_corp_no ?? null,
      adresse_legale: dispenseAdresse
        ? null
        : {
            ville: gleifRow.city ?? null,
            region: gleifRow.region ?? null,
            pays: gleifRow.country ?? null,
            code_postal: gleifRow.postal_code ?? null,
          },
      parent_direct: parentDirect,
      parent_ultime: parentUltime,
      exceptions_declaration: exceptionsDeclaration,
      filiales_canadiennes: filialesCanadiennes,
      filiales_canadiennes_total: filialesTotal,
    };
  }

  const portailsOfficiels: z.infer<typeof PortailsOfficielsSchema> = {
    req: quebec
      ? {
          url: "https://www.registreentreprises.gouv.qc.ca/REQNA/GR/GR03/GR03A71.RechercheRegistre.MVC/GR03A71/RechercheParNeq",
          portal_info_url:
            "https://www.quebec.ca/entreprises-et-travailleurs-autonomes/obtenir-renseignements-entreprise/recherche-registre-entreprises/acceder-registre-entreprises",
          libelle_fr: "Registraire des entreprises du Québec (REQ) — Recherche par NEQ",
          objet_fr: `Consulter l'état des informations en direct (valeur probante L.P.L.E.), les administrateurs, dirigeants, actionnaires principaux et bénéficiaires ultimes pour le NEQ ${quebec.neq}.`,
        }
      : null,
    corporations_canada: federal
      ? {
          url: `https://ised-isde.canada.ca/cc/lgcy/fdrlCrpDtls.html?corpId=${encodeURIComponent(federal.corporation_number)}&lang=fra`,
          search_url: "https://ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html?lang=fra",
          libelle_fr: "Corporations Canada — Fiche officielle de société fédérale",
          objet_fr: `Consulter les administrateurs actuels, le siège social et les dépôts annuels de la société fédérale n° ${federal.corporation_number}.`,
        }
      : null,
    isc_pisc: federal
      ? {
          url: "https://ised-isde.canada.ca/site/corporations-canada/fr/particuliers-ayant-controle-important",
          libelle_fr: "Corporations Canada — Particuliers ayant un contrôle important (PCI / ISC)",
          objet_fr:
            "Consulter le registre fédéral des particuliers ayant un contrôle important (bénéficiaires ultimes L.C.S.A.) et les règles de divulgation applicables.",
        }
      : null,
    gleif: gleif
      ? {
          url: `https://search.gleif.org/#/record/${encodeURIComponent(gleif.lei)}`,
          libelle_fr: "GLEIF — Fiche publique officielle du LEI",
          objet_fr: `Vérifier en direct le statut d'enregistrement (${gleif.registration_status}), la date de renouvellement et les déclarations Level 2 du LEI ${gleif.lei}.`,
        }
      : null,
  };

  const gardes = makeRegistreGardes(Boolean(quebec && qcRow), gleif !== null);
  const verifiedAt =
    snapshots.req ?? snapshots.corp_ca ?? snapshots.gleif ?? snapshots.rbq ?? "2026-11-15";

  const provenanceSource =
    gleif !== null || snapshots.gleif
      ? "Instantanés ouverts locaux : REQ (CC BY-NC-SA 4.0), RBQ / OPC / RENA (CC BY 4.0), Corporations Canada (OGL-Canada), GLEIF Golden Copy L1/L2/REPEX (CC0 1.0)"
      : "Instantanés ouverts locaux : REQ (CC BY-NC-SA 4.0), RBQ / OPC / RENA (CC BY 4.0), Corporations Canada (OGL-Canada)";

  const structured: RegistreGetEntityOutput = {
    lookup_by: lookupBy,
    lookup_value: lookupBy === "lei" ? cleanLei : rawVal,
    snapshots,
    quebec,
    federal,
    gleif,
    portails_officiels: portailsOfficiels,
    provenance: {
      source: provenanceSource,
      verified_at: verifiedAt,
    },
    gardes,
  };

  const sections: string[] = [];
  if (quebec) {
    sections.push(
      `Fiche Québec — NEQ ${quebec.neq} : ${quebec.nom_officiel}`,
      `Statut : ${quebec.statut_immatriculation.libelle} (${quebec.statut_immatriculation.code})${quebec.statut_immatriculation.date_statut ? ` depuis le ${quebec.statut_immatriculation.date_statut}` : ""}`,
      `Forme juridique : ${quebec.forme_juridique.libelle ?? "n/d"} | Loi constitutive : ${quebec.regime_constitutif.libelle ?? "n/d"}${quebec.dates.date_constitution ? ` (const. ${quebec.dates.date_constitution})` : ""}`,
      `Domicile déclaré : ${
        quebec.domicile_declare.dispense_adresse
          ? "Dispense de publication d'adresse au REQ"
          : [quebec.domicile_declare.adresse, quebec.domicile_declare.code_postal]
              .filter(Boolean)
              .join(" ") || "Non déclaré"
      }`,
      `Volets complémentaires joints sur NEQ : RBQ=${quebec.rbq_licences.length} licence(s) active(s), OPC=${quebec.opc_permis.length} permis actif(s), RENA=${quebec.rena_inscriptions.length} inscription(s)`,
    );
    if (quebec.rena_inscriptions.length > 0) {
      for (const r of quebec.rena_inscriptions) {
        sections.push(
          `  ⚠ RENA : inadmissibilité du ${r.date_debut ?? "?"} au ${r.date_fin ?? "?"} — ${r.decision_amp ?? ""}`,
        );
      }
    }
    if (quebec.rbq_licences.length > 0) {
      for (const l of quebec.rbq_licences) {
        sections.push(
          `  RBQ ${l.numero_licence} (${l.type_licence}, ${l.statut}${l.restriction ? ", AVEC RESTRICTION" : ""}) — sous-catégories : ${l.sous_categories.join(", ") || "aucune"}`,
        );
      }
    }
    if (quebec.opc_permis.length > 0) {
      for (const p of quebec.opc_permis) {
        sections.push(`  OPC permis ${p.numero_permis} : ${p.categorie_permis}`);
      }
    }
  }

  if (federal) {
    sections.push(
      `Fiche fédérale (Corporations Canada) — Société n° ${federal.corporation_number}${federal.bn_ne ? ` (NE ${federal.bn_ne})` : ""} : ${federal.nom_officiel}`,
      `Régime : ${federal.regime_legislatif} | Statut : ${federal.statut}${federal.detail_statut ? ` (${federal.detail_statut})` : ""}`,
      `Siège déclaré : ${
        dispenseAdresse
          ? "Occulté (dispense d'adresse LPLE)"
          : [
              federal.adresse_siege.rue,
              federal.adresse_siege.ville,
              federal.adresse_siege.province,
              federal.adresse_siege.code_postal,
            ]
              .filter(Boolean)
              .join(", ") || "Non déclaré"
      }`,
      `Administrateurs (min–max statutaire) : ${federal.administrateurs.min ?? "n/d"} à ${federal.administrateurs.max ?? "n/d"}`,
    );
  }

  if (gleif) {
    sections.push(
      `Fiche GLEIF — LEI ${gleif.lei} : ${gleif.nom_legal}`,
      `Statut entité : ${gleif.statut_entite} | Enregistrement : ${gleif.registration_status}${gleif.next_renewal_date ? ` (prochain renouvellement : ${gleif.next_renewal_date.slice(0, 10)})` : ""}${gleif.legal_jurisdiction ? ` | Juridiction : ${gleif.legal_jurisdiction}` : ""}`,
    );
    if (gleif.parent_direct) {
      sections.push(
        `  Mère consolidante directe : ${gleif.parent_direct.nom_legal ?? gleif.parent_direct.lei} (LEI ${gleif.parent_direct.lei}, ${gleif.parent_direct.pays ?? "n/d"}, statut ${gleif.parent_direct.relationship_status})`,
      );
    }
    if (gleif.parent_ultime) {
      sections.push(
        `  Mère consolidante ultime : ${gleif.parent_ultime.nom_legal ?? gleif.parent_ultime.lei} (LEI ${gleif.parent_ultime.lei}, ${gleif.parent_ultime.pays ?? "n/d"}, statut ${gleif.parent_ultime.relationship_status})`,
      );
    }
    for (const exc of gleif.exceptions_declaration) {
      sections.push(`  Exception Level 2 : ${exc.libelle_fr}`);
    }
    if (gleif.filiales_canadiennes_total > 0) {
      sections.push(
        `  Filiales canadiennes consolidées (${gleif.filiales_canadiennes_total}) : ${gleif.filiales_canadiennes
          .slice(0, 10)
          .map((fil) => `${fil.nom_legal} (${fil.lei}, ${fil.type_lien})`)
          .join(" ; ")}`,
      );
    }
  }

  const portalLines: string[] = [];
  if (portailsOfficiels.req) {
    portalLines.push(
      `  - REQ : ${portailsOfficiels.req.url} (info : ${portailsOfficiels.req.portal_info_url})`,
    );
  }
  if (portailsOfficiels.corporations_canada) {
    portalLines.push(`  - Corporations Canada : ${portailsOfficiels.corporations_canada.url}`);
  }
  if (portailsOfficiels.isc_pisc) {
    portalLines.push(`  - PCI / ISC fédéral : ${portailsOfficiels.isc_pisc.url}`);
  }
  if (portailsOfficiels.gleif) {
    portalLines.push(`  - GLEIF : ${portailsOfficiels.gleif.url}`);
  }
  if (portalLines.length > 0) {
    sections.push(
      "",
      "Portails officiels (dirigeants, bénéficiaires ultimes et état en direct) :",
      ...portalLines,
    );
  }

  sections.push("", "Gardes :", ...gardes.map((g) => `- [${g.code}] ${g.message}`));

  return { ok: true, structured, text: sections.join("\n") };
}
