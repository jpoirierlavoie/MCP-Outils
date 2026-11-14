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
  calendrier_list_holidays: {
    titre: "Holidays and non-juridical days (QC / CA)",
    texte:
      "Lists statutory holidays and non-juridical days for a calendar year under 'qc_cpc' " +
      "(art. 82 al. 1 C.C.P. and art. 61 par. 23° I.A., including Saturdays, Jan 2 and Dec 26), " +
      "'qc_li' (Québec Interpretation Act), or 'ca_li' (federal Interpretation Act, including " +
      "Sept 30 and Nov 11).",
  },
  calendrier_compute_deadlines: {
    titre: "Deterministic deadline calculator (C.C.P. / I.A.)",
    texte:
      "Computes 1 to 25 procedural or statutory deadlines purely arithmetically (without " +
      "automatic legal qualification). Handles non-juridical rollover (art. 83 al. 3 C.C.P., " +
      "art. 52 I.A.), technological notification shift after 17:00 or on a non-juridical day " +
      "(art. 111 al. 2 C.C.P.), backward deadlines before a hearing (preceding_business_day), " +
      "and non-sitting periods (art. 82 al. 2 C.C.P.).",
  },
  interets_compute_1619: {
    titre: "Legal interest and additional indemnity calculator (art. 1619 C.C.Q.)",
    texte:
      "Computes simple interest (art. 1620 C.C.Q.) under Exact/Exact (365/366) convention " +
      "(start date excluded, end date included) using exact BigInt rational accumulation rounded " +
      "once per tranche: legal interest (5%), art. 1619 C.C.Q. additional indemnity per embedded " +
      "art. 28 T.A.A. rates (Revenu Québec), or fixed contractual rate. Never extrapolates past " +
      "the latest published quarter.",
  },
  greffe_parse_court_file_number: {
    titre: "Québec court file number (offline)",
    texte:
      "Reads NNN-NN-NNNNNN-NNN into its registry — courthouse and judicial district — and its " +
      "jurisdiction: court, competence, registry type. A letter prefix (TAL, TAQ, C.F.…) names " +
      "a tribunal that numbers its own files. Read from tables surveyed from the ministère de la " +
      "Justice du Québec on 2026-07-15 and compiled into the Worker: no call is made, no docket is " +
      "consulted, and nothing here proves that the file exists.",
  },
  palais_list: {
    titre: "Québec courthouses — directory",
    texte:
      "The courthouses and justice service points of Québec, with civic address, the registry " +
      "numbers sitting there and their judicial district. Filterable by district, type or free " +
      "text. Surveyed from the ministère de la Justice du Québec on 2026-07-15 — addresses age, " +
      "and no telephone number is carried: check with the Ministry before serving or filing.",
  },
  palais_get: {
    titre: "Québec courthouse — record",
    texte:
      "One location in full, by registry number or by name: address, distinct mailing address " +
      "where one is published, registries sitting there, and — for a circuit court — the " +
      "communities served. Surveyed from the ministère de la Justice du Québec on 2026-07-15; a " +
      "missing address means UNKNOWN, never non-existent.",
  },
} as const;

export const EN = {
  titre: "Pratique civile — deterministic Québec practice tools",

  intro: [
    "A public, stateless, deterministic MCP server for Québec civil and commercial litigation: " +
      "statutory holidays, procedural deadlines, legal interest and additional indemnity, court file " +
      "number parsing, and Québec courthouse directory.",
  ],

  avertissement: [
    "Every computation and lookup is strictly offline and stateless: zero database, zero outbound " +
      "HTTP calls, zero logging of request payloads, dates, amounts, or file numbers.",
    "This server performs arithmetic and reads dated reference tables only: it never establishes " +
      "whether a court file exists, never qualifies legal deadlines automatically, and carries no " +
      "courthouse telephone numbers or opening hours. Verify official sources before serving or filing.",
  ],

  // ── Les deux familles d'outils ─────────────────────────────────────────────
  familleCalcul: "Deterministic calculators (holidays, deadlines, art. 1619 C.C.Q. interest)",
  familleCalculTexte: [
    "Three pure arithmetic tools built around the Code of Civil Procedure, Québec and federal " +
      "Interpretation Acts, and the Civil Code of Québec (art. 1618–1620 C.C.Q., embedded art. 28 " +
      "T.A.A. quarterly table).",
  ],
  familleGreffe: "Local Québec tables — court file numbers and courthouses",
  familleGreffeTexte: [
    "Three tools that read reference tables compiled into the Worker, surveyed from the " +
      "ministère de la Justice du Québec (courthouses 2026-07-15, registry attachments 2026-07-22). " +
      "They make no outbound calls, consult no court docket (plumitif), and write nothing.",
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
  aucuneCoordonnee: "No contact information",
  aucuneCoordonneeTexte: [
    "This connector carries NO telephone number, no email address and no opening hours — for any " +
      "courthouse. That is a property of the data, not a failure of the page.",
    "Registry telephone numbers are published per chamber (Montréal alone publishes at least " +
      "four), on the Ministry's own site. Obtain them there.",
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
      "https://outils.poirierlavoie.ca/mcp — designed to be paired with the « pratique-civile-quebecoise » " +
      "skill plugin alongside authenticated primary-source connectors.",
    "Health endpoint without payload logging: https://outils.poirierlavoie.ca/healthz. Edge rate " +
      "limiting protects availability (60 req / 60 s per IP) without storing application content.",
    "The code is open source, and the entire test suite runs locally with no network access.",
  ],

  pied: [
    "Jason Poirier Lavoie, lawyer (Québec). Statutory interest rates: Revenu Québec (art. 28 T.A.A.). " +
      "Registry and courthouse data: ministère de la Justice du Québec.",
    "No legal advice. This tool replaces neither verification at the source nor professional " +
      "judgment.",
  ],
} as const;
