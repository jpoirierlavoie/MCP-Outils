import { z } from "zod";
import {
  addDays,
  dayOfWeek,
  formatIsoDate,
  frenchWeekday,
  parseIsoDate,
} from "./dates.js";
import { Garde, GardeSchema, ProvenanceSchema, makeGarde } from "./gardes.js";

export const REGIMES = ["qc_cpc", "qc_li", "ca_li"] as const;
export const RegimeSchema = z.enum(REGIMES);
export type HolidayRegime = z.infer<typeof RegimeSchema>;

export const REGIME_LABELS_FR: Record<HolidayRegime, string> = {
  qc_cpc:
    "Québec — Code de procédure civile (art. 82 al. 1, 83 al. 3 C.p.c. et art. 61 par. 23° L.I.)",
  qc_li: "Québec — Loi d'interprétation générale (art. 61 par. 23° et art. 52 L.I., RLRQ c. I-16)",
  ca_li: "Canada — Loi d'interprétation fédérale (art. 35(1) L.I., L.R.C. 1985, c. I-21)",
};

export const VERIFIED_CALENDAR_AT = "2026-11-13";

export const HolidayEntrySchema = z.object({
  date: z.string().describe("Date du jour férié ou non juridique au format ISO YYYY-MM-DD."),
  weekday_fr: z.string().describe("Jour de la semaine en français."),
  name_fr: z.string().describe("Nom officiel ou usuel du jour férié."),
  legal_basis: z.string().describe("Fondement législatif précis."),
  movable: z.boolean().describe("Indique si la date varie selon l'année."),
});
export type HolidayEntry = z.infer<typeof HolidayEntrySchema>;

export const ListHolidaysInputSchema = z.strictObject({
  year: z
    .number()
    .int()
    .min(1900)
    .max(2200)
    .describe("Année civile visée (entre 1900 et 2200)."),
  regime: RegimeSchema
    .optional()
    .describe(
      "Régime juridique applicable : 'qc_cpc' (défaut, C.p.c. incluant samedis, 2 janv. et 26 déc.), 'qc_li' (L.I. Québec sans 2 janv./26 déc.), ou 'ca_li' (L.I. fédérale incluant 30 sept. et 11 nov., excluant 24 juin/2 janv./26 déc.)."
    ),
});
export type ListHolidaysInput = z.infer<typeof ListHolidaysInputSchema>;

export const ListHolidaysOutputSchema = z.object({
  year: z.number().int(),
  regime: RegimeSchema,
  regime_label_fr: z.string(),
  weekly_non_juridical_days: z.array(z.enum(["saturday", "sunday"])),
  saturday_triggers_deadline_rollover: z.boolean(),
  holidays: z.array(HolidayEntrySchema),
  count: z.number().int(),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type ListHolidaysOutput = z.infer<typeof ListHolidaysOutputSchema>;

/**
 * Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for Easter Sunday.
 */
export function computeEasterSunday(year: number): string {
  if (!Number.isInteger(year) || year < 1583) {
    throw new RangeError(`Année grégorienne invalide pour Pâques : ${year}`);
  }
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatIsoDate(year, month, day);
}

function mondayPrecedingMay25(year: number): string {
  const may25 = formatIsoDate(year, 5, 25);
  const dow = dayOfWeek(may25);
  const offset = (dow + 6) % 7 || 7;
  return addDays(may25, -offset);
}

function firstMondayOfMonth(year: number, month: number): string {
  const first = formatIsoDate(year, month, 1);
  const dow = dayOfWeek(first);
  const offset = (8 - dow) % 7;
  return addDays(first, offset);
}

function secondMondayOfMonth(year: number, month: number): string {
  return addDays(firstMondayOfMonth(year, month), 7);
}

export function getStatutoryHolidaysForYear(
  year: number,
  regime: HolidayRegime
): HolidayEntry[] {
  const easter = computeEasterSunday(year);
  const goodFriday = addDays(easter, -2);
  const easterMonday = addDays(easter, 1);
  const mayMonday = mondayPrecedingMay25(year);
  const july1 = formatIsoDate(year, 7, 1);
  const canadaDay = dayOfWeek(july1) === 0 ? formatIsoDate(year, 7, 2) : july1;
  const canadaDayShifted = canadaDay !== july1;
  const labourDay = firstMondayOfMonth(year, 9);
  const thanksgiving = secondMondayOfMonth(year, 10);

  const items: Array<Omit<HolidayEntry, "weekday_fr">> = [];

  if (regime === "qc_cpc" || regime === "qc_li") {
    items.push({
      date: formatIsoDate(year, 1, 1),
      name_fr: "Jour de l'an",
      legal_basis: "art. 61 par. 23° b) L.I. QC",
      movable: false,
    });
    if (regime === "qc_cpc") {
      items.push({
        date: formatIsoDate(year, 1, 2),
        name_fr: "Lendemain du jour de l'an",
        legal_basis: "art. 82 al. 1 C.p.c.",
        movable: false,
      });
    }
    items.push(
      {
        date: goodFriday,
        name_fr: "Vendredi saint",
        legal_basis: "art. 61 par. 23° c) L.I. QC",
        movable: true,
      },
      {
        date: easterMonday,
        name_fr: "Lundi de Pâques",
        legal_basis: "art. 61 par. 23° d) L.I. QC",
        movable: true,
      },
      {
        date: mayMonday,
        name_fr: "Journée nationale des patriotes / Fête du Souverain (proclamation)",
        legal_basis: "art. 61 par. 23° i) L.I. QC",
        movable: true,
      },
      {
        date: formatIsoDate(year, 6, 24),
        name_fr: "Fête nationale du Québec",
        legal_basis: "art. 61 par. 23° e) L.I. QC",
        movable: false,
      },
      {
        date: canadaDay,
        name_fr: canadaDayShifted
          ? "Fête du Canada (observée le 2 juillet, le 1er étant dimanche)"
          : "Fête du Canada",
        legal_basis: "art. 61 par. 23° f) L.I. QC",
        movable: canadaDayShifted,
      },
      {
        date: labourDay,
        name_fr: "Fête du Travail",
        legal_basis: "art. 61 par. 23° g) L.I. QC",
        movable: true,
      },
      {
        date: thanksgiving,
        name_fr: "Action de grâces",
        legal_basis: "art. 61 par. 23° g.1) L.I. QC",
        movable: true,
      },
      {
        date: formatIsoDate(year, 12, 25),
        name_fr: "Noël",
        legal_basis: "art. 61 par. 23° h) L.I. QC",
        movable: false,
      }
    );
    if (regime === "qc_cpc") {
      items.push({
        date: formatIsoDate(year, 12, 26),
        name_fr: "Lendemain de Noël",
        legal_basis: "art. 82 al. 1 C.p.c.",
        movable: false,
      });
    }
  } else {
    // ca_li: federal Interpretation Act, art. 35(1) + Holidays Act, s. 2(2)
    items.push(
      {
        date: formatIsoDate(year, 1, 1),
        name_fr: "Jour de l'an",
        legal_basis: "art. 35(1) L.I. CA",
        movable: false,
      },
      {
        date: goodFriday,
        name_fr: "Vendredi saint",
        legal_basis: "art. 35(1) L.I. CA",
        movable: true,
      },
      {
        date: easterMonday,
        name_fr: "Lundi de Pâques",
        legal_basis: "art. 35(1) L.I. CA",
        movable: true,
      },
      {
        date: mayMonday,
        name_fr: "Fête de Victoria",
        legal_basis: "art. 35(1) L.I. CA",
        movable: true,
      },
      {
        date: canadaDay,
        name_fr: canadaDayShifted
          ? "Fête du Canada (observée le 2 juillet, le 1er étant dimanche)"
          : "Fête du Canada",
        legal_basis: "art. 35(1) L.I. CA; Loi instituant des jours de fête légale, art. 2(2)",
        movable: canadaDayShifted,
      },
      {
        date: labourDay,
        name_fr: "Fête du Travail",
        legal_basis: "art. 35(1) L.I. CA",
        movable: true,
      }
    );
    if (year >= 2021) {
      items.push({
        date: formatIsoDate(year, 9, 30),
        name_fr: "Journée nationale de la vérité et de la réconciliation",
        legal_basis: "art. 35(1) L.I. CA (L.C. 2021, c. 11)",
        movable: false,
      });
    }
    items.push(
      {
        date: thanksgiving,
        name_fr: "Action de grâces (proclamation annuelle)",
        legal_basis: "art. 35(1) L.I. CA",
        movable: true,
      },
      {
        date: formatIsoDate(year, 11, 11),
        name_fr: "Jour du Souvenir",
        legal_basis: "art. 35(1) L.I. CA",
        movable: false,
      },
      {
        date: formatIsoDate(year, 12, 25),
        name_fr: "Noël",
        legal_basis: "art. 35(1) L.I. CA",
        movable: false,
      }
    );
  }

  return items
    .map((entry) => ({
      ...entry,
      weekday_fr: frenchWeekday(entry.date),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function isNonJuridicalDate(
  isoDate: string,
  regime: HolidayRegime,
  rolloverSaturday: boolean,
  extraNonJuridicalDates?: ReadonlySet<string>,
  yearCache?: Map<number, Map<string, HolidayEntry>>
): { nonJuridical: boolean; reason: string | null } {
  if (extraNonJuridicalDates?.has(isoDate)) {
    return { nonJuridical: true, reason: "jour férié/fermeture additionnel fourni" };
  }
  const dow = dayOfWeek(isoDate);
  if (dow === 0) {
    const basis =
      regime === "ca_li" ? "art. 35(1) L.I. CA" : "art. 61 par. 23° a) L.I. QC";
    return { nonJuridical: true, reason: `dimanche (${basis})` };
  }
  if (dow === 6) {
    if (regime === "qc_cpc") {
      return { nonJuridical: true, reason: "samedi (art. 82 al. 1, 83 al. 3 C.p.c.)" };
    }
    if (rolloverSaturday) {
      const basis =
        regime === "qc_li"
          ? "samedi reporté (art. 52 al. 1 L.I. QC)"
          : "samedi reporté selon rollover_saturday=true (art. 26 L.I. CA / pratique administrative)";
      return { nonJuridical: true, reason: basis };
    }
  }

  const { year } = parseIsoDate(isoDate);
  let byDate = yearCache?.get(year);
  if (!byDate) {
    byDate = new Map(getStatutoryHolidaysForYear(year, regime).map((h) => [h.date, h]));
    yearCache?.set(year, byDate);
  }
  const hit = byDate.get(isoDate);
  if (hit) {
    return { nonJuridical: true, reason: `${hit.name_fr} (${hit.legal_basis})` };
  }
  return { nonJuridical: false, reason: null };
}

export function listHolidays(input: ListHolidaysInput): ListHolidaysOutput {
  const regime: HolidayRegime = input.regime ?? "qc_cpc";
  const holidays = getStatutoryHolidaysForYear(input.year, regime);

  const gardes: Garde[] = [];
  if (regime === "qc_li") {
    gardes.push(makeGarde("SAMEDI_CONGE_LOI_INTERPRETATION_QC"));
  }
  const caNote =
    regime === "ca_li"
      ? "Sous ca_li, les jours fériés provinciaux/municipaux (art. 35(1) al. a)-b) L.I. CA) et les vacances judiciaires des Cours fédérales ne sont pas inclus automatiquement."
      : undefined;
  gardes.push(makeGarde("JOURS_PROCLAMES_NON_PREVISIBLES", caNote));

  return {
    year: input.year,
    regime,
    regime_label_fr: REGIME_LABELS_FR[regime],
    weekly_non_juridical_days:
      regime === "qc_cpc" ? ["saturday", "sunday"] : ["sunday"],
    saturday_triggers_deadline_rollover: regime === "qc_cpc" || regime === "qc_li",
    holidays,
    count: holidays.length,
    provenance: {
      source: REGIME_LABELS_FR[regime],
      verified_at: VERIFIED_CALENDAR_AT,
    },
    gardes,
  };
}
