const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const MS_PER_DAY = 86_400_000;

interface ParsedIsoDate {
  year: number;
  month: number;
  day: number;
}

interface ParsedTimeHHMM {
  hour: number;
  minute: number;
  second: number;
  totalMinutes: number;
  totalSeconds: number;
  hasExplicitSeconds: boolean;
}

const FRENCH_WEEKDAYS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): 365 | 366 {
  return isLeapYear(year) ? 366 : 365;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      throw new RangeError(`Mois invalide : ${month}`);
  }
}

export function parseIsoDate(iso: string): ParsedIsoDate {
  const match = ISO_DATE_RE.exec(iso);
  if (!match) {
    throw new RangeError(`Date ISO invalide (attendu YYYY-MM-DD) : "${iso}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new RangeError(`Mois invalide dans la date "${iso}"`);
  }
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    throw new RangeError(`Jour invalide dans la date "${iso}"`);
  }
  return { year, month, day };
}

export function formatIsoDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  const iso = `${y}-${m}-${d}`;
  parseIsoDate(iso);
  return iso;
}

function toUtcMs(iso: string): number {
  const { year, month, day } = parseIsoDate(iso);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return formatIsoDate(year, month, day);
}

export function addDays(iso: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError(`Le nombre de jours doit être entier : ${days}`);
  }
  return fromUtcMs(toUtcMs(iso) + days * MS_PER_DAY);
}

export function addMonthsClamped(iso: string, months: number): string {
  if (!Number.isInteger(months)) {
    throw new RangeError(`Le nombre de mois doit être entier : ${months}`);
  }
  const { year, month, day } = parseIsoDate(iso);
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (((totalMonths % 12) + 12) % 12) + 1;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return formatIsoDate(targetYear, targetMonth, clampedDay);
}

export function addYearsClamped(iso: string, years: number): string {
  if (!Number.isInteger(years)) {
    throw new RangeError(`Le nombre d'années doit être entier : ${years}`);
  }
  return addMonthsClamped(iso, years * 12);
}

export function diffCalendarDays(startIso: string, endIso: string): number {
  return Math.round((toUtcMs(endIso) - toUtcMs(startIso)) / MS_PER_DAY);
}

export function dayOfWeek(iso: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const dow = new Date(toUtcMs(iso)).getUTCDay();
  return dow as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function frenchWeekday(iso: string): string {
  return FRENCH_WEEKDAYS[dayOfWeek(iso)];
}

export function compareIsoDates(a: string, b: string): -1 | 0 | 1 {
  const msA = toUtcMs(a);
  const msB = toUtcMs(b);
  if (msA < msB) return -1;
  if (msA > msB) return 1;
  return 0;
}

export function minIsoDate(a: string, b: string): string {
  return compareIsoDates(a, b) <= 0 ? a : b;
}

export function parseTimeHHMM(timeStr: string): ParsedTimeHHMM {
  const match = TIME_RE.exec(timeStr);
  if (!match) {
    throw new RangeError(`Heure invalide (attendu HH:MM ou HH:MM:SS) : "${timeStr}"`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] !== undefined ? Number(match[3]) : 0;
  const hasExplicitSeconds = match[3] !== undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    throw new RangeError(`Heure hors bornes (00:00[:00]..23:59[:59]) : "${timeStr}"`);
  }
  return {
    hour,
    minute,
    second,
    totalMinutes: hour * 60 + minute,
    totalSeconds: hour * 3600 + minute * 60 + second,
    hasExplicitSeconds,
  };
}

export function getQuarter(month: number): 1 | 2 | 3 | 4 {
  if (month < 1 || month > 12) {
    throw new RangeError(`Mois invalide : ${month}`);
  }
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

export function quarterKey(year: number, month: number): string {
  return `${year}-Q${getQuarter(month)}`;
}
