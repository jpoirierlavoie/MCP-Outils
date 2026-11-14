import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  ComputeDeadlinesInputSchema,
  type ComputeDeadlinesOutput,
  ComputeDeadlinesOutputSchema,
  computeDeadlines,
} from "../core/deadlines.js";
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

export const SERVER_NAME = "pratique-civile-outils";
export const SERVER_TITLE = "Pratique civile — outils déterministes (Québec)";
export const SERVER_VERSION = "0.2.0";
export const SERVER_DESCRIPTION =
  "Serveur MCP public, sans état et déterministe pour le litige civil québécois : jours fériés et délais (C.p.c. / L.I.), intérêts légaux et indemnité additionnelle (art. 1619 C.c.Q., art. 28 L.A.F.), décomposition de numéros de dossier de cour et répertoire des palais de justice du Québec (relevé MJQ).";

export const INSTRUCTIONS =
  "Serveur MCP public sans état, sans base de données ni journalisation des charges utiles. " +
  "Tous les outils s'exécutent localement à partir de règles arithmétiques ou de tables statiques compilées " +
  "(openWorldHint: false, readOnlyHint: true) : " +
  "1) Calculs — calendrier_list_holidays, calendrier_compute_deadlines et interets_compute_1619 appliquent des règles arithmétiques exactes sans effectuer de qualification juridique ni d'extrapolation au-delà du dernier trimestre publié de l'art. 28 L.A.F. " +
  "2) Greffes et palais du Québec — greffe_parse_court_file_number, palais_list et palais_get lisent un relevé local du ministère de la Justice du Québec (adresses relevées le 2026-07-15, table des lieux 2026-07-22). " +
  "Ils ne consultent AUCUN registre de dossiers (aucun plumitif), ne portent AUCUNE coordonnée téléphonique ni courriel et n'établissent jamais qu'un dossier existe : vérifier les adresses et coordonnées officielles auprès du Ministère avant toute signification ou tout dépôt. " +
  "Pour vérifier l'existence d'une décision de jurisprudence ou d'une cour fédérale, employer le connecteur distinct « Jurisprudence » ; pour le texte officiel des lois et règlements, employer « Législation du Québec ».";

const READ_ONLY_LOCAL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export interface ToolDescriptor {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly family: "calcul" | "greffe";
  readonly inputSchemaJson: Record<string, unknown>;
  readonly annotations: typeof READ_ONLY_LOCAL_ANNOTATIONS;
}

const TOOL_SPECS: ReadonlyArray<{
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly family: "calcul" | "greffe";
  readonly inputSchema: z.ZodType;
}> = [
  {
    name: "calendrier_list_holidays",
    title: "Jours fériés et non juridiques (QC / CA)",
    description:
      "Liste les jours fériés et non juridiques d'une année civile selon le régime choisi : 'qc_cpc' (art. 82 al. 1 C.p.c. et art. 61 par. 23° L.I., incluant samedis, 2 janvier et 26 décembre), 'qc_li' (Loi d'interprétation du Québec) ou 'ca_li' (Loi d'interprétation fédérale, incluant 30 septembre et 11 novembre).",
    family: "calcul",
    inputSchema: ListHolidaysInputSchema,
  },
  {
    name: "calendrier_compute_deadlines",
    title: "Calculateur déterministe de délais (C.p.c. / L.I.)",
    description:
      "Calcule de 1 à 25 délais procéduraux ou légaux de manière purement arithmétique (sans qualification juridique automatique). Gère le report des jours non juridiques (art. 83 al. 3 C.p.c., art. 52 L.I.), le déplacement d'une notification technologique après 17 h 00 ou un jour non juridique (art. 111 al. 2 C.p.c.), les délais à rebours avant audience (preceding_business_day) et le repérage des périodes hors séance (art. 82 al. 2 C.p.c.). Même pour un seul délai, passer un tableau deadlines d'un élément.",
    family: "calcul",
    inputSchema: ComputeDeadlinesInputSchema,
  },
  {
    name: "interets_compute_1619",
    title: "Calculateur d'intérêts légaux et indemnité additionnelle (art. 1619 C.c.Q.)",
    description:
      "Calcule en arithmétique exacte (intérêt simple art. 1620 C.c.Q., convention Exact/Exact 365/366, date de départ exclue / date de fin incluse, accumulation rationnelle BigInt arrondie une fois par tranche) les intérêts légaux (5 %) et l'indemnité additionnelle de l'art. 1619 C.c.Q. selon la table embarquée de l'art. 28 L.A.F. (Revenu Québec). Supporte 1 à 50 tranches datées et 3 modes ('legal_plus_1619', 'legal_only', 'contractual'). Ne fait jamais d'extrapolation au-delà du dernier trimestre publié.",
    family: "calcul",
    inputSchema: ComputeInterest1619InputSchema,
  },
  {
    name: "greffe_parse_court_file_number",
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
      "Répertorie les palais de justice et points de service de justice du Québec, avec leur adresse municipale, les numéros de greffe qui y siègent et leur district judiciaire. Filtrable par district, par type de lieu ou par texte libre (nom, ville, numéro de greffe). Relevé auprès du ministère de la Justice du Québec le 2026-07-15 : les adresses DÉMÉNAGENT, et ce connecteur ne porte aucune coordonnée téléphonique ni courriel. Vérifier la liste officielle du Ministère avant toute signification ou tout dépôt.",
    family: "greffe",
    inputSchema: PalaisListInputSchema,
  },
  {
    name: "palais_get",
    title: "Palais de justice du Québec — fiche",
    description:
      "Fiche d'un lieu de justice du Québec, par numéro de greffe (3 chiffres) OU par nom de palais : adresse municipale, adresse postale distincte le cas échéant, greffes qui y siègent, district judiciaire et, pour une cour itinérante, les localités desservies. Relevé LOCAL auprès du ministère de la Justice du Québec, sans appel sortant. Six greffes n'ont aucune adresse publiée : l'outil le dit sans jamais affirmer qu'il n'en existe pas. Aucune coordonnée téléphonique ni courriel n'est portée par ce connecteur.",
    family: "greffe",
    inputSchema: PalaisGetInputSchema,
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

function toolConfig<TOutput extends z.ZodType>(
  name: string,
  outputSchema: TOutput,
) {
  const spec = specFor(name);
  return {
    title: spec.title,
    description: spec.description,
    outputSchema,
    annotations: { ...READ_ONLY_LOCAL_ANNOTATIONS },
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
  return [
    `Jours fériés et non juridiques (${out.year}) — ${out.regime}`,
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
  return [
    `Calcul de délais (${out.regime_label_fr})`,
    ...lines,
    formatGardesSection(out.gardes),
    `\nSource : ${out.provenance.source} (vérifié le ${out.provenance.verified_at})`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatInterestText(out: ComputeInterest1619Output): string {
  const trancheLines = out.tranches.map((t) => {
    const truncNote = t.truncated
      ? ` [TRONQUÉ au ${t.effective_end_date}, trimestre manquant : ${t.missing_quarter}]`
      : "";
    return `- ${t.label} : capital ${t.principal_cad} $ (${t.start_date_excluded} exclu → ${t.effective_end_date} inclus, ${t.accrued_days} j) → intérêt total ${t.total_interest_cad} $ (légal ${t.legal_interest_cad} $, ind. add. ${t.additional_indemnity_cad} $, conv. ${t.contractual_interest_cad} $)${truncNote}`;
  });
  return [
    `Calcul d'intérêts (${out.mode}) — ${out.convention}`,
    `Capital total : ${out.total_principal_cad} $`,
    `Intérêt légal total (5 %) : ${out.total_legal_interest_cad} $`,
    `Indemnité additionnelle totale (art. 1619 C.c.Q.) : ${out.total_additional_indemnity_cad} $`,
    `Intérêt contractuel total : ${out.total_contractual_interest_cad} $`,
    `Intérêts cumulés : ${out.total_interest_cad} $`,
    `Grand total (capital + intérêts) : ${out.grand_total_cad} $`,
    "",
    "Détail par tranche :",
    ...trancheLines,
    formatGardesSection(out.gardes),
    `\nSource : ${out.provenance.source} (table ${out.provenance.table_version ?? "n/a"}, vérifiée le ${out.provenance.verified_at})`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function createOutilsMcpServer(): McpServer {
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
    "calendrier_list_holidays",
    {
      ...toolConfig("calendrier_list_holidays", ListHolidaysOutputSchema),
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
    "calendrier_compute_deadlines",
    {
      ...toolConfig("calendrier_compute_deadlines", ComputeDeadlinesOutputSchema),
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
    "interets_compute_1619",
    {
      ...toolConfig("interets_compute_1619", ComputeInterest1619OutputSchema),
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
    "greffe_parse_court_file_number",
    {
      ...toolConfig("greffe_parse_court_file_number", ParseCourtFileOutputSchema),
      inputSchema: ParseCourtFileInputSchema,
    },
    async (args) => {
      const { structured, text } = parseCourtFile(args);
      return {
        structuredContent: structured,
        content: [{ type: "text", text }],
      };
    },
  );

  server.registerTool(
    "palais_list",
    {
      ...toolConfig("palais_list", PalaisListOutputSchema),
      inputSchema: PalaisListInputSchema,
    },
    async (args) => {
      const { structured, text } = palaisList(args);
      return {
        structuredContent: structured,
        content: [{ type: "text", text }],
      };
    },
  );

  server.registerTool(
    "palais_get",
    {
      ...toolConfig("palais_get", PalaisGetOutputSchema),
      inputSchema: PalaisGetInputSchema,
    },
    async (args) => {
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
    },
  );

  return server;
}
