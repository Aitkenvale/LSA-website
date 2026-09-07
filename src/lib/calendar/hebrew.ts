/**
 * The Hebrew calendar and the Jewish festivals.
 *
 * The Hebrew calendar has been a fixed arithmetic calendar since the fourth
 * century: the molad (mean lunar conjunction) is calculated, then four
 * postponement rules (the dehiyyot) fix Rosh Hashanah, and the year's length
 * follows. There is no observational element, so every date here is exact.
 *
 * Note that a Jewish day begins at sunset, so each festival below actually
 * begins on the evening before the Gregorian date given.
 */

import { addDays, isoDate, jdToGregorian } from './astronomy.ts';
import type { Occurrence } from './types.ts';
import { withinRange } from './types.ts';

/** Julian Day of 1 Tishri of Hebrew year 1. */
const HEBREW_EPOCH_JD = 347996.5;

export function isHebrewLeapYear(year: number): boolean {
  return ((7 * year + 1) % 19) < 7;
}

/** Days from the Hebrew epoch to 1 Tishri of `year`, after the dehiyyot. */
function elapsedDays(year: number): number {
  const monthsElapsed =
    235 * Math.floor((year - 1) / 19) +
    12 * ((year - 1) % 19) +
    Math.floor((7 * ((year - 1) % 19) + 1) / 19);
  const partsElapsed = 204 + 793 * (monthsElapsed % 1080);
  const hoursElapsed =
    5 + 12 * monthsElapsed + 793 * Math.floor(monthsElapsed / 1080) + Math.floor(partsElapsed / 1080);
  const conjunctionDay = 1 + 29 * monthsElapsed + Math.floor(hoursElapsed / 24);
  const conjunctionParts = 1080 * (hoursElapsed % 24) + (partsElapsed % 1080);

  let altDay = conjunctionDay;
  if (
    // Molad zaken: conjunction at or after noon postpones the new year.
    conjunctionParts >= 19440 ||
    // GaTaRaD: Tuesday conjunction late in the day, in a common year.
    (conjunctionDay % 7 === 2 && conjunctionParts >= 9924 && !isHebrewLeapYear(year)) ||
    // BeTUTaKPaT: Monday conjunction, in the year after a leap year.
    (conjunctionDay % 7 === 1 && conjunctionParts >= 16789 && isHebrewLeapYear(year - 1))
  ) {
    altDay = conjunctionDay + 1;
  }
  // Lo ADU Rosh: Rosh Hashanah never falls on Sunday, Wednesday or Friday.
  if (altDay % 7 === 0 || altDay % 7 === 3 || altDay % 7 === 5) altDay += 1;
  return altDay;
}

/** Length of a Hebrew year in days: 353–355, or 383–385 in a leap year. */
export function hebrewYearLength(year: number): number {
  return elapsedDays(year + 1) - elapsedDays(year);
}

/** Gregorian ISO date of 1 Tishri (Rosh Hashanah) of a Hebrew year. */
export function roshHashanah(year: number): string {
  return isoDate(jdToGregorian(HEBREW_EPOCH_JD + elapsedDays(year) + 0.5));
}

/** Hebrew month numbers, counting Tishri as 1 (the civil year order). */
const TISHRI = 1;
const CHESHVAN = 2;
const KISLEV = 3;
const TEVET = 4;
const SHEVAT = 5;
const ADAR_I = 6;
const ADAR = 7;
const NISAN = 8;
const IYAR = 9;
const SIVAN = 10;
const TAMMUZ = 11;
const AV = 12;
const ELUL = 13;

/** Days in a Hebrew month, given the year's length. */
function monthLength(year: number, month: number): number {
  const len = hebrewYearLength(year);
  const leap = isHebrewLeapYear(year);
  switch (month) {
    case TISHRI: return 30;
    case CHESHVAN: return len === 355 || len === 385 ? 30 : 29;
    case KISLEV: return len === 353 || len === 383 ? 29 : 30;
    case TEVET: return 29;
    case SHEVAT: return 30;
    case ADAR_I: return leap ? 30 : 0;
    case ADAR: return 29;
    case NISAN: return 30;
    case IYAR: return 29;
    case SIVAN: return 30;
    case TAMMUZ: return 29;
    case AV: return 30;
    case ELUL: return 29;
    default: return 0;
  }
}

/** Gregorian ISO date for a Hebrew year/month/day, months counted from Tishri. */
export function hebrewToGregorian(year: number, month: number, day: number): string {
  let offset = 0;
  for (let m = TISHRI; m < month; m += 1) offset += monthLength(year, m);
  return addDays(roshHashanah(year), offset + day - 1);
}

/** In a leap year Purim moves to Adar II, which is the month we call ADAR. */
function purimMonth(): number {
  return ADAR;
}

/** Jewish festivals for a Hebrew year, as Gregorian dates. */
export function jewishHolyDays(hebrewYear: number): Occurrence[] {
  const id = 'judaism';
  const g = (m: number, d: number) => hebrewToGregorian(hebrewYear, m, d);
  const make = (
    key: string,
    name: string,
    date: string,
    extra: Partial<Occurrence> = {},
  ): Occurrence => ({
    calendarId: id,
    key: `${key}-${hebrewYear}`,
    name,
    date,
    startsPreviousEvening: true,
    confidence: 'exact',
    ...extra,
  });

  return [
    make('rosh-hashanah', 'Rosh Hashanah', g(TISHRI, 1), {
      endDate: g(TISHRI, 2),
      note: 'The Jewish New Year, beginning ten days of repentance.',
    }),
    make('yom-kippur', 'Yom Kippur', g(TISHRI, 10), {
      note: 'The Day of Atonement — a day of fasting, prayer and repentance.',
    }),
    make('sukkot', 'Sukkot', g(TISHRI, 15), {
      endDate: g(TISHRI, 21),
      note: 'The Feast of Tabernacles, recalling the years of dwelling in booths in the wilderness.',
    }),
    make('shemini-atzeret', 'Shemini Atzeret', g(TISHRI, 22)),
    make('simchat-torah', 'Simchat Torah', g(TISHRI, 23), {
      note: 'Marks the completion of the annual cycle of Torah readings.',
    }),
    make('hanukkah', 'Hanukkah', g(KISLEV, 25), {
      endDate: addDays(g(KISLEV, 25), 7),
      note: 'The Festival of Lights, commemorating the rededication of the Temple.',
    }),
    make('tu-bishvat', 'Tu BiShvat', g(SHEVAT, 15), { note: 'The New Year of the Trees.' }),
    make('purim', 'Purim', g(purimMonth(), 14), {
      note: 'Commemorates the deliverance of the Jewish people as recounted in the Book of Esther.',
    }),
    make('pesach', 'Pesach (Passover)', g(NISAN, 15), {
      endDate: g(NISAN, 22),
      note: 'Commemorates the Exodus from slavery in Egypt.',
    }),
    make('yom-hashoah', 'Yom HaShoah', g(NISAN, 27), { note: 'Holocaust Remembrance Day.' }),
    make('lag-baomer', 'Lag BaOmer', g(IYAR, 18)),
    make('shavuot', 'Shavuot', g(SIVAN, 6), {
      endDate: g(SIVAN, 7),
      note: 'Celebrates the giving of the Torah at Mount Sinai.',
    }),
    make('tisha-bav', 'Tisha B’Av', g(AV, 9), {
      note: 'A fast day mourning the destruction of the First and Second Temples.',
    }),
  ];
}

/** Hebrew years that could contribute festivals to a Gregorian window. */
function hebrewYearsFor(fromIso: string, toIso: string): number[] {
  const first = Number(fromIso.slice(0, 4)) + 3760;
  const last = Number(toIso.slice(0, 4)) + 3762;
  const years: number[] = [];
  for (let y = first; y <= last; y += 1) years.push(y);
  return years;
}

export function generateJewish(fromIso: string, toIso: string): Occurrence[] {
  return withinRange(hebrewYearsFor(fromIso, toIso).flatMap(jewishHolyDays), fromIso, toIso);
}
