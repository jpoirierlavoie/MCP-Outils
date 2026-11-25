import { z } from "zod";
import { type GardeCode, GardeSchema, makeGarde, ProvenanceSchema } from "./gardes.js";
import { formatCentsToCad, roundHalfAwayFromZero } from "./interest1619.js";

const PERIOD_RE = /^\d{4}(?:-\d{2})?$/;
const DECIMAL_AMOUNT_RE = /^\d+(?:\.\d{1,6})?$/;

export const CpiGeoSchema = z.enum(["quebec", "montreal_rmr", "quebec_rmr", "canada"]);
export type CpiGeo = z.infer<typeof CpiGeoSchema>;

export const CpiProductSchema = z.enum([
  "all_items",
  "shelter",
  "rented_accommodation",
  "rent",
  "health_care_services",
]);
export type CpiProduct = z.infer<typeof CpiProductSchema>;

export const CpiFrequencySchema = z.enum(["monthly", "annual"]);
export type CpiFrequency = z.infer<typeof CpiFrequencySchema>;

export const CpiUomSchema = z.enum(["2002=100", "1992=100"]);
export type CpiUom = z.infer<typeof CpiUomSchema>;

export const CpiRoundingSchema = z.enum(["half_away_from_zero", "half_up"]);
export type CpiRounding = z.infer<typeof CpiRoundingSchema>;

export const IndiceIpcInputSchema = z.strictObject({
  geo: CpiGeoSchema.optional().describe(
    "Territoire StatCan : 'quebec' (défaut), 'montreal_rmr', 'quebec_rmr' ou 'canada'.",
  ),
  product: CpiProductSchema.optional().describe(
    "Composante IPC : 'all_items' (défaut), 'shelter', 'rented_accommodation', 'rent' (QC/CA seulement) ou 'health_care_services' (QC/CA seulement).",
  ),
  frequency: CpiFrequencySchema.optional().describe(
    "Fréquence : 'monthly' (défaut pour YYYY-MM) ou 'annual' (défaut pour YYYY).",
  ),
  uom: CpiUomSchema.optional().describe(
    "Année de base StatCan : '2002=100' (défaut) ou '1992=100' (série historique Ensemble arrêtée en 2018).",
  ),
  end_uom: CpiUomSchema.optional().describe(
    "Année de base pour end_period sur une plage (défaut : identique à uom ; toute divergence entre start_period et end_period bloque l'indexation sans facteur de raccordement).",
  ),
  period: z
    .string()
    .regex(PERIOD_RE)
    .optional()
    .describe(
      "Période ponctuelle ('YYYY-MM' mensuel ou 'YYYY' annuel ; exclusif avec start_period/end_period).",
    ),
  start_period: z
    .string()
    .regex(PERIOD_RE)
    .optional()
    .describe("Période initiale ('YYYY-MM' ou 'YYYY' ; requiert end_period)."),
  end_period: z
    .string()
    .regex(PERIOD_RE)
    .optional()
    .describe("Période finale ('YYYY-MM' ou 'YYYY' ; requiert start_period)."),
  amount: z
    .string()
    .trim()
    .regex(DECIMAL_AMOUNT_RE)
    .optional()
    .describe(
      "Montant décimal strictement positif (<= 6 déc.) à indexer en arithmétique exacte BigInt entre start_period et end_period.",
    ),
  floor_bps: z
    .number()
    .int()
    .min(-5000)
    .max(50000)
    .optional()
    .describe(
      "Plancher contractuel optionnel de variation en bps (p. ex. 0 pour 0,00 %, 200 pour +2,00 %). Requiert amount.",
    ),
  cap_bps: z
    .number()
    .int()
    .min(-5000)
    .max(50000)
    .optional()
    .describe(
      "Plafond contractuel optionnel de variation en bps (p. ex. 500 pour +5,00 %). Requiert amount.",
    ),
  rounding: CpiRoundingSchema.optional().describe(
    "Méthode d'arrondi au cent : 'half_away_from_zero' (défaut) ou 'half_up'. Requiert amount.",
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Nombre maximal d'observations retournées sur une plage (1 à 500, défaut : 100)."),
});
export type IndiceIpcInput = z.infer<typeof IndiceIpcInputSchema>;

export const CpiObservationOutputSchema = z.object({
  period: z.string(),
  value_decimal: z.string(),
  value_milli: z.number().int(),
  uom: z.string(),
  yoy_bps: z.number().int().nullable(),
  yoy_percent: z.string().nullable(),
});

export const CpiEscalationOutputSchema = z.object({
  input_amount: z.string(),
  start_period: z.string(),
  end_period: z.string(),
  start_index_decimal: z.string(),
  end_index_decimal: z.string(),
  start_uom: z.string(),
  end_uom: z.string(),
  raw_ratio_decimal: z.string(),
  raw_change_bps: z.number().int(),
  raw_change_percent: z.string(),
  floor_bps: z.number().int().nullable(),
  cap_bps: z.number().int().nullable(),
  applied_bound: z.enum(["none", "floor", "cap"]),
  effective_change_bps: z.number().int(),
  effective_change_percent: z.string(),
  rounding: CpiRoundingSchema,
  escalated_cents: z.number().int(),
  escalated_amount_2dec: z.string(),
  escalated_amount_exact_6dec: z.string(),
});

export const IndiceIpcOutputSchema = z.object({
  mode: z.enum(["single_period", "range"]),
  geo_code: CpiGeoSchema,
  geo_label_fr: z.string(),
  geo_label_en: z.string(),
  product_code: CpiProductSchema,
  product_label_fr: z.string(),
  product_label_en: z.string(),
  frequency: CpiFrequencySchema,
  vector_id: z.string(),
  coordinate: z.string(),
  uom: z.string(),
  available_first_period: z.string(),
  available_last_period: z.string(),
  count: z.number().int(),
  total_observations: z.number().int(),
  observations_truncated: z.boolean(),
  cumulative_change_bps: z.number().int().nullable(),
  observations: z.array(CpiObservationOutputSchema),
  escalation: CpiEscalationOutputSchema.nullable(),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type IndiceIpcOutput = z.infer<typeof IndiceIpcOutputSchema>;

interface CpiSeriesRow {
  id: number;
  product_id: number;
  frequency: "M" | "A";
  geo_code: CpiGeo;
  geo_en: string;
  geo_fr: string;
  product_code: CpiProduct;
  product_en: string;
  product_fr: string;
  coordinate: string;
  vector_id: number;
  uom: string;
  first_period: number;
  last_period: number;
}

interface CpiObsRow {
  series_id: number;
  period: number;
  value_milli: number;
}

interface MetaSourceRow {
  source_key: string;
  version_date: string;
}

interface ParsedPeriod {
  frequency: CpiFrequency;
  periodInt: number;
  formatted: string;
}

function parseCpiPeriod(
  raw: string,
): { ok: true; value: ParsedPeriod } | { ok: false; text: string } {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(raw.trim());
  if (!m) {
    return {
      ok: false,
      text: `Période IPC invalide « ${raw} » : format attendu 'YYYY-MM' (mensuel) ou 'YYYY' (annuel).`,
    };
  }
  const year = Number(m[1]);
  if (year < 1914) {
    return {
      ok: false,
      text: `Année IPC hors plage (${year}) : les séries StatCan débutent au plus tôt en 1914.`,
    };
  }
  if (m[2] !== undefined) {
    const month = Number(m[2]);
    if (month < 1 || month > 12) {
      return {
        ok: false,
        text: `Mois IPC invalide dans « ${raw} » (attendu 01..12).`,
      };
    }
    return {
      ok: true,
      value: {
        frequency: "monthly",
        periodInt: year * 100 + month,
        formatted: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
      },
    };
  }
  return {
    ok: true,
    value: {
      frequency: "annual",
      periodInt: year,
      formatted: String(year).padStart(4, "0"),
    },
  };
}

function formatPeriodInt(freq: "M" | "A", periodInt: number): string {
  if (freq === "A") {
    return String(periodInt).padStart(4, "0");
  }
  const year = Math.floor(periodInt / 100);
  const month = periodInt % 100;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function formatMilliIndex(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const rem = milli % 1000;
  // StatCan publie à 1 décimale, mais on préserve jusqu'à 3 décimales si non nulles
  if (rem % 100 === 0) {
    return `${whole}.${Math.floor(rem / 100)}`;
  }
  if (rem % 10 === 0) {
    return `${whole}.${String(Math.floor(rem / 10)).padStart(2, "0")}`;
  }
  return `${whole}.${String(rem).padStart(3, "0")}`;
}

function formatMicros6(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

function formatSignedBpsPercent(bps: bigint): string {
  const neg = bps < 0n;
  const abs = neg ? -bps : bps;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  const sign = bps > 0n ? "+" : neg ? "-" : "";
  return `${sign}${whole.toString()}.${frac} %`;
}

function parseDecimalAmount(raw: string): { num: bigint; scale: bigint } {
  const trimmed = raw.trim();
  const dot = trimmed.indexOf(".");
  if (dot === -1) {
    return { num: BigInt(trimmed), scale: 1n };
  }
  const whole = trimmed.slice(0, dot);
  const frac = trimmed.slice(dot + 1);
  return {
    num: BigInt(`${whole}${frac}`),
    scale: 10n ** BigInt(frac.length),
  };
}

function roundHalfUpSigned(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("Le dénominateur doit être strictement positif.");
  }
  const doubled = numerator * 2n;
  if (doubled >= 0n) {
    return (doubled + denominator) / (2n * denominator);
  }
  // Pour les nombres négatifs, half-up arrondit -0.5 vers 0 (+infini)
  const absNum = -numerator;
  const q = absNum / denominator;
  const r = absNum % denominator;
  const roundedAbs = r * 2n > denominator ? q + 1n : q;
  return roundedAbs === 0n ? 0n : -roundedAbs;
}

function assertSafeCents(val: bigint): number {
  if (val > BigInt(Number.MAX_SAFE_INTEGER) || val < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Dépassement de capacité entière sécuritaire lors de l'indexation IPC.");
  }
  return Number(val);
}

export async function indiceIpc(
  db: D1Database,
  input: IndiceIpcInput,
): Promise<{ ok: true; structured: IndiceIpcOutput; text: string } | { ok: false; text: string }> {
  const geo: CpiGeo = input.geo ?? "quebec";
  const product: CpiProduct = input.product ?? "all_items";
  const startUom: CpiUom = input.uom ?? "2002=100";
  const endUom: CpiUom = input.end_uom ?? startUom;

  const hasSingle = input.period !== undefined;
  const hasRange = input.start_period !== undefined || input.end_period !== undefined;
  if (hasSingle && hasRange) {
    return {
      ok: false,
      text: "Fournir soit 'period' (consultation ponctuelle), soit 'start_period' et 'end_period' (plage ou indexation), jamais les deux ensemble.",
    };
  }
  if (!hasSingle && (!input.start_period || !input.end_period)) {
    return {
      ok: false,
      text: "Préciser soit 'period', soit la paire complète 'start_period' et 'end_period'.",
    };
  }
  if (hasSingle && input.end_uom !== undefined) {
    return {
      ok: false,
      text: "Le paramètre 'end_uom' s'applique uniquement avec 'start_period' et 'end_period'.",
    };
  }

  let frequency: CpiFrequency;
  let singleParsed: ParsedPeriod | null = null;
  let startParsed: ParsedPeriod | null = null;
  let endParsed: ParsedPeriod | null = null;

  if (hasSingle) {
    const p = parseCpiPeriod(input.period!);
    if (!p.ok) return p;
    singleParsed = p.value;
    if (input.frequency && input.frequency !== singleParsed.frequency) {
      return {
        ok: false,
        text: `Incohérence entre frequency='${input.frequency}' et le format de period='${input.period}' (${singleParsed.frequency}).`,
      };
    }
    frequency = input.frequency ?? singleParsed.frequency;
  } else {
    const ps = parseCpiPeriod(input.start_period!);
    if (!ps.ok) return ps;
    const pe = parseCpiPeriod(input.end_period!);
    if (!pe.ok) return pe;
    startParsed = ps.value;
    endParsed = pe.value;
    if (startParsed.frequency !== endParsed.frequency) {
      return {
        ok: false,
        text: `start_period ('${input.start_period}') et end_period ('${input.end_period}') doivent avoir la même fréquence ('YYYY-MM' ou 'YYYY').`,
      };
    }
    if (input.frequency && input.frequency !== startParsed.frequency) {
      return {
        ok: false,
        text: `Incohérence entre frequency='${input.frequency}' et la plage '${input.start_period}..${input.end_period}' (${startParsed.frequency}).`,
      };
    }
    if (startParsed.periodInt > endParsed.periodInt) {
      return {
        ok: false,
        text: `start_period (${startParsed.formatted}) ne peut pas être postérieure à end_period (${endParsed.formatted}).`,
      };
    }
    frequency = input.frequency ?? startParsed.frequency;
  }

  if (
    (input.floor_bps !== undefined ||
      input.cap_bps !== undefined ||
      input.rounding !== undefined) &&
    input.amount === undefined
  ) {
    return {
      ok: false,
      text: "Les options 'floor_bps', 'cap_bps' et 'rounding' requièrent un montant 'amount'.",
    };
  }
  if (input.amount !== undefined) {
    if (hasSingle) {
      return {
        ok: false,
        text: "L'indexation contractuelle d'un montant ('amount') requiert une plage 'start_period' et 'end_period'.",
      };
    }
    const amt = parseDecimalAmount(input.amount);
    if (amt.num <= 0n) {
      return {
        ok: false,
        text: "Le montant 'amount' doit être strictement supérieur à zéro.",
      };
    }
    if (
      input.floor_bps !== undefined &&
      input.cap_bps !== undefined &&
      input.floor_bps > input.cap_bps
    ) {
      return {
        ok: false,
        text: `Plancher incohérent : floor_bps (${input.floor_bps}) est supérieur à cap_bps (${input.cap_bps}).`,
      };
    }
  }

  // Sous-indices absents au niveau RMR chez StatCan (vectorId=0)
  if (
    (geo === "montreal_rmr" || geo === "quebec_rmr") &&
    (product === "rent" || product === "health_care_services")
  ) {
    return {
      ok: false,
      text: `Statistique Canada ne publie pas la composante '${product}' au niveau RMR ('${geo}', vectorId=0 dans 18-10-0004-01 / 18-10-0005-01). Utiliser geo='quebec' ou product='rented_accommodation'.`,
    };
  }

  const dbFreq: "M" | "A" = frequency === "monthly" ? "M" : "A";
  const startSeries = await db
    .prepare(
      "SELECT id, product_id, frequency, geo_code, geo_en, geo_fr, product_code, product_en, product_fr, coordinate, vector_id, uom, first_period, last_period " +
        "FROM cpi_series WHERE frequency = ? AND geo_code = ? AND product_code = ? AND uom = ?",
    )
    .bind(dbFreq, geo, product, startUom)
    .first<CpiSeriesRow>();

  if (!startSeries) {
    return {
      ok: false,
      text: `Série IPC introuvable dans DB_ECONOMIE pour geo='${geo}', product='${product}', frequency='${frequency}', uom='${startUom}'.`,
    };
  }

  let endSeries = startSeries;
  if (endUom !== startUom) {
    const foundEnd = await db
      .prepare(
        "SELECT id, product_id, frequency, geo_code, geo_en, geo_fr, product_code, product_en, product_fr, coordinate, vector_id, uom, first_period, last_period " +
          "FROM cpi_series WHERE frequency = ? AND geo_code = ? AND product_code = ? AND uom = ?",
      )
      .bind(dbFreq, geo, product, endUom)
      .first<CpiSeriesRow>();
    if (!foundEnd) {
      return {
        ok: false,
        text: `Série IPC de fin introuvable dans DB_ECONOMIE pour geo='${geo}', product='${product}', frequency='${frequency}', end_uom='${endUom}'.`,
      };
    }
    endSeries = foundEnd;
  }

  // Garde-fou strict d'année de base sur indexation
  if (input.amount !== undefined && startSeries.uom !== endSeries.uom) {
    return {
      ok: false,
      text: `[IPC_BASE_REINDEXATION_ATTENTION] Indexation refusée : l'année de base diffère entre start_period (${startSeries.uom}) et end_period (${endSeries.uom}). Une division directe entre séries d'années de base distinctes est mathématiquement invalide sans facteur de raccordement officiel de Statistique Canada.`,
    };
  }

  const metaKey = dbFreq === "M" ? "statcan_cpi_monthly" : "statcan_cpi_annual";
  const metaRow = await db
    .prepare("SELECT source_key, version_date FROM meta_sources WHERE source_key = ?")
    .bind(metaKey)
    .first<MetaSourceRow>();
  const verifiedAt = metaRow?.version_date ?? formatPeriodInt(dbFreq, endSeries.last_period);

  const guardSet = new Set<GardeCode>(["IPC_INSTANTANE_HORS_LIGNE"]);
  const limit = input.limit ?? 100;
  const obsOut: Array<z.infer<typeof CpiObservationOutputSchema>> = [];
  let escalationOut: z.infer<typeof CpiEscalationOutputSchema> | null = null;
  let cumulativeChangeBps: number | null = null;
  let totalObservations = 0;
  let observationsTruncated = false;

  const availStart = formatPeriodInt(dbFreq, startSeries.first_period);
  const availEnd = formatPeriodInt(dbFreq, endSeries.last_period);

  if (hasSingle) {
    const pInt = singleParsed!.periodInt;
    if (pInt < startSeries.first_period || pInt > startSeries.last_period) {
      return {
        ok: false,
        text: `La période demandée (${singleParsed!.formatted}) est hors de l'instantané vérifié pour ${startSeries.geo_fr} — ${startSeries.product_fr} (${startSeries.uom} : ${availStart} à ${availEnd}). Aucune extrapolation n'est effectuée.`,
      };
    }

    const obsRow = await db
      .prepare(
        "SELECT series_id, period, value_milli FROM cpi_observations WHERE series_id = ? AND period = ?",
      )
      .bind(startSeries.id, pInt)
      .first<CpiObsRow>();
    if (!obsRow) {
      return {
        ok: false,
        text: `Aucune observation IPC publiée pour ${startSeries.geo_fr} — ${startSeries.product_fr} à la période ${singleParsed!.formatted} (${availStart} à ${availEnd}).`,
      };
    }

    const prevPeriodInt = dbFreq === "M" ? pInt - 100 : pInt - 1;
    const prevRow = await db
      .prepare(
        "SELECT series_id, period, value_milli FROM cpi_observations WHERE series_id = ? AND period = ?",
      )
      .bind(startSeries.id, prevPeriodInt)
      .first<CpiObsRow>();
    let yoyBps: number | null = null;
    let yoyPercent: string | null = null;
    if (prevRow && prevRow.value_milli > 0) {
      const yoyBig = roundHalfAwayFromZero(
        (BigInt(obsRow.value_milli) - BigInt(prevRow.value_milli)) * 10_000n,
        BigInt(prevRow.value_milli),
      );
      yoyBps = Number(yoyBig);
      yoyPercent = formatSignedBpsPercent(yoyBig);
    }

    obsOut.push({
      period: singleParsed!.formatted,
      value_decimal: formatMilliIndex(obsRow.value_milli),
      value_milli: obsRow.value_milli,
      uom: startSeries.uom,
      yoy_bps: yoyBps,
      yoy_percent: yoyPercent,
    });
    totalObservations = 1;
    if (startSeries.uom !== "2002=100") {
      guardSet.add("IPC_BASE_REINDEXATION_ATTENTION");
    }
  } else {
    const startInt = startParsed!.periodInt;
    const endInt = endParsed!.periodInt;

    if (startSeries.id === endSeries.id) {
      if (startInt < startSeries.first_period || endInt > startSeries.last_period) {
        return {
          ok: false,
          text: `La plage demandée (${startParsed!.formatted} à ${endParsed!.formatted}) déborde de l'instantané vérifié pour ${startSeries.geo_fr} — ${startSeries.product_fr} (${startSeries.uom} : ${availStart} à ${availEnd}). Aucune extrapolation n'est effectuée.`,
        };
      }

      const rowsRes = await db
        .prepare(
          "SELECT series_id, period, value_milli FROM cpi_observations " +
            "WHERE series_id = ? AND period BETWEEN ? AND ? ORDER BY period ASC LIMIT ?",
        )
        .bind(startSeries.id, startInt, endInt, limit)
        .all<CpiObsRow>();
      const rows = rowsRes.results ?? [];
      if (rows.length === 0) {
        return {
          ok: false,
          text: `Aucune observation IPC entre ${startParsed!.formatted} et ${endParsed!.formatted} pour ${startSeries.geo_fr} — ${startSeries.product_fr}.`,
        };
      }

      totalObservations = rows.length;
      if (rows.length === limit) {
        const countRow = await db
          .prepare(
            "SELECT COUNT(*) AS total FROM cpi_observations WHERE series_id = ? AND period BETWEEN ? AND ?",
          )
          .bind(startSeries.id, startInt, endInt)
          .first<{ total: number }>();
        totalObservations = countRow?.total ?? rows.length;
        observationsTruncated = totalObservations > rows.length;
      }

      const prevWindowStart = dbFreq === "M" ? startInt - 100 : startInt - 1;
      const prevRes = await db
        .prepare(
          "SELECT series_id, period, value_milli FROM cpi_observations " +
            "WHERE series_id = ? AND period BETWEEN ? AND ?",
        )
        .bind(startSeries.id, prevWindowStart, endInt)
        .all<CpiObsRow>();
      const byPeriod = new Map<number, number>(
        (prevRes.results ?? []).map((r) => [r.period, r.value_milli]),
      );

      for (const r of rows) {
        const prevP = dbFreq === "M" ? r.period - 100 : r.period - 1;
        const prevMilli = byPeriod.get(prevP);
        let yoyBps: number | null = null;
        let yoyPercent: string | null = null;
        if (prevMilli !== undefined && prevMilli > 0) {
          const yoyBig = roundHalfAwayFromZero(
            (BigInt(r.value_milli) - BigInt(prevMilli)) * 10_000n,
            BigInt(prevMilli),
          );
          yoyBps = Number(yoyBig);
          yoyPercent = formatSignedBpsPercent(yoyBig);
        }
        obsOut.push({
          period: formatPeriodInt(dbFreq, r.period),
          value_decimal: formatMilliIndex(r.value_milli),
          value_milli: r.value_milli,
          uom: startSeries.uom,
          yoy_bps: yoyBps,
          yoy_percent: yoyPercent,
        });
      }

      const needEndpointQueries = input.amount !== undefined || observationsTruncated;
      let startObs: CpiObsRow | null = rows[0] && rows[0].period === startInt ? rows[0] : null;
      let endObs: CpiObsRow | null =
        !observationsTruncated && rows[rows.length - 1] && rows[rows.length - 1]!.period === endInt
          ? rows[rows.length - 1]!
          : null;

      if (needEndpointQueries && !startObs) {
        startObs = await db
          .prepare(
            "SELECT series_id, period, value_milli FROM cpi_observations WHERE series_id = ? AND period = ?",
          )
          .bind(startSeries.id, startInt)
          .first<CpiObsRow>();
      }
      if (needEndpointQueries && !endObs) {
        endObs = await db
          .prepare(
            "SELECT series_id, period, value_milli FROM cpi_observations WHERE series_id = ? AND period = ?",
          )
          .bind(endSeries.id, endInt)
          .first<CpiObsRow>();
      }

      if (startObs && endObs && startObs.period !== endObs.period && startObs.value_milli > 0) {
        const firstM = BigInt(startObs.value_milli);
        const lastM = BigInt(endObs.value_milli);
        cumulativeChangeBps = Number(roundHalfAwayFromZero((lastM - firstM) * 10_000n, firstM));
      } else if (observationsTruncated) {
        const lastRangeObs = await db
          .prepare(
            "SELECT series_id, period, value_milli FROM cpi_observations " +
              "WHERE series_id = ? AND period BETWEEN ? AND ? ORDER BY period DESC LIMIT 1",
          )
          .bind(startSeries.id, startInt, endInt)
          .first<CpiObsRow>();
        if (
          lastRangeObs &&
          rows[0] &&
          rows[0].period !== lastRangeObs.period &&
          rows[0].value_milli > 0
        ) {
          const firstM = BigInt(rows[0].value_milli);
          const lastM = BigInt(lastRangeObs.value_milli);
          cumulativeChangeBps = Number(roundHalfAwayFromZero((lastM - firstM) * 10_000n, firstM));
        }
      } else if (rows.length >= 2 && rows[0]!.value_milli > 0) {
        const firstM = BigInt(rows[0]!.value_milli);
        const lastM = BigInt(rows[rows.length - 1]!.value_milli);
        cumulativeChangeBps = Number(roundHalfAwayFromZero((lastM - firstM) * 10_000n, firstM));
      }

      if (startSeries.uom !== "2002=100") {
        guardSet.add("IPC_BASE_REINDEXATION_ATTENTION");
      }

      if (input.amount !== undefined) {
        if (!startObs || !endObs) {
          return {
            ok: false,
            text: `Observation manquante pour l'indexation (${startParsed!.formatted} ou ${endParsed!.formatted}) dans ${startSeries.geo_fr} — ${startSeries.product_fr}.`,
          };
        }

        guardSet.add("IPC_BASE_REINDEXATION_ATTENTION");
        guardSet.add("IPC_INDEXATION_CONTRACTUELLE_NON_NORMATIVE");

        const { num, scale } = parseDecimalAmount(input.amount);
        const startM = BigInt(startObs.value_milli);
        const endM = BigInt(endObs.value_milli);
        const rawBpsBig = roundHalfAwayFromZero((endM - startM) * 10_000n, startM);

        const belowFloor =
          input.floor_bps !== undefined &&
          (endM - startM) * 10_000n < BigInt(input.floor_bps) * startM;
        const aboveCap =
          input.cap_bps !== undefined && (endM - startM) * 10_000n > BigInt(input.cap_bps) * startM;

        let effectiveNum = endM;
        let effectiveDen = startM;
        let appliedBound: "none" | "floor" | "cap" = "none";
        let effectiveBpsBig = rawBpsBig;

        if (belowFloor) {
          effectiveNum = 10_000n + BigInt(input.floor_bps!);
          effectiveDen = 10_000n;
          appliedBound = "floor";
          effectiveBpsBig = BigInt(input.floor_bps!);
        } else if (aboveCap) {
          effectiveNum = 10_000n + BigInt(input.cap_bps!);
          effectiveDen = 10_000n;
          appliedBound = "cap";
          effectiveBpsBig = BigInt(input.cap_bps!);
        }

        const roundingMode: CpiRounding = input.rounding ?? "half_away_from_zero";
        const roundFn = roundingMode === "half_up" ? roundHalfUpSigned : roundHalfAwayFromZero;

        const escalatedCentsBig = roundFn(num * effectiveNum * 100n, scale * effectiveDen);
        const escalatedMicrosBig = roundFn(num * effectiveNum * 1_000_000n, scale * effectiveDen);
        const ratioMicrosBig = roundHalfAwayFromZero(endM * 1_000_000n, startM);

        escalationOut = {
          input_amount: input.amount,
          start_period: startParsed!.formatted,
          end_period: endParsed!.formatted,
          start_index_decimal: formatMilliIndex(startObs.value_milli),
          end_index_decimal: formatMilliIndex(endObs.value_milli),
          start_uom: startSeries.uom,
          end_uom: endSeries.uom,
          raw_ratio_decimal: formatMicros6(ratioMicrosBig),
          raw_change_bps: Number(rawBpsBig),
          raw_change_percent: formatSignedBpsPercent(rawBpsBig),
          floor_bps: input.floor_bps ?? null,
          cap_bps: input.cap_bps ?? null,
          applied_bound: appliedBound,
          effective_change_bps: Number(effectiveBpsBig),
          effective_change_percent: formatSignedBpsPercent(effectiveBpsBig),
          rounding: roundingMode,
          escalated_cents: assertSafeCents(escalatedCentsBig),
          escalated_amount_2dec: formatCentsToCad(escalatedCentsBig),
          escalated_amount_exact_6dec: formatMicros6(escalatedMicrosBig),
        };
      }
    } else {
      // Plage multi-UOM sans indexation (startUom !== endUom)
      if (
        startInt < startSeries.first_period ||
        startInt > startSeries.last_period ||
        endInt < endSeries.first_period ||
        endInt > endSeries.last_period
      ) {
        return {
          ok: false,
          text: `La plage demandée (${startParsed!.formatted} à ${endParsed!.formatted}) déborde de l'instantané vérifié pour ${startSeries.geo_fr} — ${startSeries.product_fr} (${startSeries.uom} : ${formatPeriodInt(dbFreq, startSeries.first_period)} à ${formatPeriodInt(dbFreq, startSeries.last_period)} ; ${endSeries.uom} : ${formatPeriodInt(dbFreq, endSeries.first_period)} à ${formatPeriodInt(dbFreq, endSeries.last_period)}). Aucune extrapolation n'est effectuée.`,
        };
      }

      guardSet.add("IPC_BASE_REINDEXATION_ATTENTION");
      const r1 = await db
        .prepare(
          "SELECT series_id, period, value_milli FROM cpi_observations " +
            "WHERE series_id = ? AND period BETWEEN ? AND ? ORDER BY period ASC LIMIT ?",
        )
        .bind(startSeries.id, startInt, endInt, limit)
        .all<CpiObsRow>();
      const r2 = await db
        .prepare(
          "SELECT series_id, period, value_milli FROM cpi_observations " +
            "WHERE series_id = ? AND period BETWEEN ? AND ? ORDER BY period ASC LIMIT ?",
        )
        .bind(endSeries.id, startInt, endInt, limit)
        .all<CpiObsRow>();

      const tagged = [
        ...(r1.results ?? []).map((r) => ({ ...r, uom: startSeries.uom })),
        ...(r2.results ?? []).map((r) => ({ ...r, uom: endSeries.uom })),
      ]
        .sort((a, b) => a.period - b.period || a.uom.localeCompare(b.uom))
        .slice(0, limit);

      if (tagged.length === 0) {
        return {
          ok: false,
          text: `Aucune observation IPC entre ${startParsed!.formatted} et ${endParsed!.formatted} pour ${startSeries.geo_fr} — ${startSeries.product_fr}.`,
        };
      }

      const combinedCount = (r1.results?.length ?? 0) + (r2.results?.length ?? 0);
      totalObservations = combinedCount;
      if (tagged.length === limit) {
        const countRow = await db
          .prepare(
            "SELECT COUNT(*) AS total FROM cpi_observations WHERE series_id IN (?, ?) AND period BETWEEN ? AND ?",
          )
          .bind(startSeries.id, endSeries.id, startInt, endInt)
          .first<{ total: number }>();
        totalObservations = countRow?.total ?? combinedCount;
        observationsTruncated = totalObservations > tagged.length;
      }

      for (const item of tagged) {
        obsOut.push({
          period: formatPeriodInt(dbFreq, item.period),
          value_decimal: formatMilliIndex(item.value_milli),
          value_milli: item.value_milli,
          uom: item.uom,
          yoy_bps: null,
          yoy_percent: null,
        });
      }
    }
  }

  const gardes = Array.from(guardSet).map((code) => makeGarde(code));
  const structured: IndiceIpcOutput = {
    mode: hasSingle ? "single_period" : "range",
    geo_code: geo,
    geo_label_fr: startSeries.geo_fr,
    geo_label_en: startSeries.geo_en,
    product_code: product,
    product_label_fr: startSeries.product_fr,
    product_label_en: startSeries.product_en,
    frequency,
    vector_id: `v${startSeries.vector_id}`,
    coordinate: startSeries.coordinate,
    uom:
      startSeries.uom === endSeries.uom
        ? startSeries.uom
        : `${startSeries.uom} -> ${endSeries.uom}`,
    available_first_period: availStart,
    available_last_period: availEnd,
    count: obsOut.length,
    total_observations: totalObservations,
    observations_truncated: observationsTruncated,
    cumulative_change_bps: cumulativeChangeBps,
    observations: obsOut,
    escalation: escalationOut,
    provenance: {
      source:
        dbFreq === "M"
          ? `Statistique Canada — Tableau 18-10-0004-01 (IPC mensuel, vecteur v${startSeries.vector_id})`
          : `Statistique Canada — Tableau 18-10-0005-01 (IPC annuel, vecteur v${startSeries.vector_id})`,
      verified_at: verifiedAt,
      table_version: verifiedAt,
    },
    gardes,
  };

  return {
    ok: true,
    structured,
    text: formatIpcText(structured),
  };
}

function formatIpcText(out: IndiceIpcOutput): string {
  const lines: string[] = [
    `IPC Statistique Canada — ${out.geo_label_fr} / ${out.product_label_fr} (${out.frequency === "monthly" ? "mensuel" : "annuel"}, vecteur ${out.vector_id}, base ${out.uom}) :`,
  ];
  for (const obs of out.observations) {
    const yoy = obs.yoy_percent ? ` (var. annuelle : ${obs.yoy_percent})` : "";
    lines.push(`- ${obs.period} : ${obs.value_decimal} [${obs.uom}]${yoy}`);
  }
  if (out.observations_truncated) {
    lines.push(
      `Affichage tronqué à ${out.count} observations sur ${out.total_observations} dans la plage (augmenter 'limit' jusqu'à 500 pour tout afficher).`,
    );
  }
  if (out.cumulative_change_bps !== null) {
    const spanTag = out.observations_truncated ? " (plage complète)" : "";
    lines.push(
      `Variation cumulative sur la plage${spanTag} : ${formatSignedBpsPercent(BigInt(out.cumulative_change_bps))} (${out.cumulative_change_bps} bps).`,
    );
  }
  if (out.escalation) {
    const e = out.escalation;
    const boundNote =
      e.applied_bound === "floor"
        ? ` [plancher appliqué : ${formatSignedBpsPercent(BigInt(e.floor_bps ?? 0))}]`
        : e.applied_bound === "cap"
          ? ` [plafond appliqué : ${formatSignedBpsPercent(BigInt(e.cap_bps ?? 0))}]`
          : "";
    lines.push(
      "",
      `Indexation (${e.start_period} → ${e.end_period}, base ${e.start_uom}) : ${e.input_amount} $ → ${e.escalated_amount_2dec} $ (exact 6 déc. : ${e.escalated_amount_exact_6dec} $, variation brute ${e.raw_change_percent}, effective ${e.effective_change_percent}${boundNote}, arrondi ${e.rounding}).`,
    );
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
