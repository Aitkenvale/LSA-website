/**
 * Hindu, Buddhist, Jain and Sikh observances.
 *
 * These are the hard ones, and the reason every occurrence below is marked
 * 'approximate'. The Indian lunisolar calendar is not arithmetic: a festival is
 * fixed by a tithi (a 12° step of the Moon's elongation from the Sun) within a
 * named lunar month, and the month is named for the sidereal zodiac sign the Sun
 * occupies at the month's new moon. Beyond the astronomy, observance genuinely
 * differs — amānta versus pūrṇimānta reckoning, regional panchāṅga traditions,
 * and Theravāda versus Mahāyāna versus Tibetan Buddhist practice — so a single
 * computed date can only ever be the most common answer, not the only one.
 *
 * We compute with Lahiri ayanāṁśa and take Ujjain (the traditional Indian prime
 * meridian, effectively IST) as the reference location, which is what pan-Indian
 * published calendars do. The prevailing convention is applied: a festival falls
 * on the civil day whose sunrise its tithi spans.
 */

import {
  addDays,
  elongationCrossing,
  gregorianToJD,
  isoDate,
  jdToGregorian,
  fullMoonAfter,
  marchEquinox,
  newMoonAfter,
  norm360,
  parseIso,
  solarLongitude,
  sunriseJde,
  sunsetJde,
  tithiAt,
  UJJAIN,
} from './astronomy.ts';
import type { Occurrence } from './types.ts';
import { withinRange, yearsSpanned } from './types.ts';

// ---------------------------------------------------------------------------
// Sidereal zodiac and lunar months
// ---------------------------------------------------------------------------

/** Lahiri (Chitrapaksha) ayanāṁśa in degrees — the official Indian value. */
function lahiriAyanamsa(jde: number): number {
  const t = (jde - 2451545) / 36525;
  return 23.85304 + 1.3968 * t + 0.000308 * t * t;
}

/** Sidereal longitude of the Sun, in degrees. */
export function siderealSolarLongitude(jde: number): number {
  return norm360(solarLongitude(jde) - lahiriAyanamsa(jde));
}

/** Sidereal zodiac sign (rāśi) of the Sun: 0 = Meṣa (Aries) … 11 = Mīna (Pisces). */
function rashiAt(jde: number): number {
  return Math.floor(siderealSolarLongitude(jde) / 30);
}

/** Amānta lunar months, in order. Index 0 = Chaitra. */
export const LUNAR_MONTHS = [
  'Chaitra', 'Vaisakha', 'Jyeshtha', 'Ashadha', 'Shravana', 'Bhadrapada',
  'Ashvina', 'Kartika', 'Margashirsha', 'Pausha', 'Magha', 'Phalguna',
];

/**
 * Which lunar month a lunation begins. A month is named for the sign the Sun
 * enters during it, so a new moon with the Sun in Mīna (11) begins Chaitra (0).
 */
function lunarMonthOf(newMoonJde: number): number {
  return (rashiAt(newMoonJde) + 1) % 12;
}

interface Lunation {
  jde: number;
  month: number;
}

/** Every lunation whose festivals could land in Gregorian year `gy`. */
function lunationsAround(gy: number): Lunation[] {
  const out: Lunation[] = [];
  let jde = gregorianToJD(gy - 1, 11, 1);
  const end = gregorianToJD(gy + 1, 2, 1);
  while (jde < end) {
    jde = newMoonAfter(jde + 0.75);
    out.push({ jde, month: lunarMonthOf(jde) });
  }
  return out;
}

/**
 * Time of day a festival's tithi is tested against. Most festivals take the
 * tithi prevailing at sunrise, but several long-standing exceptions use another
 * moment, and using sunrise for them puts the date a day out:
 *
 *   - MahaShivaratri is observed at niśīta kāla, around local midnight;
 *   - Ganesh Chaturthi at madhyāhna, the middle of the day;
 *   - Diwali (Lakṣmī Pūjā) at pradoṣa, just after sunset.
 */
export type TithiReference = 'sunrise' | 'midday' | 'sunset' | 'midnight';

/** The instant on a civil day at which a tithi is tested. */
function referenceInstant(iso: string, reference: TithiReference): number {
  const sunrise = sunriseJde(iso, UJJAIN);
  const sunset = sunsetJde(iso, UJJAIN);
  switch (reference) {
    case 'sunset': return sunset + 10 / 1440; // pradoṣa: shortly after sunset
    case 'midday': return (sunrise + sunset) / 2;
    case 'midnight': {
      // Niśīta kāla falls in the night *following* the civil day.
      const { year, month, day } = parseIso(iso);
      return gregorianToJD(year, month, day) + 1 - UJJAIN.utcOffsetHours / 24;
    }
    default: return sunrise;
  }
}

/**
 * Civil date (ISO, Ujjain reckoning) on which a tithi falls. Tithi index runs
 * 0–29 from the new moon: 0–14 are the waxing (śukla) tithis, 14 is Pūrṇimā,
 * 15–29 the waning (kṛṣṇa) tithis, and 29 is Amāvāsyā.
 */
function tithiCivilDate(
  lunationJde: number,
  tithiIndex: number,
  reference: TithiReference = 'sunrise',
): string {
  const start = elongationCrossing(tithiIndex * 12, lunationJde - 0.5);
  const first = addDays(isoDate(jdToGregorian(start + UJJAIN.utcOffsetHours / 24)), -1);
  for (let d = 0; d < 3; d += 1) {
    const candidate = addDays(first, d);
    if (tithiAt(referenceInstant(candidate, reference)) === tithiIndex) return candidate;
  }
  // A kṣaya tithi that never spans the reference moment: use the day it begins.
  return addDays(first, 1);
}

/**
 * Date of a festival defined as (lunar month, tithi) for a Gregorian year.
 * Where an adhika (intercalary) month duplicates a name, festivals are kept in
 * the second — the nija, or true, month.
 */
function lunarFestival(
  gy: number,
  month: number,
  tithi: number,
  reference: TithiReference = 'sunrise',
): string | null {
  const matches = lunationsAround(gy).filter((l) => l.month === month);
  if (!matches.length) return null;
  for (const l of matches.reverse()) {
    const date = tithiCivilDate(l.jde, tithi, reference);
    if (Number(date.slice(0, 4)) === gy) return date;
  }
  return null;
}

/**
 * Civil date (IST) containing a full moon instant. Buddhist uposatha festivals
 * are keyed to the full moon day itself rather than to a tithi at sunrise, and
 * this matches the published multifaith dates more closely.
 */
function fullMoonDay(gy: number, afterIso: string): string {
  const { year, month, day } = parseIso(afterIso);
  const jde = fullMoonAfter(gregorianToJD(year, month, day));
  return isoDate(jdToGregorian(jde + UJJAIN.utcOffsetHours / 24));
}

/** The full moon day of a named lunar month — the Buddhist reckoning. */
function fullMoonOfLunarMonth(gy: number, month: number): string | null {
  const matches = lunationsAround(gy).filter((l) => l.month === month);
  if (!matches.length) return null;
  for (const l of matches.reverse()) {
    const date = isoDate(jdToGregorian(fullMoonAfter(l.jde) + UJJAIN.utcOffsetHours / 24));
    if (Number(date.slice(0, 4)) === gy) return date;
  }
  return null;
}

/** Date on which the Sun enters a sidereal sign (saṅkrānti), for a Gregorian year. */
function sankranti(gy: number, rashi: number): string {
  // Search day by day; the Sun takes about a month per sign, so a coarse scan
  // followed by a day-level check is ample.
  let jde = gregorianToJD(gy, 1, 1);
  for (let i = 0; i < 400; i += 1) {
    const here = rashiAt(jde);
    const next = rashiAt(jde + 1);
    if (here !== rashi && next === rashi) {
      return isoDate(jdToGregorian(jde + 1 + UJJAIN.utcOffsetHours / 24));
    }
    jde += 1;
  }
  return isoDate({ year: gy, month: 1, day: 14 });
}

function make(
  calendarId: string,
  key: string,
  name: string,
  date: string | null,
  gy: number,
  extra: Partial<Occurrence> = {},
): Occurrence | null {
  if (!date) return null;
  return {
    calendarId,
    key: `${key}-${gy}`,
    name,
    date,
    confidence: 'approximate',
    ...extra,
  };
}

const notNull = (list: (Occurrence | null)[]): Occurrence[] => list.filter((o): o is Occurrence => o !== null);

// Tithi indices used below.
const SHUKLA = (n: number) => n - 1; // śukla pakṣa 1–15
const KRISHNA = (n: number) => 14 + n; // kṛṣṇa pakṣa 1–15
const PURNIMA = 14;
const AMAVASYA = 29;

// Lunar month indices.
const CHAITRA = 0, VAISAKHA = 1, ASHADHA = 3, SHRAVANA = 4;
const BHADRAPADA = 5, ASHVINA = 6, KARTIKA = 7, MAGHA = 10, PHALGUNA = 11;

// ---------------------------------------------------------------------------
// Hinduism
// ---------------------------------------------------------------------------

export function hinduHolyDays(gy: number): Occurrence[] {
  const id = 'hinduism';
  const f = (m: number, t: number) => lunarFestival(gy, m, t);
  const navaratriStart = f(ASHVINA, SHUKLA(1));
  return notNull([
    make(id, 'makar-sankranti', 'Makar Sankranti / Pongal', sankranti(gy, 9), gy, {
      note: 'Marks the Sun’s entry into Capricorn — a harvest festival, known as Pongal in the south.',
    }),
    make(id, 'maha-shivaratri', 'MahaShivaratri', lunarFestival(gy, MAGHA, KRISHNA(14), 'midnight'), gy, {
      note: 'The Great Night of Shiva, on which Shiva is said to perform the cosmic dance.',
    }),
    make(id, 'holi', 'Holi', f(PHALGUNA, PURNIMA), gy, {
      note: 'The festival of colours, celebrating the arrival of spring and the triumph of good.',
    }),
    make(id, 'rama-navami', 'Rama Navami', f(CHAITRA, SHUKLA(9)), gy, {
      note: 'Celebrates the birth of Lord Rama.',
    }),
    make(id, 'krishna-janmashtami', 'Krishna Janmashtami', f(SHRAVANA, KRISHNA(8)), gy, {
      note: 'Celebrates the birth of Lord Krishna.',
    }),
    make(id, 'raksha-bandhan', 'Raksha Bandhan', f(SHRAVANA, PURNIMA), gy),
    make(id, 'ganesh-chaturthi', 'Ganesh Chaturthi', lunarFestival(gy, BHADRAPADA, SHUKLA(4), 'midday'), gy, {
      note: 'Celebrates the birth of Ganesha, remover of obstacles.',
    }),
    make(id, 'navaratri', 'Navaratri', navaratriStart, gy, {
      endDate: navaratriStart ? addDays(navaratriStart, 8) : undefined,
      note: 'Nine nights honouring the Divine Mother in her many forms.',
    }),
    make(id, 'dussehra', 'Dussehra', f(ASHVINA, SHUKLA(10)), gy, {
      note: 'Celebrates the victory of Rama over Ravana — of good over evil.',
    }),
    make(id, 'diwali', 'Diwali', lunarFestival(gy, ASHVINA, AMAVASYA, 'sunset'), gy, {
      note: 'The festival of lights, celebrating the victory of light over darkness.',
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Buddhism
// ---------------------------------------------------------------------------

export function buddhistHolyDays(gy: number): Occurrence[] {
  const id = 'buddhism';
  // Tibetan New Year approximates to the new moon beginning the Tibetan first
  // month, which in most years is the second new moon after the winter solstice.
  const losar = (() => {
    const jde = newMoonAfter(gregorianToJD(gy, 1, 20));
    return isoDate(jdToGregorian(jde + 1 + UJJAIN.utcOffsetHours / 24));
  })();
  // Chinese New Year: the second new moon after the December solstice, taken on
  // the Beijing meridian.
  const lunarNewYear = (() => {
    const solstice = gregorianToJD(gy - 1, 12, 21);
    let jde = newMoonAfter(solstice);
    jde = newMoonAfter(jde + 0.75);
    return isoDate(jdToGregorian(jde + 8 / 24));
  })();
  const mahayanaNewYear = fullMoonDay(gy, isoDate({ year: gy, month: 1, day: 1 }));
  const fm = (m: number) => fullMoonOfLunarMonth(gy, m);
  return notNull([
    make(id, 'mahayana-new-year', 'Mahayana New Year', mahayanaNewYear, gy, {
      note: 'Observed on the first full moon day in January in Mahāyāna countries.',
    }),
    make(id, 'lunar-new-year', 'Lunar New Year', lunarNewYear, gy, {
      note: 'Also known as Chinese New Year or Spring Festival. The date differs by country.',
    }),
    make(id, 'magha-puja', 'Magha Puja Day', fm(MAGHA), gy, {
      note: 'Commemorates the Buddha’s teaching to a spontaneous gathering of 1,250 disciples.',
    }),
    make(id, 'nirvana-day', 'Nirvana Day', isoDate({ year: gy, month: 2, day: 15 }), gy, {
      note: 'Marks the Buddha’s attainment of final Nirvana. Also called Parinirvana Day.',
    }),
    make(id, 'losar', 'Losar / Tibetan New Year', losar, gy, {
      note: 'Tibetan New Year, celebrated over fifteen days and varying by region.',
    }),
    make(id, 'vesak', 'Vesak (Buddha Day)', fm(VAISAKHA), gy, {
      note: 'The most significant Buddhist festival — the Buddha’s birth, enlightenment and death.',
    }),
    make(id, 'asalha-puja', 'Asalha Puja', fm(ASHADHA), gy, {
      note: 'Commemorates the Buddha’s first sermon, and the beginning of the rains retreat.',
    }),
    make(id, 'ullambana', 'Ullambana', fm(SHRAVANA), gy, {
      note: 'A festival of offerings for the relief of ancestors, observed across Mahāyāna traditions.',
    }),
    make(id, 'bodhi-day', 'Bodhi Day', isoDate({ year: gy, month: 12, day: 8 }), gy, {
      note: 'Commemorates the Buddha’s enlightenment beneath the Bodhi tree.',
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Jainism
// ---------------------------------------------------------------------------

export function jainHolyDays(gy: number): Occurrence[] {
  const id = 'jainism';
  const f = (m: number, t: number) => lunarFestival(gy, m, t);
  const samvatsari = f(BHADRAPADA, SHUKLA(4));
  return notNull([
    make(id, 'mahavir-janma', 'Mahavir Janma Kalyanak', f(CHAITRA, SHUKLA(13)), gy, {
      note: 'Celebrates the birth of Mahavira, the twenty-fourth and last Tirthankara.',
    }),
    make(id, 'paryushana', 'Paryushana', samvatsari ? addDays(samvatsari, -7) : null, gy, {
      endDate: samvatsari ?? undefined,
      note: 'The most important Jain observance — eight days of fasting, reflection and forgiveness.',
    }),
    make(id, 'samvatsari', 'Samvatsari', samvatsari, gy, {
      note: 'The final day of Paryushana, on which forgiveness is asked of all beings.',
    }),
    // Observed on Diwali, so it must use the same pradoṣa reckoning — and must
    // follow Diwali if that date is ever corrected.
    make(id, 'mahavira-nirvana', 'Mahavira Nirvana (Diwali)', lunarFestival(gy, ASHVINA, AMAVASYA, 'sunset'), gy, {
      note: 'Marks the liberation of Mahavira, observed on the day of Diwali.',
      linkedTo: { key: `hinduism:diwali-${gy}` },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Sikhism
// ---------------------------------------------------------------------------

export function sikhHolyDays(gy: number): Occurrence[] {
  const id = 'sikhism';
  const fixed = (month: number, day: number) => isoDate({ year: gy, month, day });
  const holi = lunarFestival(gy, PHALGUNA, PURNIMA);
  return notNull([
    // The Nanakshahi calendar fixes most gurpurabs to Gregorian dates.
    make(id, 'guru-gobind-singh', 'Birthday of Guru Gobind Singh Ji', fixed(1, 5), gy, {
      note: 'The tenth and final Sikh Guru, who created the Khalsa.',
      confidence: 'exact',
    }),
    make(id, 'maghi', 'Maghi', fixed(1, 14), gy, {
      note: 'Commemorates the sacrifice of forty Sikhs at the Battle of Muktsar in 1705.',
      confidence: 'exact',
    }),
    make(id, 'hola-mohalla', 'Hola Mohalla', holi ? addDays(holi, 1) : null, gy, {
      linkedTo: { key: `hinduism:holi-${gy}`, offsetDays: 1 },
    }),
    make(id, 'vaisakhi', 'Vaisakhi', fixed(4, 14), gy, {
      note: 'Marks the founding of the Khalsa in 1699. Also a harvest festival.',
      confidence: 'exact',
    }),
    make(id, 'martyrdom-guru-arjan', 'Martyrdom of Guru Arjan Dev Ji', fixed(6, 16), gy, {
      confidence: 'exact',
    }),
    make(id, 'parkash-granth-sahib', 'First Parkash of Guru Granth Sahib', fixed(9, 1), gy, {
      confidence: 'exact',
    }),
    make(id, 'guru-nanak-gurpurab', 'Guru Nanak Gurpurab', lunarFestival(gy, KARTIKA, PURNIMA), gy, {
      note: 'Celebrates the birth of Guru Nanak, the founder of Sikhism.',
    }),
    make(id, 'martyrdom-tegh-bahadur', 'Martyrdom of Guru Tegh Bahadur Ji', fixed(11, 24), gy, {
      confidence: 'exact',
    }),
  ]);
}

export function generateHindu(from: string, to: string): Occurrence[] {
  return withinRange(yearsSpanned(from, to).flatMap(hinduHolyDays), from, to);
}
export function generateBuddhist(from: string, to: string): Occurrence[] {
  return withinRange(yearsSpanned(from, to).flatMap(buddhistHolyDays), from, to);
}
export function generateJain(from: string, to: string): Occurrence[] {
  return withinRange(yearsSpanned(from, to).flatMap(jainHolyDays), from, to);
}
export function generateSikh(from: string, to: string): Occurrence[] {
  return withinRange(yearsSpanned(from, to).flatMap(sikhHolyDays), from, to);
}
