/**
 * The Badí‘ (Bahá'í) calendar.
 *
 * From 172 B.E. (2015) the calendar is astronomically determined, per the
 * Universal House of Justice's letter of 10 July 2014:
 *
 *   - Naw-Rúz is the Bahá'í day (sunset to sunset) in which the March equinox
 *     falls, as reckoned at Tehran.
 *   - The Twin Holy Birthdays fall on the first and second days following the
 *     eighth new moon after Naw-Rúz, again reckoned at Tehran.
 *
 * Everything else — the nineteen months of nineteen days, the length of
 * Ayyám-i-Há, the Fast, the Feasts and the fixed-date Holy Days — follows
 * arithmetically from those two anchors.
 */

import {
  addDays,
  daysBetween,
  gregorianToJD,
  isoDate,
  jdToGregorian,
  marchEquinox,
  nthNewMoonAfter,
  parseIso,
  sunsetJde,
  TEHRAN,
  tdToUt,
} from './astronomy.ts';
import { OFFICIAL_NAW_RUZ, OFFICIAL_TWIN_BIRTHDAYS } from './badi-official.ts';

/** Bahá'í year 1 began at Naw-Rúz 1844. */
const BE_EPOCH_GREGORIAN_YEAR = 1843;

export interface BadiMonth {
  /** 1–19; Ayyám-i-Há is represented by month 0. */
  number: number;
  name: string;
  meaning: string;
}

export const BADI_MONTHS: BadiMonth[] = [
  { number: 1, name: 'Bahá', meaning: 'Splendour' },
  { number: 2, name: 'Jalál', meaning: 'Glory' },
  { number: 3, name: 'Jamál', meaning: 'Beauty' },
  { number: 4, name: '‘Aẓamat', meaning: 'Grandeur' },
  { number: 5, name: 'Núr', meaning: 'Light' },
  { number: 6, name: 'Raḥmat', meaning: 'Mercy' },
  { number: 7, name: 'Kalimát', meaning: 'Words' },
  { number: 8, name: 'Kamál', meaning: 'Perfection' },
  { number: 9, name: 'Asmá’', meaning: 'Names' },
  { number: 10, name: '‘Izzat', meaning: 'Might' },
  { number: 11, name: 'Mashíyyat', meaning: 'Will' },
  { number: 12, name: '‘Ilm', meaning: 'Knowledge' },
  { number: 13, name: 'Qudrat', meaning: 'Power' },
  { number: 14, name: 'Qawl', meaning: 'Speech' },
  { number: 15, name: 'Masá’il', meaning: 'Questions' },
  { number: 16, name: 'Sharaf', meaning: 'Honour' },
  { number: 17, name: 'Sulṭán', meaning: 'Sovereignty' },
  { number: 18, name: 'Mulk', meaning: 'Dominion' },
  { number: 19, name: '‘Alá’', meaning: 'Loftiness' },
];

export const AYYAM_I_HA: BadiMonth = { number: 0, name: 'Ayyám-i-Há', meaning: 'Days of Há' };

export function badiMonth(number: number): BadiMonth {
  return number === 0 ? AYYAM_I_HA : BADI_MONTHS[number - 1];
}

export interface BadiDate {
  /** Bahá'í year (B.E.). */
  year: number;
  /** 1–19, or 0 for Ayyám-i-Há. */
  month: number;
  /** 1–19, or 1–5 within Ayyám-i-Há. */
  day: number;
}

/**
 * Which Bahá'í day contains a given instant, expressed as the Gregorian date on
 * which that Bahá'í day's daylight falls. The Bahá'í day begins at sunset, so
 * an instant after sunset belongs to the following Gregorian date.
 */
function badiDayOf(jdeInstant: number): string {
  const ut = tdToUt(jdeInstant);
  // Tehran local civil date of the instant.
  const local = jdToGregorian(ut + TEHRAN.utcOffsetHours / 24);
  const iso = isoDate(local);
  return ut >= sunsetJde(iso, TEHRAN) ? addDays(iso, 1) : iso;
}

const nawRuzCache = new Map<number, string>();

/** Naw-Rúz as computed from the equinox, ignoring the official table. */
function computedNawRuz(badiYear: number): string {
  return badiDayOf(marchEquinox(badiYear + BE_EPOCH_GREGORIAN_YEAR));
}

/**
 * How far the March equinox falls from Tehran sunset, in minutes. Positive
 * means after sunset. A small magnitude means the determination is too close to
 * call from a computed sunset.
 */
export function equinoxSunsetMarginMinutes(badiYear: number): number {
  const equinox = tdToUt(marchEquinox(badiYear + BE_EPOCH_GREGORIAN_YEAR));
  const local = isoDate(jdToGregorian(equinox + TEHRAN.utcOffsetHours / 24));
  return (equinox - sunsetJde(local, TEHRAN)) * 1440;
}

/** Below this margin the computed determination is not trustworthy on its own. */
const MARGINAL_MINUTES = 30;

export type NawRuzConfidence = 'official' | 'computed' | 'marginal';

/**
 * Whether a year's Naw-Rúz comes from the published table ('official'), was
 * computed with a comfortable margin ('computed'), or was computed but falls
 * near enough to Tehran sunset that an official date is required ('marginal').
 */
export function nawRuzConfidence(badiYear: number): NawRuzConfidence {
  if (OFFICIAL_NAW_RUZ[badiYear]) return 'official';
  return Math.abs(equinoxSunsetMarginMinutes(badiYear)) < MARGINAL_MINUTES ? 'marginal' : 'computed';
}

/** Gregorian date (ISO) of Naw-Rúz beginning Bahá'í year `badiYear`. */
export function nawRuz(badiYear: number): string {
  const cached = nawRuzCache.get(badiYear);
  if (cached) return cached;
  const result = OFFICIAL_NAW_RUZ[badiYear] ?? computedNawRuz(badiYear);
  nawRuzCache.set(badiYear, result);
  return result;
}

/** Number of days in Ayyám-i-Há for a Bahá'í year (4 or 5). */
export function ayyamIHaLength(badiYear: number): number {
  return daysBetween(nawRuz(badiYear), nawRuz(badiYear + 1)) - 361;
}

/** Gregorian date (ISO) for a Badí‘ date. Month 0 = Ayyám-i-Há. */
export function badiToGregorian(year: number, month: number, day: number): string {
  const start = nawRuz(year);
  if (month === 0) return addDays(start, 18 * 19 + (day - 1));
  if (month === 19) return addDays(start, 18 * 19 + ayyamIHaLength(year) + (day - 1));
  return addDays(start, (month - 1) * 19 + (day - 1));
}

/** Badí‘ date for a Gregorian date (ISO), by daylight — sunset is not applied. */
export function gregorianToBadi(iso: string): BadiDate {
  const { year: gy } = parseIso(iso);
  // The Bahá'í year that began in this Gregorian year, or the previous one.
  let year = gy - BE_EPOCH_GREGORIAN_YEAR;
  if (iso < nawRuz(year)) year -= 1;
  const offset = daysBetween(nawRuz(year), iso);
  if (offset < 18 * 19) {
    return { year, month: Math.floor(offset / 19) + 1, day: (offset % 19) + 1 };
  }
  const ayyam = ayyamIHaLength(year);
  const afterMulk = offset - 18 * 19;
  if (afterMulk < ayyam) return { year, month: 0, day: afterMulk + 1 };
  return { year, month: 19, day: afterMulk - ayyam + 1 };
}

/** "8 ‘Aẓamat" — day then month, the conventional written form. */
export function formatBadiDate(d: BadiDate, withYear = false): string {
  const m = badiMonth(d.month);
  const base = d.month === 0 ? `${d.day} Ayyám-i-Há` : `${d.day} ${m.name}`;
  return withYear ? `${base} ${d.year}` : base;
}

/** Gregorian date (ISO) of the eighth new moon after Naw-Rúz — the Twin Birthdays anchor. */
export function twinBirthdaysAnchor(badiYear: number): string {
  const official = OFFICIAL_TWIN_BIRTHDAYS[badiYear];
  // The table records the Birth of the Báb, which is the day after the anchor.
  if (official) return addDays(official, -1);
  const { year, month, day } = parseIso(nawRuz(badiYear));
  const eighth = nthNewMoonAfter(gregorianToJD(year, month, day), 8);
  return badiDayOf(eighth);
}

export type BadiHolyDayKind = 'holy-day' | 'observance';

export interface BadiHolyDay {
  key: string;
  name: string;
  /** Gregorian date, ISO. */
  date: string;
  kind: BadiHolyDayKind;
  /** True for the nine Holy Days on which work is suspended. */
  workSuspended: boolean;
}

/** Holy Days at fixed Badí‘ dates: [key, name, month, day, workSuspended]. */
const FIXED_HOLY_DAYS: [string, string, number, number, boolean][] = [
  ['naw-ruz', 'Naw-Rúz', 1, 1, true],
  ['ridvan-1', 'First Day of Riḍván', 2, 13, true],
  ['ridvan-9', 'Ninth Day of Riḍván', 3, 2, true],
  ['ridvan-12', 'Twelfth Day of Riḍván', 3, 5, true],
  ['declaration-bab', 'Declaration of the Báb', 4, 8, true],
  ['ascension-bahaullah', 'Ascension of Bahá’u’lláh', 4, 13, true],
  ['martyrdom-bab', 'Martyrdom of the Báb', 6, 17, true],
  ['covenant', 'Day of the Covenant', 14, 4, false],
  ['ascension-abdul-baha', 'Ascension of ‘Abdu’l-Bahá', 14, 6, false],
];

/** The eleven Holy Days of a Bahá'í year, in date order. */
export function badiHolyDays(badiYear: number): BadiHolyDay[] {
  const days: BadiHolyDay[] = FIXED_HOLY_DAYS.map(([key, name, month, day, workSuspended]) => ({
    key,
    name,
    date: badiToGregorian(badiYear, month, day),
    kind: 'holy-day' as const,
    workSuspended,
  }));
  const anchor = twinBirthdaysAnchor(badiYear);
  days.push({
    key: 'birth-bab',
    name: 'Birth of the Báb',
    date: addDays(anchor, 1),
    kind: 'holy-day',
    workSuspended: true,
  });
  days.push({
    key: 'birth-bahaullah',
    name: 'Birth of Bahá’u’lláh',
    date: addDays(anchor, 2),
    kind: 'holy-day',
    workSuspended: true,
  });
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export interface BadiMonthStart {
  month: BadiMonth;
  /** Gregorian date, ISO, on which the month's first day falls. */
  date: string;
  badiYear: number;
}

/** The nineteen month beginnings of a Bahá'í year, plus Ayyám-i-Há. */
export function badiMonthStarts(badiYear: number): BadiMonthStart[] {
  const starts: BadiMonthStart[] = BADI_MONTHS.map((m) => ({
    month: m,
    date: badiToGregorian(badiYear, m.number, 1),
    badiYear,
  }));
  starts.push({ month: AYYAM_I_HA, date: badiToGregorian(badiYear, 0, 1), badiYear });
  return starts.sort((a, b) => a.date.localeCompare(b.date));
}

/** Inclusive Gregorian date range (ISO) of Ayyám-i-Há. */
export function ayyamIHaRange(badiYear: number): { start: string; end: string; length: number } {
  const length = ayyamIHaLength(badiYear);
  const start = badiToGregorian(badiYear, 0, 1);
  return { start, end: addDays(start, length - 1), length };
}

/** Inclusive Gregorian date range (ISO) of the Fast — the month of ‘Alá’. */
export function fastRange(badiYear: number): { start: string; end: string } {
  return { start: badiToGregorian(badiYear, 19, 1), end: addDays(nawRuz(badiYear + 1), -1) };
}
