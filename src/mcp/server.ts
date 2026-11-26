import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

z.config(z.locales.fr());

import {
  AdresseVerifyInputSchema,
  AdresseVerifyOutputSchema,
  adresseVerify,
} from "../core/adresses.js";
import {
  ComputeDeadlinesInputSchema,
  type ComputeDeadlinesOutput,
  ComputeDeadlinesOutputSchema,
  computeDeadlines,
} from "../core/deadlines.js";
import {
  TauxBocRatesInputSchema,
  TauxBocRatesOutputSchema,
  tauxBocRates,
} from "../core/economie.js";
import type { Garde } from "../core/gardes.js";
import {
  ListHolidaysInputSchema,
  type ListHolidaysOutput,
  ListHolidaysOutputSchema,
  listHolidays,
} from "../core/holidays.js";
import {
  ComputeInterest1619InputSchema,
  type ComputeInterest1619Output,
  ComputeInterest1619OutputSchema,
  computeInterest1619,
} from "../core/interest1619.js";
import { IndiceIpcInputSchema, IndiceIpcOutputSchema, indiceIpc } from "../core/ipc.js";
import {
  PalaisGetInputSchema,
  PalaisGetOutputSchema,
  PalaisListInputSchema,
  PalaisListOutputSchema,
  ParseCourtFileInputSchema,
  ParseCourtFileOutputSchema,
  palaisGet,
  palaisList,
  parseCourtFile,
} from "../core/qcTools.js";
import {
  RegistreGetEntityInputSchema,
  RegistreGetEntityOutputSchema,
  RegistreSearchEntitiesInputSchema,
  RegistreSearchEntitiesOutputSchema,
  registreGetEntity,
  registreSearchEntities,
} from "../core/registres.js";
import { LoyerTalInputSchema, LoyerTalOutputSchema, loyerTal } from "../core/tal.js";
import {
  TerminologieAttestationsInputSchema,
  TerminologieAttestationsOutputSchema,
  TerminologieLookupInputSchema,
  TerminologieLookupOutputSchema,
  TerminologieScanTextInputSchema,
  TerminologieScanTextOutputSchema,
  terminologieAttestations,
  terminologieLookup,
  terminologieScanText,
} from "../core/terminologie.js";

export const SERVER_NAME = "mcp-outils";
export const SERVER_TITLE = "MCP Outils";
export const SERVER_VERSION = "2.2.1";
export const SERVER_DESCRIPTION =
  "Serveur MCP public, sans journalisation et déterministe pour le litige civil québécois : jours fériés et délais (C.p.c. / L.I.), intérêts légaux et indemnité additionnelle (art. 1619 C.c.Q., art. 28 L.A.F., taux préférentiel BDC), greffes et palais de justice (relevé MJQ), registres d'entreprises (REQ, RBQ, OPC, RENA, Corporations Canada, GLEIF), adresses civiques et lots RQA, terminologie bijuridique, taux Banque du Canada, IPC StatCan et calculateur TAL (RLRQ, c. T-15.01, r. 2).";

export const INSTRUCTIONS =
  "Serveur MCP public sans état applicatif ni journalisation des charges utiles, s'exécutant exclusivement à partir de règles arithmétiques, de tables statiques et de quatre bases D1 en lecture seule à la requête (aucun appel HTTP sortant, openWorldHint: false, readOnlyHint: true) : " +
  "1) Calculs — calendrier_holidays, calendrier_deadlines et interets_1619 appliquent des règles arithmétiques exactes (y compris le mode 'prime_plus_margin' fondé sur la série BDC V80691311) sans effectuer de qualification juridique ni d'extrapolation au-delà du dernier trimestre L.A.F. publié ou de la dernière date préférentielle vérifiée. " +
  "2) Greffes et palais du Québec — greffe_parse_number, palais_list et palais_get lisent un relevé local du ministère de la Justice du Québec (adresses et coordonnées relevées le 2026-11-17, table des lieux 2026-07-22) sans consulter aucun plumitif ; quatre greffes itinérants demeurent sans adresse civique fixe. " +
  "3) Registres d'entreprises — registre_search et registre_get_entity interrogent des instantanés locaux de données ouvertes (REQ, RBQ, OPC, RENA, Corporations Canada et GLEIF Golden Copy CC0 1.0 pour les LEI et hiérarchies corporatives Level 2). Les dirigeants, administrateurs et actionnaires personnes physiques sont exclus des jeux ouverts (Loi sur la publicité légale des entreprises, RLRQ, c. P-44.1 ; L.C.S.A.) : consulter les portails officiels (REQ, Corporations Canada, PCI/ISC et GLEIF) retournés dans portails_officiels avant toute signification ou désignation finale d'une partie. " +
  "4) Adresses civiques — adresse_verify vérifie et normalise une adresse québécoise selon le Référentiel québécois des adresses (RQA, MRNF). La présence au RQA atteste l'existence municipale d'une adresse civique, jamais le domicile ou l'établissement d'une partie ; les lots cadastraux et matricules n'ont qu'une valeur indicative (seul le Registre foncier du Québec fait foi). " +
  "5) Terminologie juridique bilingue et bijuridique — terminologie_lookup, termino_attestations et terminologie_scan assistent le choix terminologique FR/EN et détectent les calques et faux amis de common law ou de droit français sans jamais réécrire le texte ni remplacer l'interprétation des textes officiels (pour le texte intégral des lois et règlements, employer « lois » ; pour la jurisprudence, employer « juris »). " +
  "6) Économie, IPC et logement — taux_boc_rates consulte hors ligne les taux de change BdC/StatCan (midi HE avant le 2017-05-01, moyenne 16 h 30 HE depuis 2017-05-01) et les taux V39079/V122530/V80691311 avec conversion BigInt (art. 12 Loi sur la monnaie) ; indice_ipc fournit les indices IPC StatCan (18-10-0004-01 / 18-10-0005-01) et l'indexation contractuelle en BigInt avec contrôle strict d'année de base (2002=100 vs 1992=100) ; loyer_tal expose les barèmes TAL (2015–2027), le calculateur post-1er janvier 2026 (RLRQ, c. T-15.01, r. 2 ; Décret 1455-2025) avec gardes transitoires et art. 1955 C.c.Q., ainsi que les loyers moyens SCHL (34-10-0133-01).";

const READ_ONLY_LOCAL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export type ToolFamily = "calcul" | "greffe" | "registre" | "adresse" | "terminologie" | "economie";

export interface OutilsBindings {
  DB_TERMINOLOGIE?: D1Database;
  DB_REGISTRES?: D1Database;
  DB_ADRESSES?: D1Database;
  DB_ECONOMIE?: D1Database;
}

export interface ToolDescriptor {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly family: ToolFamily;
  readonly inputSchemaJson: Record<string, unknown>;
  readonly annotations: typeof READ_ONLY_LOCAL_ANNOTATIONS;
}

const TOOL_SPECS: ReadonlyArray<{
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly family: ToolFamily;
  readonly inputSchema: z.ZodType;
}> = [
  {
    name: "calendrier_holidays",
    title: "Jours fériés et non juridiques (QC / CA)",
    description:
      "Liste les jours fériés et non juridiques d'une année civile selon le régime choisi : 'qc_cpc' (art. 82 al. 1 C.p.c. et art. 61 par. 23° L.I., incluant samedis, 2 janvier et 26 décembre), 'qc_prescription' (art. 2879 al. 2 C.c.Q. et art. 61 par. 23° L.I., samedis reportés sans 2 janvier ni 26 décembre), 'qc_li' (Loi d'interprétation du Québec, samedis non reportés par défaut sauf bureau de la publicité des droits) ou 'ca_li' (Loi d'interprétation fédérale, incluant 30 septembre et 11 novembre, avec paramètre province='QC' optionnel pour inclure le 24 juin).",
    family: "calcul",
    inputSchema: ListHolidaysInputSchema,
  },
  {
    name: "calendrier_deadlines",
    title: "Calculateur déterministe de délais (C.p.c. / L.I.)",
    description:
      "Calcule de 1 à 25 délais procéduraux ou légaux de manière purement arithmétique (sans qualification juridique automatique). Supporte 'qc_cpc', 'qc_prescription' (art. 2879 al. 2 C.c.Q.), 'qc_li' (art. 52 L.I., rollover_saturday=false par défaut sauf publicité des droits) et 'ca_li' (avec province='QC' optionnel pour le 24 juin). Gère le déplacement technologique après 17 h 00 (art. 111 al. 2 C.p.c.), les délais à rebours (preceding_business_day) et les périodes hors séance (art. 82 al. 2 C.p.c.). Même pour un seul délai, passer un tableau deadlines d'un élément.",
    family: "calcul",
    inputSchema: ComputeDeadlinesInputSchema,
  },
  {
    name: "interets_1619",
    title: "Calculateur d'intérêts légaux et indemnité additionnelle (art. 1619 C.c.Q.)",
    description:
      "Calcule en arithmétique exacte (intérêt simple art. 1620 C.c.Q., convention Exact/Exact 365/366, date de départ exclue / date de fin incluse, accumulation rationnelle BigInt arrondie une fois par tranche) les intérêts légaux (5 %) et l'indemnité additionnelle de l'art. 1619 C.c.Q. selon la table embarquée de l'art. 28 L.A.F. (Revenu Québec), un taux contractuel fixe ou le taux préférentiel BDC V80691311 + marge (spread_bps). Supporte 1 à 50 tranches datées et 4 modes ('legal_plus_1619', 'legal_only', 'contractual', 'prime_plus_margin'). Ne fait jamais d'extrapolation au-delà de la dernière période vérifiée.",
    family: "calcul",
    inputSchema: ComputeInterest1619InputSchema,
  },
  {
    name: "greffe_parse_number",
    title: "Numéro de dossier de cour du Québec (hors ligne)",
    description:
      "Analyse un numéro de dossier de cour du Québec (NNN-NN-NNNNNN-NNN) et en tire le greffe — palais de justice et district judiciaire — puis la juridiction : tribunal, compétence, type de greffe. Un préfixe alphabétique (TAL, TAQ, C.F.…) désigne un tribunal administratif ou une cour fédérale, qui numérotent leurs dossiers eux-mêmes. Données de référence LOCALES, relevées auprès du ministère de la Justice du Québec : cet outil n'interroge aucun service externe ni aucun registre, et n'établit donc PAS que le dossier existe ou qu'il est actif. Les positions 7 et suivantes ne sont pas analysées ; aucune somme de contrôle n'est vérifiée.",
    family: "greffe",
    inputSchema: ParseCourtFileInputSchema,
  },
  {
    name: "palais_list",
    title: "Palais de justice du Québec — répertoire",
    description:
      "Répertorie les 44 palais de justice et 9 points de service de justice du Québec, avec leur adresse municipale, les numéros de greffe qui y siègent et leur district judiciaire. Filtrable par district, par type de lieu ou par texte libre (nom, ville, numéro de greffe). Relevé auprès du ministère de la Justice du Québec le 2026-11-17 : employer palais_get pour les coordonnées, télécopieurs et heures d'ouverture, et vérifier la liste officielle du Ministère avant toute signification ou tout dépôt.",
    family: "greffe",
    inputSchema: PalaisListInputSchema,
  },
  {
    name: "palais_get",
    title: "Palais de justice du Québec — fiche",
    description:
      "Fiche d'un lieu de justice du Québec, par numéro de greffe (3 chiffres) OU par nom de palais : adresse municipale, adresse postale distincte le cas échéant, heures d'ouverture, télécopieur, coordonnées téléphoniques et courriels par chambre ou service, greffes qui y siègent, district judiciaire et, pour une cour itinérante, les localités desservies. Relevé LOCAL auprès du ministère de la Justice du Québec (2026-11-17), sans appel sortant. Quatre greffes itinérants n'ont aucune adresse civique fixe publiée : l'outil le dit sans jamais affirmer qu'il n'en existe pas.",
    family: "greffe",
    inputSchema: PalaisGetInputSchema,
  },
  {
    name: "registre_search",
    title: "Registres d'entreprises (QC / Canada / GLEIF) — recherche",
    description:
      "Recherche hors ligne dans les instantanés locaux de données ouvertes du Registraire des entreprises du Québec (REQ, enrichi des licences RBQ actives, permis OPC et inscriptions RENA), de Corporations Canada (sociétés fédérales) et de la GLEIF (entités canadiennes titulaires d'un LEI ISO 17442, dont banques, fiducies et sociétés extraprovinciales). Trouve une entité par dénomination sociale, autre nom utilisé, société à numéro ('9123-4567 Québec inc.'), NEQ, numéro fédéral ou LEI à 20 caractères, et signale has_lei. Exclut les dirigeants et bénéficiaires ultimes personnes physiques (L.P.L.E. / L.C.S.A.) : vérifier aux portails officiels avant toute signification ou désignation d'une partie.",
    family: "registre",
    inputSchema: RegistreSearchEntitiesInputSchema,
  },
  {
    name: "registre_get_entity",
    title: "Registres d'entreprises (QC / Canada / GLEIF) — fiche complète",
    description:
      "Récupère la fiche détaillée d'une entreprise par NEQ à 10 chiffres (Québec : statut, forme/régime juridique, domicile élu ou dispense d'adresse LPLE, établissements, fusions/scissions, RBQ, OPC et RENA), numéro de société fédérale / NE à 9 chiffres (Corporations Canada) ou LEI ISO 17442 à 20 caractères (GLEIF Level 1 et hiérarchie comptable Level 2 : parent_direct, parent_ultime y compris sociétés mères étrangères, exceptions_declaration REPEX et filiales canadiennes). Retourne les liens directs vers les portails officiels (REQ, Corporations Canada, PCI/ISC fédéral et GLEIF) pour consulter les administrateurs et bénéficiaires ultimes personnes physiques sans jamais en stocker ni en retourner. Instantanés locaux sans valeur de certificat officiel.",
    family: "registre",
    inputSchema: RegistreGetEntityInputSchema,
  },
  {
    name: "adresse_verify",
    title: "Référentiel québécois des adresses (RQA) — vérification et normalisation",
    description:
      "Vérifie l'existence municipale d'une adresse québécoise et la normalise selon le Référentiel québécois des adresses (RQA, MRNF) et Odonymes et renvois, ou effectue une recherche inversée par numéro de lot cadastral (`lot_number`) ou matricule d'évaluation (`matricule`). Corrige les fautes de frappe et abréviations courantes ('boul', 'Mtl', 'St-', anciens odonymes), distingue les unités confirmées des bureaux non subdivisés, précise la provenance des lots (unité vs repli sur l'immeuble parent) et les ambiguïtés de copropriété, et indique la plage civique d'une rue, le code postal, les lots cadastraux et matricules indicatifs ainsi que le district judiciaire probable par municipalité. N'établit jamais le domicile ou l'établissement d'une partie ni la propriété foncière.",
    family: "adresse",
    inputSchema: AdresseVerifyInputSchema,
  },
  {
    name: "terminologie_lookup",
    title: "Terminologie juridique bilingue et bijuridique — recherche",
    description:
      "Recherche bilingue FR/EN dans la base terminologique juridique hiérarchisée (rang 1 : glossaire curé de pratique civile et commerciale québécoise ; rang 2 : concordancier législatif et doublets bijuridiques fédéraux ; rang 3 : TERMIUM Plus — Droit et justice ; rang 4 : OQLF — domaines du droit). Signale les calques et faux amis de common law ou de droit français (p. ex. 'mortgage' vs 'hypothec', 'joint and several' vs 'solidary', 'assignation' vs 'demande introductive d'instance').",
    family: "terminologie",
    inputSchema: TerminologieLookupInputSchema,
  },
  {
    name: "termino_attestations",
    title: "Terminologie juridique — attestations statutaires bilingues (QC / CA)",
    description:
      "Compte les occurrences exactes d'un terme ou syntagme juridique dans le concordancier législatif bilingue aligné (Code civil du Québec, Code de procédure civile, lois québécoises et lois fédérales dont les art. 8.1-8.2 L.I.) et retourne les extraits FR et EN côte à côte par loi et article afin d'ancrer un choix rédactionnel dans l'usage législatif attesté.",
    family: "terminologie",
    inputSchema: TerminologieAttestationsInputSchema,
  },
  {
    name: "terminologie_scan",
    title: "Terminologie juridique — détection des contaminations dans un projet d'acte",
    description:
      "Analyse en lecture seule un extrait de projet d'acte, contrat, correspondance ou note (jusqu'à 32 000 caractères, FR ou EN) pour repérer les francismes de droit français ('assignation' au sens d'acte introductif, 'référé', 'garde à vue'), les anglicismes et faux amis de common law en droit civil québécois ('mortgage', 'statute of limitations', 'joint and several', 'consideration', 'easement') et les archaïsmes procéduraux d'avant 2016 ('bref', 'comparution', 'défense et demande reconventionnelle'). Signale chaque occurrence avec motif, remplacement suggéré et base légale sans jamais réécrire le texte.",
    family: "terminologie",
    inputSchema: TerminologieScanTextInputSchema,
  },
  {
    name: "taux_boc_rates",
    title: "Taux de change et taux directeurs (Banque du Canada — hors ligne)",
    description:
      "Consulte hors ligne dans DB_ECONOMIE les taux de change historiques et quotidiens face au dollar canadien (Banque du Canada FX_RATES_DAILY depuis le 2017-05-01 en moyenne quotidienne 16 h 30 HE, LEGACY_NOON_RATES 2007–2017 et Statistique Canada 10-10-0008-01 2001–2007 en taux au comptant de midi HE), ainsi que le taux directeur (V39079), le taux d'escompte (V122530) et le taux préférentiel (V80691311). Effectue la conversion exacte en BigInt devise étrangère <-> CAD selon l'art. 12 de la Loi sur la monnaie en signalant tout report au jour ouvrable précédent et le régime méthodologique.",
    family: "economie",
    inputSchema: TauxBocRatesInputSchema,
  },
  {
    name: "indice_ipc",
    title: "Indice des prix à la consommation (Statistique Canada — hors ligne)",
    description:
      "Consulte hors ligne dans DB_ECONOMIE l'indice des prix à la consommation (Statistique Canada 18-10-0004-01 mensuel et 18-10-0005-01 annuel : Ensemble, Logement, Logement locatif, Loyer et Services de soins de santé pour le Québec, les RMR de Montréal et Québec et le Canada, base 2002=100 et série historique 1992=100), calcule la variation annuelle (%) et effectue une indexation contractuelle exacte en BigInt avec options de plancher (floor_bps), plafond (cap_bps), arrondi et garde-fou strict contre les divergences d'année de base.",
    family: "economie",
    inputSchema: IndiceIpcInputSchema,
  },
  {
    name: "loyer_tal",
    title: "Fixation de loyer TAL (RLRQ, c. T-15.01, r. 2) et loyers SCHL",
    description:
      "Outil complet de fixation de loyer au Québec : 1) mode 'bareme' : pourcentages officiels publiés par le TAL (pré-2026 de 2015 à 2026 incluant le mazout -10,0 % en 2024, et post-2026 Décret 1455-2025 : 4,5 % / 6,0 % pour janv.–1er avril 2026 et 3,1 % / 6,7 % + 5,0 % immobilisations pour 2 avril 2026–1er avril 2027) ; 2) mode 'calcul_2026' : calculateur déterministe exact en BigInt reproduisant la grille officielle TAL 2026 (base IPC, part RPA, taxes municipales/scolaires et assurances asymétriques, travaux 5 % avec subvention/prêt réduit, nouvelles dépenses, aides et arrondi art. 15.1) avec gardes transitoires (< 2026-01-01) et art. 1955 C.c.Q. ; 3) mode 'schl' : loyers moyens du marché (StatCan 34-10-0133-01) dans DB_ECONOMIE.",
    family: "economie",
    inputSchema: LoyerTalInputSchema,
  },
];

let cachedDescriptors: ToolDescriptor[] | null = null;

export function listToolDescriptors(): readonly ToolDescriptor[] {
  if (cachedDescriptors === null) {
    cachedDescriptors = TOOL_SPECS.map((spec) => ({
      name: spec.name,
      title: spec.title,
      description: spec.description,
      family: spec.family,
      inputSchemaJson: z.toJSONSchema(spec.inputSchema) as Record<string, unknown>,
      annotations: READ_ONLY_LOCAL_ANNOTATIONS,
    }));
  }
  return cachedDescriptors;
}

const TOOL_SPEC_BY_NAME = new Map(TOOL_SPECS.map((spec) => [spec.name, spec]));

function specFor(name: string) {
  const spec = TOOL_SPEC_BY_NAME.get(name);
  if (!spec) {
    throw new Error(`Descripteur d'outil manquant : ${name}`);
  }
  return spec;
}

function toolConfig<TOutput extends z.ZodType>(name: string, outputSchema: TOutput) {
  const spec = specFor(name);
  return {
    title: spec.title,
    description: spec.description,
    outputSchema,
    annotations: { ...READ_ONLY_LOCAL_ANNOTATIONS },
  };
}

function missingDatabaseError(bindingName: string, domainLabel: string) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: `Base D1 en lecture seule (${bindingName} — ${domainLabel}) non liée dans cet environnement d'exécution.`,
      },
    ],
  };
}

function formatGardesSection(gardes: Garde[]): string {
  if (gardes.length === 0) return "";
  const lines = gardes.map((g) => `- [${g.code}] ${g.message}`);
  return `\nGardes :\n${lines.join("\n")}`;
}

function formatHolidaysText(out: ListHolidaysOutput): string {
  const lines = out.holidays.map(
    (h) => `- ${h.date} (${h.weekday_fr}) : ${h.name_fr} — ${h.legal_basis}`,
  );
  const provinceSuffix = out.province ? ` — province : ${out.province}` : "";
  return [
    `Jours fériés et non juridiques (${out.year}) — ${out.regime}${provinceSuffix}`,
    `Régime : ${out.regime_label_fr}`,
    `Jours hebdomadaires non juridiques : ${out.weekly_non_juridical_days.join(", ")} (report samedi : ${out.saturday_triggers_deadline_rollover ? "oui" : "non"})`,
    "",
    ...lines,
    formatGardesSection(out.gardes),
    `\nSource : ${out.provenance.source} (vérifié le ${out.provenance.verified_at})`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDeadlinesText(out: ComputeDeadlinesOutput): string {
  const lines = out.results.map((r) => {
    const flags: string[] = [];
    if (r.anchor_shifted_art_111) flags.push("art. 111 al. 2 C.p.c.");
    if (r.rolled_over) flags.push("reporté");
    if (r.in_non_sitting_period && r.non_sitting_period_label) {
      flags.push(`hors séance : ${r.non_sitting_period_label}`);
    }
    const suffix = flags.length > 0 ? ` [${flags.join("; ")}]` : "";
    return `- ${r.label} (${r.direction}) : ${r.effective_date} (${r.effective_weekday_fr})${suffix}\n  Calcul : ${r.formula_summary_fr}`;
  });
  const provinceSuffix = out.province ? ` — province : ${out.province}` : "";
  return [
    `Calcul de délais (${out.regime_label_fr}${provinceSuffix})`,
    ...lines,
    formatGardesSection(out.gardes),
    `\nSource : ${out.provenance.source} (vérifié le ${out.provenance.verified_at})`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBpsPercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(".", ",")} %`;
}

function formatInterestText(out: ComputeInterest1619Output): string {
  const truncatedEndDates = out.tranches
    .filter((t) => t.truncated)
    .map((t) => t.effective_end_date)
    .sort();
  const truncEndDate =
    truncatedEndDates[truncatedEndDates.length - 1] ?? out.tranches[0]?.effective_end_date ?? "";
  const truncBanner = out.truncated_any
    ? out.mode === "prime_plus_margin"
      ? `[CALCUL TRONQUÉ AU ${truncEndDate} — TAUX PRÉFÉRENTIEL BDC NON VÉRIFIÉ AU-DELÀ]`
      : `[CALCUL TRONQUÉ AU ${truncEndDate} — TAUX ART. 28 L.A.F. NON PUBLIÉ AU-DELÀ]`
    : "";
  const anyOverridden = out.tranches.some((t) => t.periods.some((p) => p.overridden));
  const overrideBanner = anyOverridden
    ? "[TAUX L.A.F. SURCHARGÉS PAR L'APPELANT — NON VÉRIFIÉS DANS LA TABLE EMBARQUÉE]"
    : "";
  const omitTables = out.tranches.length > 10;

  const trancheBlocks = out.tranches.flatMap((t) => {
    const truncNote = t.truncated
      ? ` [TRONQUÉ au ${t.effective_end_date}${t.missing_quarter ? `, trimestre manquant : ${t.missing_quarter}` : ""}]`
      : "";
    const summaryLine = `- ${t.label} : capital ${t.principal_cad} $ (${t.start_date_excluded} exclu → ${t.effective_end_date} inclus, ${t.accrued_days} j) → intérêt total ${t.total_interest_cad} $ (légal ${t.legal_interest_cad} $, ind. add. ${t.additional_indemnity_cad} $, conv. ${t.contractual_interest_cad} $)${truncNote}`;
    if (t.periods.length === 0) {
      return [summaryLine];
    }
    if (omitTables) {
      return [
        summaryLine,
        "  (Ventilation détaillée par période omise du résumé texte pour > 10 tranches ; consulter structuredContent.tranches[].periods)",
      ];
    }
    const tableHeader =
      "  | Période | Dates (incluses) | Jours | Base | Taux effectif (1619 / L.A.F.) | Intérêt légal | Ind. add. 1619 | Contractuel | Sous-total exact |";
    const tableSep = "  |---|---|---:|---:|---:|---:|---:|---:|---:|";
    const periodRows = t.periods.map((p) => {
      const ovTag = p.overridden ? " [surcharge]" : "";
      let rateDetail: string;
      if (p.laf_rate_bps !== null) {
        rateDetail =
          p.laf_rate_bps < p.legal_rate_bps
            ? `${formatBpsPercent(p.effective_rate_bps)} (taux légal min. 5,00 % ; L.A.F. ${formatBpsPercent(p.laf_rate_bps)} < 5,00 % ⇒ ind. add. 0,00 %)${ovTag}`
            : `${formatBpsPercent(p.effective_rate_bps)} (L.A.F. ${formatBpsPercent(p.laf_rate_bps)} = 5,00 % + ${formatBpsPercent(p.additional_rate_bps)})${ovTag}`;
      } else if (p.prime_rate_bps !== null) {
        const spreadSign = (p.spread_bps ?? 0) >= 0 ? "+" : "-";
        rateDetail = `${formatBpsPercent(p.effective_rate_bps)} (préf. ${formatBpsPercent(p.prime_rate_bps)} ${spreadSign} ${formatBpsPercent(Math.abs(p.spread_bps ?? 0))})`;
      } else if (p.contractual_rate_bps > 0) {
        rateDetail = `${formatBpsPercent(p.effective_rate_bps)} (contractuel)`;
      } else {
        rateDetail = formatBpsPercent(p.effective_rate_bps);
      }
      return `  | ${p.period_label} | ${p.start_date_included} → ${p.end_date_included} | ${p.days} j | /${p.year_days} | ${rateDetail} | ${p.legal_interest_cad_exact_6dec} $ | ${p.additional_indemnity_cad_exact_6dec} $ | ${p.contractual_interest_cad_exact_6dec} $ | ${p.total_interest_cad_exact_6dec} $ |`;
    });
    return [summaryLine, tableHeader, tableSep, ...periodRows];
  });

  return [
    truncBanner,
    overrideBanner,
    `Calcul d'intérêts (${out.mode}) — ${out.convention}`,
    `Capital total : ${out.total_principal_cad} $`,
    `Intérêt légal total (5 %) : ${out.total_legal_interest_cad} $`,
    `Indemnité additionnelle totale (art. 1619 C.c.Q.) : ${out.total_additional_indemnity_cad} $`,
    `Intérêt contractuel total : ${out.total_contractual_interest_cad} $`,
    `Intérêts cumulés : ${out.total_interest_cad} $`,
    `Grand total (capital + intérêts)${truncBanner ? ` ${truncBanner}` : ""} : ${out.grand_total_cad} $`,
    "Arrondi : accumulation rationnelle exacte et arrondi au cent UNE fois par tranche (les sous-totaux à 6 décimales des périodes sont indicatifs et leur somme arrondie séparément peut différer de 0,01 $).",
    "",
    "Détail par tranche et ventilation par période :",
    ...trancheBlocks,
    formatGardesSection(out.gardes),
    `\nSource : ${out.provenance.source} (table ${out.provenance.table_version ?? "n/a"}, vérifiée le ${out.provenance.verified_at})`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function createOutilsMcpServer(env: OutilsBindings = {}): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: SERVER_TITLE,
      version: SERVER_VERSION,
      description: SERVER_DESCRIPTION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: INSTRUCTIONS,
    },
  );

  server.registerTool(
    "calendrier_holidays",
    {
      ...toolConfig("calendrier_holidays", ListHolidaysOutputSchema),
      inputSchema: ListHolidaysInputSchema,
    },
    async (args) => {
      try {
        const result = listHolidays(args);
        return {
          structuredContent: result,
          content: [{ type: "text", text: formatHolidaysText(result) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de calcul : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "calendrier_deadlines",
    {
      ...toolConfig("calendrier_deadlines", ComputeDeadlinesOutputSchema),
      inputSchema: ComputeDeadlinesInputSchema,
    },
    async (args) => {
      try {
        const result = computeDeadlines(args);
        return {
          structuredContent: result,
          content: [{ type: "text", text: formatDeadlinesText(result) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de validation ou de calcul : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "interets_1619",
    {
      ...toolConfig("interets_1619", ComputeInterest1619OutputSchema),
      inputSchema: ComputeInterest1619InputSchema,
    },
    async (args) => {
      try {
        const result = computeInterest1619(args);
        return {
          structuredContent: result,
          content: [{ type: "text", text: formatInterestText(result) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de validation ou de calcul : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "greffe_parse_number",
    {
      ...toolConfig("greffe_parse_number", ParseCourtFileOutputSchema),
      inputSchema: ParseCourtFileInputSchema,
    },
    async (args) => {
      try {
        const { structured, text } = parseCourtFile(args);
        return {
          structuredContent: structured,
          content: [{ type: "text", text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur d'analyse de dossier : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "palais_list",
    {
      ...toolConfig("palais_list", PalaisListOutputSchema),
      inputSchema: PalaisListInputSchema,
    },
    async (args) => {
      try {
        const { structured, text } = palaisList(args);
        return {
          structuredContent: structured,
          content: [{ type: "text", text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de répertoire des palais : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "palais_get",
    {
      ...toolConfig("palais_get", PalaisGetOutputSchema),
      inputSchema: PalaisGetInputSchema,
    },
    async (args) => {
      try {
        const result = palaisGet(args);
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: result.text }],
          };
        }
        return {
          structuredContent: result.structured,
          content: [{ type: "text", text: result.text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de consultation de palais : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "registre_search",
    {
      ...toolConfig("registre_search", RegistreSearchEntitiesOutputSchema),
      inputSchema: RegistreSearchEntitiesInputSchema,
    },
    async (args) => {
      if (!env.DB_REGISTRES) {
        return missingDatabaseError("DB_REGISTRES", "registres d'entreprises");
      }
      try {
        const { structured, text } = await registreSearchEntities(env.DB_REGISTRES, args);
        return {
          structuredContent: structured,
          content: [{ type: "text", text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de recherche aux registres : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "registre_get_entity",
    {
      ...toolConfig("registre_get_entity", RegistreGetEntityOutputSchema),
      inputSchema: RegistreGetEntityInputSchema,
    },
    async (args) => {
      if (!env.DB_REGISTRES) {
        return missingDatabaseError("DB_REGISTRES", "registres d'entreprises");
      }
      try {
        const result = await registreGetEntity(env.DB_REGISTRES, args);
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: result.text }],
          };
        }
        return {
          structuredContent: result.structured,
          content: [{ type: "text", text: result.text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de consultation aux registres : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "adresse_verify",
    {
      ...toolConfig("adresse_verify", AdresseVerifyOutputSchema),
      inputSchema: AdresseVerifyInputSchema,
    },
    async (args) => {
      if (!env.DB_ADRESSES) {
        return missingDatabaseError("DB_ADRESSES", "référentiel québécois des adresses");
      }
      try {
        const result = await adresseVerify(env.DB_ADRESSES, args);
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: result.text }],
          };
        }
        return {
          structuredContent: result.structured,
          content: [{ type: "text", text: result.text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de vérification d'adresse : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "terminologie_lookup",
    {
      ...toolConfig("terminologie_lookup", TerminologieLookupOutputSchema),
      inputSchema: TerminologieLookupInputSchema,
    },
    async (args) => {
      if (!env.DB_TERMINOLOGIE) {
        return missingDatabaseError("DB_TERMINOLOGIE", "terminologie juridique");
      }
      try {
        const { structured, text } = await terminologieLookup(env.DB_TERMINOLOGIE, args);
        return {
          structuredContent: structured,
          content: [{ type: "text", text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de recherche terminologique : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "termino_attestations",
    {
      ...toolConfig("termino_attestations", TerminologieAttestationsOutputSchema),
      inputSchema: TerminologieAttestationsInputSchema,
    },
    async (args) => {
      if (!env.DB_TERMINOLOGIE) {
        return missingDatabaseError("DB_TERMINOLOGIE", "terminologie juridique");
      }
      try {
        const { structured, text } = await terminologieAttestations(env.DB_TERMINOLOGIE, args);
        return {
          structuredContent: structured,
          content: [{ type: "text", text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur d'attestations statutaires : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "terminologie_scan",
    {
      ...toolConfig("terminologie_scan", TerminologieScanTextOutputSchema),
      inputSchema: TerminologieScanTextInputSchema,
    },
    async (args) => {
      if (!env.DB_TERMINOLOGIE) {
        return missingDatabaseError("DB_TERMINOLOGIE", "terminologie juridique");
      }
      try {
        const { structured, text } = await terminologieScanText(env.DB_TERMINOLOGIE, args);
        return {
          structuredContent: structured,
          content: [{ type: "text", text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur d'analyse terminologique : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "taux_boc_rates",
    {
      ...toolConfig("taux_boc_rates", TauxBocRatesOutputSchema),
      inputSchema: TauxBocRatesInputSchema,
    },
    async (args) => {
      if (!env.DB_ECONOMIE) {
        return missingDatabaseError(
          "DB_ECONOMIE",
          "taux de change et taux directeurs (Banque du Canada)",
        );
      }
      try {
        const result = await tauxBocRates(env.DB_ECONOMIE, args);
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: result.text }],
          };
        }
        return {
          structuredContent: result.structured,
          content: [{ type: "text", text: result.text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de consultation des taux BoC : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "indice_ipc",
    {
      ...toolConfig("indice_ipc", IndiceIpcOutputSchema),
      inputSchema: IndiceIpcInputSchema,
    },
    async (args) => {
      if (!env.DB_ECONOMIE) {
        return missingDatabaseError(
          "DB_ECONOMIE",
          "indice des prix à la consommation (Statistique Canada)",
        );
      }
      try {
        const result = await indiceIpc(env.DB_ECONOMIE, args);
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: result.text }],
          };
        }
        return {
          structuredContent: result.structured,
          content: [{ type: "text", text: result.text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de consultation IPC : ${msg}` }],
        };
      }
    },
  );

  server.registerTool(
    "loyer_tal",
    {
      ...toolConfig("loyer_tal", LoyerTalOutputSchema),
      inputSchema: LoyerTalInputSchema,
    },
    async (args) => {
      if (args.mode === "schl" && !env.DB_ECONOMIE) {
        return missingDatabaseError("DB_ECONOMIE", "loyers moyens du marché SCHL");
      }
      try {
        const result = await loyerTal(env.DB_ECONOMIE ?? null, args);
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: result.text }],
          };
        }
        return {
          structuredContent: result.structured,
          content: [{ type: "text", text: result.text }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Erreur de calcul ou de consultation TAL : ${msg}` }],
        };
      }
    },
  );

  return server;
}
