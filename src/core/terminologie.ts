import { z } from "zod";
import { type Garde, GardeSchema, makeGarde, ProvenanceSchema } from "./gardes.js";

export function normalizeFold(input: string): string {
  return input
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
  const tokens = extractSafeFtsTokens(input);
  if (tokens.length === 0) return null;
  return `"${tokens.map((t) => t.replace(/"/g, "")).join(" ")}"`;
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
      const variants = Array.from(
        new Set([clean, ...singularizeFoldedTokenVariants(folded, lang)].filter(Boolean)),
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
  const inPlaceholders = qVariants.map(() => "?").join(", ");
  const exactWhere =
    sourceLang === "fr"
      ? `terme_fr_norm IN (${inPlaceholders})`
      : sourceLang === "en"
        ? `terme_en_norm IN (${inPlaceholders})`
        : `(terme_fr_norm IN (${inPlaceholders}) OR terme_en_norm IN (${inPlaceholders}))`;
  const exactParams = sourceLang === "auto" ? [...qVariants, ...qVariants] : [...qVariants];
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
    byId.set(Number(r.id), { row: r, exactTier: 0 });
  }

  // 2) Recherche plein texte FTS5 (incluant synonymes, pluriels et faux amis déconseillés)
  const qVariantSet = new Set(qVariants);
  const ftsQuery = buildFtsAndPrefixQuery(input.query, sourceLang);
  if (ftsQuery) {
    const ftsRes = await db
      .prepare(
        `SELECT t.id, t.rang_source, t.source_nom, t.licence_source, t.terme_fr, t.terme_en,
                t.terme_fr_norm, t.terme_en_norm, t.synonymes_fr_json, t.synonymes_en_json,
                t.termes_deconseilles_json, t.systeme_juridique, t.domaine,
                t.note_ou_definition, t.base_legale, t.url_fiche, t.date_verification
           FROM fiches_fts f
           JOIN fiches_terminologiques t ON t.id = f.rowid
          WHERE fiches_fts MATCH ?
          ORDER BY t.rang_source ASC, bm25(fiches_fts) ASC
          LIMIT 80`,
      )
      .bind(ftsQuery)
      .all<RawFicheRow>();

    for (const r of ftsRes.results) {
      const id = Number(r.id);
      if (!byId.has(id)) {
        const decList = parseJsonArray<z.infer<typeof TermeDeconseilleSchema>>(
          r.termes_deconseilles_json,
        );
        const synFr = parseJsonArray<string>(r.synonymes_fr_json);
        const synEn = parseJsonArray<string>(r.synonymes_en_json);
        const matchesVariant = (s: string) => qVariantSet.has(normalizeFold(s));
        const isHeadwordExact =
          sourceLang === "fr"
            ? qVariantSet.has(r.terme_fr_norm)
            : sourceLang === "en"
              ? qVariantSet.has(r.terme_en_norm)
              : qVariantSet.has(r.terme_fr_norm) || qVariantSet.has(r.terme_en_norm);
        const isDeconseilleExact = decList.some((d) => matchesVariant(d.terme));
        const isSynExact =
          sourceLang === "fr"
            ? synFr.some(matchesVariant)
            : sourceLang === "en"
              ? synEn.some(matchesVariant)
              : synFr.some(matchesVariant) || synEn.some(matchesVariant);
        const isLangMatch =
          sourceLang === "fr"
            ? qVariants.some((v) => r.terme_fr_norm.includes(v))
            : sourceLang === "en"
              ? qVariants.some((v) => r.terme_en_norm.includes(v))
              : qVariants.some((v) => r.terme_fr_norm.includes(v) || r.terme_en_norm.includes(v));
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
  if (fiches.some((f) => f.rang_source === 4 || f.licence_source.includes("NC-SA"))) {
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

// ── 2. terminologie_attestations ─────────────────────────────────────────────

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
  const escaped = normalizeQuotesAndSpaces(term.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flexQuotes = escaped
    .replace(/'/g, "['\\u2018\\u2019\\u02bc]")
    .replace(/-/g, "[-\\u2010\\u2011]");
  const startsWord = /^[\p{L}\p{N}]/u.test(term.trim());
  const endsWord = /[\p{L}\p{N}]$/u.test(term.trim());
  const pre = startsWord ? "(?<![\\p{L}\\p{N}])" : "";
  const post = endsWord ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(`${pre}${flexQuotes}${post}`, "iu");
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

interface LightAttestationCandidateRow {
  id: number;
  law_id: string;
  article_number: string;
  sort_key: number;
  target_text: string;
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
  let lawsSql = `
    SELECT law_id, jurisdiction, name_fr, name_en, official_cite, consol_date_fr, consol_date_en
      FROM lois_bilingues
  `;
  const lawsParams: unknown[] = [];
  if (lawFilter) {
    lawsSql += " WHERE LOWER(law_id) = LOWER(?) OR LOWER(official_cite) LIKE LOWER(?)";
    lawsParams.push(lawFilter, `%${lawFilter}%`);
  }
  const lawsRes = await db
    .prepare(lawsSql)
    .bind(...lawsParams)
    .all<LoiBilingueRow>();
  const lawMap = new Map<string, LoiBilingueRow>(lawsRes.results.map((l) => [l.law_id, l]));

  let verifiedRows: LightAttestationCandidateRow[] = [];
  const phraseRegex = buildExactPhraseRegex(input.term);

  if (!lawFilter || lawMap.size > 0) {
    let sql = `
      SELECT a.id, a.law_id, a.article_number, a.sort_key, a.${targetCol} AS target_text
        FROM ${ftsTable} f
        JOIN articles_bilingues a ON a.id = f.rowid
       WHERE ${ftsTable} MATCH ?
    `;
    const params: unknown[] = [ftsPhrase];
    if (lawFilter) {
      const allowedLawIds = Array.from(lawMap.keys());
      sql += ` AND a.law_id IN (${allowedLawIds.map(() => "?").join(",")})`;
      params.push(...allowedLawIds);
    }

    const res = await db
      .prepare(sql)
      .bind(...params)
      .all<LightAttestationCandidateRow>();

    verifiedRows = res.results.filter(
      (r) => lawMap.has(r.law_id) && phraseRegex.test(r.target_text),
    );
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

// ── 3. terminologie_scan_text ────────────────────────────────────────────────

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

const SUPPLEMENTAL_SCAN_RULES: readonly RawRegleRow[] = [
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
      "Doctrine d'equity de common law étrangère au droit civil québécois (art. 6, 7 et 1457 C.c.Q. ; fin de non-recevoir).",
    suggested_replacement: "ground for dismissal / good faith (art. 6–7 C.C.Q.)",
    legal_basis: "Art. 6, 7, 1457 C.c.Q. ; art. 168 C.p.c.",
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

function buildContaminationRegex(regle: RawRegleRow): RegExp {
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
  const reglesRes = await db
    .prepare(
      `SELECT code_regle, lang, pattern_term, case_sensitive, risk_category,
              allowed_in_bijural_if, reason_fr, suggested_replacement, legal_basis
         FROM regles_contamination
        WHERE lang = ?
        ORDER BY LENGTH(pattern_term) DESC, id ASC`,
    )
    .bind(input.lang)
    .all<RawRegleRow>();

  // Fusionner sans doublon les règles de la base avec les marqueurs complémentaires haute précision
  const seenPatternKeys = new Set(reglesRes.results.map((r) => normalizeFold(r.pattern_term)));
  const mergedRegles: RawRegleRow[] = [...reglesRes.results];
  for (const sup of SUPPLEMENTAL_SCAN_RULES) {
    if (sup.lang === input.lang && !seenPatternKeys.has(normalizeFold(sup.pattern_term))) {
      seenPatternKeys.add(normalizeFold(sup.pattern_term));
      mergedRegles.push(sup);
    }
  }
  mergedRegles.sort((a, b) => b.pattern_term.length - a.pattern_term.length);

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

      // Exception : « avis d'assignation » est le terme officiel de l'art. 145 C.p.c.
      if (normalizeFold(regle.pattern_term) === "assignation") {
        const prefixWindow = input.text.slice(Math.max(0, start - 32), start);
        if (/\bavis\s+d['\u2018\u2019\u02bc]\s*$/iu.test(prefixWindow)) {
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
      verified_at: "2026-11-15",
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
    `\nSource : ${structured.provenance.source} (vérifié le 2026-11-15)`,
  ].join("\n");

  return { structured, text };
}
