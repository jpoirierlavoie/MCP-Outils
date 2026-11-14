import { McpServer } from "@modelcontextprotocol/server";
import {
  ComputeDeadlinesInputSchema,
  ComputeDeadlinesOutput,
  ComputeDeadlinesOutputSchema,
  computeDeadlines,
} from "../core/deadlines.js";
import { Garde } from "../core/gardes.js";
import {
  ListHolidaysInputSchema,
  ListHolidaysOutput,
  ListHolidaysOutputSchema,
  listHolidays,
} from "../core/holidays.js";
import {
  ComputeInterest1619InputSchema,
  ComputeInterest1619Output,
  ComputeInterest1619OutputSchema,
  computeInterest1619,
} from "../core/interest1619.js";

export const SERVER_NAME = "pratique-civile-outils";
export const SERVER_VERSION = "0.1.0";

function formatGardesSection(gardes: Garde[]): string {
  if (gardes.length === 0) return "";
  const lines = gardes.map((g) => `- [${g.code}] ${g.message}`);
  return `\nGardes :\n${lines.join("\n")}`;
}

function formatHolidaysText(out: ListHolidaysOutput): string {
  const lines = out.holidays.map(
    (h) => `- ${h.date} (${h.weekday_fr}) : ${h.name_fr} — ${h.legal_basis}`
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
      version: SERVER_VERSION,
      description:
        "Outils déterministes et sans état pour la pratique du litige civil québécois : jours fériés, délais procéduraux (C.p.c. / L.I.) et intérêts légaux + indemnité additionnelle (art. 1619 C.c.Q., art. 28 L.A.F.).",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.registerTool(
    "calendrier_list_holidays",
    {
      title: "Jours fériés et non juridiques (QC / CA)",
      description:
        "Liste les jours fériés et non juridiques d'une année civile selon le régime choisi : 'qc_cpc' (art. 82 al. 1 C.p.c. et art. 61 par. 23° L.I., incluant samedis, 2 janvier et 26 décembre), 'qc_li' (Loi d'interprétation du Québec) ou 'ca_li' (Loi d'interprétation fédérale, incluant 30 septembre et 11 novembre).",
      inputSchema: ListHolidaysInputSchema,
      outputSchema: ListHolidaysOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
    }
  );

  server.registerTool(
    "calendrier_compute_deadlines",
    {
      title: "Calculateur déterministe de délais (C.p.c. / L.I.)",
      description:
        "Calcule de 1 à 25 délais procéduraux ou légaux de manière purement arithmétique (sans qualification juridique automatique). Gère le report des jours non juridiques (art. 83 al. 3 C.p.c., art. 52 L.I.), le déplacement d'une notification technologique après 17 h 00 ou un jour non juridique (art. 111 al. 2 C.p.c.), les délais à rebours avant audience (preceding_business_day) et le repérage des périodes hors séance (art. 82 al. 2 C.p.c.). Même pour un seul délai, passer un tableau deadlines d'un élément.",
      inputSchema: ComputeDeadlinesInputSchema,
      outputSchema: ComputeDeadlinesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
    }
  );

  server.registerTool(
    "interets_compute_1619",
    {
      title: "Calculateur d'intérêts légaux et indemnité additionnelle (art. 1619 C.c.Q.)",
      description:
        "Calcule en arithmétique exacte (intérêt simple art. 1620 C.c.Q., convention Exact/Exact 365/366, date de départ exclue / date de fin incluse, accumulation rationnelle BigInt arrondie une fois par tranche) les intérêts légaux (5 %) et l'indemnité additionnelle de l'art. 1619 C.c.Q. selon la table embarquée de l'art. 28 L.A.F. (Revenu Québec). Supporte 1 à 50 tranches datées et 3 modes ('legal_plus_1619', 'legal_only', 'contractual'). Ne fait jamais d'extrapolation au-delà du dernier trimestre publié.",
      inputSchema: ComputeInterest1619InputSchema,
      outputSchema: ComputeInterest1619OutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
    }
  );

  return server;
}
