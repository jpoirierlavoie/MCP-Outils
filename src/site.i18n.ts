/**
 * Chaînes ANGLAISES de la page publique (`GET /`).
 *
 * Ce dépôt est francophone : les titres d'outils, descriptions, schémas et
 * réserves (`GARDE_*`) n'existent qu'en français, langue canonique reçue par le
 * modèle. Ce fichier ne porte QUE les traductions anglaises de la page publique.
 */

import bocPrimeRatesJson from "./data/boc_prime_rates.json" with { type: "json" };
import lafRatesJson from "./data/laf_art28_rates.json" with { type: "json" };

export interface OutilEn {
  readonly titre: string;
  readonly resume: readonly string[];
  readonly texte: string;
}

export const OUTILS_EN: Readonly<Record<string, OutilEn>> = {
  calendrier_holidays: {
    titre: "Holidays and non-juridical days (QC / CA)",
    resume: [
      "Lists statutory holidays and non-juridical days for a given year under Québec's Code of Civil Procedure, Civil Code prescription rules, or Québec/federal Interpretation Acts.",
    ],
    texte:
      "Lists statutory holidays and non-juridical days for a calendar year under 'qc_cpc' " +
      "(art. 82 al. 1 C.C.P. and art. 61 par. 23° I.A., including Saturdays, Jan 2 and Dec 26), " +
      "'qc_prescription' (art. 2879 al. 2 C.C.Q. and art. 61 par. 23° I.A., Saturday rollover " +
      "without Jan 2 or Dec 26), 'qc_li' (Québec Interpretation Act, Saturday rollover off by " +
      "default except land registry), or 'ca_li' (federal Interpretation Act, including Sept 30 " +
      "and Nov 11, with optional province='QC' to include June 24).",
  },
  calendrier_deadlines: {
    titre: "Deterministic deadline calculator (C.C.P. / I.A.)",
    resume: [
      "Calculates up to 25 procedural or statutory deadlines at once (forward or backward), handling after-5:00 p.m. electronic notification shifts, weekend/holiday rollovers, and summer/winter non-sitting periods.",
      "Applies pure calendar arithmetic without deciding which legal deadline applies — always verify the governing rule.",
    ],
    texte:
      "Computes 1 to 25 procedural or statutory deadlines purely arithmetically (without " +
      "automatic legal qualification) under 'qc_cpc', 'qc_prescription' (art. 2879 al. 2 C.C.Q.), " +
      "'qc_li' (rollover_saturday=false by default except land registry art. 52 al. 2 I.A.), and " +
      "'ca_li' (optional province='QC' for June 24; rollover_saturday=false by default per s. 26 & 35(1) I.A.). Handles technological notification shift " +
      "after 17:00 (art. 111 al. 2 C.C.P.), backward deadlines (preceding_business_day), and " +
      "non-sitting periods (art. 82 al. 2 C.C.P.).",
  },
  interets_1619: {
    titre: "Legal interest and additional indemnity calculator (art. 1619 C.C.Q.)",
    resume: [
      "Calculates exact legal interest (5%), the art. 1619 C.C.Q. additional indemnity (embedded Revenu Québec art. 28 T.A.A. quarterly rates), a fixed contractual rate, or Bank of Canada Prime (V80691311) plus margin (spread_bps) across up to 50 tranches.",
      "Never estimates future periods beyond Revenu Québec's latest published quarter or the latest verified Prime date.",
    ],
    texte:
      "Computes simple interest (art. 1620 C.C.Q.) under Exact/Exact (365/366) convention " +
      "(start date excluded, end date included) using exact BigInt rational accumulation rounded " +
      "once per tranche: legal interest (5%), art. 1619 C.C.Q. additional indemnity per embedded " +
      "art. 28 T.A.A. rates (Revenu Québec), fixed contractual rate, or Bank of Canada Prime " +
      "(V80691311) + margin (spread_bps). Never extrapolates past the latest verified date.",
  },
  greffe_parse_number: {
    titre: "Québec court file number (offline)",
    resume: [
      "Breaks down a Québec court file number (or tribunal prefix like TAL-, TAQ-, C.F.-) to identify the registry, courthouse, judicial district, court, and competence.",
      "Reads offline reference tables only — it does not check any court docket or prove a file exists.",
    ],
    texte:
      "Reads NNN-NN-NNNNNN-NNN into its registry — courthouse and judicial district — and its " +
      "jurisdiction: court, competence, registry type. A letter prefix (TAL, TAQ, C.F.…) names " +
      "a tribunal that numbers its own files. Read from tables surveyed from the ministère de la " +
      "Justice du Québec on 2026-11-17 (registry table 2026-07-22) and compiled into the Worker: " +
      "no call is made, no docket is consulted, and nothing here proves that the file exists.",
  },
  palais_list: {
    titre: "Québec courthouses — directory",
    resume: [
      "Lists Québec's 44 courthouses and 9 service points with their civic addresses, registry numbers, and judicial districts, filterable by region or name.",
    ],
    texte:
      "The 44 courthouses and 9 justice service points of Québec, with civic address, the registry " +
      "numbers sitting there and their judicial district. Filterable by district, type or free " +
      "text. Surveyed from the ministère de la Justice du Québec on 2026-11-17 — use palais_get " +
      "for phone numbers, faxes, emails and opening hours, and check with the Ministry before serving or filing.",
  },
  palais_get: {
    titre: "Québec courthouse — record",
    resume: [
      "Returns complete contact details for a courthouse (street and mailing addresses, opening hours, fax, phone numbers, and chamber/registry emails). Always confirm on the Ministry's site before serving or filing.",
    ],
    texte:
      "One location in full, by registry number or by name: civic address, distinct mailing " +
      "address where published, opening hours, fax, phone numbers and emails per chamber or " +
      "service, registries sitting there, and — for a circuit court — the communities served. " +
      "Surveyed from the ministère de la Justice du Québec on 2026-11-17; a missing address means " +
      "UNKNOWN, never non-existent.",
  },
  registre_search: {
    titre: "Business registries (QC / Canada / GLEIF) — search",
    resume: [
      "Searches offline snapshots of Québec's Registraire des entreprises (REQ, enriched with RBQ, OPC, and RENA records), Corporations Canada, and GLEIF (Canadian LEI holders including banks and trusts) by name, trade name, numbered-company name, NEQ, federal number, or 20-char LEI, surfacing has_lei.",
      "Natural-person directors and beneficial owners are omitted from open datasets by law; verify live official portals before naming or serving a party.",
    ],
    texte:
      "Offline search across read-only open-data snapshots of the Registraire des entreprises du " +
      "Québec (REQ, enriched with active RBQ contractor licences, OPC permits, and RENA public-contract " +
      "ineligibility records), Corporations Canada, and GLEIF Golden Copy (Canadian LEI holders). " +
      "Matches corporate names, trade names, numbered corporations ('9123-4567 Québec inc.'), NEQ, " +
      "federal corporation numbers, or 20-char ISO 17442 LEIs, and surfaces has_lei. Natural-person " +
      "directors and UBOs are excluded by statute: verify live official portals before serving " +
      "proceedings or naming a party.",
  },
  registre_get_entity: {
    titre: "Business registries (QC / Canada / GLEIF) — full record",
    resume: [
      "Looks up a company's full snapshot record by 10-digit NEQ, federal corporation/BN number, or 20-char LEI (status, legal form, trade names, establishments, RBQ/OPC/RENA, GLEIF Level 2 accounting parents/exceptions/subsidiaries, and direct official REQ, Corporations Canada, ISC/PISC, and GLEIF links). Informational snapshot only — not an official certificate.",
    ],
    texte:
      "Retrieves an entity's full snapshot record by 10-digit NEQ (Québec registration status, legal " +
      "form and governing statute, key dates, elected domicile or LPLE address exemption, trade " +
      "names, establishments, amalgamations/continuations, RBQ licences, OPC permits, and RENA " +
      "listings), federal corporation number / 9-digit BN (Corporations Canada), or 20-char ISO 17442 " +
      "LEI (GLEIF Level 1 and Level 2 accounting-consolidation parents including foreign parents, " +
      "REPEX exceptions, and Canadian subsidiaries), alongside direct official portal links (REQ, " +
      "Corporations Canada, federal ISC/PISC, and GLEIF) with zero natural-person data stored or " +
      "returned. Informational snapshot only — never an official certificate or attestation.",
  },
  adresse_verify: {
    titre: "Québec address reference (RQA) — verification and normalization",
    resume: [
      "Verifies whether a Québec street address exists municipally and standardizes spelling, postal code, and probable judicial district (handling typos and former street names). Never proves domicile or property title.",
    ],
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
    resume: [
      "Finds accurate French/English Québec civil-law terms across curated civil-law glossaries, statutes, TERMIUM Plus, and the OQLF, while flagging common-law or French false friends (e.g., 'mortgage' vs. 'hypothec').",
    ],
    texte:
      "Bilingual FR/EN search across four ranked legal terminology sources (rank 1: curated Québec " +
      "civil and commercial litigation glossary; rank 2: aligned statutory concordance and federal " +
      "bijural doublets; rank 3: TERMIUM Plus — Law and Justice; rank 4: OQLF legal domains). " +
      "Flags common-law and continental-French false friends ('mortgage' vs 'hypothec', 'joint and " +
      "several' vs 'solidary', 'assignation' vs 'demande introductive d'instance').",
  },
  termino_attestations: {
    titre: "Legal terminology — bilingual statutory attestations (QC / CA)",
    resume: [
      "Checks how often a legal term appears in Québec and federal legislation and displays side-by-side FR/EN statutory excerpts to back up drafting choices.",
    ],
    texte:
      "Counts exact occurrences of a legal term or phrase across the aligned bilingual statutory " +
      "concordance (Civil Code of Québec, Code of Civil Procedure, Québec statutes, and federal " +
      "statutes under ss. 8.1–8.2 Interpretation Act) and returns side-by-side FR/EN statutory " +
      "snippets by statute and section to ground drafting choices in attested legislative usage.",
  },
  terminologie_scan: {
    titre: "Legal terminology — draft contamination scanner",
    resume: [
      "Scans a draft pleading, contract, or letter (FR or EN) to flag common-law terms ('mortgage', 'consideration', 'joint and several'), France-specific phrasing, and pre-2016 C.C.P. terms ('bref', 'comparution'), suggesting civil-law alternatives without altering your text.",
    ],
    texte:
      "Read-only scan of a draft pleading, contract, letter, or memo excerpt (up to 32,000 characters, " +
      "FR or EN) to flag continental-French legalisms, common-law calques and false friends in Québec " +
      "civil-law drafting ('mortgage', 'statute of limitations', 'joint and several', 'consideration', " +
      "'easement'), and pre-2016 C.C.P. archaisms. Reports offsets, rationale, suggested civil-law " +
      "replacement, and statutory basis without ever rewriting the text.",
  },
  taux_boc_rates: {
    titre: "Exchange rates and policy rates (Bank of Canada — offline)",
    resume: [
      "Queries offline Bank of Canada exchange rates against CAD (2001–2026+) and Policy, Bank, and Prime rates (V39079, V122530, V80691311), with exact BigInt conversion under s. 12 of the Currency Act.",
      "Explicitly flags pre-May 1, 2017 Noon spot rates vs. modern 16:30 ET daily averages and any prior-business-day rollback.",
    ],
    texte:
      "Offline read-only lookup in DB_ECONOMIE for historical and daily CAD exchange rates (Bank of " +
      "Canada FX_RATES_DAILY from 2017-05-01 as 16:30 ET daily averages, LEGACY_NOON_RATES 2007–2017 " +
      "and StatCan 10-10-0008-01 2001–2007 as noon spot rates), plus Policy (V39079), Bank (V122530), " +
      "and Prime (V80691311) series. Computes exact BigInt foreign <-> CAD conversions under s. 12 " +
      "of the Currency Act while flagging methodology and business-day rollbacks.",
  },
  indice_ipc: {
    titre: "Consumer Price Index (Statistics Canada — offline)",
    resume: [
      "Queries offline Statistics Canada Consumer Price Index series (Tables 18-10-0004-01 monthly and 18-10-0005-01 annual: All-items, Shelter, Rented accommodation, Rent, and Health care services for Québec, Montréal CMA, Québec CMA, and Canada) with year-over-year percentage changes.",
      "Computes exact BigInt contractual escalation with optional floor/cap and rounding, and blocks division across differing base years (2002=100 vs. 1992=100) without an official linking factor.",
    ],
    texte:
      "Offline read-only lookup in DB_ECONOMIE for Statistics Canada CPI levels (18-10-0004-01 " +
      "monthly and 18-10-0005-01 annual: All-items, Shelter, Rented accommodation, Rent, and Health " +
      "care services across Québec, Montréal CMA, Québec CMA, and Canada, 2002=100 base and " +
      "historical 1992=100 series), year-over-year %, and exact BigInt contractual escalation with " +
      "floor_bps, cap_bps, rounding options, and strict base-year mismatch protection.",
  },
  loyer_tal: {
    titre: "TAL rent fixing (CQLR, c. T-15.01, r. 2) and CMHC market rents",
    resume: [
      "Returns official TAL annual percentages (2015–2027), runs the deterministic post-Jan. 1, 2026 BigInt rent-fixing calculator (CQLR, c. T-15.01, r. 2; Order in Council 1455-2025) including RPA personal services, asymmetric taxes/insurance, 5% major capital works, and s. 15.1 rounding, and queries CMHC average market rents (34-10-0133-01).",
      "Flags pre-2026 notices (s. 6 O.C. 1455-2025), the 5-year Section F exemption (art. 1955 C.C.Q.), and TAL adjudicator discretion.",
    ],
    texte:
      "Comprehensive Québec rent-fixing tool: 1) 'bareme' mode returns official published TAL " +
      "percentages (pre-2026 2015–2026 including 2024 fuel oil -10.0%, and post-2026 O.C. 1455-2025: " +
      "4.5%/6.0% for Jan.–Apr. 1, 2026 and 3.1%/6.7% + 5.0% capital works for Apr. 2, 2026–Apr. 1, 2027); " +
      "2) 'calcul_2026' runs the exact BigInt 2026 TAL calculator with pre-2026 and art. 1955 C.C.Q. " +
      "guards; 3) 'schl' queries CMHC average market rents (StatCan 34-10-0133-01) in DB_ECONOMIE.",
  },
} as const;

export const EN = {
  titre: "MCP Tools — Deadlines, Interest, Registries & Legal Terminology",

  intro: [
    "Free public connector for Québec civil and commercial litigation (no account or key required). " +
      "It lets your AI assistant compute statutory holidays, C.C.P. deadlines, art. 1619 C.C.Q. " +
      "interest, and TAL rent adjustments accurately, and look up court file numbers, courthouses, " +
      "business registries (REQ, RBQ, OPC, RENA, Corporations Canada, GLEIF), civic addresses/lots (RQA), " +
      "bijural terminology, Bank of Canada rates, StatCan CPI, and CMHC rents.",
  ],

  avertissement: [
    "Every calculation and lookup runs locally on read-only public datasets, with no outbound calls " +
      "and no logging of party names, addresses, draft excerpts, dates, amounts, or file numbers.",
    "These tools follow arithmetic rules and dated open-data snapshots: they never prove a court " +
      "file exists, never replace live Registraire des entreprises or Land Register searches, never " +
      "prove a party's domicile, and never decide which legal deadline applies. Always verify official " +
      "sources before serving or filing.",
  ],

  // ── Les cinq familles d'outils ─────────────────────────────────────────────
  outilsIntro: [
    "You never need to run these tools manually: your AI assistant calls them automatically behind " +
      "the scenes when calculating dates or interest, verifying party details, or proofreading bilingual drafts.",
  ],
  familleCalcul: "Exact calculators (holidays, deadlines, art. 1619 C.C.Q. interest)",
  familleCalculTexte: [
    "Three arithmetic calculators based on the Code of Civil Procedure, Québec and federal " +
      "Interpretation Acts, and the Civil Code of Québec (art. 1618–1620 C.C.Q., art. 28 T.A.A. " +
      `rates through quarter ${lafRatesJson.metadata.last_quarter} and Bank of Canada chartered ` +
      `bank Prime rate V80691311 verified through ${bocPrimeRatesJson.metadata.last_verified_date}).`,
  ],
  familleGreffe: "Local Québec tables — court file numbers and courthouses",
  familleGreffeTexte: [
    "Three tools reading reference tables compiled from the ministère de la Justice du Québec " +
      "(courthouses surveyed 2026-11-17, registry attachments 2026-07-22). They make no outbound " +
      "calls and consult no court docket (plumitif).",
  ],
  familleRegistre:
    "Business registries (QC / Canada / GLEIF) — REQ, RBQ, OPC, RENA, Corporations Canada, and LEIs",
  familleRegistreTexte: [
    "Two tools backed by a read-only local snapshot of public corporate open data and GLEIF " +
      "accounting-consolidation hierarchies (CC0 1.0). Natural-person directors, officers, and " +
      "beneficial owners are excluded pursuant to the Act respecting the legal publicity of " +
      "enterprises (CQLR, c. P-44.1) and the CBCA; direct official portal links (REQ, Corporations " +
      "Canada, ISC/PISC, and GLEIF) are included with every profile.",
  ],
  familleAdresse: "Québec civic addresses — Référentiel québécois des adresses (RQA)",
  familleAdresseTexte: [
    "One tool backed by a read-only local copy of the ~5M-address Référentiel québécois des " +
      "adresses (MRNF) and Odonymes et renvois. Confirms municipal civic existence without ever " +
      "establishing domicile or land title.",
  ],
  familleTerminologie: "Bilingual and bijural legal terminology (FR / EN)",
  familleTerminologieTexte: [
    "Three tools backed by a read-only local terminology database combining a Québec civil-law " +
      "glossary, aligned bilingual statutory concordances, TERMIUM Plus (Law and Justice), and OQLF " +
      "legal entries to flag common-law and continental-French calques.",
  ],
  familleEconomie: "Economy, CPI, and housing (Bank of Canada, StatCan, and TAL)",
  familleEconomieTexte: [
    "Three tools combining a read-only local database (DB_ECONOMIE: Bank of Canada FX and policy " +
      "rates since 2001, StatCan monthly/annual CPI 18-10-0004-01 & 18-10-0005-01, and CMHC average " +
      "market rents 34-10-0133-01) with embedded Tribunal administratif du logement schedules (CQLR, c. T-15.01, r. 2).",
  ],

  // ── Schémas ────────────────────────────────────────────────────────────────
  schemaTexte: [
    "Technical reference for developers and automated scripts: every tool accepts only the " +
      "parameters listed below, generated directly from the server's validation rules.",
    "The Description column stays in French in both views because those sentences are the exact " +
      "canonical strings sent to the assistant.",
  ],
  schemaResume: "Show parameter tables for all 15 tools (technical reference)",
  colParam: "Parameter",
  colType: "Type",
  colContrainte: "Constraints",
  colDescription: "Description",
  requis: "required",

  // ── Numéro de dossier ──────────────────────────────────────────────────────
  dossierTexte: [
    "A Québec judicial file number reads NNN-NN-NNNNNN-NNN. Positions 1–3 identify the registry " +
      "(courthouse and judicial district), and positions 5–6 identify the jurisdiction (court, " +
      "competence, registry type). The remainder contains the sequence number and trailing digits.",
    "Positions 7 onward are not checked because there is no official checksum rule that would avoid " +
      "falsely rejecting valid numbers.",
    "When a number starts with a letter prefix (TAL-, TAQ-, C.F.-), that prefix directly names " +
      "a court or tribunal that issues its own file numbers.",
  ],
  dossierExemples: "Sample court file numbers",
  dossierExemplesTexte: [
    "Examples below show how the tool reads different court file formats directly:",
  ],
  colEntree: "Input",
  colIssue: "Outcome",

  // ── Greffes et palais ──────────────────────────────────────────────────────
  greffesTexte: [
    "Québec court registries, indexed by the three-digit number at the start of a court file " +
      "number. A registry is an administrative register and a courthouse is a building: a single " +
      "registry number can serve several locations, and a single courthouse can house several registries.",
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
    "The courthouse lookup (palais_get) includes telephone numbers, fax numbers, email addresses per " +
      "chamber or service, and opening hours surveyed from the ministère de la Justice du Québec on " +
      "2026-11-17 (44 courthouses and 9 service points).",
    "Phone numbers and opening hours may change without notice: verify on the Ministry's " +
      "official directory before serving, filing, or attending.",
  ],
  juridictionsTitre: "Jurisdiction codes",
  juridictionsTexte: [
    "The two-digit code at positions 5–6. The dash (—) for codes 46, 72, and 73 is normal: those " +
      "administrative series are not tied to a specific named court.",
  ],
  colCode: "Code",
  colTribunal: "Court",
  colCompetence: "Competence",
  colGreffeType: "Registry type",

  // ── Accès & pied ───────────────────────────────────────────────────────────
  acces: [
    "Public connector — no Barreau account, login, or API key required.",
    "If you install the droit-civil-quebecois plugin, this connector is included automatically. You " +
      "can also add https://outils.poirierlavoie.ca/mcp directly in claude.ai, ChatGPT, or Gemini " +
      "with « No authentication » selected.",
  ],
  accesTechniqueTitre: "Technical details (MCP discovery, rate limits & open-source licences)",
  accesTechnique: [
    "Public endpoint: https://outils.poirierlavoie.ca/mcp. The MCP Server Card is published at " +
      "https://outils.poirierlavoie.ca/mcp/server-card, and the repository includes standalone " +
      "manifests for Google Antigravity and Gemini CLI. Zero-logging health check: " +
      "https://outils.poirierlavoie.ca/healthz (rate limit: 240 requests per minute per IP).",
    "The source code and civil-law glossary are free and open-source under Apache-2.0 (see " +
      "LICENSE), while integrated public datasets remain governed by their publishers' licenses " +
      "documented in NOTICE (including CC BY-NC-SA 4.0 for REQ and OQLF).",
  ],

  pied: [
    "Jason Poirier Lavoie, lawyer (Québec). Open-data sources: Revenu Québec (art. 28 T.A.A.), " +
      "Tribunal administratif du logement / LégisQuébec (CQLR, c. T-15.01, r. 2), " +
      "Bank of Canada (FX and policy/prime rates), Statistics Canada (Tables 10-10-0008-01, " +
      "18-10-0004-01, 18-10-0005-01, and 34-10-0133-01 CMHC, OGL-Canada), " +
      "ministère de la Justice du Québec, Registraire des entreprises (CC BY-NC-SA 4.0), RBQ / OPC / " +
      "AMP — RENA / MRNF — RQA (CC BY 4.0), Corporations Canada & TERMIUM Plus® (OGL-Canada), " +
      "GLEIF Golden Copy L1/L2/REPEX (CC0 1.0), and Office québécois de la langue française (CC BY-NC-SA 4.0).",
    "No legal advice. This tool replaces neither verification at the source nor professional " +
      "judgment.",
  ],
} as const;
