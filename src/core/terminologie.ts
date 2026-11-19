import { z } from "zod";
import { type Garde, GardeSchema, makeGarde, ProvenanceSchema } from "./gardes.js";

function expandLigatures(input: string): string {
  return input
    .replace(/Œ/g, "OE")
    .replace(/œ/g, "oe")
    .replace(/Æ/g, "AE")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss");
}

function expandLigatureFtsTokenVariants(tok: string): string[] {
  const out = new Set<string>([tok]);
  const lower = tok.toLowerCase();
  if (lower.includes("oe")) out.add(lower.replace(/oe/g, "œ"));
  if (lower.includes("ae")) out.add(lower.replace(/ae/g, "æ"));
  if (lower.includes("œ")) out.add(lower.replace(/œ/g, "oe"));
  if (lower.includes("æ")) out.add(lower.replace(/æ/g, "ae"));
  return Array.from(out);
}

export function normalizeFold(input: string): string {
  return expandLigatures(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const INVARIABLE_WORDS = new Set([
  "frais",
  "depens",
  "recours",
  "avis",
  "proces",
  "succes",
  "exces",
  "acces",
  "deces",
  "legs",
  "corps",
  "temps",
  "tiers",
  "status",
  "corpus",
  "onus",
  "nexus",
  "situs",
  "vires",
  "habeas",
  "mandamus",
  "plus",
  "moins",
  "vers",
  "dans",
  "sans",
  "sous",
  "hors",
  "des",
  "les",
  "ces",
  "nos",
  "vos",
  "aux",
]);

function singularizeFoldedTokenVariants(
  tok: string,
  lang: "fr" | "en" | "auto" = "auto",
): string[] {
  const t = tok.toLowerCase();
  const out = new Set<string>([tok]);
  if (t.length < 4 || INVARIABLE_WORDS.has(t) || /^\d/.test(t)) {
    return Array.from(out);
  }
  if (lang !== "en") {
    if (t === "baux") out.add("bail");
    else if (t.endsWith("eaux") && t.length >= 6) out.add(tok.slice(0, -1));
    else if (t.endsWith("aux") && t.length >= 5) out.add(`${tok.slice(0, -3)}al`);
  }
  if (lang !== "fr") {
    if (/[^aeiou]ies$/i.test(t) && t.length >= 5) out.add(`${tok.slice(0, -3)}y`);
    if (/(?:ches|shes|xes|zes|sses)$/i.test(t) && t.length >= 5) out.add(tok.slice(0, -2));
  }
  if (t.endsWith("s") && !/(?:ss|us|is|os|as)$/i.test(t)) {
    out.add(tok.slice(0, -1));
  }
  return Array.from(out).filter((v) => v.length >= 2);
}

function buildNormalizedQueryVariants(qNorm: string, lang: "fr" | "en" | "auto"): string[] {
  const words = qNorm.split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const primarySingular = words
    .map((w) => {
      const vars = singularizeFoldedTokenVariants(w, lang);
      // En anglais ou auto, préférer -y pour -ies, sinon le premier variant singulier s'il existe
      return vars.length > 1 ? vars[1]! : vars[0]!;
    })
    .join(" ");
  const lastWordSingular =
    words.length >= 2
      ? [
          ...words.slice(0, -1),
          singularizeFoldedTokenVariants(words[words.length - 1]!, lang)[1] ??
            words[words.length - 1]!,
        ].join(" ")
      : primarySingular;
  return Array.from(
    new Set([qNorm, primarySingular, lastWordSingular].filter((s) => s.length >= 2)),
  );
}

export function extractSafeFtsTokens(input: string): string[] {
  const normalized = input.replace(/[\u2018\u2019\u02bc]/g, " ").normalize("NFC");
  const matches = normalized.match(/[\p{L}\p{N}]+/gu);
  return matches ? matches.filter((t) => t.length > 0).slice(0, 16) : [];
}

export function buildFtsPhraseQuery(input: string): string | null {
  const tokens = extractSafeFtsTokens(input).map((t) => t.replace(/"/g, ""));
  if (tokens.length === 0) return null;
  let phrases: string[][] = [[]];
  let expandedCount = 0;
  for (const tok of tokens) {
    const vars = expandedCount < 3 ? expandLigatureFtsTokenVariants(tok) : [tok];
    if (vars.length > 1) expandedCount += 1;
    const next: string[][] = [];
    for (const prefix of phrases) {
      for (const v of vars) {
        next.push([...prefix, v]);
      }
    }
    phrases = next;
  }
  const uniquePhrases = Array.from(new Set(phrases.map((p) => `"${p.join(" ")}"`)));
  return uniquePhrases.join(" OR ");
}

export function buildFtsAndPrefixQuery(
  input: string,
  lang: "fr" | "en" | "auto" = "auto",
): string | null {
  const tokens = extractSafeFtsTokens(input);
  if (tokens.length === 0) return null;
  return tokens
    .map((t) => {
      const clean = t.replace(/"/g, "");
      const folded = normalizeFold(clean);
      const baseVariants = [clean, ...singularizeFoldedTokenVariants(folded, lang)].filter(Boolean);
      const variants = Array.from(
        new Set(baseVariants.flatMap((v) => expandLigatureFtsTokenVariants(v))),
      );
      const clauses = variants.map((v) => (v.length >= 3 ? `"${v}"*` : `"${v}"`));
      return clauses.length === 1 ? clauses[0]! : `(${clauses.join(" OR ")})`;
    })
    .join(" AND ");
}

// ── 1. terminologie_lookup ───────────────────────────────────────────────────

export const TerminologieLookupInputSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      "Terme ou expression juridique à rechercher en français ou en anglais (p. ex. 'hypothèque', 'mortgage', 'originating application', 'cautionnement').",
    ),
  source_lang: z
    .enum(["fr", "en", "auto"])
    .optional()
    .describe(
      "Langue du terme cherché : 'fr', 'en' ou 'auto' (défaut : recherche bilingue simultanée).",
    ),
  domain_filter: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Filtre optionnel sur le domaine juridique (p. ex. 'sûretés', 'obligations', 'procédure', 'biens', 'sociétés', 'bijuridisme').",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Nombre maximal de fiches retournées (1 à 25, défaut 10)."),
});
export type TerminologieLookupInput = z.infer<typeof TerminologieLookupInputSchema>;

export const TermeDeconseilleSchema = z.object({
  terme: z.string(),
  langue: z.string().optional(),
  origine: z.string().optional(),
  motif: z.string(),
});

export const FicheTerminologiqueSchema = z.object({
  id: z.number().int(),
  rang_source: z.number().int().min(1).max(4),
  source_nom: z.string(),
  licence_source: z.string(),
  terme_fr: z.string(),
  synonymes_fr: z.array(z.string()),
  terme_en: z.string(),
  synonymes_en: z.array(z.string()),
  termes_deconseilles: z.array(TermeDeconseilleSchema),
  systeme_juridique: z.string(),
  domaine: z.string(),
  note_ou_definition: z.string(),
  base_legale: z.string().nullable(),
  url_fiche: z.string().nullable(),
  date_verification: z.string(),
});
export type FicheTerminologique = z.infer<typeof FicheTerminologiqueSchema>;

export const TerminologieLookupOutputSchema = z.object({
  query: z.string(),
  source_lang: z.enum(["fr", "en", "auto"]),
  count: z.number().int(),
  fiches: z.array(FicheTerminologiqueSchema),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type TerminologieLookupOutput = z.infer<typeof TerminologieLookupOutputSchema>;

interface RawFicheRow {
  id: number;
  rang_source: number;
  source_nom: string;
  licence_source: string;
  terme_fr: string;
  terme_en: string;
  terme_fr_norm: string;
  terme_en_norm: string;
  synonymes_fr_json: string;
  synonymes_en_json: string;
  termes_deconseilles_json: string;
  systeme_juridique: string;
  domaine: string;
  note_ou_definition: string;
  base_legale: string | null;
  url_fiche: string | null;
  date_verification: string;
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function mapFicheRow(r: RawFicheRow): FicheTerminologique {
  return {
    id: Number(r.id),
    rang_source: Number(r.rang_source),
    source_nom: r.source_nom,
    licence_source: r.licence_source,
    terme_fr: r.terme_fr,
    synonymes_fr: parseJsonArray<string>(r.synonymes_fr_json),
    terme_en: r.terme_en,
    synonymes_en: parseJsonArray<string>(r.synonymes_en_json),
    termes_deconseilles: parseJsonArray<z.infer<typeof TermeDeconseilleSchema>>(
      r.termes_deconseilles_json,
    ),
    systeme_juridique: r.systeme_juridique,
    domaine: r.domaine,
    note_ou_definition: r.note_ou_definition,
    base_legale: r.base_legale ?? null,
    url_fiche: r.url_fiche ?? null,
    date_verification: r.date_verification,
  };
}

export async function terminologieLookup(
  db: D1Database,
  input: TerminologieLookupInput,
): Promise<{ structured: TerminologieLookupOutput; text: string }> {
  const sourceLang = input.source_lang ?? "auto";
  const limit = input.limit ?? 10;
  const qNorm = normalizeFold(input.query);
  if (!qNorm) {
    throw new Error("La requête terminologique ne contient aucun caractère alphanumérique valide.");
  }
  const domNorm = input.domain_filter ? normalizeFold(input.domain_filter) : null;

  const byId = new Map<number, { row: RawFicheRow; exactTier: number }>();

  // 1) Correspondances exactes sur termes normalisés (incluant la lemmatisation singulière régulière)
  const qVariants = buildNormalizedQueryVariants(qNorm, sourceLang);
  const qVariantSet = new Set(qVariants);
  const sqlVariants = Array.from(
    new Set([
      ...qVariants,
      ...qVariants
        .filter((v) => v.includes("oe") || v.includes("ae"))
        .map((v) => v.replace(/oe/g, " ").replace(/ae/g, " ").replace(/\s+/g, " ").trim())
        .filter((v) => v.length >= 2),
    ]),
  );
  const inPlaceholders = sqlVariants.map(() => "?").join(", ");
  const exactWhere =
    sourceLang === "fr"
      ? `terme_fr_norm IN (${inPlaceholders})`
      : sourceLang === "en"
        ? `terme_en_norm IN (${inPlaceholders})`
        : `(terme_fr_norm IN (${inPlaceholders}) OR terme_en_norm IN (${inPlaceholders}))`;
  const exactParams = sourceLang === "auto" ? [...sqlVariants, ...sqlVariants] : [...sqlVariants];
  const exactRes = await db
    .prepare(
      `SELECT id, rang_source, source_nom, licence_source, terme_fr, terme_en,
              terme_fr_norm, terme_en_norm, synonymes_fr_json, synonymes_en_json,
              termes_deconseilles_json, systeme_juridique, domaine,
              note_ou_definition, base_legale, url_fiche, date_verification
         FROM fiches_terminologiques
        WHERE ${exactWhere}
        ORDER BY rang_source ASC, id ASC
        LIMIT 30`,
    )
    .bind(...exactParams)
    .all<RawFicheRow>();

  for (const r of exactRes.results) {
    const rowFrNorm = normalizeFold(r.terme_fr);
    const rowEnNorm = normalizeFold(r.terme_en);
    const matchesExact =
      sourceLang === "fr"
        ? qVariantSet.has(rowFrNorm)
        : sourceLang === "en"
          ? qVariantSet.has(rowEnNorm)
          : qVariantSet.has(rowFrNorm) || qVariantSet.has(rowEnNorm);
    if (matchesExact) {
      byId.set(Number(r.id), { row: r, exactTier: 0 });
    }
  }

  // 2) Recherche plein texte FTS5 (incluant synonymes, pluriels et faux amis déconseillés)
  const ftsQuery = buildFtsAndPrefixQuery(input.query, sourceLang);
  if (ftsQuery) {
    const ftsSelectSql = `SELECT t.id, t.rang_source, t.source_nom, t.licence_source, t.terme_fr, t.terme_en,
                t.terme_fr_norm, t.terme_en_norm, t.synonymes_fr_json, t.synonymes_en_json,
                t.termes_deconseilles_json, t.systeme_juridique, t.domaine,
                t.note_ou_definition, t.base_legale, t.url_fiche, t.date_verification
           FROM fiches_fts f
           JOIN fiches_terminologiques t ON t.id = f.rowid
          WHERE fiches_fts MATCH ?
          ORDER BY t.rang_source ASC, bm25(fiches_fts) ASC
          LIMIT 80`;
    const domFts = input.domain_filter ? buildFtsAndPrefixQuery(input.domain_filter, "auto") : null;
    let ftsRows = (
      await db
        .prepare(ftsSelectSql)
        .bind(domFts ? `(${ftsQuery}) AND {domaine} : (${domFts})` : ftsQuery)
        .all<RawFicheRow>()
    ).results;
    if (domFts && ftsRows.length === 0) {
      ftsRows = (await db.prepare(ftsSelectSql).bind(ftsQuery).all<RawFicheRow>()).results;
    }

    for (const r of ftsRows) {
      const id = Number(r.id);
      if (!byId.has(id)) {
        const rowFrNorm = normalizeFold(r.terme_fr);
        const rowEnNorm = normalizeFold(r.terme_en);
        const decList = parseJsonArray<z.infer<typeof TermeDeconseilleSchema>>(
          r.termes_deconseilles_json,
        );
        const synFr = parseJsonArray<string>(r.synonymes_fr_json);
        const synEn = parseJsonArray<string>(r.synonymes_en_json);
        const matchesVariant = (s: string) => qVariantSet.has(normalizeFold(s));
        const isHeadwordExact =
          sourceLang === "fr"
            ? qVariantSet.has(rowFrNorm)
            : sourceLang === "en"
              ? qVariantSet.has(rowEnNorm)
              : qVariantSet.has(rowFrNorm) || qVariantSet.has(rowEnNorm);
        const isDeconseilleExact = decList.some((d) => matchesVariant(d.terme));
        const isSynExact =
          sourceLang === "fr"
            ? synFr.some(matchesVariant)
            : sourceLang === "en"
              ? synEn.some(matchesVariant)
              : synFr.some(matchesVariant) || synEn.some(matchesVariant);
        const isLangMatch =
          sourceLang === "fr"
            ? qVariants.some((v) => rowFrNorm.includes(v))
            : sourceLang === "en"
              ? qVariants.some((v) => rowEnNorm.includes(v))
              : qVariants.some((v) => rowFrNorm.includes(v) || rowEnNorm.includes(v));
        const tier =
          isHeadwordExact || (r.rang_source === 1 && (isDeconseilleExact || isSynExact))
            ? 0
            : isSynExact || isDeconseilleExact
              ? 1
              : isLangMatch
                ? 2
                : 3;
        byId.set(id, { row: r, exactTier: tier });
      }
    }
  }

  let candidates = Array.from(byId.values());
  if (domNorm) {
    candidates = candidates.filter((c) => normalizeFold(c.row.domaine).includes(domNorm));
  }

  candidates.sort((a, b) => {
    if (a.exactTier !== b.exactTier) return a.exactTier - b.exactTier;
    if (a.row.rang_source !== b.row.rang_source) return a.row.rang_source - b.row.rang_source;
    return a.row.id - b.row.id;
  });

  const fiches = candidates.slice(0, limit).map((c) => mapFicheRow(c.row));

  const gardes: Garde[] = [makeGarde("TERMINOLOGIE_AIDE_REDACTION_NON_NORMATIVE")];
  if (fiches.some((f) => f.rang_source === 4)) {
    gardes.push(makeGarde("LICENCE_DONNEES_OUVERTES_NC_SA"));
  }

  const metaRow = await db
    .prepare("SELECT MAX(version_date) AS v FROM meta_sources")
    .first<{ v: string | null }>();
  const verifiedAt = metaRow?.v ?? "2026-11-15";

  const structured: TerminologieLookupOutput = {
    query: input.query,
    source_lang: sourceLang,
    count: fiches.length,
    fiches,
    provenance: {
      source:
        "Glossaire curé QC (rang 1), Concordancier LégisQuébec / Justice Canada (rang 2), TERMIUM Plus® OGL-Canada (rang 3), OQLF GDT CC BY-NC-SA 4.0 (rang 4)",
      verified_at: verifiedAt,
    },
    gardes,
  };

  const lines = fiches.map((f) => {
    const dec =
      f.termes_deconseilles.length > 0
        ? `\n  À éviter : ${f.termes_deconseilles.map((d) => `« ${d.terme} » (${d.motif})`).join(" ; ")}`
        : "";
    const base = f.base_legale ? ` — ${f.base_legale}` : "";
    const url = f.url_fiche ? `\n  Fiche : ${f.url_fiche}` : "";
    const note = f.note_ou_definition ? `\n  Note : ${f.note_ou_definition}` : "";
    return `- [Rang ${f.rang_source} · ${f.systeme_juridique} · ${f.domaine}] FR « ${f.terme_fr} » ↔ EN « ${f.terme_en} »${base}${dec}${note}${url}`;
  });

  const text = [
    `Recherche terminologique juridique pour « ${input.query} » (${fiches.length} fiche(s))`,
    ...(lines.length > 0 ? lines : ["Aucune fiche correspondante trouvée dans le référentiel."]),
    "",
    "Gardes :",
    ...gardes.map((g) => `- [${g.code}] ${g.message}`),
    `\nSource : ${structured.provenance.source} (vérifié le ${verifiedAt})`,
  ].join("\n");

  return { structured, text };
}

// ── 2. termino_attestations ─────────────────────────────────────────────

export const TerminologieAttestationsInputSchema = z.strictObject({
  term: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .describe(
      "Terme ou expression exacte dont on veut mesurer et attester l'emploi dans les lois consolidées (p. ex. 'hypothec', 'mortgage', 'suretyship', 'demande introductive d\\'instance').",
    ),
  lang: z
    .enum(["fr", "en"])
    .describe(
      "Langue dans laquelle rechercher le terme exact dans le corpus législatif ('fr' ou 'en').",
    ),
  law_filter: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe(
      "Filtre optionnel par identifiant ou référence de loi (p. ex. 'ccq', 'cpc', 'ca-i-21', 'S-31.1').",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Nombre maximal d'extraits bilingues FR/EN alignés à retourner (1 à 20, défaut 10)."),
});
export type TerminologieAttestationsInput = z.infer<typeof TerminologieAttestationsInputSchema>;

export const AttestationParLoiSchema = z.object({
  law_id: z.string(),
  official_cite: z.string(),
  law_title_fr: z.string(),
  law_title_en: z.string(),
  jurisdiction: z.string(),
  article_count: z.number().int(),
});

export const AttestationExtraitSchema = z.object({
  law_id: z.string(),
  official_cite: z.string(),
  article_number: z.string(),
  snippet_fr: z.string(),
  snippet_en: z.string(),
  consol_date: z.string().nullable(),
});

export const TerminologieAttestationsOutputSchema = z.object({
  term: z.string(),
  lang: z.enum(["fr", "en"]),
  law_filter: z.string().nullable(),
  total_matching_articles: z.number().int(),
  by_law: z.array(AttestationParLoiSchema),
  attestations: z.array(AttestationExtraitSchema),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type TerminologieAttestationsOutput = z.infer<typeof TerminologieAttestationsOutputSchema>;

function normalizeQuotesAndSpaces(s: string): string {
  return s.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\s+/g, " ");
}

function buildExactPhraseRegex(term: string): RegExp {
  const normTerm = expandLigatures(normalizeQuotesAndSpaces(term.trim()));
  const escaped = normTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flexQuotesAndLigatures = escaped
    .replace(/'/g, "['\\u2018\\u2019\\u02bc]")
    .replace(/-/g, "[-\\u2010\\u2011]")
    .replace(/oe/gi, "(?:oe|œ|Œ)")
    .replace(/ae/gi, "(?:ae|æ|Æ)");
  const startsWord = /^[\p{L}\p{N}]/u.test(term.trim());
  const endsWord = /[\p{L}\p{N}]$/u.test(term.trim());
  const pre = startsWord ? "(?<![\\p{L}\\p{N}])" : "";
  const post = endsWord ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(`${pre}${flexQuotesAndLigatures}${post}`, "iu");
}

function extractAroundMatch(text: string, regex: RegExp, maxLen = 300): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const m = regex.exec(clean);
  if (!m || clean.length <= maxLen) {
    return clean.length <= maxLen ? clean : `${clean.slice(0, maxLen - 1)}…`;
  }
  const half = Math.floor((maxLen - m[0].length) / 2);
  const start = Math.max(0, m.index - half);
  const end = Math.min(clean.length, m.index + m[0].length + half);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

interface LoiBilingueRow {
  law_id: string;
  jurisdiction: string;
  name_fr: string;
  name_en: string;
  official_cite: string;
  consol_date_fr: string | null;
  consol_date_en: string | null;
}

const ATTESTATION_CURSOR_PAGE_SIZE = 4_000;

interface LightAttestationCandidateRow {
  id: number;
  law_id: string;
  article_number: string;
  sort_key: number;
  target_text: string;
}

interface VerifiedAttestationRow {
  id: number;
  law_id: string;
  article_number: string;
  sort_key: number;
}

export async function terminologieAttestations(
  db: D1Database,
  input: TerminologieAttestationsInput,
): Promise<{ structured: TerminologieAttestationsOutput; text: string }> {
  const limit = input.limit ?? 10;
  const ftsPhrase = buildFtsPhraseQuery(input.term);
  if (!ftsPhrase) {
    throw new Error("Le terme recherché doit comporter au moins un mot alphanumérique.");
  }

  const ftsTable = input.lang === "fr" ? "articles_fr_fts" : "articles_en_fts";
  const targetCol = input.lang === "fr" ? "text_fr" : "text_en";
  const lawFilter = input.law_filter?.trim() ?? null;

  // Charger les 97 lois une seule fois afin d'éviter toute répétition de métadonnées et tout plafond arbitraire
  let lawRows: LoiBilingueRow[];
  if (!lawFilter) {
    lawRows = (
      await db
        .prepare(
          `SELECT law_id, jurisdiction, name_fr, name_en, official_cite, consol_date_fr, consol_date_en
             FROM lois_bilingues`,
        )
        .all<LoiBilingueRow>()
    ).results;
  } else {
    // 1) Correspondance exacte sur identifiant ou cote officielle (évite p. ex. que 'ccq' tire 'ccq-r.6' ou que 'b-1' tire 'b-1.1')
    lawRows = (
      await db
        .prepare(
          `SELECT law_id, jurisdiction, name_fr, name_en, official_cite, consol_date_fr, consol_date_en
             FROM lois_bilingues
            WHERE LOWER(law_id) = LOWER(?)
               OR LOWER(official_cite) = LOWER(?)
               OR LOWER(COALESCE(official_cite_en, '')) = LOWER(?)
               OR LOWER(official_cite) = LOWER('RLRQ, c. ' || ?)
               OR LOWER(official_cite) = LOWER('L.R.C. (1985), ch. ' || ?)`,
        )
        .bind(lawFilter, lawFilter, lawFilter, lawFilter, lawFilter)
        .all<LoiBilingueRow>()
    ).results;

    // 2) Repli par sous-chaîne échappée si aucun identifiant/cote exact ne correspond
    if (lawRows.length === 0) {
      const escapedLike = `%${lawFilter.replace(/[\\%_]/g, "\\$&")}%`;
      lawRows = (
        await db
          .prepare(
            `SELECT law_id, jurisdiction, name_fr, name_en, official_cite, consol_date_fr, consol_date_en
               FROM lois_bilingues
              WHERE LOWER(official_cite) LIKE LOWER(?) ESCAPE '\\'
                 OR LOWER(COALESCE(official_cite_en, '')) LIKE LOWER(?) ESCAPE '\\'
                 OR LOWER(name_fr) LIKE LOWER(?) ESCAPE '\\'
                 OR LOWER(name_en) LIKE LOWER(?) ESCAPE '\\'`,
          )
          .bind(escapedLike, escapedLike, escapedLike, escapedLike)
          .all<LoiBilingueRow>()
      ).results;
    }
  }
  const lawMap = new Map<string, LoiBilingueRow>(lawRows.map((l) => [l.law_id, l]));

  const verifiedRows: VerifiedAttestationRow[] = [];
  const phraseRegex = buildExactPhraseRegex(input.term);

  if (!lawFilter || lawMap.size > 0) {
    const allowedLawIds = lawFilter ? Array.from(lawMap.keys()) : [];
    const pushLawInClause = lawFilter !== null && allowedLawIds.length <= 50;
    const lawInClause = pushLawInClause
      ? ` AND a.law_id IN (${allowedLawIds.map(() => "?").join(",")})`
      : "";
    const pageSql = `
      SELECT a.id, a.law_id, a.article_number, a.sort_key, a.${targetCol} AS target_text
        FROM ${ftsTable} f
        JOIN articles_bilingues a ON a.id = f.rowid
       WHERE ${ftsTable} MATCH ?
         AND f.rowid > ?
         AND a.id > ?${lawInClause}
       ORDER BY f.rowid ASC
       LIMIT ${ATTESTATION_CURSOR_PAGE_SIZE}
    `;

    let lastId = -1;
    while (true) {
      const pageParams: unknown[] = pushLawInClause
        ? [ftsPhrase, lastId, lastId, ...allowedLawIds]
        : [ftsPhrase, lastId, lastId];
      const res = await db
        .prepare(pageSql)
        .bind(...pageParams)
        .all<LightAttestationCandidateRow>();

      const batch = res.results;
      if (batch.length === 0) {
        break;
      }

      for (const r of batch) {
        if (lawMap.has(r.law_id) && phraseRegex.test(r.target_text)) {
          verifiedRows.push({
            id: Number(r.id),
            law_id: r.law_id,
            article_number: r.article_number,
            sort_key: Number(r.sort_key),
          });
        }
      }

      const nextLastId = Number(batch[batch.length - 1]!.id);
      if (batch.length < ATTESTATION_CURSOR_PAGE_SIZE || nextLastId <= lastId) {
        break;
      }
      lastId = nextLastId;
    }
  }

  const lawPriority = (lawId: string): number =>
    lawId === "ccq" ? 0 : lawId === "cpc" ? 1 : lawId === "ca-i-21" ? 2 : 3;

  verifiedRows.sort((a, b) => {
    const pa = lawPriority(a.law_id);
    const pb = lawPriority(b.law_id);
    if (pa !== pb) return pa - pb;
    if (a.law_id !== b.law_id) return a.law_id.localeCompare(b.law_id);
    return Number(a.sort_key) - Number(b.sort_key);
  });

  const lawCounts = new Map<string, z.infer<typeof AttestationParLoiSchema>>();
  for (const r of verifiedRows) {
    const cur = lawCounts.get(r.law_id);
    if (cur) {
      cur.article_count += 1;
    } else {
      const l = lawMap.get(r.law_id)!;
      lawCounts.set(r.law_id, {
        law_id: r.law_id,
        official_cite: l.official_cite,
        law_title_fr: l.name_fr,
        law_title_en: l.name_en,
        jurisdiction: l.jurisdiction,
        article_count: 1,
      });
    }
  }

  const byLaw = Array.from(lawCounts.values()).sort(
    (a, b) => b.article_count - a.article_count || a.law_id.localeCompare(b.law_id),
  );

  // Ne rapatrier les deux colonnes complètes `text_fr` et `text_en` que pour les `limit` (<= 20) extraits retenus
  const topSlice = verifiedRows.slice(0, limit);
  const bilingualById = new Map<number, { text_fr: string; text_en: string }>();
  if (topSlice.length > 0) {
    const ids = topSlice.map((r) => Number(r.id));
    const biRes = await db
      .prepare(
        `SELECT id, text_fr, text_en
           FROM articles_bilingues
          WHERE id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(...ids)
      .all<{ id: number; text_fr: string; text_en: string }>();
    for (const b of biRes.results) {
      bilingualById.set(Number(b.id), { text_fr: b.text_fr, text_en: b.text_en });
    }
  }

  const attestations = topSlice.map((r) => {
    const l = lawMap.get(r.law_id)!;
    const bi = bilingualById.get(Number(r.id)) ?? { text_fr: "", text_en: "" };
    return {
      law_id: r.law_id,
      official_cite: l.official_cite,
      article_number: r.article_number,
      snippet_fr:
        input.lang === "fr"
          ? extractAroundMatch(bi.text_fr, phraseRegex, 300)
          : bi.text_fr.length <= 300
            ? bi.text_fr
            : `${bi.text_fr.slice(0, 299)}…`,
      snippet_en:
        input.lang === "en"
          ? extractAroundMatch(bi.text_en, phraseRegex, 300)
          : bi.text_en.length <= 300
            ? bi.text_en
            : `${bi.text_en.slice(0, 299)}…`,
      consol_date:
        (input.lang === "fr" ? l.consol_date_fr : l.consol_date_en) ?? l.consol_date_fr ?? null,
    };
  });

  const metaRow = await db
    .prepare("SELECT version_date FROM meta_sources WHERE source_key = 'concordancier_legislatif'")
    .first<{ version_date: string }>();
  const verifiedAt = metaRow?.version_date ?? "2026-11-15";

  const gardes: Garde[] = [makeGarde("TERMINOLOGIE_AIDE_REDACTION_NON_NORMATIVE")];

  const structured: TerminologieAttestationsOutput = {
    term: input.term,
    lang: input.lang,
    law_filter: lawFilter,
    total_matching_articles: verifiedRows.length,
    by_law: byLaw,
    attestations,
    provenance: {
      source:
        "Concordancier législatif bilingue dérivé du corpus consolidé (LégisQuébec / Justice Canada)",
      verified_at: verifiedAt,
    },
    gardes,
  };

  const lawSummary =
    byLaw.length > 0
      ? byLaw
          .slice(0, 10)
          .map((l) => `- ${l.law_id} (${l.official_cite}) : ${l.article_count} article(s)`)
          .join("\n")
      : "Aucune occurrence exacte repérée dans ce périmètre législatif.";

  const snippetLines = attestations.map(
    (a) =>
      `- ${a.official_cite}, art. ${a.article_number} (consol. ${a.consol_date ?? "n/d"})\n  FR : ${a.snippet_fr}\n  EN : ${a.snippet_en}`,
  );

  const text = [
    `Attestations statutaires pour « ${input.term} » (lang=${input.lang}${lawFilter ? `, filtre=${lawFilter}` : ""}) : ${verifiedRows.length} article(s)`,
    "",
    "Répartition par loi :",
    lawSummary,
    ...(snippetLines.length > 0 ? ["", "Extraits bilingues alignés :", ...snippetLines] : []),
    "",
    "Gardes :",
    ...gardes.map((g) => `- [${g.code}] ${g.message}`),
    `\nSource : ${structured.provenance.source} (extrait le ${verifiedAt})`,
  ].join("\n");

  return { structured, text };
}

// ── 3. terminologie_scan ────────────────────────────────────────────────

export const TerminologieScanTextInputSchema = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(32_000)
    .describe(
      "Extrait de projet d'acte, contrat, correspondance ou note à contrôler (maximum 32 000 caractères). L'outil signale les contaminations sans jamais réécrire le texte.",
    ),
  lang: z
    .enum(["fr", "en"])
    .describe(
      "Langue du texte analysé : 'fr' (détecte francismes de France, anglicismes et archaïsmes) ou 'en' (détecte les faux amis de common law en anglais civiliste québécois).",
    ),
  context_system: z
    .enum(["droit_civil_qc", "bijuridique_federal"])
    .optional()
    .describe(
      "Cadre juridique visé : 'droit_civil_qc' (défaut, droit privé et procédure du Québec) ou 'bijuridique_federal' (tolère un terme de common law s'il est dûment jumelé à son doublet civiliste à proximité).",
    ),
});
export type TerminologieScanTextInput = z.infer<typeof TerminologieScanTextInputSchema>;

export const ScanOccurrenceSchema = z.object({
  offset_start: z.number().int(),
  offset_end: z.number().int(),
  matched_text: z.string(),
  snippet: z.string(),
  risk_category: z.enum([
    "francisme_france",
    "anglicisme_ou_common_law",
    "archaisme_qc",
    "omission_bijuridique",
  ]),
  reason_fr: z.string(),
  suggested_replacement: z.string(),
  legal_basis: z.string(),
});
export type ScanOccurrence = z.infer<typeof ScanOccurrenceSchema>;

export const TerminologieScanTextOutputSchema = z.object({
  lang: z.enum(["fr", "en"]),
  context_system: z.enum(["droit_civil_qc", "bijuridique_federal"]),
  scanned_length: z.number().int(),
  flagged_count: z.number().int(),
  occurrences: z.array(ScanOccurrenceSchema),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type TerminologieScanTextOutput = z.infer<typeof TerminologieScanTextOutputSchema>;

interface RawRegleRow {
  code_regle: string;
  lang: string;
  pattern_term: string;
  case_sensitive: number;
  risk_category:
    | "francisme_france"
    | "anglicisme_ou_common_law"
    | "archaisme_qc"
    | "omission_bijuridique";
  allowed_in_bijural_if: string | null;
  reason_fr: string;
  suggested_replacement: string;
  legal_basis: string;
}

interface SupplementalRegleRow extends RawRegleRow {
  overrideDb?: boolean;
}

const NON_INFLECTED_SCAN_TOKENS = new Set([
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "un",
  "une",
  "et",
  "ou",
  "en",
  "au",
  "aux",
  "pour",
  "par",
  "sur",
  "dans",
  "sous",
  "sans",
  "avec",
  "ne",
  "pas",
  "plus",
  "dont",
  "devant",
  "entre",
  "vers",
  "chez",
  "contre",
  "of",
  "in",
  "on",
  "to",
  "for",
  "by",
  "at",
  "and",
  "or",
  "the",
  "a",
  "an",
  "not",
  "with",
  "under",
  "from",
  "into",
  "before",
  "after",
  "upon",
  "ab",
  "initio",
  "quantum",
  "meruit",
  "cautio",
  "judicatum",
  "solvi",
  "vu",
  "ces",
  "aid",
  "will",
  "god",
]);

const EN_COLLIDING_IN_FR = new Set(["tort", "consideration", "briefing"]);

const SUPPLEMENTAL_SCAN_RULES: readonly SupplementalRegleRow[] = [
  {
    code_regle: "sup-en-jointly-severally",
    lang: "en",
    pattern_term: "jointly and severally",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: "solidar",
    reason_fr:
      "Calque de common law (« jointly and severally ») ; en droit civil québécois, la solidarité s'exprime par « solidarily » / « solidary obligation ».",
    suggested_replacement: "solidarily",
    legal_basis: "Art. 1523 C.c.Q.",
  },
  {
    code_regle: "sup-en-hold-harmless-indemnify",
    lang: "en",
    pattern_term: "hold harmless and indemnify",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Formule redondante de common law ; en rédaction civiliste québécoise en anglais, privilégier « indemnify and take up the defence ».",
    suggested_replacement: "indemnify and take up the defence",
    legal_basis: "Art. 1434 C.c.Q. ; art. 184 C.p.c.",
  },
  {
    code_regle: "sup-en-indemnify-hold-harmless",
    lang: "en",
    pattern_term: "indemnify and hold harmless",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Formule redondante de common law ; en rédaction civiliste québécoise en anglais, privilégier « indemnify and take up the defence ».",
    suggested_replacement: "indemnify and take up the defence",
    legal_basis: "Art. 1434 C.c.Q. ; art. 184 C.p.c.",
  },
  {
    code_regle: "sup-en-hold-harmless",
    lang: "en",
    pattern_term: "hold harmless",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Formule de common law ; en droit civil québécois, employer « indemnify and take up the defence » (« garantir et prendre fait et cause »).",
    suggested_replacement: "indemnify and take up the defence (garantir et prendre fait et cause)",
    legal_basis: "Art. 1434 C.c.Q. ; art. 184 C.p.c.",
  },
  {
    code_regle: "sup-en-liquidated-damages",
    lang: "en",
    pattern_term: "liquidated damages",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: "penal clause",
    reason_fr:
      "Distinction de common law entre « liquidated damages » et « penalty » inapplicable sous le C.c.Q., qui reconnaît expressément la « penal clause » (« clause pénale », réductible si abusive).",
    suggested_replacement: "penal clause (clause pénale)",
    legal_basis: "Art. 1622–1623 C.c.Q.",
  },
  {
    code_regle: "sup-en-consideration",
    lang: "en",
    pattern_term: "consideration",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Doctrine de common law étrangère au droit civil québécois : le contrat se forme par l'échange de consentements avec cause et objet sans exigence de « consideration » (art. 1385, 1410–1412 C.c.Q.) ; pour la prestation réciproque, employer « prestation » / « counterpart ».",
    suggested_replacement: "cause / prestation (art. 1385, 1410–1412 C.c.Q.)",
    legal_basis: "Art. 1385, 1410–1412 C.c.Q.",
  },
  {
    code_regle: "sup-en-exam-discovery",
    lang: "en",
    pattern_term: "examination for discovery",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Terme procédural des provinces de common law ; la version anglaise officielle du C.p.c. emploie « pre-trial examination ».",
    suggested_replacement: "pre-trial examination",
    legal_basis: "Art. 221 C.p.c.",
  },
  {
    code_regle: "sup-en-prayer-relief",
    lang: "en",
    pattern_term: "prayer for relief",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Formule de common law ; la version anglaise officielle du C.p.c. emploie « conclusions ».",
    suggested_replacement: "conclusions",
    legal_basis: "Art. 99–100 C.p.c.",
  },
  {
    code_regle: "sup-en-estoppel",
    lang: "en",
    pattern_term: "estoppel",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: "fin de non-recevoir",
    reason_fr:
      "Doctrine d'equity de common law étrangère au droit civil québécois ; employer plutôt la fin de non-recevoir fondée sur la bonne foi et l'interdiction de l'abus de droit (art. 6, 7 et 1375 C.c.Q.).",
    suggested_replacement: "fin de non-recevoir (art. 6, 7 et 1375 C.c.Q.)",
    legal_basis: "Art. 6, 7 et 1375 C.c.Q.",
    overrideDb: true,
  },
  {
    code_regle: "sup-fr-estoppel",
    lang: "fr",
    pattern_term: "estoppel",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: "fin de non-recevoir",
    reason_fr:
      "Doctrine d'equity de common law étrangère au droit civil québécois ; employer plutôt la fin de non-recevoir fondée sur la bonne foi et l'interdiction de l'abus de droit (art. 6, 7 et 1375 C.c.Q.).",
    suggested_replacement: "fin de non-recevoir (art. 6, 7 et 1375 C.c.Q.)",
    legal_basis: "Art. 6, 7 et 1375 C.c.Q.",
    overrideDb: true,
  },
  {
    code_regle: "sup-fr-specific-performance",
    lang: "fr",
    pattern_term: "specific performance",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Emprunt à l'anglais dans un texte français ; en droit civil québécois, employer « exécution en nature » (droit primaire du créancier, art. 1590 et 1601 C.c.Q.).",
    suggested_replacement: "exécution en nature",
    legal_basis: "Art. 1590 et 1601 C.c.Q.",
  },
  {
    code_regle: "sup-fr-punitive-damages",
    lang: "fr",
    pattern_term: "punitive damages",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Emprunt à l'anglais dans un texte français ; employer « dommages-intérêts punitifs » (attribués uniquement si la loi le prévoit expressément, art. 1621 C.c.Q.).",
    suggested_replacement: "dommages-intérêts punitifs",
    legal_basis: "Art. 1621 C.c.Q.",
  },
  {
    code_regle: "sup-fr-trustee",
    lang: "fr",
    pattern_term: "trustee",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Emprunt à l'anglais dans un texte français ; selon le contexte, employer « fiduciaire » (art. 1260 C.c.Q.) ou « syndic » (L.F.I.).",
    suggested_replacement: "fiduciaire / syndic",
    legal_basis: "Art. 1260 C.c.Q. ; art. 2 L.F.I.",
  },
  {
    code_regle: "sup-fr-valuable-consideration",
    lang: "fr",
    pattern_term: "valuable consideration",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Emprunt de common law dans un texte français ; en droit civil québécois, le contrat repose sur le consentement, la cause et l'objet (art. 1385, 1410–1412 C.c.Q.).",
    suggested_replacement: "cause / prestation (art. 1385, 1410–1412 C.c.Q.)",
    legal_basis: "Art. 1385, 1410–1412 C.c.Q.",
  },
  {
    code_regle: "sup-fr-nominal-consideration",
    lang: "fr",
    pattern_term: "nominal consideration",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Emprunt de common law dans un texte français ; la « nominal consideration » est sans objet en droit civil québécois (art. 1385 et 1410 C.c.Q.).",
    suggested_replacement: "cause / échange de consentements (art. 1385 C.c.Q.)",
    legal_basis: "Art. 1385 et 1410 C.c.Q.",
  },
  {
    code_regle: "sup-fr-en-refere",
    lang: "fr",
    pattern_term: "en référé",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Institution procédurale française sans équivalent au Québec ; viser l'ordonnance de sauvegarde ou l'injonction interlocutoire provisoire.",
    suggested_replacement: "ordonnance de sauvegarde / injonction interlocutoire provisoire",
    legal_basis: "Art. 49, 509–510 C.p.c.",
  },
  {
    code_regle: "sup-fr-demande-de-refere",
    lang: "fr",
    pattern_term: "demande de référé",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Procédure française inexistante au Québec ; employer « demande d'ordonnance de sauvegarde » ou « demande d'injonction interlocutoire provisoire ».",
    suggested_replacement:
      "demande d'ordonnance de sauvegarde / injonction interlocutoire provisoire",
    legal_basis: "Art. 49, 509–510 C.p.c.",
  },
  {
    code_regle: "sup-fr-refere",
    lang: "fr",
    pattern_term: "référé",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Institution procédurale française (« référé ») inexistante en droit judiciaire québécois ; viser l'ordonnance de sauvegarde (art. 49 C.p.c.) ou l'injonction provisoire (art. 510 C.p.c.).",
    suggested_replacement: "ordonnance de sauvegarde / injonction provisoire",
    legal_basis: "Art. 49, 509–510 C.p.c.",
  },
  {
    code_regle: "sup-fr-juge-referes",
    lang: "fr",
    pattern_term: "juge des référés",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Juridiction française du référé inexistante au Québec ; référer à la Cour supérieure ou au juge siégeant en chambre de pratique.",
    suggested_replacement: "juge de la Cour supérieure (ordonnance de sauvegarde / injonction)",
    legal_basis: "Art. 49, 509–510 C.p.c.",
  },
  {
    code_regle: "sup-fr-defense-et-demande-reconventionnelle",
    lang: "fr",
    pattern_term: "défense et demande reconventionnelle",
    case_sensitive: 0,
    risk_category: "archaisme_qc",
    allowed_in_bijural_if: null,
    reason_fr:
      "Intitulé issu de l'ancien C.p.c. d'avant 2016 : depuis la réforme de 2016, la défense est orale par défaut sauf cas prévus (art. 170 C.p.c.) et la demande reconventionnelle est formée dans les conditions des art. 172 et s. C.p.c.",
    suggested_replacement:
      "défense (art. 170 C.p.c.) / demande reconventionnelle (art. 172 C.p.c.)",
    legal_basis: "Art. 145, 170 et 172 C.p.c.",
  },
  {
    code_regle: "sup-fr-acte-de-comparution",
    lang: "fr",
    pattern_term: "acte de comparution",
    case_sensitive: 0,
    risk_category: "archaisme_qc",
    allowed_in_bijural_if: null,
    reason_fr:
      "Archaïsme procédural d'avant 2016 : l'ancien « acte de comparution » a été remplacé par la « réponse à l'assignation » dans les 15 jours (art. 145 et 147 C.p.c.).",
    suggested_replacement: "réponse à l'assignation",
    legal_basis: "Art. 145 et 147 C.p.c.",
  },
  {
    code_regle: "sup-fr-comparution",
    lang: "fr",
    pattern_term: "comparution",
    case_sensitive: 0,
    risk_category: "archaisme_qc",
    allowed_in_bijural_if: null,
    reason_fr:
      "En procédure civile québécoise depuis 2016, le défendeur produit une « réponse » à l'assignation et non plus une « comparution » (sauf comparution physique d'un témoin ou d'une partie à l'audience).",
    suggested_replacement: "réponse (à l'assignation)",
    legal_basis: "Art. 145 et 147 C.p.c.",
  },
  {
    code_regle: "sup-fr-comparaitre",
    lang: "fr",
    pattern_term: "comparaître",
    case_sensitive: 0,
    risk_category: "archaisme_qc",
    allowed_in_bijural_if: null,
    reason_fr:
      "Archaïsme au sens de constituer avocat ou déposer une comparution écrite : depuis 2016, on « répond à l'assignation » (art. 145 C.p.c.). Ne viser « comparaître » que pour la présence physique d'un témoin ou à l'audience (art. 269 C.p.c.).",
    suggested_replacement: "répondre à l'assignation",
    legal_basis: "Art. 145 et 147 C.p.c.",
  },
  {
    code_regle: "sup-fr-audition-au-merite",
    lang: "fr",
    pattern_term: "audition au mérite",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Anglicisme (« hearing on the merits ») ; au Québec, la version française du C.p.c. emploie « instruction au fond » / « audience au fond ».",
    suggested_replacement: "instruction au fond / audience au fond",
    legal_basis: "Art. 173 et 211 C.p.c.",
  },
  {
    code_regle: "sup-fr-au-merite",
    lang: "fr",
    pattern_term: "au mérite",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Anglicisme judiciaire (« on the merits ») ; en procédure civile québécoise, employer « au fond » ou « sur le fond ».",
    suggested_replacement: "au fond / sur le fond",
    legal_basis: "Art. 173 et 211 C.p.c.",
  },
  {
    code_regle: "sup-fr-loger-recours",
    lang: "fr",
    pattern_term: "loger un appel",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Anglicisme (« to lodge an appeal / application / complaint ») ; en français juridique, on « interjette » un appel et on « dépose » ou « présente » une demande, une plainte ou un grief.",
    suggested_replacement:
      "interjeter appel / déposer ou présenter (une demande, plainte, un grief)",
    legal_basis: "Art. 99, 141, 352 C.p.c. ; OQLF",
  },
  {
    code_regle: "sup-fr-renverser-decision",
    lang: "fr",
    pattern_term: "renverser un jugement",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Anglicisme (« to reverse a judgment / decision ») ; une cour d'appel « infirme », « casse » ou « annule » un jugement ou une décision (ne pas confondre avec « renverser une présomption »).",
    suggested_replacement: "infirmer / casser / annuler (un jugement ou une décision)",
    legal_basis: "Art. 385 C.p.c. ; OQLF",
  },
  {
    code_regle: "sup-fr-appliquer-pour",
    lang: "fr",
    pattern_term: "appliquer pour",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Anglicisme (« to apply for ») ; employer « demander », « solliciter » ou « présenter une demande de ».",
    suggested_replacement: "demander / solliciter / présenter une demande de",
    legal_basis: "Art. 101 C.p.c. ; OQLF",
  },
  {
    code_regle: "sup-fr-charger-frais",
    lang: "fr",
    pattern_term: "charger des frais",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Anglicisme (« to charge fees / costs / interest ») ; employer « facturer », « exiger », « imputer » ou « appliquer » des frais, honoraires ou intérêts.",
    suggested_replacement: "facturer / exiger / imputer / appliquer",
    legal_basis: "OQLF — Banque de dépannage linguistique",
  },
  {
    code_regle: "sup-fr-canceller",
    lang: "fr",
    pattern_term: "canceller",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Anglicisme (« to cancel ») ; selon l'acte juridique visé, employer « annuler », « résilier », « résoudre », « révoquer » ou « radier ».",
    suggested_replacement: "annuler / résilier / résoudre / révoquer",
    legal_basis: "Art. 1416, 1606 C.c.Q. ; OQLF",
  },
  {
    code_regle: "sup-fr-ceduler",
    lang: "fr",
    pattern_term: "céduler",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Anglicisme (« to schedule ») ; en procédure civile et en gestion de dossier, employer « fixer (une date / audience) », « inscrire au rôle » ou « mettre au calendrier ».",
    suggested_replacement: "fixer / inscrire au rôle / mettre au calendrier",
    legal_basis: "Art. 148, 174 C.p.c. ; OQLF",
  },
  {
    code_regle: "sup-fr-suite-a",
    lang: "fr",
    pattern_term: "suite à",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Ellipse administrative fautive (OQLF) : sauf dans « donner suite à », « faire suite à » ou « comme suite à », remplacer « suite à / au / aux » par « à la suite de », « par suite de » ou « après ».",
    suggested_replacement: "à la suite de / comme suite à / par suite de",
    legal_basis: "OQLF — Banque de dépannage linguistique",
  },
  {
    code_regle: "sup-fr-juge-mise-en-etat",
    lang: "fr",
    pattern_term: "juge de la mise en état",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Institution procédurale française ; au Québec, la gestion de l'instance et le protocole de l'instance relèvent des art. 148 et 157 s. C.p.c.",
    suggested_replacement: "protocole de l'instance / gestion d'instance",
    legal_basis: "Art. 148, 157 s. C.p.c.",
  },
  {
    code_regle: "sup-fr-cour-cassation",
    lang: "fr",
    pattern_term: "Cour de cassation",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Juridiction suprême de l'ordre judiciaire français ; au Québec et au Canada, viser la Cour d'appel du Québec ou la Cour suprême du Canada.",
    suggested_replacement: "Cour d'appel du Québec / Cour suprême du Canada",
    legal_basis: "Art. 30 C.p.c.",
  },
  {
    code_regle: "sup-fr-conseil-etat",
    lang: "fr",
    pattern_term: "Conseil d'État",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Juridiction administrative française sans équivalent au Québec ; le contrôle judiciaire relève de la Cour supérieure.",
    suggested_replacement: "pourvoi en contrôle judiciaire devant la Cour supérieure",
    legal_basis: "Art. 34 et 529 C.p.c.",
  },
  {
    code_regle: "sup-fr-commandement-payer",
    lang: "fr",
    pattern_term: "commandement de payer",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Acte d'exécution français ; au Québec, employer la mise en demeure avant jugement ou l'avis d'exécution après jugement.",
    suggested_replacement: "mise en demeure / avis d'exécution",
    legal_basis: "Art. 1594 C.c.Q. ; art. 681 C.p.c.",
  },
  {
    code_regle: "sup-fr-huissier-justice",
    lang: "fr",
    pattern_term: "acte d'huissier de justice",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Terminologie française ; au Québec, la signification par huissier est constatée par procès-verbal de signification.",
    suggested_replacement: "signification par huissier (procès-verbal de signification)",
    legal_basis: "Art. 110 et 119 C.p.c.",
  },
  {
    code_regle: "sup-fr-bref-saisie",
    lang: "fr",
    pattern_term: "bref de saisie",
    case_sensitive: 0,
    risk_category: "archaisme_qc",
    allowed_in_bijural_if: null,
    reason_fr:
      "Archaïsme procédural d'avant le C.p.c. de 2016 ; les brefs d'exécution ont été remplacés par l'avis d'exécution.",
    suggested_replacement: "avis d'exécution",
    legal_basis: "Art. 681 C.p.c.",
  },
  {
    code_regle: "sup-fr-bref-execution",
    lang: "fr",
    pattern_term: "bref d'exécution",
    case_sensitive: 0,
    risk_category: "archaisme_qc",
    allowed_in_bijural_if: null,
    reason_fr: "Archaïsme procédural d'avant le C.p.c. de 2016 ; remplacé par l'avis d'exécution.",
    suggested_replacement: "avis d'exécution",
    legal_basis: "Art. 681 C.p.c.",
  },
  {
    code_regle: "sup-fr-bref-subpoena",
    lang: "fr",
    pattern_term: "bref de subpoena",
    case_sensitive: 0,
    risk_category: "archaisme_qc",
    allowed_in_bijural_if: null,
    reason_fr: "Archaïsme procédural d'avant 2016 ; employer « citation à comparaître ».",
    suggested_replacement: "citation à comparaître",
    legal_basis: "Art. 269 C.p.c.",
  },
  {
    code_regle: "sup-fr-vu-articles",
    lang: "fr",
    pattern_term: "Vu les articles",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Formule de visa à la française ; au Québec, l'acte de procédure énonce directement les faits générateurs du droit sans visas de textes.",
    suggested_replacement: "Énoncer directement les faits générateurs du droit (art. 99 C.p.c.)",
    legal_basis: "Art. 99 C.p.c.",
  },
  {
    code_regle: "sup-fr-au-visa",
    lang: "fr",
    pattern_term: "au visa de l'article",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Formule de cassation/procédure française ; au Québec, l'acte de procédure allègue les faits sans visas législatifs.",
    suggested_replacement: "Énoncer directement les faits générateurs du droit (art. 99 C.p.c.)",
    legal_basis: "Art. 99 C.p.c.",
  },
  {
    code_regle: "sup-fr-garde-a-vue",
    lang: "fr",
    pattern_term: "garde à vue",
    case_sensitive: 0,
    risk_category: "francisme_france",
    allowed_in_bijural_if: null,
    reason_fr:
      "Institution de procédure pénale française inexistante en droit québécois et canadien (détention aux fins d'enquête / arrestation).",
    suggested_replacement: "détention / arrestation",
    legal_basis: "Charte canadienne, art. 9–10",
  },
  {
    code_regle: "sup-fr-statement-of-claim",
    lang: "fr",
    pattern_term: "statement of claim",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Emprunt de common law ; au Québec, l'acte introductif se nomme « demande introductive d'instance » (et « originating application » en anglais).",
    suggested_replacement: "demande introductive d'instance",
    legal_basis: "Art. 141 C.p.c.",
  },
  {
    code_regle: "sup-en-motion-to-dismiss",
    lang: "en",
    pattern_term: "motion to dismiss",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Terme procédural de common law ; la version anglaise officielle du C.p.c. emploie « application for dismissal » (art. 168 C.p.c.) ou « preliminary exception » (art. 166 C.p.c.).",
    suggested_replacement: "application for dismissal / preliminary exception",
    legal_basis: "Art. 166, 168 C.p.c.",
  },
  {
    code_regle: "sup-en-laches",
    lang: "en",
    pattern_term: "laches",
    case_sensitive: 0,
    risk_category: "anglicisme_ou_common_law",
    allowed_in_bijural_if: null,
    reason_fr:
      "Doctrine d'equity de common law étrangère au droit civil québécois ; employer la prescription extinctive ou la fin de non-recevoir fondée sur la bonne foi / l'abus de droit.",
    suggested_replacement: "extinctive prescription / fin de non-recevoir (art. 6–7, 2875 C.c.Q.)",
    legal_basis: "Art. 6–7, 1375, 2875 C.c.Q.",
  },
];

function escapeScanLiteral(raw: string): string {
  return raw
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/'/g, "['\\u2018\\u2019\\u02bc]")
    .replace(/-/g, "[-\\u2010\\u2011]");
}

function inflectScanWordPattern(rawToken: string, lang: string, caseSensitive: number): string {
  const aposMatch = /^([dlDL]['\u2018\u2019\u02bc])(.+)$/u.exec(rawToken);
  const prefix = aposMatch ? escapeScanLiteral(aposMatch[1]!) : "";
  const core = aposMatch ? aposMatch[2]! : rawToken;

  if (
    caseSensitive ||
    !/^\p{L}{3,}$/u.test(core) ||
    /^[A-ZÀ-Ý]{2,}$/.test(core) ||
    NON_INFLECTED_SCAN_TOKENS.has(normalizeFold(core))
  ) {
    return `${prefix}${escapeScanLiteral(core)}`;
  }

  if (lang === "en") {
    if (/[^aeiou]y$/i.test(core)) {
      const stem = escapeScanLiteral(core.slice(0, -1));
      return `${prefix}(?:${stem}y|${stem}ies)`;
    }
    if (/(?:s|x|z|ch|sh)$/i.test(core)) {
      return `${prefix}${escapeScanLiteral(core)}(?:es)?`;
    }
    return `${prefix}${escapeScanLiteral(core)}s?`;
  }

  // Français : pluriels réguliers (-s, -aux, -eaux)
  if (/al$/i.test(core) && core.length >= 5) {
    const stem = escapeScanLiteral(core.slice(0, -2));
    return `${prefix}(?:${stem}al|${stem}aux)`;
  }
  if (/(?:eau|eu)$/i.test(core)) {
    return `${prefix}${escapeScanLiteral(core)}x?`;
  }
  if (!/[sxz]$/i.test(core)) {
    return `${prefix}${escapeScanLiteral(core)}s?`;
  }
  return `${prefix}${escapeScanLiteral(core)}`;
}

const CUSTOM_SCAN_REGEX_BY_CODE: Readonly<Record<string, RegExp>> = {
  "sup-fr-demande-de-refere":
    /(?<![\p{L}\p{N}])(?:demandes?|requ[êe]tes?|ordonnances?)\s+de\s+r[ée]f[ée]r[ée]s?(?![\p{L}\p{N}])/giu,
  "sup-fr-refere": /(?<![\p{L}\p{N}])r[ée]f[ée]r[ée]s?(?![\p{L}\p{N}])/giu,
  "sup-fr-comparaitre":
    /(?<![\p{L}\p{N}])(?:compara[îi](?:tre|ssent|ssons|ssez|ssait|ssaies?|ssaient)|comparaî(?:t|tra(?:i[ts]?|ient|s)?|tront|trons|trez)|compar(?:u[es]{0,2}|aisse(?:s|nt)?|[ûu]t))(?![\p{L}\p{N}])/giu,
  "sup-fr-loger-recours":
    /(?<![\p{L}\p{N}])log(?:er(?:ai[st]?|aient|ont|ons|ez|[ae]s?)?|e(?:nt|s|ait|aient|ons|z)?|eons|[ée]e?s?|eant|ea(?:i[st]?|ient)?|[èe]rent)\s+(?:(?:un|une|le|la|l['\u2018\u2019\u02bc]|les|ce|cet|cette|ces|son|sa|ses|leur|leurs|des|du)\s+)?(?:(?:pr[ée]sente?s?|nouve(?:au|lle)s?)\s+)?(?:appels?|demandes?|requ[êe]tes?|griefs?|plaintes?|oppositions?|pourvois?|recours|actions?|poursuites?|proc[ée]dures?)(?![\p{L}\p{N}])/giu,
  "sup-fr-ceduler":
    /(?<![\p{L}\p{N}])c[ée]dul(?:er(?:ai[st]?|aient|ont|ons|ez|[ae]s?)?|e(?:nt|s|ait|aient|ons|z)?|ons|ez|[ée]e?s?|ant|a(?:i[st]?|ient)?|[èe]rent)(?![\p{L}\p{N}])/giu,
  "sup-fr-appliquer-pour":
    /(?<![\p{L}\p{N}])appliqu(?:er(?:ai[st]?|aient|ont|ons|ez|[ae]s?)?|e(?:nt|s|ait|aient|ons|z)?|ons|ez|[ée]e?s?|ant|a(?:i[st]?|ient)?|[èe]rent)\s+pour\s+(?:un|une|le|la|l['\u2018\u2019\u02bc]|les|des|du|ce|cet|cette|ces|mon|ma|mes|son|sa|ses|leur|leurs)(?![\p{L}\p{N}])/giu,
  "sup-fr-suite-a": /(?<![\p{L}\p{N}])suite\s+(?:[àa]|aux?)(?![\p{L}\p{N}])/giu,
  "sup-fr-renverser-decision":
    /(?<![\p{L}\p{N}])renvers(?:er(?:ai[st]?|aient|ont|ons|ez|[ae]s?)?|e(?:nt|s|ait|aient|ons|z)?|ons|ez|[ée]e?s?|ant|a(?:i[st]?|ient)?|[èe]rent)\s+(?:(?:un|une|le|la|l['\u2018\u2019\u02bc]|les|ce|cet|cette|ces|ledit|ladite|son|sa)\s+)?(?:(?:pr[ée]sente?|m[êe]me)\s+)?(?:jugements?|d[ée]cisions?|ordonnances?|verdicts?|arr[êe]ts?)(?![\p{L}\p{N}])/giu,
  "sup-fr-canceller":
    /(?<![\p{L}\p{N}])cancell(?:er(?:ai[st]?|aient|ont|ons|ez|[ae]s?)?|e(?:nt|s|ait|aient|ons|z)?|ons|ez|[ée]e?s?|ant|a(?:i[st]?|ient)?|[èe]rent)(?![\p{L}\p{N}])/giu,
  "sup-fr-charger-frais":
    /(?<![\p{L}\p{N}])charg(?:er(?:ai[st]?|aient|ont|ons|ez|[ae]s?)?|e(?:nt|s|ait|aient|ons|z)?|eons|ez|[ée]e?s?|eant|ea(?:i[st]?|ient)?|[èe]rent)\s+(?:de|d['\u2018\u2019\u02bc]|des|les|aucuns?)\s+(?:frais|honoraires|int[ée]r[êe]ts)(?![\p{L}\p{N}])/giu,
  "sup-fr-audition-au-merite":
    /(?<![\p{L}\p{N}])(?:auditions?|audiences?|proc[èe]s|instructions?)\s+au\s+m[ée]rite(?![\p{L}\p{N}])/giu,
  "sup-fr-au-merite": /(?<![\p{L}\p{N}])au\s+m[ée]rite(?![\p{L}\p{N}])/giu,
  "sup-en-consideration": /(?<![\p{L}\p{N}])consideration(?![\p{L}\p{N}])/giu,
};

function buildContaminationRegex(regle: RawRegleRow): RegExp {
  const custom = CUSTOM_SCAN_REGEX_BY_CODE[regle.code_regle];
  if (custom) {
    return new RegExp(custom.source, custom.flags);
  }
  const tokens = normalizeQuotesAndSpaces(regle.pattern_term.trim()).split(" ").filter(Boolean);
  const body = tokens
    .map((tok) => inflectScanWordPattern(tok, regle.lang, regle.case_sensitive))
    .join("\\s+");
  const startsWord = /^[\p{L}\p{N}]/u.test(regle.pattern_term.trim());
  const endsWord = /[\p{L}\p{N}]$/u.test(regle.pattern_term.trim());
  const pre = startsWord ? "(?<![\\p{L}\\p{N}])" : "";
  const post = endsWord ? "(?![\\p{L}\\p{N}])" : "";
  const flags = regle.case_sensitive ? "gu" : "giu";
  return new RegExp(`${pre}${body}${post}`, flags);
}

export async function terminologieScanText(
  db: D1Database,
  input: TerminologieScanTextInput,
): Promise<{ structured: TerminologieScanTextOutput; text: string }> {
  const contextSystem = input.context_system ?? "droit_civil_qc";
  const reglesSql =
    input.lang === "fr"
      ? `SELECT code_regle, lang, pattern_term, case_sensitive, risk_category,
                allowed_in_bijural_if, reason_fr, suggested_replacement, legal_basis
           FROM regles_contamination
          WHERE lang = 'fr' OR (lang = 'en' AND risk_category = 'anglicisme_ou_common_law')
          ORDER BY LENGTH(pattern_term) DESC, CASE WHEN lang = 'fr' THEN 0 ELSE 1 END, id ASC`
      : `SELECT code_regle, lang, pattern_term, case_sensitive, risk_category,
                allowed_in_bijural_if, reason_fr, suggested_replacement, legal_basis
           FROM regles_contamination
          WHERE lang = ?
          ORDER BY LENGTH(pattern_term) DESC, id ASC`;
  const reglesStmt = db.prepare(reglesSql);
  const reglesRes =
    input.lang === "fr"
      ? await reglesStmt.all<RawRegleRow>()
      : await reglesStmt.bind(input.lang).all<RawRegleRow>();

  // En mode français, exclure les faux amis purement homographes (ex. « tort » dans « à tort »)
  // provenant des règles anglaises ; les autres anglicismes / termes de common law insérés en
  // français (ex. « joint and several », « hold harmless », « estoppel », « mortgage ») restent détectés.
  const baseRegles: RawRegleRow[] = reglesRes.results.filter(
    (r) =>
      !(
        input.lang === "fr" &&
        r.lang === "en" &&
        EN_COLLIDING_IN_FR.has(normalizeFold(r.pattern_term))
      ),
  );

  // Fusionner sans doublon les règles de la base avec les marqueurs complémentaires haute précision
  const seenPatternKeys = new Set(baseRegles.map((r) => normalizeFold(r.pattern_term)));
  const mergedRegles: RawRegleRow[] = [...baseRegles];
  for (const sup of SUPPLEMENTAL_SCAN_RULES) {
    const key = normalizeFold(sup.pattern_term);
    const includeSup =
      sup.lang === input.lang ||
      (input.lang === "fr" &&
        sup.lang === "en" &&
        sup.risk_category === "anglicisme_ou_common_law" &&
        !EN_COLLIDING_IN_FR.has(key));
    if (!includeSup) {
      continue;
    }
    if (sup.overrideDb) {
      const kept = mergedRegles.filter(
        (r) =>
          !(normalizeFold(r.pattern_term) === key && (r.lang === sup.lang || input.lang === "fr")),
      );
      mergedRegles.length = 0;
      mergedRegles.push(...kept, sup);
      seenPatternKeys.add(key);
    } else if (!seenPatternKeys.has(key)) {
      seenPatternKeys.add(key);
      mergedRegles.push(sup);
    }
  }
  mergedRegles.sort(
    (a, b) =>
      b.pattern_term.length - a.pattern_term.length ||
      (a.lang === input.lang ? 0 : 1) - (b.lang === input.lang ? 0 : 1),
  );

  const rawOccurrences: ScanOccurrence[] = [];
  const occupiedRanges: Array<[number, number]> = [];

  for (const regle of mergedRegles) {
    const re = buildContaminationRegex(regle);

    for (const m of input.text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;

      // Éviter de signaler deux fois un segment chevauchant déjà une locution plus longue
      if (occupiedRanges.some(([s, e]) => start < e && end > s)) {
        continue;
      }

      const normPattern = normalizeFold(regle.pattern_term);
      const prefixWindow = input.text.slice(Math.max(0, start - 45), start);
      const suffixWindow = input.text.slice(end, Math.min(input.text.length, end + 45));

      // Exceptions du C.p.c. : « avis d'assignation », « répondre / répond à l'assignation », « délai / mode d'assignation » (art. 145, 149 C.p.c.)
      if (normPattern === "assignation") {
        if (
          /\b(?:avis\s+d|r[ée]pond\p{L}*\s+[àa]\s+l|r[ée]ponses?\s+[àa]\s+l|d[ée]lai\s+d|mode\s+d)['\u2018\u2019\u02bc]\s*$/iu.test(
            prefixWindow,
          )
        ) {
          continue;
        }
      }

      // Exception québécoise : « tribunaux judiciaires » (Loi sur les tribunaux judiciaires, RLRQ c. T-16 ; art. 2807 C.c.Q.)
      // et emploi générique indéfini (« un / autre / tout / aucun tribunal judiciaire » par opposition à administratif)
      if (normPattern === "tribunal judiciaire") {
        if (/tribunaux/iu.test(m[0]) || /\b(?:un|autre|tout|aucun)\s+$/iu.test(prefixWindow)) {
          continue;
        }
      }

      // Exception dénomination statutaire fédérale : « Canada Mortgage and Housing Corporation » (art. 1339 C.c.Q. EN)
      if (normPattern === "mortgage") {
        const around = input.text.slice(
          Math.max(0, start - 20),
          Math.min(input.text.length, end + 30),
        );
        if (/\bCanada\s+Mortgage\s+and\s+Housing\b/iu.test(around)) {
          continue;
        }
      }

      // Exception verbe « se référer / référer à » vs institution procédurale française « référé »
      if (normPattern === "refere") {
        if (
          /\b(?:s['\u2018\u2019\u02bc]\s*est|s['\u2018\u2019\u02bc]\s*[ée]tait|sont|est|[ée]tait|[ée]taient|a|ai|as|avons|avez|ont|avait|avaient|aura|aurait|[ée]t[ée]|[êe]tre|avoir|y\s+est|y\s+a)\s+$/iu.test(
            prefixWindow,
          ) ||
          /^\s+(?:à|au|aux)\b/iu.test(suffixWindow)
        ) {
          continue;
        }
      }

      // Exception témoin / indemnité / présence physique : « comparution » (art. 269 C.p.c.)
      if (normPattern === "comparution") {
        if (
          /\b(?:indemnit[ée]s?\s+d['\u2018\u2019\u02bc]|frais\s+de|allocation\s+de)\s*$/iu.test(
            prefixWindow,
          ) ||
          /^\s+(?:du\s+t[ée]moin|des\s+t[ée]moins|physique|en\s+personne|[àa]\s+l['\u2018\u2019\u02bc]audience|devant\s+le\s+tribunal|par\s+(?:visioconf[ée]rence|t[ée]l[ée]phone|moyen\s+technologique)|[àa]\s+distance)\b/iu.test(
            suffixWindow,
          )
        ) {
          continue;
        }
      }

      // Exception citation à comparaître / témoin / présence physique : « comparaître » (art. 269 C.p.c.)
      if (normPattern === "comparaitre") {
        if (
          /\b(?:citation|cit[ée]e?s?|sommation|ordre|ordonn[ée]e?s?)\s+[àa]\s+$/iu.test(
            prefixWindow,
          ) ||
          /^\s+(?:comme\s+t[ée]moin|[àa]\s+titre\s+de\s+t[ée]moin|en\s+qualit[ée]\s+de\s+t[ée]moin|pour\s+t[ée]moigner|en\s+personne|personnellement|[àa]\s+l['\u2018\u2019\u02bc]audience|[àa]\s+l['\u2018\u2019\u02bc]instruction|devant\s+(?:la\s+cour|le\s+tribunal|le\s+juge)|par\s+(?:visioconf[ée]rence|t[ée]l[ée]phone|moyen\s+technologique)|[àa]\s+distance)\b/iu.test(
            suffixWindow,
          )
        ) {
          continue;
        }
      }

      // Exception pronominale « s'appliquer pour » / « l'appliquer pour » (sens français normal)
      if (normPattern === "appliquer pour") {
        if (
          /\b(?:s['\u2018\u2019\u02bc]|se|l['\u2018\u2019\u02bc]|le|la|les)\s*$/iu.test(
            prefixWindow,
          )
        ) {
          continue;
        }
      }

      // Exceptions OQLF légitimes : « comme / faire / donner suite à » et « la suite à donner »
      if (normPattern === "suite a") {
        if (
          /\b(?:comme|faire|fait(?:es|s)?|faisant|faisons|faisaient|faisait|fera(?:i[ts]?|ient)?|feront|ferons|ferez|fit|firent|fasse(?:nt)?|donner|donne(?:nt|s|ait|aient)?|donn[ée]e?s?|donnant|donnera(?:i[ts]?|ient)?|donneront|donnons|donnez)\s+$/iu.test(
            prefixWindow,
          ) ||
          /^\s+(?:donner|r[ée]server|apporter)\b/iu.test(suffixWindow)
        ) {
          continue;
        }
      }

      // Exception « chargé des intérêts des créanciers / mineurs / clients » (administration du bien d'autrui)
      if (normPattern === "charger des frais") {
        if (
          /^\s+(?:de|du|des)\s+(?:mineurs?|cr[ée]anciers?|parties?|clients?|actionnaires?|b[ée]n[ée]ficiaires?|h[ée]ritiers?)\b/iu.test(
            suffixWindow,
          )
        ) {
          continue;
        }
      }

      // Exception « prime / nomination / avancement au mérite »
      if (normPattern === "au merite") {
        if (
          /\b(?:prime|avancement|promotion|promu[es]?|nomination|nomm[ée]e?s?|r[ée]mun[ée]ration|s[ée]lection|embauche|recrutement|bourse|prix|m[ée]daille|ordre|concours|r[ée]compense|[ée]valuation)\s+$/iu.test(
            prefixWindow,
          )
        ) {
          continue;
        }
      }

      // Exception en anglais : emplois non contractuels de « consideration » (« take into consideration », « for consideration by the Court »)
      if (normPattern === "consideration") {
        if (
          /\b(?:into|under|careful|serious|due|further|preliminary|main|primary|major|key|important|sole|only|judicial|court['\u2018\u2019\u02bc]s|for\s+the)\s+$/iu.test(
            prefixWindow,
          ) ||
          /^\s+(?:by\s+the\s+(?:court|tribunal|judge|panel)|of\s+(?:the\s+(?:evidence|facts|record|application|motion|appeal|matter|issue|circumstances)|whether|this\s+(?:application|motion|issue|matter)))\b/iu.test(
            suffixWindow,
          )
        ) {
          continue;
        }
      }

      // Contexte bijuridique fédéral : tolérer si le terme compagnon civiliste figure dans la fenêtre ±80 car.
      let riskCat = regle.risk_category;
      if (contextSystem === "bijuridique_federal" && regle.allowed_in_bijural_if) {
        const winStart = Math.max(0, start - 80);
        const winEnd = Math.min(input.text.length, end + 80);
        const windowLower = normalizeFold(input.text.slice(winStart, winEnd));
        if (windowLower.includes(normalizeFold(regle.allowed_in_bijural_if))) {
          continue;
        }
        riskCat = "omission_bijuridique";
      }

      occupiedRanges.push([start, end]);
      const snipStart = Math.max(0, start - 45);
      const snipEnd = Math.min(input.text.length, end + 45);
      const snippet = `${snipStart > 0 ? "…" : ""}${input.text
        .slice(snipStart, snipEnd)
        .replace(/\s+/g, " ")
        .trim()}${snipEnd < input.text.length ? "…" : ""}`;

      rawOccurrences.push({
        offset_start: start,
        offset_end: end,
        matched_text: m[0],
        snippet,
        risk_category: riskCat,
        reason_fr: regle.reason_fr,
        suggested_replacement: regle.suggested_replacement,
        legal_basis: regle.legal_basis,
      });
    }
  }

  rawOccurrences.sort((a, b) => a.offset_start - b.offset_start);
  const cappedOccurrences = rawOccurrences.slice(0, 250);

  const gardes: Garde[] = [makeGarde("TERMINOLOGIE_AIDE_REDACTION_NON_NORMATIVE")];
  const structured: TerminologieScanTextOutput = {
    lang: input.lang,
    context_system: contextSystem,
    scanned_length: input.text.length,
    flagged_count: rawOccurrences.length,
    occurrences: cappedOccurrences,
    provenance: {
      source: "Table curée de détection des contaminations bijuridiques et linguistiques (Québec)",
      verified_at: "2026-11-19",
    },
    gardes,
  };

  const occLines = cappedOccurrences.map(
    (o) =>
      `- [pos. ${o.offset_start}–${o.offset_end} · ${o.risk_category}] « ${o.matched_text} » dans « ${o.snippet} »\n  Risque : ${o.reason_fr}\n  Remplacement québécois attesté : « ${o.suggested_replacement} » (${o.legal_basis})`,
  );
  if (rawOccurrences.length > cappedOccurrences.length) {
    occLines.push(
      `… (${rawOccurrences.length - cappedOccurrences.length} occurrence(s) additionnelle(s) omise(s) de l'affichage détaillé)`,
    );
  }

  const text = [
    `Contrôle de contamination terminologique (${input.lang}, cadre ${contextSystem}, ${input.text.length} car.) : ${rawOccurrences.length} occurrence(s) signalée(s)`,
    ...(occLines.length > 0
      ? occLines
      : ["Aucun marqueur de contamination repéré parmi les règles curées."]),
    "",
    "Gardes :",
    ...gardes.map((g) => `- [${g.code}] ${g.message}`),
    `\nSource : ${structured.provenance.source} (vérifié le 2026-11-19)`,
  ].join("\n");

  return { structured, text };
}
