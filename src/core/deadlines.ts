import { z } from "zod";
import {
  addDays,
  addMonthsClamped,
  addYearsClamped,
  frenchWeekday,
  parseIsoDate,
  parseTimeHHMM,
} from "./dates.js";
import { Garde, GardeCode, GardeSchema, makeGarde, ProvenanceSchema } from "./gardes.js";
import {
  caProvinceHolidayNote,
  HolidayEntry,
  HolidayRegime,
  isNonJuridicalDate,
  Province,
  ProvinceSchema,
  REGIME_LABELS_FR,
  RegimeSchema,
  VERIFIED_CALENDAR_AT,
} from "./holidays.js";

const ISO_DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_FORMAT_RE = /^\d{2}:\d{2}(?::\d{2})?$/;

const NotificationModeSchema = z.enum(["none", "technological", "physical"]);
type NotificationMode = z.infer<typeof NotificationModeSchema>;

const DeadlineUnitSchema = z.enum(["days", "months", "years"]);
type DeadlineUnit = z.infer<typeof DeadlineUnitSchema>;

const DeadlineDirectionSchema = z.enum(["forward", "backward"]);
type DeadlineDirection = z.infer<typeof DeadlineDirectionSchema>;

const DeadlineStepInputSchema = z.strictObject({
  label: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Étiquette fournie par l'appelant pour identifier l'étape (p. ex. 'Réponse')."),
  amount: z.number().int().min(1).max(36500).describe("Durée entière positive du délai à compter."),
  unit: DeadlineUnitSchema.optional().describe(
    "Unité du délai : 'days' (défaut), 'months' (quantième) ou 'years'.",
  ),
  direction: DeadlineDirectionSchema.optional().describe(
    "Sens du calcul : 'forward' (défaut, délai prospectif) ou 'backward' (délai à rebours avant une audience ou étape).",
  ),
  anchor_date: z
    .string()
    .regex(ISO_DATE_FORMAT_RE)
    .optional()
    .describe("Date d'ancrage ISO YYYY-MM-DD spécifique à cette étape (remplace event_date)."),
  anchor_time: z
    .string()
    .regex(TIME_FORMAT_RE)
    .optional()
    .describe("Heure d'ancrage HH:MM ou HH:MM:SS spécifique à cette étape."),
  notification_mode: NotificationModeSchema.optional().describe(
    "Mode de notification spécifique à cette étape (remplace l'option globale).",
  ),
  depends_on_index: z
    .number()
    .int()
    .min(0)
    .max(24)
    .optional()
    .describe(
      "Index 0-basé d'une étape précédente de deadlines[] dont l'effective_date sert de point de départ.",
    ),
});

export const ComputeDeadlinesInputSchema = z.strictObject({
  event_date: z
    .string()
    .regex(ISO_DATE_FORMAT_RE)
    .describe("Date d'ancrage principale au format ISO YYYY-MM-DD (exclu du compte initial)."),
  event_time: z
    .string()
    .regex(TIME_FORMAT_RE)
    .optional()
    .describe(
      "Heure de l'événement au format 24h HH:MM ou HH:MM:SS (utile pour art. 111 al. 2 C.p.c. après 17:00:00).",
    ),
  notification_mode: NotificationModeSchema.optional().describe(
    "Mode de notification : 'none' (défaut), 'technological' (applique le report de l'art. 111 al. 2 C.p.c. après 17:00 ou un jour non juridique), ou 'physical'.",
  ),
  regime: RegimeSchema.optional().describe(
    "Régime de jours fériés : 'qc_cpc' (défaut), 'qc_prescription' (prescription C.c.Q., art. 2879 al. 2), 'qc_li', ou 'ca_li'.",
  ),
  province: ProvinceSchema.optional().describe(
    "Province ou territoire canadien optionnel (p. ex. 'QC', 'ON', 'BC') : sous 'ca_li' avec 'QC', ajoute le 24 juin (Fête nationale du Québec, art. 35(1) al. a) L.I. CA).",
  ),
  rollover_saturday: z
    .boolean()
    .optional()
    .describe(
      "Prolonger un délai échéant un samedi (toujours vrai en qc_cpc et qc_prescription ; défaut false en qc_li et ca_li — activer true si art. 52 al. 2 L.I. QC au bureau de la publicité des droits ou règle particulière).",
    ),
  extra_non_juridical_dates: z
    .array(z.string().regex(ISO_DATE_FORMAT_RE))
    .max(50)
    .optional()
    .describe(
      "Dates additionnelles proclamées fériées ou fermetures de greffe au format YYYY-MM-DD.",
    ),
  deadlines: z
    .array(DeadlineStepInputSchema)
    .min(1)
    .max(25)
    .describe("Liste d'une à 25 étapes de calcul de délai à exécuter."),
});
type ComputeDeadlinesInput = z.infer<typeof ComputeDeadlinesInputSchema>;

const RolloverHopSchema = z.object({
  date: z.string(),
  weekday_fr: z.string(),
  reason: z.string(),
});

const DeadlineStepResultSchema = z.object({
  index: z.number().int(),
  label: z.string(),
  direction: DeadlineDirectionSchema,
  unit: DeadlineUnitSchema,
  amount: z.number().int(),
  input_anchor_date: z.string(),
  effective_anchor_date: z.string(),
  anchor_shifted_art_111: z.boolean(),
  anchor_shift_reason: z.string().nullable(),
  raw_date: z.string(),
  raw_weekday_fr: z.string(),
  effective_date: z.string(),
  effective_weekday_fr: z.string(),
  preceding_business_day: z.string().nullable(),
  rolled_over: z.boolean(),
  rollover_hops: z.array(RolloverHopSchema),
  in_non_sitting_period: z.boolean(),
  non_sitting_period_label: z.string().nullable(),
  formula_summary_fr: z.string(),
});
type DeadlineStepResult = z.infer<typeof DeadlineStepResultSchema>;

export const ComputeDeadlinesOutputSchema = z.object({
  regime: RegimeSchema,
  province: ProvinceSchema.nullable(),
  regime_label_fr: z.string(),
  rollover_saturday: z.boolean(),
  results: z.array(DeadlineStepResultSchema),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type ComputeDeadlinesOutput = z.infer<typeof ComputeDeadlinesOutputSchema>;

function unitLabelFr(amount: number, unit: DeadlineUnit): string {
  switch (unit) {
    case "days":
      return amount === 1 ? "1 jour" : `${amount} jours`;
    case "months":
      return `${amount} mois`;
    case "years":
      return amount === 1 ? "1 an" : `${amount} ans`;
  }
}

function getQcNonSittingPeriodLabel(isoDate: string): string | null {
  const { month, day } = parseIsoDate(isoDate);
  if ((month === 6 && day === 30) || month === 7 || month === 8 || (month === 9 && day === 1)) {
    return "du 30 juin au 1er septembre (art. 82 al. 2 C.p.c.)";
  }
  if ((month === 12 && day >= 20) || (month === 1 && day <= 7)) {
    return "du 20 décembre au 7 janvier (art. 82 al. 2 C.p.c.)";
  }
  return null;
}

function addAmountByUnit(isoDate: string, signedAmount: number, unit: DeadlineUnit): string {
  switch (unit) {
    case "days":
      return addDays(isoDate, signedAmount);
    case "months":
      return addMonthsClamped(isoDate, signedAmount);
    case "years":
      return addYearsClamped(isoDate, signedAmount);
  }
}

export function computeDeadlines(input: ComputeDeadlinesInput): ComputeDeadlinesOutput {
  parseIsoDate(input.event_date);
  if (input.event_time !== undefined) {
    parseTimeHHMM(input.event_time);
  }
  const extraSet = new Set<string>();
  for (const extraDate of input.extra_non_juridical_dates ?? []) {
    parseIsoDate(extraDate);
    extraSet.add(extraDate);
  }

  const regime: HolidayRegime = input.regime ?? "qc_cpc";
  const province: Province | null = input.province ?? null;
  if (province !== null && province !== "QC" && regime !== "ca_li") {
    throw new RangeError(
      `Le paramètre province='${province}' hors Québec ne s'applique qu'au régime fédéral 'ca_li'.`,
    );
  }
  const rolloverSaturday =
    regime === "qc_cpc" || regime === "qc_prescription" ? true : (input.rollover_saturday ?? false);
  const yearCache = new Map<number, Map<string, HolidayEntry>>();

  const guardReasons = new Map<GardeCode, string | undefined>();
  const recordGarde = (code: GardeCode, detail?: string) => {
    if (!guardReasons.has(code)) {
      guardReasons.set(code, detail);
    }
  };

  if (regime === "qc_li") {
    recordGarde("SAMEDI_CONGE_LOI_INTERPRETATION_QC");
  } else if (regime === "ca_li") {
    recordGarde("SAMEDI_CONGE_LOI_INTERPRETATION_CA");
  }
  recordGarde(
    "JOURS_PROCLAMES_NON_PREVISIBLES",
    regime === "ca_li" ? caProvinceHolidayNote(input.province) : undefined,
  );

  const results: DeadlineStepResult[] = [];

  for (let idx = 0; idx < input.deadlines.length; idx++) {
    const step = input.deadlines[idx]!;
    const direction: DeadlineDirection = step.direction ?? "forward";
    const unit: DeadlineUnit = step.unit ?? "days";
    const label = step.label ?? `Délai #${idx + 1}`;

    if (step.depends_on_index !== undefined && step.anchor_date !== undefined) {
      throw new RangeError(
        `Étape #${idx + 1} (${label}) : ne pas combiner depends_on_index et anchor_date.`,
      );
    }

    let inputAnchorDate: string;
    let effectiveAnchorDate: string;
    let anchorShiftedArt111 = false;
    let anchorShiftReason: string | null = null;
    let stepTime: string | undefined;
    let stepNotifMode: NotificationMode;

    if (step.depends_on_index !== undefined) {
      if (idx === 0) {
        throw new RangeError(
          `Étape #1 (${label}) : depends_on_index ne peut pas être utilisé sur la première étape (aucune étape antérieure à référencer ; utiliser event_date ou anchor_date).`,
        );
      }
      if (step.depends_on_index >= idx) {
        throw new RangeError(
          `Étape #${idx + 1} (${label}) : depends_on_index (${step.depends_on_index}) doit référencer une étape antérieure (0..${idx - 1}).`,
        );
      }
      const parent = results[step.depends_on_index]!;
      inputAnchorDate = parent.effective_date;
      effectiveAnchorDate = parent.effective_date;
      stepTime = step.anchor_time;
      stepNotifMode = step.notification_mode ?? "none";
    } else {
      inputAnchorDate = step.anchor_date ?? input.event_date;
      parseIsoDate(inputAnchorDate);
      stepTime = step.anchor_time ?? (step.anchor_date ? undefined : input.event_time);
      if (stepTime !== undefined) {
        parseTimeHHMM(stepTime);
      }
      stepNotifMode = step.notification_mode ?? input.notification_mode ?? "none";
      effectiveAnchorDate = inputAnchorDate;
    }

    if (stepNotifMode === "technological" && direction === "forward") {
      const parsedTime = stepTime ? parseTimeHHMM(stepTime) : null;
      const after17h = parsedTime !== null && parsedTime.totalSeconds > 17 * 3600;
      const isExact1700WithoutSeconds =
        parsedTime !== null &&
        parsedTime.totalSeconds === 17 * 3600 &&
        !parsedTime.hasExplicitSeconds;
      const anchorStatus = isNonJuridicalDate(
        inputAnchorDate,
        regime,
        rolloverSaturday,
        extraSet,
        yearCache,
        input.province,
      );
      if (after17h || anchorStatus.nonJuridical) {
        let candidate = after17h ? addDays(inputAnchorDate, 1) : inputAnchorDate;
        while (
          isNonJuridicalDate(
            candidate,
            regime,
            rolloverSaturday,
            extraSet,
            yearCache,
            input.province,
          ).nonJuridical
        ) {
          candidate = addDays(candidate, 1);
        }
        effectiveAnchorDate = candidate;
        anchorShiftedArt111 = candidate !== inputAnchorDate;
        const causes: string[] = [];
        if (after17h && stepTime) {
          causes.push(`notification technologique après 17:00:00 (${stepTime})`);
        }
        if (anchorStatus.nonJuridical && anchorStatus.reason) {
          causes.push(`jour initial non juridique (${anchorStatus.reason})`);
        }
        anchorShiftReason = causes.join(" et ");
        recordGarde("NOTIFICATION_TECHNOLOGIQUE_APRES_17H");
      } else if (isExact1700WithoutSeconds && !anchorStatus.nonJuridical) {
        recordGarde("NOTIFICATION_TECHNOLOGIQUE_17H_SECONDE_EXACTE");
      } else if (parsedTime === null && !anchorStatus.nonJuridical) {
        recordGarde("NOTIFICATION_TECHNOLOGIQUE_SANS_HEURE");
      }
    }

    const signedAmount = direction === "forward" ? step.amount : -step.amount;
    const rawDate = addAmountByUnit(effectiveAnchorDate, signedAmount, unit);
    const rawWeekday = frenchWeekday(rawDate);

    const rolloverHops: Array<{ date: string; weekday_fr: string; reason: string }> = [];
    let current = rawDate;
    const hopDelta = direction === "forward" ? 1 : -1;
    let safety = 0;
    while (true) {
      const check = isNonJuridicalDate(
        current,
        regime,
        rolloverSaturday,
        extraSet,
        yearCache,
        input.province,
      );
      if (!check.nonJuridical) {
        break;
      }
      rolloverHops.push({
        date: current,
        weekday_fr: frenchWeekday(current),
        reason: check.reason ?? "jour non juridique",
      });
      current = addDays(current, hopDelta);
      safety += 1;
      if (safety > 366) {
        throw new RangeError(
          `Dépassement lors de la recherche du jour ouvrable pour l'étape "${label}".`,
        );
      }
    }

    const effectiveDate = current;
    const effectiveWeekday = frenchWeekday(effectiveDate);
    const rolledOver = effectiveDate !== rawDate;
    const precedingBusinessDay = direction === "backward" ? effectiveDate : null;

    if (direction === "backward") {
      recordGarde("DELAI_A_REBOURS_VERIFIER_TEXTE");
    } else if (regime === "qc_cpc") {
      recordGarde("DEPOT_GREFFE_HEURES_OUVERTURE");
    }

    let nonSittingLabel: string | null = null;
    if (regime === "qc_cpc") {
      nonSittingLabel =
        getQcNonSittingPeriodLabel(rawDate) ?? getQcNonSittingPeriodLabel(effectiveDate);
      if (nonSittingLabel !== null) {
        recordGarde("JOUR_NON_SEANCE_ART_82_AL_2");
      }
    }

    const parts: string[] = [];
    if (anchorShiftedArt111) {
      parts.push(
        `${frenchWeekday(inputAnchorDate)} ${inputAnchorDate}${stepTime ? ` à ${stepTime}` : ""} → réputé fait le ${frenchWeekday(effectiveAnchorDate)} ${effectiveAnchorDate} (art. 111 al. 2 C.p.c.)`,
      );
    } else {
      parts.push(`${frenchWeekday(effectiveAnchorDate)} ${effectiveAnchorDate}`);
    }
    const op = direction === "forward" ? "+" : "-";
    parts.push(`${op} ${unitLabelFr(step.amount, unit)} → ${rawWeekday} ${rawDate}`);
    if (rolledOver) {
      const hopText = rolloverHops.map((h) => h.reason).join(", ");
      const verb = direction === "forward" ? "reporté au" : "reculé au jour ouvrable précédent";
      parts.push(`(${hopText}) → ${verb} ${effectiveWeekday} ${effectiveDate}`);
    }

    results.push({
      index: idx,
      label,
      direction,
      unit,
      amount: step.amount,
      input_anchor_date: inputAnchorDate,
      effective_anchor_date: effectiveAnchorDate,
      anchor_shifted_art_111: anchorShiftedArt111,
      anchor_shift_reason: anchorShiftReason,
      raw_date: rawDate,
      raw_weekday_fr: rawWeekday,
      effective_date: effectiveDate,
      effective_weekday_fr: effectiveWeekday,
      preceding_business_day: precedingBusinessDay,
      rolled_over: rolledOver,
      rollover_hops: rolloverHops,
      in_non_sitting_period: nonSittingLabel !== null,
      non_sitting_period_label: nonSittingLabel,
      formula_summary_fr: parts.join(" "),
    });
  }

  const gardes: Garde[] = Array.from(guardReasons.entries()).map(([code, detail]) =>
    makeGarde(code, detail),
  );

  return {
    regime,
    province,
    regime_label_fr: REGIME_LABELS_FR[regime],
    rollover_saturday: rolloverSaturday,
    results,
    provenance: {
      source:
        regime === "qc_cpc"
          ? `${REGIME_LABELS_FR[regime]}; art. 107, 111 C.p.c.`
          : REGIME_LABELS_FR[regime],
      verified_at: VERIFIED_CALENDAR_AT,
    },
    gardes,
  };
}
