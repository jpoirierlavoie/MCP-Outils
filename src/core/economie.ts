import { z } from "zod";
import { compareIsoDates, diffCalendarDays, parseIsoDate } from "./dates.js";
import { assertSafeInt, formatMicros6, parseDecimalAmount } from "./format.js";
import { type GardeCode, GardeSchema, makeGarde, ProvenanceSchema } from "./gardes.js";
import { formatCentsToCad, roundHalfAwayFromZero } from "./interest1619.js";

const ISO_DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_AMOUNT_RE = /^\d+(?:\.\d{1,6})?$/;
const REGIME_SWITCH_INT = 20170501;
const MAX_FX_ROLLBACK_DAYS = 10;
const MAX_FX_FUTURE_TAIL_DAYS = 4;

const EconomieCategorySchema = z.enum(["fx", "policy", "bank", "prime", "all_rates"]);
type EconomieCategory = z.infer<typeof EconomieCategorySchema>;

const BocInterestSeriesIdSchema = z.enum(["V39079", "V122530", "V80691311"]);
type BocInterestSeriesId = z.infer<typeof BocInterestSeriesIdSchema>;

const ConversionDirectionSchema = z.enum(["foreign_to_cad", "cad_to_foreign"]);
type ConversionDirection = z.infer<typeof ConversionDirectionSchema>;

const FxMethodologySchema = z.enum(["noon_spot_pre_2017_05_01", "daily_average_1630_et"]);
type FxMethodology = z.infer<typeof FxMethodologySchema>;

export const TauxBocRatesInputSchema = z.strictObject({
  category: EconomieCategorySchema.optional().describe(
    "Catégorie recherchée : 'fx' (taux de change vs CAD), 'policy' (taux cible V39079), 'bank' (taux d'escompte V122530), 'prime' (taux préférentiel V80691311) ou 'all_rates' (les trois taux BoC). Par défaut 'fx' si currency ou amount est fourni, sinon 'all_rates'.",
  ),
  currency: z
    .string()
    .trim()
    .min(3)
    .max(16)
    .optional()
    .describe(
      "Code ISO 4217 de la devise étrangère (p. ex. 'USD', 'EUR', 'GBP', 'JPY') ou série Valet ('FXUSDCAD') pour category='fx'. Ne pas passer 'CAD'.",
    ),
  date: z
    .string()
    .regex(ISO_DATE_FORMAT_RE)
    .optional()
    .describe(
      "Date ISO YYYY-MM-DD d'une consultation ponctuelle (exclusif avec start_date/end_date).",
    ),
  start_date: z
    .string()
    .regex(ISO_DATE_FORMAT_RE)
    .optional()
    .describe("Date de début ISO YYYY-MM-DD d'une plage chronologique (requiert end_date)."),
  end_date: z
    .string()
    .regex(ISO_DATE_FORMAT_RE)
    .optional()
    .describe("Date de fin ISO YYYY-MM-DD d'une plage chronologique (requiert start_date)."),
  amount: z
    .string()
    .trim()
    .regex(DECIMAL_AMOUNT_RE)
    .optional()
    .describe(
      "Montant décimal strictement positif (jusqu'à 6 décimales, p. ex. '12500.50') à convertir en arithmétique exacte BigInt selon l'art. 12 de la Loi sur la monnaie (requiert date et currency).",
    ),
  direction: ConversionDirectionSchema.optional().describe(
    "Sens de conversion lorsque amount est fourni : 'foreign_to_cad' (défaut : devise étrangère vers CAD) ou 'cad_to_foreign' (CAD vers devise étrangère).",
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Nombre maximal d'observations retournées sur une plage (1 à 500, défaut : 100)."),
});
type TauxBocRatesInput = z.infer<typeof TauxBocRatesInputSchema>;

const FxObservationSchema = z.object({
  currency_code: z.string(),
  requested_date: z.string().nullable(),
  effective_observation_date: z.string(),
  rolled_back: z.boolean(),
  rollback_days: z.number().int(),
  rate_methodology: FxMethodologySchema,
  cad_per_foreign_unit: z.string(),
  foreign_per_cad_approx: z.string(),
  rate_micros: z.number().int(),
});

const InterestObservationSchema = z.object({
  series_id: BocInterestSeriesIdSchema,
  series_label_fr: z.string(),
  requested_date: z.string().nullable(),
  effective_observation_date: z.string(),
  rolled_back: z.boolean(),
  rollback_days: z.number().int(),
  rate_bps: z.number().int(),
  rate_percent: z.string(),
});

const CurrencyConversionSchema = z.object({
  direction: ConversionDirectionSchema,
  foreign_currency: z.string(),
  input_amount: z.string(),
  effective_observation_date: z.string(),
  rate_methodology: FxMethodologySchema,
  cad_per_foreign_unit: z.string(),
  converted_currency: z.string(),
  converted_cents: z.number().int(),
  converted_amount_2dec: z.string(),
  converted_amount_exact_6dec: z.string(),
  legal_basis: z.string(),
});

export const TauxBocRatesOutputSchema = z.object({
  category: EconomieCategorySchema,
  mode: z.enum(["single_date", "range"]),
  requested_date: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  currency: z
    .object({
      code: z.string(),
      name_fr: z.string(),
      name_en: z.string(),
      active_daily: z.boolean(),
    })
    .nullable(),
  count: z.number().int(),
  fx_observations: z.array(FxObservationSchema),
  interest_observations: z.array(InterestObservationSchema),
  conversion: CurrencyConversionSchema.nullable(),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
type TauxBocRatesOutput = z.infer<typeof TauxBocRatesOutputSchema>;

const SERIES_META: Record<
  BocInterestSeriesId,
  { labelFr: string; maxRollbackDays: number; maxTailDays: number }
> = {
  V39079: {
    labelFr: "Taux cible du financement à un jour (taux directeur, V39079)",
    maxRollbackDays: 10,
    maxTailDays: 4,
  },
  V122530: {
    labelFr: "Taux officiel d'escompte mensuel (V122530)",
    maxRollbackDays: 35,
    maxTailDays: 35,
  },
  V80691311: {
    labelFr: "Taux préférentiel hebdomadaire des banques à charte (V80691311)",
    maxRollbackDays: 10,
    maxTailDays: 10,
  },
};

function isoToInt(iso: string): number {
  parseIsoDate(iso);
  return Number(iso.replace(/-/g, ""));
}

function intToIso(dInt: number): string {
  const s = String(dInt).padStart(8, "0");
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function normalizeCurrencyCode(
  raw: string,
): { ok: true; code: string } | { ok: false; text: string } {
  const upper = raw.trim().toUpperCase();
  const valetMatch = /^FX([A-Z]{3})CAD$/.exec(upper);
  const code = valetMatch ? valetMatch[1]! : upper;
  if (code === "CAD") {
    return {
      ok: false,
      text: "La devise CAD est la monnaie de référence : préciser la devise étrangère (p. ex. 'USD', 'EUR', 'GBP', 'JPY').",
    };
  }
  if (!/^[A-Z]{3}$/.test(code)) {
    return {
      ok: false,
      text: `Code de devise invalide « ${raw} » : fournir un code ISO 4217 à 3 lettres (p. ex. 'USD', 'EUR') ou une série Valet ('FXUSDCAD').`,
    };
  }
  return { ok: true, code };
}

function methodologyForRegime(regime: number): FxMethodology {
  return regime === 1 ? "noon_spot_pre_2017_05_01" : "daily_average_1630_et";
}

function targetSeriesForCategory(category: EconomieCategory): BocInterestSeriesId[] {
  if (category === "policy") return ["V39079"];
  if (category === "bank") return ["V122530"];
  if (category === "prime") return ["V80691311"];
  if (category === "all_rates") return ["V39079", "V122530", "V80691311"];
  return [];
}

interface CurrencyRow {
  id: number;
  code: string;
  name_en: string;
  name_fr: string;
  active_daily: number;
  first_date: number;
  last_date: number;
}

interface FxRateRow {
  obs_date: number;
  regime: number;
  rate_micros: number;
}

interface BocRateRow {
  series_id: BocInterestSeriesId;
  obs_date: number;
  rate_bps: number;
}

interface MetaSourceRow {
  source_key: string;
  version_date: string;
}

export async function tauxBocRates(
  db: D1Database,
  input: TauxBocRatesInput,
): Promise<
  { ok: true; structured: TauxBocRatesOutput; text: string } | { ok: false; text: string }
> {
  try {
    if (input.date !== undefined) parseIsoDate(input.date);
    if (input.start_date !== undefined) parseIsoDate(input.start_date);
    if (input.end_date !== undefined) parseIsoDate(input.end_date);
  } catch (err) {
    return {
      ok: false,
      text: err instanceof Error ? err.message : "Date ISO invalide.",
    };
  }

  const hasSingle = input.date !== undefined;
  const hasRange = input.start_date !== undefined || input.end_date !== undefined;
  if (hasSingle && hasRange) {
    return {
      ok: false,
      text: "Fournir soit 'date' (consultation ponctuelle), soit 'start_date' et 'end_date' (plage chronologique), jamais les deux ensemble.",
    };
  }
  if (!hasSingle && (!input.start_date || !input.end_date)) {
    return {
      ok: false,
      text: "Préciser soit 'date', soit la paire complète 'start_date' et 'end_date'.",
    };
  }
  if (!hasSingle && compareIsoDates(input.start_date!, input.end_date!) > 0) {
    return {
      ok: false,
      text: `start_date (${input.start_date}) ne peut pas être postérieure à end_date (${input.end_date}).`,
    };
  }

  const category: EconomieCategory =
    input.category ??
    (input.currency !== undefined || input.amount !== undefined ? "fx" : "all_rates");

  if (input.currency !== undefined && category !== "fx") {
    return {
      ok: false,
      text: `Le paramètre 'currency' s'applique uniquement à category='fx' (reçu avec category='${category}').`,
    };
  }
  if (input.direction !== undefined && input.amount === undefined) {
    return {
      ok: false,
      text: "Le paramètre 'direction' requiert un montant 'amount'.",
    };
  }
  if (input.amount !== undefined) {
    if (category !== "fx" || !hasSingle || !input.currency) {
      return {
        ok: false,
        text: "La conversion d'un montant ('amount') requiert category='fx', une devise ('currency') et une date ponctuelle ('date').",
      };
    }
    const parsedAmt = parseDecimalAmount(input.amount);
    if (parsedAmt.num <= 0n) {
      return {
        ok: false,
        text: "Le montant 'amount' doit être strictement supérieur à zéro.",
      };
    }
  }

  const guardSet = new Set<GardeCode>(["TAUX_BOC_INSTANTANE_HORS_LIGNE"]);
  const limit = input.limit ?? 100;
  const metaRows = await db
    .prepare("SELECT source_key, version_date FROM meta_sources")
    .all<MetaSourceRow>();
  const metaVersions = new Map<string, string>(
    (metaRows.results ?? []).map((m) => [m.source_key, m.version_date]),
  );
  const latestMetaDate = Array.from(metaVersions.values()).sort().at(-1) ?? "2026-11-24";

  if (category === "fx") {
    if (!input.currency) {
      return {
        ok: false,
        text: "Préciser 'currency' (p. ex. 'USD', 'EUR', 'GBP', 'JPY') pour consulter un taux de change.",
      };
    }
    const norm = normalizeCurrencyCode(input.currency);
    if (!norm.ok) return norm;
    const ccyCode = norm.code;

    const ccyRow = await db
      .prepare(
        "SELECT id, code, name_en, name_fr, active_daily, first_date, last_date FROM fx_currencies WHERE code = ?",
      )
      .bind(ccyCode)
      .first<CurrencyRow>();
    if (!ccyRow) {
      return {
        ok: false,
        text: `Devise « ${ccyCode} » introuvable dans l'instantané DB_ECONOMIE (Banque du Canada / StatCan 10-10-0008-01).`,
      };
    }

    const currencySummary = {
      code: ccyRow.code,
      name_fr: ccyRow.name_fr || ccyRow.name_en,
      name_en: ccyRow.name_en,
      active_daily: Boolean(ccyRow.active_daily),
    };

    const fxObs: Array<z.infer<typeof FxObservationSchema>> = [];
    let conversion: z.infer<typeof CurrencyConversionSchema> | null = null;

    if (hasSingle) {
      const reqDate = input.date!;
      const reqInt = isoToInt(reqDate);
      const targetRegime = reqInt < REGIME_SWITCH_INT ? 1 : 2;
      const regimeLabel =
        targetRegime === 1
          ? "midi HE (pré-2017-05-01)"
          : "moyenne quotidienne 16 h 30 HE (2017-05-01+)";

      const globalMaxRow = await db
        .prepare("SELECT MAX(obs_date) AS m FROM fx_rates WHERE regime = ?")
        .bind(targetRegime)
        .first<{ m: number | null }>();
      const globalMaxInt = globalMaxRow?.m ?? null;
      if (globalMaxInt !== null && reqInt > globalMaxInt) {
        const globalMaxIso = intToIso(globalMaxInt);
        if (diffCalendarDays(globalMaxIso, reqDate) > MAX_FX_FUTURE_TAIL_DAYS) {
          return {
            ok: false,
            text: `La date demandée (${reqDate}) dépasse la dernière observation vérifiée dans DB_ECONOMIE (${globalMaxIso}) pour le régime ${regimeLabel}. Aucune extrapolation n'est effectuée.`,
          };
        }
      }

      const row = await db
        .prepare(
          "SELECT obs_date, regime, rate_micros FROM fx_rates WHERE currency_id = ? AND regime = ? AND obs_date <= ? ORDER BY obs_date DESC LIMIT 1",
        )
        .bind(ccyRow.id, targetRegime, reqInt)
        .first<FxRateRow>();

      if (!row) {
        const ccyBounds = await db
          .prepare(
            "SELECT MIN(obs_date) AS min_d, MAX(obs_date) AS max_d FROM fx_rates WHERE currency_id = ? AND regime = ?",
          )
          .bind(ccyRow.id, targetRegime)
          .first<{ min_d: number | null; max_d: number | null }>();
        const avail =
          ccyBounds?.min_d && ccyBounds?.max_d
            ? `plage disponible sous ce régime : ${intToIso(ccyBounds.min_d)} au ${intToIso(ccyBounds.max_d)}`
            : `aucune donnée publiée sous le régime ${regimeLabel} (plage globale de la devise : ${intToIso(ccyRow.first_date)} au ${intToIso(ccyRow.last_date)})`;
        return {
          ok: false,
          text: `Aucun taux de change disponible pour ${ccyCode} au ${reqDate} (${avail}).`,
        };
      }

      const effIso = intToIso(row.obs_date);
      const rollbackDays = diffCalendarDays(effIso, reqDate);
      if (rollbackDays > MAX_FX_ROLLBACK_DAYS) {
        return {
          ok: false,
          text: `Aucune cotation disponible pour ${ccyCode} au ${reqDate} : la dernière observation antérieure sous ce régime date du ${effIso} (écart de ${rollbackDays} jours > fenêtre maximale de ${MAX_FX_ROLLBACK_DAYS} jours ; série interrompue ou non cotée).`,
        };
      }

      const rolledBack = rollbackDays > 0;
      const methodology = methodologyForRegime(row.regime);
      if (methodology === "noon_spot_pre_2017_05_01") {
        guardSet.add("TAUX_BOC_NOON_HISTORIQUE_PRE_2017");
      }
      if (rolledBack) {
        guardSet.add("TAUX_BOC_REPORT_JOUR_OUVRABLE_PRECEDENT");
      }

      const rateMicros = BigInt(row.rate_micros);
      const cadPerForeign = formatMicros6(rateMicros);
      const foreignPerCadMicros = roundHalfAwayFromZero(1_000_000n * 1_000_000n, rateMicros);
      const foreignPerCadApprox = formatMicros6(foreignPerCadMicros);

      fxObs.push({
        currency_code: ccyCode,
        requested_date: reqDate,
        effective_observation_date: effIso,
        rolled_back: rolledBack,
        rollback_days: rollbackDays,
        rate_methodology: methodology,
        cad_per_foreign_unit: cadPerForeign,
        foreign_per_cad_approx: foreignPerCadApprox,
        rate_micros: row.rate_micros,
      });

      if (input.amount !== undefined) {
        guardSet.add("TAUX_BOC_CONVERSION_LOI_MONNAIE");
        const direction: ConversionDirection = input.direction ?? "foreign_to_cad";
        const { num, scale } = parseDecimalAmount(input.amount);

        const rawCents =
          direction === "foreign_to_cad"
            ? roundHalfAwayFromZero(num * rateMicros * 100n, scale * 1_000_000n)
            : roundHalfAwayFromZero(num * 1_000_000n * 100n, scale * rateMicros);
        const rawMicros =
          direction === "foreign_to_cad"
            ? roundHalfAwayFromZero(num * rateMicros * 1_000_000n, scale * 1_000_000n)
            : roundHalfAwayFromZero(num * 1_000_000n * 1_000_000n, scale * rateMicros);

        const convertedCents = assertSafeInt(rawCents, "lors de la conversion");
        conversion = {
          direction,
          foreign_currency: ccyCode,
          input_amount: input.amount,
          effective_observation_date: effIso,
          rate_methodology: methodology,
          cad_per_foreign_unit: cadPerForeign,
          converted_currency: direction === "foreign_to_cad" ? "CAD" : ccyCode,
          converted_cents: convertedCents,
          converted_amount_2dec: formatCentsToCad(rawCents),
          converted_amount_exact_6dec: formatMicros6(rawMicros),
          legal_basis:
            "Loi sur la monnaie (L.R.C. 1985, c. C-52, art. 12); art. 1561 et 3161 C.c.Q.",
        };
      }
    } else {
      const startInt = isoToInt(input.start_date!);
      const endInt = isoToInt(input.end_date!);
      const res = await db
        .prepare(
          "SELECT obs_date, regime, rate_micros FROM fx_rates " +
            "WHERE currency_id = ? AND obs_date BETWEEN ? AND ? " +
            "AND ((obs_date < ? AND regime = 1) OR (obs_date >= ? AND regime = 2)) " +
            "ORDER BY obs_date ASC LIMIT ?",
        )
        .bind(ccyRow.id, startInt, endInt, REGIME_SWITCH_INT, REGIME_SWITCH_INT, limit)
        .all<FxRateRow>();

      const rows = res.results ?? [];
      if (rows.length === 0) {
        return {
          ok: false,
          text: `Aucune observation de taux de change pour ${ccyCode} entre ${input.start_date} et ${input.end_date}.`,
        };
      }
      for (const r of rows) {
        const effIso = intToIso(r.obs_date);
        const methodology = methodologyForRegime(r.regime);
        if (methodology === "noon_spot_pre_2017_05_01") {
          guardSet.add("TAUX_BOC_NOON_HISTORIQUE_PRE_2017");
        }
        const rateMicros = BigInt(r.rate_micros);
        const foreignPerCadMicros = roundHalfAwayFromZero(1_000_000n * 1_000_000n, rateMicros);
        fxObs.push({
          currency_code: ccyCode,
          requested_date: null,
          effective_observation_date: effIso,
          rolled_back: false,
          rollback_days: 0,
          rate_methodology: methodology,
          cad_per_foreign_unit: formatMicros6(rateMicros),
          foreign_per_cad_approx: formatMicros6(foreignPerCadMicros),
          rate_micros: r.rate_micros,
        });
      }
    }

    const gardes = Array.from(guardSet).map((code) => makeGarde(code));
    const structured: TauxBocRatesOutput = {
      category: "fx",
      mode: hasSingle ? "single_date" : "range",
      requested_date: input.date ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      currency: currencySummary,
      count: fxObs.length,
      fx_observations: fxObs,
      interest_observations: [],
      conversion,
      provenance: {
        source:
          "Banque du Canada (Valet FX_RATES_DAILY & LEGACY_NOON_RATES) ; Statistique Canada (Tableau 10-10-0008-01)",
        verified_at: metaVersions.get("boc_fx_daily") ?? latestMetaDate,
        table_version: metaVersions.get("boc_fx_daily") ?? latestMetaDate,
      },
      gardes,
    };

    return {
      ok: true,
      structured,
      text: formatEconomieText(structured),
    };
  }

  const seriesIds = targetSeriesForCategory(category);
  const interestObs: Array<z.infer<typeof InterestObservationSchema>> = [];
  const missingDetails: string[] = [];

  if (hasSingle) {
    const reqDate = input.date!;
    const reqInt = isoToInt(reqDate);

    for (const sid of seriesIds) {
      const meta = SERIES_META[sid];
      const bounds = await db
        .prepare(
          "SELECT MIN(obs_date) AS min_d, MAX(obs_date) AS max_d FROM boc_rates WHERE series_id = ?",
        )
        .bind(sid)
        .first<{ min_d: number | null; max_d: number | null }>();
      if (!bounds?.min_d || !bounds?.max_d) {
        missingDetails.push(`${sid} absente de DB_ECONOMIE`);
        continue;
      }
      const minIso = intToIso(bounds.min_d);
      const maxIso = intToIso(bounds.max_d);
      if (reqInt < bounds.min_d) {
        missingDetails.push(`${sid} commence le ${minIso}`);
        continue;
      }
      if (reqInt > bounds.max_d && diffCalendarDays(maxIso, reqDate) > meta.maxTailDays) {
        missingDetails.push(
          `${sid} vérifiée jusqu'au ${maxIso} (date ${reqDate} hors instantané sans extrapolation)`,
        );
        continue;
      }

      const row = await db
        .prepare(
          "SELECT series_id, obs_date, rate_bps FROM boc_rates WHERE series_id = ? AND obs_date <= ? ORDER BY obs_date DESC LIMIT 1",
        )
        .bind(sid, reqInt)
        .first<BocRateRow>();
      if (!row) {
        missingDetails.push(`${sid} sans observation <= ${reqDate}`);
        continue;
      }
      const effIso = intToIso(row.obs_date);
      const rollbackDays = diffCalendarDays(effIso, reqDate);
      if (rollbackDays > meta.maxRollbackDays) {
        missingDetails.push(
          `${sid} dernière observation le ${effIso} (écart de ${rollbackDays} j > ${meta.maxRollbackDays} j)`,
        );
        continue;
      }
      if (rollbackDays > 0) {
        guardSet.add("TAUX_BOC_REPORT_JOUR_OUVRABLE_PRECEDENT");
      }
      interestObs.push({
        series_id: sid,
        series_label_fr: meta.labelFr,
        requested_date: reqDate,
        effective_observation_date: effIso,
        rolled_back: rollbackDays > 0,
        rollback_days: rollbackDays,
        rate_bps: row.rate_bps,
        rate_percent: `${(row.rate_bps / 100).toFixed(2)} %`,
      });
    }

    if (interestObs.length === 0) {
      return {
        ok: false,
        text: `Aucun taux Banque du Canada disponible pour la date ${reqDate} (${missingDetails.join(" ; ")}).`,
      };
    }
  } else {
    const startInt = isoToInt(input.start_date!);
    const endInt = isoToInt(input.end_date!);
    const placeholders = seriesIds.map(() => "?").join(", ");
    const res = await db
      .prepare(
        `SELECT series_id, obs_date, rate_bps FROM boc_rates ` +
          `WHERE series_id IN (${placeholders}) AND obs_date BETWEEN ? AND ? ` +
          `ORDER BY obs_date ASC, series_id ASC LIMIT ?`,
      )
      .bind(...seriesIds, startInt, endInt, limit)
      .all<BocRateRow>();

    for (const r of res.results ?? []) {
      const sid = r.series_id;
      interestObs.push({
        series_id: sid,
        series_label_fr: SERIES_META[sid].labelFr,
        requested_date: null,
        effective_observation_date: intToIso(r.obs_date),
        rolled_back: false,
        rollback_days: 0,
        rate_bps: r.rate_bps,
        rate_percent: `${(r.rate_bps / 100).toFixed(2)} %`,
      });
    }
    if (interestObs.length === 0) {
      return {
        ok: false,
        text: `Aucune observation pour ${seriesIds.join(", ")} entre ${input.start_date} et ${input.end_date}.`,
      };
    }
  }

  const gardes = Array.from(guardSet).map((code) => makeGarde(code));
  const structured: TauxBocRatesOutput = {
    category,
    mode: hasSingle ? "single_date" : "range",
    requested_date: input.date ?? null,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    currency: null,
    count: interestObs.length,
    fx_observations: [],
    interest_observations: interestObs,
    conversion: null,
    provenance: {
      source:
        "Banque du Canada — API Valet (V39079 taux cible, V122530 taux officiel d'escompte, V80691311 taux préférentiel)",
      verified_at: metaVersions.get("boc_interest_rates") ?? latestMetaDate,
      table_version: metaVersions.get("boc_interest_rates") ?? latestMetaDate,
    },
    gardes,
  };

  return {
    ok: true,
    structured,
    text: formatEconomieText(structured, missingDetails),
  };
}

function formatEconomieText(out: TauxBocRatesOutput, partialNotes: readonly string[] = []): string {
  const lines: string[] = [];
  if (out.category === "fx" && out.currency) {
    const scope =
      out.mode === "single_date"
        ? `au ${out.requested_date}`
        : `du ${out.start_date} au ${out.end_date}`;
    lines.push(
      `Taux de change Banque du Canada — ${out.currency.code} (${out.currency.name_fr}) / CAD ${scope} (${out.count} observation(s)) :`,
    );
    for (const obs of out.fx_observations) {
      const meth =
        obs.rate_methodology === "noon_spot_pre_2017_05_01"
          ? "au comptant de midi HE (pré-2017-05-01)"
          : "moyenne quotidienne 16 h 30 HE";
      const rb = obs.rolled_back
        ? ` [report ${obs.rollback_days} j depuis ${obs.requested_date}]`
        : "";
      lines.push(
        `- ${obs.effective_observation_date} : 1 ${obs.currency_code} = ${obs.cad_per_foreign_unit} CAD (${meth})${rb}`,
      );
    }
    if (out.conversion) {
      const c = out.conversion;
      lines.push(
        "",
        `Conversion (${c.legal_basis}) : ${c.input_amount} ${c.direction === "foreign_to_cad" ? c.foreign_currency : "CAD"} -> ${c.converted_amount_2dec} ${c.converted_currency} (exact 6 déc. : ${c.converted_amount_exact_6dec} ${c.converted_currency}, taux retenu du ${c.effective_observation_date} = ${c.cad_per_foreign_unit} CAD/${c.foreign_currency}).`,
      );
    }
  } else {
    const scope =
      out.mode === "single_date"
        ? `au ${out.requested_date}`
        : `du ${out.start_date} au ${out.end_date}`;
    lines.push(
      `Taux d'intérêt Banque du Canada (${out.category}) ${scope} (${out.count} observation(s)) :`,
    );
    for (const obs of out.interest_observations) {
      const rb = obs.rolled_back
        ? ` [report ${obs.rollback_days} j depuis ${obs.requested_date}]`
        : "";
      lines.push(
        `- ${obs.effective_observation_date} — ${obs.series_label_fr} : ${obs.rate_percent} (${obs.rate_bps} bps)${rb}`,
      );
    }
    if (partialNotes.length > 0) {
      lines.push(`Notes de couverture : ${partialNotes.join(" ; ")}.`);
    }
  }

  if (out.gardes.length > 0) {
    lines.push("", "Gardes :");
    for (const g of out.gardes) {
      lines.push(`- [${g.code}] ${g.message}`);
    }
  }
  lines.push(`\nSource : ${out.provenance.source} (vérifié le ${out.provenance.verified_at})`);
  return lines.join("\n");
}
