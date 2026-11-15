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

export function buildFtsAndPrefixQuery(input: string): string | null {
  const tokens = extractSafeFtsTokens(input);
  if (tokens.length === 0) return null;
  return tokens
    .map((t) => {
      const clean = t.replace(/"/g, "");
      return clean.length >= 3 ? `"${clean}"*` : `"${clean}"`;
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

  // 1) Correspondances exactes sur termes normalisés
  const exactWhere =
    sourceLang === "fr"
      ? "terme_fr_norm = ?"
      : sourceLang === "en"
        ? "terme_en_norm = ?"
        : "(terme_fr_norm = ? OR terme_en_norm = ?)";
  const exactParams = sourceLang === "auto" ? [qNorm, qNorm] : [qNorm];
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

  // 2) Recherche plein texte FTS5 (incluant synonymes et faux amis déconseillés)
  const ftsQuery = buildFtsAndPrefixQuery(input.query);
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
        const isDeconseilleExact = decList.some((d) => normalizeFold(d.terme) === qNorm);
        const isSynExact =
          synFr.some((s) => normalizeFold(s) === qNorm) ||
          synEn.some((s) => normalizeFold(s) === qNorm);
        const isLangMatch =
          sourceLang === "fr"
            ? r.terme_fr_norm.includes(qNorm)
            : sourceLang === "en"
              ? r.terme_en_norm.includes(qNorm)
              : r.terme_fr_norm.includes(qNorm) || r.terme_en_norm.includes(qNorm);
        const tier =
          (isDeconseilleExact && r.rang_source === 1) || isSynExact ? 0 : isLangMatch ? 1 : 2;
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

interface RawAttestationRow {
  law_id: string;
  jurisdiction: string;
  name_fr: string;
  name_en: string;
  official_cite: string;
  consol_date_fr: string | null;
  consol_date_en: string | null;
  article_number: string;
  sort_key: number;
  text_fr: string;
  text_en: string;
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
  const lawFilter = input.law_filter?.trim() ?? null;

  let sql = `
    SELECT a.law_id, l.jurisdiction, l.name_fr, l.name_en, l.official_cite,
           l.consol_date_fr, l.consol_date_en,
           a.article_number, a.sort_key, a.text_fr, a.text_en
      FROM ${ftsTable} f
      JOIN articles_bilingues a ON a.id = f.rowid
      JOIN lois_bilingues l ON l.law_id = a.law_id
     WHERE ${ftsTable} MATCH ?
  `;
  const params: unknown[] = [ftsPhrase];
  if (lawFilter) {
    sql += " AND (LOWER(a.law_id) = LOWER(?) OR LOWER(l.official_cite) LIKE LOWER(?))";
    params.push(lawFilter, `%${lawFilter}%`);
  }
  sql += `
     ORDER BY CASE a.law_id WHEN 'ccq' THEN 0 WHEN 'cpc' THEN 1 WHEN 'ca-i-21' THEN 2 ELSE 3 END,
              a.law_id ASC,
              a.sort_key ASC
     LIMIT 2500
  `;

  const res = await db
    .prepare(sql)
    .bind(...params)
    .all<RawAttestationRow>();
  const phraseRegex = buildExactPhraseRegex(input.term);

  const verifiedRows = res.results.filter((r) => {
    const target = input.lang === "fr" ? r.text_fr : r.text_en;
    return phraseRegex.test(target);
  });

  const lawCounts = new Map<string, z.infer<typeof AttestationParLoiSchema>>();
  for (const r of verifiedRows) {
    const cur = lawCounts.get(r.law_id);
    if (cur) {
      cur.article_count += 1;
    } else {
      lawCounts.set(r.law_id, {
        law_id: r.law_id,
        official_cite: r.official_cite,
        law_title_fr: r.name_fr,
        law_title_en: r.name_en,
        jurisdiction: r.jurisdiction,
        article_count: 1,
      });
    }
  }

  const byLaw = Array.from(lawCounts.values()).sort((a, b) => b.article_count - a.article_count);
  const attestations = verifiedRows.slice(0, limit).map((r) => ({
    law_id: r.law_id,
    official_cite: r.official_cite,
    article_number: r.article_number,
    snippet_fr:
      input.lang === "fr"
        ? extractAroundMatch(r.text_fr, phraseRegex, 300)
        : r.text_fr.length <= 300
          ? r.text_fr
          : `${r.text_fr.slice(0, 299)}…`,
    snippet_en:
      input.lang === "en"
        ? extractAroundMatch(r.text_en, phraseRegex, 300)
        : r.text_en.length <= 300
          ? r.text_en
          : `${r.text_en.slice(0, 299)}…`,
    consol_date:
      (input.lang === "fr" ? r.consol_date_fr : r.consol_date_en) ?? r.consol_date_fr ?? null,
  }));

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
    by_law: byLaw.slice(0, 25),
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

  const rawOccurrences: ScanOccurrence[] = [];
  const occupiedRanges: Array<[number, number]> = [];

  for (const regle of reglesRes.results) {
    const escaped = normalizeQuotesAndSpaces(regle.pattern_term.trim()).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const flexQuotes = escaped.replace(/'/g, "['\\u2018\\u2019\\u02bc]").replace(/\s+/g, "\\s+");
    const flags = regle.case_sensitive ? "gu" : "giu";
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${flexQuotes}(?![\\p{L}\\p{N}])`, flags);

    for (const m of input.text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;

      // Éviter de signaler deux fois un sous-segment déjà couvert par une locution plus longue
      if (occupiedRanges.some(([s, e]) => start >= s && end <= e)) {
        continue;
      }

      // Exception : « avis d'assignation » est le terme officiel de l'art. 145 C.p.c.
      if (normalizeFold(regle.pattern_term) === "assignation") {
        const prefixWindow = input.text.slice(Math.max(0, start - 12), start);
        if (/avis\s+d['\u2018\u2019\u02bc]\s*$/iu.test(prefixWindow)) {
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

      if (rawOccurrences.length >= 100) break;
    }
    if (rawOccurrences.length >= 100) break;
  }

  rawOccurrences.sort((a, b) => a.offset_start - b.offset_start);

  const gardes: Garde[] = [makeGarde("TERMINOLOGIE_AIDE_REDACTION_NON_NORMATIVE")];
  const structured: TerminologieScanTextOutput = {
    lang: input.lang,
    context_system: contextSystem,
    scanned_length: input.text.length,
    flagged_count: rawOccurrences.length,
    occurrences: rawOccurrences,
    provenance: {
      source: "Table curée de détection des contaminations bijuridiques et linguistiques (Québec)",
      verified_at: "2026-11-15",
    },
    gardes,
  };

  const occLines = rawOccurrences.map(
    (o) =>
      `- [pos. ${o.offset_start}–${o.offset_end} · ${o.risk_category}] « ${o.matched_text} » dans « ${o.snippet} »\n  Risque : ${o.reason_fr}\n  Remplacement québécois attesté : « ${o.suggested_replacement} » (${o.legal_basis})`,
  );

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
