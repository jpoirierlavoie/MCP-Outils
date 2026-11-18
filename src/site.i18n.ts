/**
 * Chaînes ANGLAISES de la page publique (`GET /`).
 *
 * Ce dépôt est francophone : les titres d'outils, descriptions, schémas et
 * réserves (`GARDE_*`) n'existent qu'en français, langue canonique reçue par le
 * modèle. Ce fichier ne porte QUE les traductions anglaises de la page publique.
 */

export interface OutilEn {
  readonly titre: string;
  readonly texte: string;
}

export const OUTILS_EN: Readonly<Record<string, OutilEn>> = {
  calendrier_holidays: {
    titre: "Holidays and non-juridical days (QC / CA)",
    texte:
      "Lists statutory holidays and non-juridical days for a calendar year under 'qc_cpc' " +
      "(art. 82 al. 1 C.C.P. and art. 61 par. 23° I.A., including Saturdays, Jan 2 and Dec 26), " +
      "'qc_li' (Québec Interpretation Act), or 'ca_li' (federal Interpretation Act, including " +
      "Sept 30 and Nov 11).",
  },
  calendrier_deadlines: {
    titre: "Deterministic deadline calculator (C.C.P. / I.A.)",
    texte:
      "Computes 1 to 25 procedural or statutory deadlines purely arithmetically (without " +
      "automatic legal qualification). Handles non-juridical rollover (art. 83 al. 3 C.C.P., " +
      "art. 52 I.A.), technological notification shift after 17:00 or on a non-juridical day " +
      "(art. 111 al. 2 C.C.P.), backward deadlines before a hearing (preceding_business_day), " +
      "and non-sitting periods (art. 82 al. 2 C.C.P.).",
  },
  interets_1619: {
    titre: "Legal interest and additional indemnity calculator (art. 1619 C.C.Q.)",
    texte:
      "Computes simple interest (art. 1620 C.C.Q.) under Exact/Exact (365/366) convention " +
      "(start date excluded, end date included) using exact BigInt rational accumulation rounded " +
      "once per tranche: legal interest (5%), art. 1619 C.C.Q. additional indemnity per embedded " +
      "art. 28 T.A.A. rates (Revenu Québec), or fixed contractual rate. Never extrapolates past " +
      "the latest published quarter.",
  },
  greffe_parse_number: {
    titre: "Québec court file number (offline)",
    texte:
      "Reads NNN-NN-NNNNNN-NNN into its registry — courthouse and judicial district — and its " +
      "jurisdiction: court, competence, registry type. A letter prefix (TAL, TAQ, C.F.…) names " +
      "a tribunal that numbers its own files. Read from tables surveyed from the ministère de la " +
      "Justice du Québec on 2026-11-17 (registry table 2026-07-22) and compiled into the Worker: " +
      "no call is made, no docket is consulted, and nothing here proves that the file exists.",
  },
  palais_list: {
    titre: "Québec courthouses — directory",
    texte:
      "The 44 courthouses and 9 justice service points of Québec, with civic address, the registry " +
      "numbers sitting there and their judicial district. Filterable by district, type or free " +
      "text. Surveyed from the ministère de la Justice du Québec on 2026-11-17 — use palais_get " +
      "for phone numbers, faxes, emails and opening hours, and check with the Ministry before serving or filing.",
  },
  palais_get: {
    titre: "Québec courthouse — record",
    texte:
      "One location in full, by registry number or by name: civic address, distinct mailing " +
      "address where published, opening hours, fax, phone numbers and emails per chamber or " +
      "service, registries sitting there, and — for a circuit court — the communities served. " +
      "Surveyed from the ministère de la Justice du Québec on 2026-11-17; a missing address means " +
      "UNKNOWN, never non-existent.",
  },
  registre_search: {
    titre: "Business registries (QC / Canada) — search",
    texte:
      "Offline search across read-only open-data snapshots of the Registraire des entreprises du " +
      "Québec (REQ, enriched with active RBQ contractor licences, OPC permits, and RENA public-contract " +
      "ineligibility records) and Corporations Canada. Matches corporate names, trade names, numbered " +
      "corporations ('9123-4567 Québec inc.'), NEQ, or federal corporation numbers. Natural-person " +
      "directors and shareholders are excluded from REQ open data by statute: verify live official " +
      "status before serving proceedings or naming a party.",
  },
  registre_get_entity: {
    titre: "Business registries (QC / Canada) — full record",
    texte:
      "Retrieves an entity's full snapshot record by 10-digit NEQ (Québec registration status, legal " +
      "form and governing statute, key dates, elected domicile or address exemption, current and " +
      "former trade names, establishments, amalgamations/continuations, RBQ licences, OPC permits, " +
      "and RENA listings) or by federal corporation number / 9-digit BN (Corporations Canada). " +
      "Informational snapshot only — never an official certificate or attestation.",
  },
  adresse_verify: {
    titre: "Québec address reference (RQA) — verification and normalization",
    texte:
      "Verifies municipal civic existence and normalizes Québec addresses against the Référentiel " +
      "québécois des adresses (RQA, MRNF) and Odonymes et renvois. Recovers typos and common " +
      "abbreviations ('boul', 'Mtl', 'St-', former street names), distinguishes confirmed condo " +
      "subdivisions from unconfirmed suites, reports street civic ranges, postal codes, indicative " +
      "cadastral lots/assessment roll numbers, and probable judicial district. Never proves a party's " +
      "domicile or land ownership.",
  },
  terminologie_lookup: {
    titre: "Bilingual and bijural legal terminology — lookup",
    texte:
      "Bilingual FR/EN search across four ranked legal terminology sources (rank 1: curated Québec " +
      "civil and commercial litigation glossary; rank 2: aligned statutory concordance and federal " +
      "bijural doublets; rank 3: TERMIUM Plus — Law and Justice; rank 4: OQLF legal domains). " +
      "Flags common-law and continental-French false friends ('mortgage' vs 'hypothec', 'joint and " +
      "several' vs 'solidary', 'assignation' vs 'demande introductive d'instance').",
  },
  termino_attestations: {
    titre: "Legal terminology — bilingual statutory attestations (QC / CA)",
    texte:
      "Counts exact occurrences of a legal term or phrase across the aligned bilingual statutory " +
      "concordance (Civil Code of Québec, Code of Civil Procedure, Québec statutes, and federal " +
      "statutes under ss. 8.1–8.2 Interpretation Act) and returns side-by-side FR/EN statutory " +
      "snippets by statute and section to ground drafting choices in attested legislative usage.",
  },
  terminologie_scan: {
    titre: "Legal terminology — draft contamination scanner",
    texte:
      "Read-only scan of a draft pleading, contract, letter, or memo excerpt (up to 32,000 characters, " +
      "FR or EN) to flag continental-French legalisms, common-law calques and false friends in Québec " +
      "civil-law drafting ('mortgage', 'statute of limitations', 'joint and several', 'consideration', " +
      "'easement'), and pre-2016 C.C.P. archaisms. Reports offsets, rationale, suggested civil-law " +
      "replacement, and statutory basis without ever rewriting the text.",
  },
} as const;

export const EN = {
  titre: "MCP Outils",

  intro: [
    "A public, zero-logging, deterministic MCP server for Québec civil and commercial litigation: " +
      "statutory holidays, procedural deadlines, legal interest and additional indemnity, court file " +
      "number parsing and courthouses, business registries (REQ / RBQ / OPC / RENA / Corporations " +
      "Canada), Québec civic addresses (RQA), and bilingual bijural legal terminology.",
  ],

  avertissement: [
    "Every computation and lookup executes locally with zero outbound HTTP calls, read-only D1 " +
      "open-data snapshots, zero runtime writes, and zero logging of request payloads, party names, " +
      "addresses, draft excerpts, dates, amounts, or file numbers.",
    "This server performs arithmetic and reads dated snapshots only: it never establishes whether " +
      "a court file exists, never replaces live Registraire des entreprises or Land Register " +
      "verifications, never proves a party's domicile, and never qualifies legal deadlines automatically. " +
      "Verify official primary sources before serving or filing.",
  ],

  // ── Les cinq familles d'outils ─────────────────────────────────────────────
  familleCalcul: "Deterministic calculators (holidays, deadlines, art. 1619 C.C.Q. interest)",
  familleCalculTexte: [
    "Three pure arithmetic tools built around the Code of Civil Procedure, Québec and federal " +
      "Interpretation Acts, and the Civil Code of Québec (art. 1618–1620 C.C.Q., embedded art. 28 " +
      "T.A.A. quarterly table).",
  ],
  familleGreffe: "Local Québec tables — court file numbers and courthouses",
  familleGreffeTexte: [
    "Three tools that read reference tables compiled into the Worker, surveyed from the " +
      "ministère de la Justice du Québec (courthouses and contact details 2026-11-17, registry attachments 2026-07-22). " +
      "They make no outbound calls, consult no court docket (plumitif), and write nothing.",
  ],
  familleRegistre:
    "Business registries (QC / Canada) — REQ, RBQ, OPC, RENA and Corporations Canada",
  familleRegistreTexte: [
    "Two tools backed by a read-only D1 snapshot of public corporate open data. Natural-person " +
      "directors, officers, and shareholders are excluded from the REQ public dataset pursuant to " +
      "the Act respecting the legal publicity of enterprises (CQLR, c. P-44.1).",
  ],
  familleAdresse: "Québec civic addresses — Référentiel québécois des adresses (RQA)",
  familleAdresseTexte: [
    "One tool backed by a normalized read-only D1 snapshot of the ~5M-address Référentiel québécois " +
      "des adresses (MRNF) and Odonymes et renvois. Confirms municipal civic existence without ever " +
      "establishing domicile or land title.",
  ],
  familleTerminologie: "Bilingual and bijural legal terminology (FR / EN)",
  familleTerminologieTexte: [
    "Three tools backed by a read-only D1 terminology database combining a curated Québec civil-law " +
      "glossary, aligned bilingual statutory concordances, TERMIUM Plus (Law and Justice), and OQLF " +
      "legal entries to prevent common-law and continental-French terminology contamination.",
  ],

  // ── Schémas ────────────────────────────────────────────────────────────────
  schemaTexte: [
    "Every tool declares a closed input schema: any unrecognised property is rejected. These " +
      "tables are generated directly from the live Zod schemas applied at call time, so they cannot " +
      "drift from what the server accepts.",
    "The Description column stays in FRENCH in both language views, deliberately: those sentences " +
      "are the canonical strings sent to the model.",
  ],
  colParam: "Parameter",
  colType: "Type",
  colContrainte: "Constraints",
  colDescription: "Description",
  requis: "required",

  // ── Numéro de dossier ──────────────────────────────────────────────────────
  dossierTexte: [
    "A Québec judicial file number reads NNN-NN-NNNNNN-NNN. Positions 1-3 are the registry — " +
      "courthouse and judicial district. Positions 5-6 are the jurisdiction — court, competence, " +
      "registry type. The remainder is a sequence and check digits.",
    "Positions 7 onward are NOT parsed, and no checksum is verified: there is none. Inventing " +
      "one would reject valid numbers, which is the worse of the two faults.",
    "A letter prefix short-circuits all of this: TAL-, TAQ-, C.F.- and the like name a tribunal " +
      "that numbers its own files. The prefix IS the answer to « which tribunal ».",
  ],
  dossierExemples: "Outcomes, produced by the real parser",
  dossierExemplesTexte: [
    "The examples below are not transcribed. The page runs the parser as it renders and prints " +
      "what it returns, so this documentation cannot drift from the behaviour.",
  ],
  colEntree: "Input",
  colIssue: "Outcome",

  // ── Greffes et palais ──────────────────────────────────────────────────────
  greffesTexte: [
    "The registries of Québec, keyed on the three-digit number a court file number begins with. " +
      "A registry is a REGISTER; a courthouse is a BUILDING — the relation is neither one-to-one " +
      "nor total, and one registry often serves several locations.",
  ],
  colGreffe: "Registry",
  colPalais: "Courthouse",
  colDistrict: "Judicial district",
  colAdresse: "Address",
  colTypeLieu: "Type",
  typeItinerant: "circuit court",
  sansAdresse: "no published address",
  tousDistricts: "All districts",
  coordonneesTitre: "Contact details and opening hours",
  coordonneesTexte: [
    "The palais_get tool (and structured output of greffe_parse_number) carries telephone numbers, " +
      "fax numbers, email addresses per chamber or service, and opening hours surveyed from the " +
      "ministère de la Justice du Québec on 2026-11-17 (44 courthouses and 9 service points).",
    "Phone numbers and opening hours may change without notice: verify on the Ministry's " +
      "official directory before serving, filing, or attending.",
  ],
  juridictionsTitre: "Jurisdiction codes",
  juridictionsTexte: [
    "The two-digit code at positions 5-6. The em dash in codes 46, 72 and 73 is a real value: " +
      "those series belong to no named court.",
  ],
  colCode: "Code",
  colTribunal: "Court",
  colCompetence: "Competence",
  colGreffeType: "Registry type",

  // ── Accès & pied ───────────────────────────────────────────────────────────
  acces: [
    "Public Streamable HTTP endpoint (no secret or authentication required): " +
      "https://outils.poirierlavoie.ca/mcp — designed to be paired with the « droit-civil-quebecois » " +
      "skill plugin alongside authenticated primary-source connectors.",
    "The public discovery card (SEP-2127) is served at " +
      "https://outils.poirierlavoie.ca/mcp/server-card; the repository includes manifests " +
      "for Google Antigravity (plugin.json, mcp_config.json) and Gemini CLI (gemini-extension.json). " +
      "Health endpoint without payload logging: https://outils.poirierlavoie.ca/healthz (edge rate limit: 60 req / 60 s per IP).",
    "The source code is public (CC BY-NC-SA 4.0 licence), and the entire test suite runs locally with no network access.",
  ],

  pied: [
    "Jason Poirier Lavoie, lawyer (Québec). Open-data sources: Revenu Québec (art. 28 T.A.A.), " +
      "ministère de la Justice du Québec, Registraire des entreprises (CC BY-NC-SA 4.0), RBQ / OPC / " +
      "AMP — RENA / MRNF — RQA (CC BY 4.0), Corporations Canada & TERMIUM Plus® (OGL-Canada), " +
      "and Office québécois de la langue française (CC BY-NC-SA 4.0).",
    "No legal advice. This tool replaces neither verification at the source nor professional " +
      "judgment.",
  ],
} as const;
