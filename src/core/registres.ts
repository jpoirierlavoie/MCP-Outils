import { z } from "zod";
import { type Garde, GardeSchema, makeGarde, ProvenanceSchema } from "./gardes.js";

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

function expandLigatures(raw: string): string {
  return raw
    .replace(/Œ/g, "OE")
    .replace(/œ/g, "oe")
    .replace(/Æ/g, "AE")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss");
}

function expandLigatureFtsTokenVariants(tok: string): string[] {
  const out = new Set<string>([tok]);
  if (tok.includes("oe")) out.add(tok.replace(/oe/g, "œ"));
  if (tok.includes("ae")) out.add(tok.replace(/ae/g, "æ"));
  if (tok.includes("œ")) out.add(tok.replace(/œ/g, "oe"));
  if (tok.includes("æ")) out.add(tok.replace(/æ/g, "ae"));
  return Array.from(out);
}

export function normalizeEntitySearch(raw: string): string {
  // Recomposer les sigles ponctués (p. ex. S.E.N.C.R.L. -> sencrl, S.A. -> sa, C.É.G.E.P. -> cegep)
  const collapsedAcronyms = raw.replace(DOTTED_ACRONYM_RE, (m) => m.replace(/\./g, ""));
  return expandLigatures(collapsedAcronyms)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildRegistreFtsQuery(rawQuery: string): string | null {
  const collapsed = rawQuery.replace(DOTTED_ACRONYM_RE, (m) => m.replace(/\./g, ""));
  const folded = expandLigatures(collapsed)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, " ")
    .toLowerCase();

  // Détecter les sociétés à numéro québécoises : « 9123-4567 » ou « 91234567 »
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

  // Repli si la dénomination est composée uniquement d'initiales d'un caractère (p. ex. « A&W », « H&M »)
  if (groups.length === 0 && chosenTokens.length > 0) {
    for (const tok of chosenTokens) {
      groups.push(`"${tok}"`);
    }
  }

  return groups.length > 0 ? groups.join(" AND ") : null;
}

// ── Schémas d'entrée et de sortie ────────────────────────────────────────────

export const RegistreSearchEntitiesInputSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .describe(
      "Nom d'entreprise, autre nom utilisé, numéro de société à numéro (p. ex. '9123-4567 Québec inc.'), NEQ (10 chiffres) ou numéro fédéral.",
    ),
  jurisdiction: z
    .enum(["qc", "ca", "all"])
    .optional()
    .describe(
      "Périmètre juridictionnel : 'qc' (Registraire des entreprises du Québec + RBQ/OPC/RENA), 'ca' (Corporations Canada) ou 'all' (défaut).",
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
export type RegistreSearchEntitiesInput = z.infer<typeof RegistreSearchEntitiesInputSchema>;

export const CandidatRegistreSchema = z.object({
  jurisdiction: z.enum(["qc", "ca"]),
  neq: z.string().nullable(),
  corporation_number: z.string().nullable(),
  bn_ne: z.string().nullable(),
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
  jurisdiction: z.enum(["qc", "ca", "all"]),
  active_only: z.boolean(),
  count: z.number().int(),
  exact_match_found: z.boolean(),
  snapshots: z.record(z.string(), z.string()),
  entities: z.array(CandidatRegistreSchema),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type RegistreSearchEntitiesOutput = z.infer<typeof RegistreSearchEntitiesOutputSchema>;

export const RegistreGetEntityInputSchema = z.strictObject({
  neq: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Numéro d'entreprise du Québec (NEQ à 10 chiffres, p. ex. '1140030355'). Fournir exactement l'un des trois identifiants : neq, corporation_number ou bn_ne.",
    ),
  corporation_number: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Numéro de société fédérale de Corporations Canada (p. ex. '8284083'). Fournir exactement l'un des trois identifiants : neq, corporation_number ou bn_ne.",
    ),
  bn_ne: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Numéro d'entreprise fédéral à 9 chiffres (NE / BN, p. ex. '801423500'). Fournir exactement l'un des trois identifiants : neq, corporation_number ou bn_ne.",
    ),
});
export type RegistreGetEntityInput = z.infer<typeof RegistreGetEntityInputSchema>;

export const RbqLicenceSchema = z.object({
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

export const OpcPermisSchema = z.object({
  numero_permis: z.string(),
  categorie_permis: z.string(),
  nom_commercant: z.string(),
  adresse_etablissement: z.string().nullable(),
  ville_etablissement: z.string().nullable(),
  code_postal: z.string().nullable(),
  autres_noms: z.string().nullable(),
});

export const RenaInscriptionSchema = z.object({
  nom_entreprise: z.string(),
  categorie: z.string().nullable(),
  adresse: z.string().nullable(),
  date_debut: z.string().nullable(),
  date_fin: z.string().nullable(),
  infraction: z.string().nullable(),
  decision_amp: z.string().nullable(),
});

export const ProfilQuebecSchema = z.object({
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

export const ProfilFederalSchema = z.object({
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

export const RegistreGetEntityOutputSchema = z.object({
  lookup_by: z.enum(["neq", "corporation_number", "bn_ne"]),
  lookup_value: z.string(),
  snapshots: z.record(z.string(), z.string()),
  quebec: ProfilQuebecSchema.nullable(),
  federal: ProfilFederalSchema.nullable(),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type RegistreGetEntityOutput = z.infer<typeof RegistreGetEntityOutputSchema>;

// ── Accès base D1 en lecture seule ───────────────────────────────────────────

interface RawEntiteRow {
  id: number;
  juridiction: "qc" | "ca";
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
  // Tranches de <= 40 paires (<= 80 paramètres liés) utilisant la clé primaire (typ_dom_val, cod_dom_val)
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
  const folded = expandLigatures(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function makeRegistreGardes(includeNcSa: boolean): Garde[] {
  const gardes: Garde[] = [
    makeGarde("REGISTRE_ABSENCE_PERSONNES_PHYSIQUES"),
    makeGarde("REGISTRE_FRAICHEUR_ET_OPPOSABILITE_LPLE"),
    makeGarde("REGISTRE_ABSENCE_NON_PROBANTE_ANCILLAIRES"),
  ];
  if (includeNcSa) {
    gardes.push(makeGarde("LICENCE_DONNEES_OUVERTES_NC_SA"));
  }
  return gardes;
}

export async function registreSearchEntities(
  db: D1Database,
  input: RegistreSearchEntitiesInput,
): Promise<{ structured: RegistreSearchEntitiesOutput; text: string }> {
  const jurisdiction = input.jurisdiction ?? "all";
  const activeOnly = input.active_only ?? false;
  const limit = input.limit ?? 10;

  const snapshots = await loadMetaSnapshots(db);

  const digitsOnly = input.query.replace(/[\s-]/g, "");
  const byId = new Map<number, { row: RawEntiteRow; score: number }>();

  // 1) Recherche directe par identifiant numérique (NEQ 10 ch., NE 9 ch., n° fédéral)
  if (/^\d{5,10}$/.test(digitsOnly)) {
    let idSql = `
      SELECT id, juridiction, identifiant_principal, bn_ne, is_active, nom_officiel,
             nom_recherche, autres_noms_appercu, forme_code, statut_code,
             date_constitution, ville, flags, fiche_json
        FROM entites
       WHERE (identifiant_principal = ? OR bn_ne = ?)
    `;
    const idParams: unknown[] = [digitsOnly, digitsOnly];
    if (jurisdiction !== "all") {
      idSql += " AND juridiction = ?";
      idParams.push(jurisdiction);
    }
    if (activeOnly) {
      idSql += " AND is_active = 1";
    }
    idSql += " LIMIT 10";
    const directRes = await db
      .prepare(idSql)
      .bind(...idParams)
      .all<RawEntiteRow>();
    for (const r of directRes.results) {
      byId.set(Number(r.id), { row: r, score: -1000 });
    }
  }

  // 2) Recherche plein texte FTS5 (avec normalisation des accents, suffixes et sociétés à numéro)
  const ftsQuery = buildRegistreFtsQuery(input.query);
  if (ftsQuery) {
    let ftsSql = `
      SELECT e.id, e.juridiction, e.identifiant_principal, e.bn_ne, e.is_active, e.nom_officiel,
             e.nom_recherche, e.autres_noms_appercu, e.forme_code, e.statut_code,
             e.date_constitution, e.ville, e.flags, e.fiche_json,
             bm25(entites_fts, 3.0, 1.0) AS rank_score
        FROM entites_fts f
        JOIN entites e ON e.id = f.rowid
       WHERE entites_fts MATCH ?
    `;
    const ftsParams: unknown[] = [ftsQuery];
    if (jurisdiction !== "all") {
      ftsSql += " AND e.juridiction = ?";
      ftsParams.push(jurisdiction);
    }
    if (activeOnly) {
      ftsSql += " AND e.is_active = 1";
    }
    ftsSql += " ORDER BY rank_score ASC LIMIT 80";

    const ftsRes = await db
      .prepare(ftsSql)
      .bind(...ftsParams)
      .all<RawEntiteRow & { rank_score: number }>();

    const qNormFull = normalizeEntitySearch(input.query);
    for (const r of ftsRes.results) {
      const id = Number(r.id);
      if (byId.has(id)) continue;
      const officialNorm = normalizeEntitySearch(r.nom_officiel);
      let bonus = 0;
      if (officialNorm === qNormFull) bonus -= 50;
      else if (officialNorm.startsWith(qNormFull)) bonus -= 15;
      if (r.is_active === 1) bonus -= 40;
      byId.set(id, { row: r, score: Number(r.rank_score) + bonus });
    }
  }

  const sorted = Array.from(byId.values())
    .sort((a, b) => a.score - b.score || a.row.id - b.row.id)
    .slice(0, limit);

  const dvPairs: Array<[string, string | null | undefined]> = [];
  for (const { row } of sorted) {
    if (row.juridiction === "qc") {
      dvPairs.push(["FORM_JURI", row.forme_code], ["STAT_IMMAT", row.statut_code]);
    }
  }
  const dv = await loadDomaineValeurForPairs(db, dvPairs);

  const entities = sorted.map(({ row }) => {
    const isQc = row.juridiction === "qc";
    const forme = isQc ? decodeDv(dv, "FORM_JURI", row.forme_code) : row.forme_code;
    const statut = isQc
      ? (decodeDv(dv, "STAT_IMMAT", row.statut_code) ?? row.statut_code)
      : row.statut_code;
    const autresNoms = parseJsonSafe<string[]>(row.autres_noms_appercu, []);
    const flags = Number(row.flags);
    const qcFiche = isQc ? parseJsonSafe<QcFicheCompact>(row.fiche_json, {}) : null;
    const effectiveVille =
      isQc && qcFiche ? resolveQcVille(row.ville, qcFiche) : (row.ville ?? null);

    return {
      jurisdiction: row.juridiction,
      neq: isQc ? row.identifiant_principal : null,
      corporation_number: isQc ? null : row.identifiant_principal,
      bn_ne: row.bn_ne ?? null,
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
    if (qNormFull.length === 0 || !e.is_active) {
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
  const gardes = makeRegistreGardes(hasQc);
  const verifiedAt = snapshots.req ?? snapshots.corp_ca ?? snapshots.rbq ?? "2026-11-15";

  const structured: RegistreSearchEntitiesOutput = {
    query: input.query,
    jurisdiction,
    active_only: activeOnly,
    count: entities.length,
    exact_match_found: exactMatchFound,
    snapshots,
    entities,
    provenance: {
      source:
        "Instantanés ouverts locaux : REQ (CC BY-NC-SA 4.0), RBQ / OPC / RENA (CC BY 4.0), Corporations Canada (OGL-Canada)",
      verified_at: verifiedAt,
    },
    gardes,
  };

  const lines = entities.map((e) => {
    const idLabel =
      e.jurisdiction === "qc"
        ? `NEQ ${e.neq}`
        : `Soc. féd. ${e.corporation_number}${e.bn_ne ? ` (NE ${e.bn_ne})` : ""}`;
    const badges: string[] = [];
    if (e.has_rbq_licence) badges.push("RBQ active");
    if (e.has_opc_permit) badges.push("Permis OPC");
    if (e.in_rena) badges.push("INSCRITE AU RENA");
    if (e.faillite_declaree) badges.push("Faillite déclarée");
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
  ].filter((x): x is readonly ["neq" | "corporation_number" | "bn_ne", string] => x !== null);

  if (provided.length !== 1) {
    return {
      ok: false,
      text: "Paramètres invalides : fournir exactement l'un des trois identifiants (`neq`, `corporation_number` ou `bn_ne`).",
    };
  }

  const [lookupBy, rawVal] = provided[0]!;
  const cleanDigits = rawVal.replace(/[\s-]/g, "");

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

  const snapshots = await loadMetaSnapshots(db);

  let qcRow: RawEntiteRow | null = null;
  let caRow: RawEntiteRow | null = null;

  if (lookupBy === "neq") {
    qcRow = await db
      .prepare(
        `SELECT id, juridiction, identifiant_principal, bn_ne, is_active, nom_officiel,
                nom_recherche, autres_noms_appercu, forme_code, statut_code,
                date_constitution, ville, flags, fiche_json
           FROM entites
          WHERE juridiction = 'qc' AND identifiant_principal = ?
          LIMIT 1`,
      )
      .bind(cleanDigits)
      .first<RawEntiteRow>();
  } else if (lookupBy === "corporation_number") {
    const rawTrim = rawVal.trim();
    const stripped = rawTrim.replace(/[\s-]+/g, "");
    const cleanCorp = stripped.replace(/^0+(?=\d)/, "");
    caRow =
      (await db
        .prepare(
          `SELECT id, juridiction, identifiant_principal, bn_ne, is_active, nom_officiel,
                  nom_recherche, autres_noms_appercu, forme_code, statut_code,
                  date_constitution, ville, flags, fiche_json
             FROM entites
            WHERE juridiction = 'ca' AND identifiant_principal IN (?, ?, ?)
            LIMIT 1`,
        )
        .bind(rawTrim, stripped, cleanCorp)
        .first<RawEntiteRow>()) ?? null;
  } else {
    caRow = await db
      .prepare(
        `SELECT id, juridiction, identifiant_principal, bn_ne, is_active, nom_officiel,
                nom_recherche, autres_noms_appercu, forme_code, statut_code,
                date_constitution, ville, flags, fiche_json
           FROM entites
          WHERE juridiction = 'ca' AND bn_ne = ?
          ORDER BY is_active DESC, id ASC
          LIMIT 1`,
      )
      .bind(cleanDigits)
      .first<RawEntiteRow>();
  }

  // Cas où un NEQ n'est pas dans entites (p. ex. req.zip non chargé) mais figure dans RBQ/OPC/RENA
  let rbqRows: Array<{ numero_licence: string; payload_json: string }> = [];
  let opcRows: Array<{ numero_permis: string; payload_json: string }> = [];
  let renaRows: Array<{ nom_entreprise: string; payload_json: string }> = [];

  if (lookupBy === "neq") {
    const [rbqRes, opcRes, renaRes] = await db.batch([
      db
        .prepare("SELECT numero_licence, payload_json FROM rbq_licences WHERE neq = ?")
        .bind(cleanDigits),
      db
        .prepare("SELECT numero_permis, payload_json FROM opc_permis WHERE neq = ?")
        .bind(cleanDigits),
      db
        .prepare("SELECT nom_entreprise, payload_json FROM rena_inscriptions WHERE neq = ?")
        .bind(cleanDigits),
    ]);
    rbqRows = (rbqRes?.results ?? []) as Array<{ numero_licence: string; payload_json: string }>;
    opcRows = (opcRes?.results ?? []) as Array<{ numero_permis: string; payload_json: string }>;
    renaRows = (renaRes?.results ?? []) as Array<{ nom_entreprise: string; payload_json: string }>;
  }

  if (!qcRow && !caRow && rbqRows.length === 0 && opcRows.length === 0 && renaRows.length === 0) {
    return {
      ok: false,
      text: `Aucune entité trouvée pour ${lookupBy}=« ${rawVal} » dans les instantanés locaux (${Object.keys(snapshots).join(", ") || "aucune source"}).`,
    };
  }

  let quebec: z.infer<typeof ProfilQuebecSchema> | null = null;
  if (qcRow || rbqRows.length > 0 || opcRows.length > 0 || renaRows.length > 0) {
    const f = parseJsonSafe<QcFicheCompact>(qcRow?.fiche_json ?? null, {});
    const dispenseAdresse = f.da === 1;
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
      `Entité NEQ ${cleanDigits}`;

    quebec = {
      neq: cleanDigits,
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
      adresse_siege: {
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

  const gardes = makeRegistreGardes(Boolean(quebec && qcRow));
  const verifiedAt = snapshots.req ?? snapshots.corp_ca ?? snapshots.rbq ?? "2026-11-15";

  const structured: RegistreGetEntityOutput = {
    lookup_by: lookupBy,
    lookup_value: rawVal,
    snapshots,
    quebec,
    federal,
    provenance: {
      source:
        "Instantanés ouverts locaux : REQ (CC BY-NC-SA 4.0), RBQ / OPC / RENA (CC BY 4.0), Corporations Canada (OGL-Canada)",
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
      `Siège déclaré : ${[federal.adresse_siege.rue, federal.adresse_siege.ville, federal.adresse_siege.province, federal.adresse_siege.code_postal].filter(Boolean).join(", ") || "Non déclaré"}`,
      `Administrateurs (min–max statutaire) : ${federal.administrateurs.min ?? "n/d"} à ${federal.administrateurs.max ?? "n/d"}`,
    );
  }

  sections.push("", "Gardes :", ...gardes.map((g) => `- [${g.code}] ${g.message}`));

  return { ok: true, structured, text: sections.join("\n") };
}
