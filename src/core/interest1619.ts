import { z } from "zod";
import lafRatesJson from "../data/laf_art28_rates.json" with { type: "json" };
import {
  addDays,
  compareIsoDates,
  daysInMonth,
  daysInYear,
  diffCalendarDays,
  formatIsoDate,
  getQuarter,
  minIsoDate,
  parseIsoDate,
  quarterKey,
} from "./dates.js";
import { Garde, GardeCode, GardeSchema, ProvenanceSchema, makeGarde } from "./gardes.js";

const ISO_DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUARTER_RE = /^\d{4}-Q[1-4]$/;

// lcm(365, 366) * 10_000 basis points = 133_590 * 10_000
export const EXACT_EXACT_COMMON_DENOMINATOR = 1_335_900_000n;
export const LEGAL_INTEREST_RATE_BPS = lafRatesJson.metadata.legal_rate_bps;

export const InterestModeSchema = z.enum([
  "legal_plus_1619",
  "legal_only",
  "contractual",
]);
export type InterestMode = z.infer<typeof InterestModeSchema>;

export const RateOverrideSchema = z.object({
  quarter: z
    .string()
    .regex(QUARTER_RE)
    .describe("Trimestre au format YYYY-Q1..Q4 (p. ex. '2027-Q1')."),
  laf_rate_bps: z
    .number()
    .int()
    .min(0)
    .max(50000)
    .describe(
      "Taux annuel total fixé sous l'art. 28 L.A.F. en points de base (p. ex. 700 pour 7,00 %)."
    ),
});
export type RateOverride = z.infer<typeof RateOverrideSchema>;

export const CapitalTrancheInputSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Étiquette de la tranche de capital (p. ex. 'Facture #104' ou 'Préjudice corporel')."),
  principal_cents: z
    .number()
    .int()
    .min(1)
    .max(1_000_000_000_000)
    .describe("Montant en capital en cents entiers (p. ex. 10000000 pour 100 000,00 $)."),
  start_date: z
    .string()
    .regex(ISO_DATE_FORMAT_RE)
    .describe(
      "Date de point de départ ISO YYYY-MM-DD (exclue du compte : les intérêts courent à compter du lendemain)."
    ),
  end_date: z
    .string()
    .regex(ISO_DATE_FORMAT_RE)
    .optional()
    .describe("Date de fin optionnelle propre à cette tranche (incluse; remplace end_date global)."),
  rate_bps: z
    .number()
    .int()
    .min(0)
    .max(50000)
    .optional()
    .describe("Taux contractuel en points de base propre à cette tranche (mode 'contractual')."),
});
export type CapitalTrancheInput = z.infer<typeof CapitalTrancheInputSchema>;

export const ComputeInterest1619InputSchema = z.object({
  mode: InterestModeSchema
    .optional()
    .describe(
      "Mode de calcul : 'legal_plus_1619' (défaut : taux légal 5 % + indemnité additionnelle art. 1619 C.c.Q.), 'legal_only' (5 % seul), ou 'contractual' (taux fixe spécifié par rate_bps)."
    ),
  end_date: z
    .string()
    .regex(ISO_DATE_FORMAT_RE)
    .describe("Date de fin du calcul ISO YYYY-MM-DD (incluse dans le compte)."),
  rate_bps: z
    .number()
    .int()
    .min(0)
    .max(50000)
    .optional()
    .describe(
      "Taux annuel contractuel par défaut en points de base (requis en mode 'contractual' si non précisé par tranche; 100 bps = 1,00 %)."
    ),
  rate_overrides: z
    .array(RateOverrideSchema)
    .max(40)
    .optional()
    .describe(
      "Surcharges trimestrielles officielles de l'art. 28 L.A.F. pour les trimestres non encore publiés dans la table embarquée."
    ),
  tranches: z
    .array(CapitalTrancheInputSchema)
    .min(1)
    .max(50)
    .describe("Liste d'une à 50 tranches de capital datées à calculer en intérêt simple."),
});
export type ComputeInterest1619Input = z.infer<typeof ComputeInterest1619InputSchema>;

export const InterestPeriodSliceSchema = z.object({
  period_label: z.string(),
  start_date_included: z.string(),
  end_date_included: z.string(),
  days: z.number().int(),
  year_days: z.union([z.literal(365), z.literal(366)]),
  laf_rate_bps: z.number().int().nullable(),
  legal_rate_bps: z.number().int(),
  additional_rate_bps: z.number().int(),
  contractual_rate_bps: z.number().int(),
  effective_rate_bps: z.number().int(),
  legal_interest_cad_exact_6dec: z.string(),
  additional_indemnity_cad_exact_6dec: z.string(),
  contractual_interest_cad_exact_6dec: z.string(),
  total_interest_cad_exact_6dec: z.string(),
});
export type InterestPeriodSlice = z.infer<typeof InterestPeriodSliceSchema>;

export const TrancheResultSchema = z.object({
  index: z.number().int(),
  label: z.string(),
  principal_cents: z.number().int(),
  principal_cad: z.string(),
  start_date_excluded: z.string(),
  requested_end_date: z.string(),
  effective_end_date: z.string(),
  truncated: z.boolean(),
  missing_quarter: z.string().nullable(),
  accrued_days: z.number().int(),
  legal_interest_cents: z.number().int(),
  legal_interest_cad: z.string(),
  additional_indemnity_cents: z.number().int(),
  additional_indemnity_cad: z.string(),
  contractual_interest_cents: z.number().int(),
  contractual_interest_cad: z.string(),
  total_interest_cents: z.number().int(),
  total_interest_cad: z.string(),
  total_with_principal_cents: z.number().int(),
  total_with_principal_cad: z.string(),
  periods: z.array(InterestPeriodSliceSchema),
});
export type TrancheResult = z.infer<typeof TrancheResultSchema>;

export const ComputeInterest1619OutputSchema = z.object({
  mode: InterestModeSchema,
  convention: z.literal("Exact/Exact (365/366), start_excluded_end_included, simple"),
  laf_table_last_quarter: z.string(),
  truncated_any: z.boolean(),
  total_principal_cents: z.number().int(),
  total_principal_cad: z.string(),
  total_legal_interest_cents: z.number().int(),
  total_legal_interest_cad: z.string(),
  total_additional_indemnity_cents: z.number().int(),
  total_additional_indemnity_cad: z.string(),
  total_contractual_interest_cents: z.number().int(),
  total_contractual_interest_cad: z.string(),
  total_interest_cents: z.number().int(),
  total_interest_cad: z.string(),
  grand_total_cents: z.number().int(),
  grand_total_cad: z.string(),
  tranches: z.array(TrancheResultSchema),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type ComputeInterest1619Output = z.infer<typeof ComputeInterest1619OutputSchema>;

export function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("Le dénominateur doit être strictement positif.");
  }
  const neg = numerator < 0n;
  const absNum = neg ? -numerator : numerator;
  const quotient = absNum / denominator;
  const remainder = absNum % denominator;
  const roundedAbs = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return neg ? -roundedAbs : roundedAbs;
}

export function formatCentsToCad(cents: bigint | number): string {
  const value = typeof cents === "bigint" ? cents : BigInt(cents);
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

/**
 * Formats an exact rational cent value `(num / EXACT_EXACT_COMMON_DENOMINATOR)`
 * as dollars with 6 decimal places (pure audit formatting).
 */
function formatRationalCentsAsCad6(numerator: bigint): string {
  const scaledMicroDollars = roundHalfAwayFromZero(
    numerator * 10_000n,
    EXACT_EXACT_COMMON_DENOMINATOR
  );
  const neg = scaledMicroDollars < 0n;
  const abs = neg ? -scaledMicroDollars : scaledMicroDollars;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

function assertSafeIntCents(val: bigint, label: string): number {
  if (val > BigInt(Number.MAX_SAFE_INTEGER) || val < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Dépassement de capacité entière sécuritaire pour ${label}.`);
  }
  return Number(val);
}

function buildLafRateMap(overrides?: RateOverride[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const [quarter, bps] of Object.entries(lafRatesJson.quarters)) {
    map.set(quarter, bps);
  }
  for (const override of overrides ?? []) {
    map.set(override.quarter, override.laf_rate_bps);
  }
  return map;
}

export function computeInterest1619(
  input: ComputeInterest1619Input
): ComputeInterest1619Output {
  const mode: InterestMode = input.mode ?? "legal_plus_1619";
  parseIsoDate(input.end_date);

  if (mode !== "contractual" && input.rate_bps !== undefined) {
    throw new RangeError(
      `rate_bps global ne doit être fourni qu'en mode 'contractual' (reçu avec mode='${mode}').`
    );
  }

  const lafRateMap =
    mode === "legal_plus_1619" ? buildLafRateMap(input.rate_overrides) : null;

  const guardReasons = new Map<GardeCode, string | undefined>();
  guardReasons.set("INTERET_SIMPLE_ART_1620_CCQ", undefined);

  const trancheResults: TrancheResult[] = [];
  let truncatedAny = false;
  let sumPrincipalCents = 0n;
  let sumLegalCents = 0n;
  let sumAdditionalCents = 0n;
  let sumContractualCents = 0n;
  let sumTotalInterestCents = 0n;

  for (let idx = 0; idx < input.tranches.length; idx++) {
    const tranche = input.tranches[idx]!;
    const label = tranche.label ?? `Tranche #${idx + 1}`;
    parseIsoDate(tranche.start_date);
    const requestedEndDate = tranche.end_date ?? input.end_date;
    parseIsoDate(requestedEndDate);

    if (compareIsoDates(requestedEndDate, tranche.start_date) < 0) {
      throw new RangeError(
        `Tranche #${idx + 1} (${label}) : end_date (${requestedEndDate}) précède start_date (${tranche.start_date}).`
      );
    }

    if (mode !== "contractual" && tranche.rate_bps !== undefined) {
      throw new RangeError(
        `Tranche #${idx + 1} (${label}) : rate_bps ne s'applique qu'en mode 'contractual'.`
      );
    }

    let trancheContractualRateBps = 0;
    if (mode === "contractual") {
      const resolvedRate = tranche.rate_bps ?? input.rate_bps;
      if (resolvedRate === undefined) {
        throw new RangeError(
          `Tranche #${idx + 1} (${label}) : rate_bps est requis (par tranche ou globalement) en mode 'contractual'.`
        );
      }
      trancheContractualRateBps = resolvedRate;
    }

    const principalBig = BigInt(tranche.principal_cents);
    const periods: InterestPeriodSlice[] = [];
    let legalNumSum = 0n;
    let additionalNumSum = 0n;
    let contractualNumSum = 0n;
    let accruedDays = 0;
    let truncated = false;
    let missingQuarter: string | null = null;
    let effectiveEndDate = requestedEndDate;

    if (compareIsoDates(requestedEndDate, tranche.start_date) > 0) {
      let cur = addDays(tranche.start_date, 1);

      while (compareIsoDates(cur, requestedEndDate) <= 0) {
        const { year, month } = parseIsoDate(cur);
        const yDays = daysInYear(year);
        const yMult = yDays === 365 ? 366n : 365n;

        let sliceEndLimit: string;
        let periodLabel: string;
        let lafBps: number | null = null;
        let legalBps = 0;
        let additionalBps = 0;
        let contractualBps = 0;

        if (mode === "legal_plus_1619") {
          const q = getQuarter(month);
          const qKey = quarterKey(year, month);
          const endMonth = q * 3;
          sliceEndLimit = formatIsoDate(year, endMonth, daysInMonth(year, endMonth));
          periodLabel = qKey;

          const foundBps = lafRateMap!.get(qKey);
          if (foundBps === undefined) {
            if (accruedDays === 0 && qKey < lafRatesJson.metadata.first_quarter) {
              throw new RangeError(
                `Tranche #${idx + 1} (${label}) : aucun taux art. 28 L.A.F. n'est disponible pour ${qKey} (table embarquée : ${lafRatesJson.metadata.first_quarter} à ${lafRatesJson.metadata.last_quarter}). Fournissez rate_overrides si nécessaire.`
              );
            }
            truncated = true;
            truncatedAny = true;
            missingQuarter = qKey;
            effectiveEndDate =
              accruedDays === 0 ? tranche.start_date : addDays(cur, -1);
            guardReasons.set(
              "TAUX_LAF_TRIMESTRE_MANQUANT",
              `Trimestre manquant : ${qKey} (calcul arrêté au ${effectiveEndDate}).`
            );
            break;
          }

          lafBps = foundBps;
          legalBps = LEGAL_INTEREST_RATE_BPS;
          additionalBps = Math.max(0, lafBps - LEGAL_INTEREST_RATE_BPS);
        } else {
          sliceEndLimit = formatIsoDate(year, 12, 31);
          periodLabel = String(year);
          if (mode === "legal_only") {
            legalBps = LEGAL_INTEREST_RATE_BPS;
          } else {
            contractualBps = trancheContractualRateBps;
          }
        }

        const sliceEnd = minIsoDate(requestedEndDate, sliceEndLimit);
        const sliceDays = diffCalendarDays(cur, sliceEnd) + 1;
        const sliceDaysBig = BigInt(sliceDays);

        const sliceLegalNum = principalBig * BigInt(legalBps) * sliceDaysBig * yMult;
        const sliceAdditionalNum =
          principalBig * BigInt(additionalBps) * sliceDaysBig * yMult;
        const sliceContractualNum =
          principalBig * BigInt(contractualBps) * sliceDaysBig * yMult;
        const sliceTotalNum = sliceLegalNum + sliceAdditionalNum + sliceContractualNum;

        legalNumSum += sliceLegalNum;
        additionalNumSum += sliceAdditionalNum;
        contractualNumSum += sliceContractualNum;
        accruedDays += sliceDays;

        periods.push({
          period_label: periodLabel,
          start_date_included: cur,
          end_date_included: sliceEnd,
          days: sliceDays,
          year_days: yDays,
          laf_rate_bps: lafBps,
          legal_rate_bps: legalBps,
          additional_rate_bps: additionalBps,
          contractual_rate_bps: contractualBps,
          effective_rate_bps: legalBps + additionalBps + contractualBps,
          legal_interest_cad_exact_6dec: formatRationalCentsAsCad6(sliceLegalNum),
          additional_indemnity_cad_exact_6dec: formatRationalCentsAsCad6(sliceAdditionalNum),
          contractual_interest_cad_exact_6dec: formatRationalCentsAsCad6(sliceContractualNum),
          total_interest_cad_exact_6dec: formatRationalCentsAsCad6(sliceTotalNum),
        });

        cur = addDays(sliceEnd, 1);
      }
    }

    const legalRounded = roundHalfAwayFromZero(
      legalNumSum,
      EXACT_EXACT_COMMON_DENOMINATOR
    );
    const additionalRounded = roundHalfAwayFromZero(
      additionalNumSum,
      EXACT_EXACT_COMMON_DENOMINATOR
    );
    const contractualRounded = roundHalfAwayFromZero(
      contractualNumSum,
      EXACT_EXACT_COMMON_DENOMINATOR
    );
    const trancheInterestTotal =
      legalRounded + additionalRounded + contractualRounded;
    const trancheWithPrincipal = principalBig + trancheInterestTotal;

    sumPrincipalCents += principalBig;
    sumLegalCents += legalRounded;
    sumAdditionalCents += additionalRounded;
    sumContractualCents += contractualRounded;
    sumTotalInterestCents += trancheInterestTotal;

    trancheResults.push({
      index: idx,
      label,
      principal_cents: tranche.principal_cents,
      principal_cad: formatCentsToCad(principalBig),
      start_date_excluded: tranche.start_date,
      requested_end_date: requestedEndDate,
      effective_end_date: effectiveEndDate,
      truncated,
      missing_quarter: missingQuarter,
      accrued_days: accruedDays,
      legal_interest_cents: assertSafeIntCents(legalRounded, `${label} legal`),
      legal_interest_cad: formatCentsToCad(legalRounded),
      additional_indemnity_cents: assertSafeIntCents(
        additionalRounded,
        `${label} additional`
      ),
      additional_indemnity_cad: formatCentsToCad(additionalRounded),
      contractual_interest_cents: assertSafeIntCents(
        contractualRounded,
        `${label} contractual`
      ),
      contractual_interest_cad: formatCentsToCad(contractualRounded),
      total_interest_cents: assertSafeIntCents(
        trancheInterestTotal,
        `${label} total_interest`
      ),
      total_interest_cad: formatCentsToCad(trancheInterestTotal),
      total_with_principal_cents: assertSafeIntCents(
        trancheWithPrincipal,
        `${label} total_with_principal`
      ),
      total_with_principal_cad: formatCentsToCad(trancheWithPrincipal),
      periods,
    });
  }

  const grandTotalCents = sumPrincipalCents + sumTotalInterestCents;
  const gardes: Garde[] = Array.from(guardReasons.entries()).map(([code, detail]) =>
    makeGarde(code, detail)
  );

  return {
    mode,
    convention: "Exact/Exact (365/366), start_excluded_end_included, simple",
    laf_table_last_quarter: lafRatesJson.metadata.last_quarter,
    truncated_any: truncatedAny,
    total_principal_cents: assertSafeIntCents(sumPrincipalCents, "total_principal"),
    total_principal_cad: formatCentsToCad(sumPrincipalCents),
    total_legal_interest_cents: assertSafeIntCents(
      sumLegalCents,
      "total_legal_interest"
    ),
    total_legal_interest_cad: formatCentsToCad(sumLegalCents),
    total_additional_indemnity_cents: assertSafeIntCents(
      sumAdditionalCents,
      "total_additional_indemnity"
    ),
    total_additional_indemnity_cad: formatCentsToCad(sumAdditionalCents),
    total_contractual_interest_cents: assertSafeIntCents(
      sumContractualCents,
      "total_contractual_interest"
    ),
    total_contractual_interest_cad: formatCentsToCad(sumContractualCents),
    total_interest_cents: assertSafeIntCents(
      sumTotalInterestCents,
      "total_interest"
    ),
    total_interest_cad: formatCentsToCad(sumTotalInterestCents),
    grand_total_cents: assertSafeIntCents(grandTotalCents, "grand_total"),
    grand_total_cad: formatCentsToCad(grandTotalCents),
    tranches: trancheResults,
    provenance: {
      source:
        mode === "contractual"
          ? "Calcul arithmétique conventionnel en intérêt simple (Exact/Exact, 365/366)"
          : `${lafRatesJson.metadata.source}; art. 3 Loi sur l'intérêt (L.R.C. 1985, c. I-15); art. 1618-1620 C.c.Q.`,
      verified_at: lafRatesJson.metadata.verified_at,
      table_version: lafRatesJson.metadata.table_version,
    },
    gardes,
  };
}
