/**
 * Astronomical core for the calculated religious calendars.
 *
 * Algorithms from Jean Meeus, "Astronomical Algorithms" (2nd ed.):
 *   ch.7  Julian Day            ch.25 Solar coordinates
 *   ch.27 Equinoxes/solstices   ch.47 Moon position
 *   ch.49 Phases of the Moon
 *
 * Everything here is pure arithmetic — no ephemeris files, no network, and it
 * runs unchanged in a Cloudflare Worker. Angles are degrees, times are Julian
 * Ephemeris Day (TD) unless a function says otherwise.
 */

const RAD = Math.PI / 180;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

/** Normalise an angle to [0, 360). */
export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Julian Day
// ---------------------------------------------------------------------------

/** Julian Day for a Gregorian calendar date (fractional day allowed). */
export function gregorianToJD(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5
  );
}

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** Gregorian calendar date for a Julian Day (fraction discarded to the civil day). */
export function jdToGregorian(jd: number): CivilDate {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e) + f;
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { year, month, day: Math.floor(day) };
}

/** ISO "YYYY-MM-DD" for a civil date. */
export function isoDate({ year, month, day }: CivilDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ISO "YYYY-MM-DD" for a Julian Day, at the given UTC-offset in hours. */
export function jdToIso(jd: number, utcOffsetHours = 0): string {
  return isoDate(jdToGregorian(jd + utcOffsetHours / 24));
}

/** Parse "YYYY-MM-DD" into a civil date. */
export function parseIso(iso: string): CivilDate {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

/** Add whole days to an ISO date, staying in civil-date space (no timezone). */
export function addDays(iso: string, days: number): string {
  const { year, month, day } = parseIso(iso);
  return jdToIso(gregorianToJD(year, month, day) + days + 0.5);
}

/** Whole days between two ISO dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const p = parseIso(a);
  const q = parseIso(b);
  return Math.round(gregorianToJD(q.year, q.month, q.day) - gregorianToJD(p.year, p.month, p.day));
}

/** Day of week for an ISO date: 0 = Sunday. */
export function weekday(iso: string): number {
  const { year, month, day } = parseIso(iso);
  return (Math.floor(gregorianToJD(year, month, day) + 1.5) % 7 + 7) % 7;
}

// ---------------------------------------------------------------------------
// ΔT — difference between Terrestrial Dynamical Time and Universal Time
// ---------------------------------------------------------------------------

/**
 * ΔT in seconds (Espenak & Meeus polynomial expressions, NASA five-millennium
 * canon). Only the 1986→ branches matter for this application; ~70s today, so
 * it shifts an event by under a minute — but that is enough to move a Naw-Rúz
 * determination across the Tehran sunset boundary in a marginal year.
 */
export function deltaT(year: number): number {
  if (year >= 2005 && year < 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  if (year >= 1986 && year < 2005) {
    const t = year - 2000;
    return (
      63.86 +
      0.3345 * t -
      0.060374 * t * t +
      0.0017275 * t ** 3 +
      0.000651814 * t ** 4 +
      0.00002373599 * t ** 5
    );
  }
  if (year >= 2050 && year < 2150) {
    return -20 + 32 * ((year - 1820) / 100) ** 2 - 0.5628 * (2150 - year);
  }
  const u = (year - 1820) / 100;
  return -20 + 32 * u * u;
}

/** Convert a Julian Ephemeris Day (TD) to a Julian Day in UT. */
export function tdToUt(jde: number): number {
  const { year } = jdToGregorian(jde);
  return jde - deltaT(year) / 86400;
}

// ---------------------------------------------------------------------------
// Sun — Meeus ch.25
// ---------------------------------------------------------------------------

/** Apparent geocentric longitude of the Sun, in degrees, for a JDE. */
export function solarLongitude(jde: number): number {
  const t = (jde - 2451545) / 36525;
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
  const m = 357.52911 + 35999.05029 * t - 0.0001537 * t * t;
  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * sin(m) +
    (0.019993 - 0.000101 * t) * sin(2 * m) +
    0.000289 * sin(3 * m);
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  return norm360(trueLong - 0.00569 - 0.00478 * sin(omega));
}

/**
 * Instant (JDE) at which the Sun reaches a given apparent longitude, searching
 * forward from `fromJde`. Newton iteration on the ~0.9856°/day mean motion.
 */
export function solarLongitudeCrossing(targetDeg: number, fromJde: number): number {
  let jde = fromJde;
  for (let i = 0; i < 40; i += 1) {
    let diff = norm360(targetDeg - solarLongitude(jde));
    if (diff > 180) diff -= 360;
    if (Math.abs(diff) < 1e-7) break;
    jde += diff / 0.9856473;
  }
  return jde;
}

/** Table 27.C — periodic corrections to the mean equinox/solstice. */
const EQUINOX_TERMS: [number, number, number][] = [
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186],
  [182, 27.85, 445267.112], [156, 73.14, 45036.886], [136, 171.52, 22518.443],
  [77, 222.54, 65928.934], [74, 296.72, 3034.906], [70, 243.58, 9037.513],
  [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
  [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417],
  [18, 155.12, 67555.328], [17, 288.79, 4562.452], [16, 198.04, 62894.029],
  [14, 199.76, 31436.921], [12, 95.39, 14577.848], [12, 287.11, 31931.756],
  [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074],
];

/**
 * March (vernal) equinox for a Gregorian year, as a JDE. Meeus ch.27 mean
 * expression plus the periodic terms; accurate to well under a minute, which is
 * far finer than any calendrical rule built on it needs.
 */
export function marchEquinox(year: number): number {
  const y = (year - 2000) / 1000;
  const jde0 =
    2451623.80984 + 365242.37404 * y + 0.05169 * y * y - 0.00411 * y ** 3 - 0.00057 * y ** 4;
  const t = (jde0 - 2451545) / 36525;
  const w = 35999.373 * t - 2.47;
  const dl = 1 + 0.0334 * cos(w) + 0.0007 * cos(2 * w);
  let s = 0;
  for (const [a, b, c] of EQUINOX_TERMS) s += a * cos(b + c * t);
  // Deliberately NOT refined against solarLongitude(): the ch.25 low-accuracy
  // solar formula carries ~0.01 deg of error, which is ~15 minutes of solar
  // motion, and refining against it makes this expression measurably worse.
  // As written this matches published equinox times to within a minute.
  return jde0 + (0.00001 * s) / dl;
}

// ---------------------------------------------------------------------------
// Moon phases — Meeus ch.49
// ---------------------------------------------------------------------------

const NEW_MOON_TERMS: [number, number, number, number, number, number][] = [
  // coefficient, E-power, M' mult, M mult, F mult, Omega mult
  [-0.4072, 0, 1, 0, 0, 0], [0.17241, 1, 0, 1, 0, 0], [0.01608, 0, 2, 0, 0, 0],
  [0.01039, 0, 0, 0, 2, 0], [0.00739, 1, 1, -1, 0, 0], [-0.00514, 1, 1, 1, 0, 0],
  [0.00208, 2, 0, 2, 0, 0], [-0.00111, 0, 1, 0, -2, 0], [-0.00057, 0, 1, 0, 2, 0],
  [0.00056, 1, 2, 1, 0, 0], [-0.00042, 0, 3, 0, 0, 0], [0.00042, 1, 0, 1, 2, 0],
  [0.00038, 1, 0, 1, -2, 0], [-0.00024, 1, 2, -1, 0, 0], [-0.00017, 0, 0, 0, 0, 1],
  [-0.00007, 0, 1, 2, 0, 0], [0.00004, 0, 2, 0, -2, 0], [0.00004, 0, 0, 3, 0, 0],
  [0.00003, 0, 1, 1, -2, 0], [0.00003, 0, 2, 0, 2, 0], [-0.00003, 0, 1, 1, 2, 0],
  [0.00003, 0, 1, -1, 2, 0], [-0.00002, 0, 1, -1, -2, 0], [-0.00002, 0, 3, 1, 0, 0],
  [0.00002, 0, 4, 0, 0, 0],
];

const FULL_MOON_TERMS: [number, number, number, number, number, number][] = [
  [-0.40614, 0, 1, 0, 0, 0], [0.17302, 1, 0, 1, 0, 0], [0.01614, 0, 2, 0, 0, 0],
  [0.01043, 0, 0, 0, 2, 0], [0.00734, 1, 1, -1, 0, 0], [-0.00515, 1, 1, 1, 0, 0],
  [0.00209, 2, 0, 2, 0, 0], [-0.00111, 0, 1, 0, -2, 0], [-0.00057, 0, 1, 0, 2, 0],
  [0.00056, 1, 2, 1, 0, 0], [-0.00042, 0, 3, 0, 0, 0], [0.00042, 1, 0, 1, 2, 0],
  [0.00038, 1, 0, 1, -2, 0], [-0.00024, 1, 2, -1, 0, 0], [-0.00017, 0, 0, 0, 0, 1],
  [-0.00007, 0, 1, 2, 0, 0], [0.00004, 0, 2, 0, -2, 0], [0.00004, 0, 0, 3, 0, 0],
  [0.00003, 0, 1, 1, -2, 0], [0.00003, 0, 2, 0, 2, 0], [-0.00003, 0, 1, 1, 2, 0],
  [0.00003, 0, 1, -1, 2, 0], [-0.00002, 0, 1, -1, -2, 0], [-0.00002, 0, 3, 1, 0, 0],
  [0.00002, 0, 4, 0, 0, 0],
];

const PLANETARY_ARGS: [number, number, number, number][] = [
  // amplitude, constant, k coefficient, T^2 coefficient
  [0.000325, 299.77, 0.107408, -0.009173], [0.000165, 251.88, 0.016321, 0],
  [0.000164, 251.83, 26.651886, 0], [0.000126, 349.42, 36.412478, 0],
  [0.00011, 84.66, 18.206239, 0], [0.000062, 141.74, 53.303771, 0],
  [0.00006, 207.14, 2.453732, 0], [0.000056, 154.84, 7.30686, 0],
  [0.000047, 34.52, 27.261239, 0], [0.000042, 207.19, 0.121824, 0],
  [0.00004, 291.34, 1.844379, 0], [0.000037, 161.72, 24.198154, 0],
  [0.000035, 239.56, 25.513099, 0], [0.000023, 331.55, 3.592518, 0],
];

/**
 * Instant (JDE) of the lunation `k` phases past the new moon of 2000 Jan 6.
 * Integer k = new moon; k + 0.5 = full moon.
 */
export function moonPhase(k: number): number {
  const t = k / 1236.85;
  let jde =
    2451550.09766 +
    29.530588861 * k +
    0.00015437 * t * t -
    0.00000015 * t ** 3 +
    0.00000000073 * t ** 4;

  const e = 1 - 0.002516 * t - 0.0000074 * t * t;
  const m = norm360(2.5534 + 29.1053567 * k - 0.0000014 * t * t - 0.00000011 * t ** 3);
  const mp = norm360(
    201.5643 + 385.81693528 * k + 0.0107582 * t * t + 0.00001238 * t ** 3 - 0.000000058 * t ** 4,
  );
  const f = norm360(
    160.7108 + 390.67050284 * k - 0.0016118 * t * t - 0.00000227 * t ** 3 + 0.000000011 * t ** 4,
  );
  const omega = norm360(124.7746 - 1.56375588 * k + 0.0020672 * t * t + 0.00000215 * t ** 3);

  const isFull = Math.abs(k - Math.floor(k) - 0.5) < 1e-9;
  for (const [coeff, ePow, mpMul, mMul, fMul, omMul] of isFull ? FULL_MOON_TERMS : NEW_MOON_TERMS) {
    jde += coeff * e ** ePow * sin(mpMul * mp + mMul * m + fMul * f + omMul * omega);
  }
  // NB: Meeus's extra correction W applies to the first and last quarters
  // only, never to new or full moons. Adding it to full moons offsets them by
  // about four minutes.
  for (const [amp, c0, ck, ct2] of PLANETARY_ARGS) {
    jde += amp * sin(c0 + ck * k + ct2 * t * t);
  }
  return jde;
}

/** Approximate lunation number for a Gregorian year and fraction of year. */
function approxK(year: number, yearFraction = 0): number {
  return (year + yearFraction - 2000) * 12.3685;
}

/** JDE of the first new moon at or after `fromJde`. */
export function newMoonAfter(fromJde: number): number {
  const { year } = jdToGregorian(fromJde);
  let k = Math.floor(approxK(year, 0)) - 2;
  // Walk forward one lunation at a time; the mean rate is close enough that
  // this never needs more than a handful of steps.
  for (let i = 0; i < 40; i += 1) {
    const jde = moonPhase(k);
    if (jde >= fromJde) return jde;
    k += 1;
  }
  return moonPhase(k);
}

/** JDE of the nth (1-based) new moon strictly after `fromJde`. */
export function nthNewMoonAfter(fromJde: number, n: number): number {
  let jde = fromJde;
  for (let i = 0; i < n; i += 1) jde = newMoonAfter(jde + 0.75);
  return jde;
}

/** JDE of the first full moon at or after `fromJde`. */
export function fullMoonAfter(fromJde: number): number {
  const { year } = jdToGregorian(fromJde);
  let k = Math.floor(approxK(year, 0)) - 2;
  for (let i = 0; i < 40; i += 1) {
    const jde = moonPhase(k + 0.5);
    if (jde >= fromJde) return jde;
    k += 1;
  }
  return moonPhase(k + 0.5);
}

// ---------------------------------------------------------------------------
// Moon longitude — truncated ELP-2000/82 (Meeus ch.47, table 47.A)
// ---------------------------------------------------------------------------

const MOON_LON_TERMS: [number, number, number, number, number][] = [
  // D, M, M', F, coefficient (in 1e-6 degrees)
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314],
  [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332],
  [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322],
  [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034],
  [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888], [2, 1, 0, 0, -6766],
  [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
  [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665],
  [0, 1, -2, 0, -2689], [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390],
  [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236], [0, 1, 2, 0, -2120],
  [0, 2, 0, 0, -2069], [2, -2, -1, 0, 2048], [2, 0, 1, -2, -1773],
  [2, 0, 0, 2, -1595], [4, -1, -1, 0, 1215], [0, 0, 2, 2, -1110],
  [3, 0, -1, 0, -892], [2, 1, 1, 0, -810], [4, -1, -2, 0, 759],
  [0, 2, -1, 0, -713], [2, 2, -1, 0, -700], [2, 1, -2, 0, 691],
  [2, -1, 0, -2, 596], [4, 0, 1, 0, 549], [0, 0, 4, 0, 537],
  [4, -1, 0, 0, 520], [1, 0, -2, 0, -487], [2, 1, 0, -2, -399],
  [0, 0, 2, -2, -381], [1, 1, 1, 0, 351], [3, 0, -2, 0, -340],
  [4, 0, -3, 0, 330], [2, -1, 2, 0, 327], [0, 2, 1, 0, -323],
  [1, 1, -1, 0, 299], [2, 0, 3, 0, 294],
];

/**
 * Apparent geocentric longitude of the Moon, in degrees, for a JDE.
 * Truncated to the 59 largest periodic terms — good to roughly an arcminute,
 * i.e. a couple of minutes of lunar motion. Ample for deciding which civil day
 * a tithi or a full moon falls on, though it is why the lunisolar festivals
 * carry an "approximate" confidence flag.
 */
export function lunarLongitude(jde: number): number {
  const t = (jde - 2451545) / 36525;
  const lp = norm360(
    218.3164477 + 481267.88123421 * t - 0.0015786 * t * t + (t ** 3) / 538841 - (t ** 4) / 65194000,
  );
  const d = norm360(
    297.8501921 + 445267.1114034 * t - 0.0018819 * t * t + (t ** 3) / 545868 - (t ** 4) / 113065000,
  );
  const m = norm360(357.5291092 + 35999.0502909 * t - 0.0001536 * t * t + (t ** 3) / 24490000);
  const mp = norm360(
    134.9633964 + 477198.8675055 * t + 0.0087414 * t * t + (t ** 3) / 69699 - (t ** 4) / 14712000,
  );
  const f = norm360(
    93.272095 + 483202.0175233 * t - 0.0036539 * t * t - (t ** 3) / 3526000 + (t ** 4) / 863310000,
  );
  const e = 1 - 0.002516 * t - 0.0000074 * t * t;

  let sum = 0;
  for (const [dm, mm, mpm, fm, coeff] of MOON_LON_TERMS) {
    // Terms in M are multiplied by E (or E²) to account for the slowly
    // decreasing eccentricity of the Earth's orbit.
    const ecc = Math.abs(mm) === 1 ? e : Math.abs(mm) === 2 ? e * e : 1;
    sum += coeff * ecc * sin(dm * d + mm * m + mpm * mp + fm * f);
  }
  // Additive terms from Venus, Jupiter and the flattening of the Earth.
  const a1 = norm360(119.75 + 131.849 * t);
  const a2 = norm360(53.09 + 479264.29 * t);
  sum += 3958 * sin(a1) + 1962 * sin(lp - f) + 318 * sin(a2);

  const omega = 125.04452 - 1934.136261 * t;
  const nutation = -0.00478 * sin(omega); // longitude nutation, approximated
  return norm360(lp + sum / 1000000 + nutation);
}

/**
 * Elongation of the Moon from the Sun, 0–360°. Tithi index is
 * `Math.floor(elongation / 12)`, giving 0–29.
 */
export function lunarElongation(jde: number): number {
  return norm360(lunarLongitude(jde) - solarLongitude(jde));
}

/** Tithi index (0–29) at a given instant. */
export function tithiAt(jde: number): number {
  return Math.floor(lunarElongation(jde) / 12);
}

/**
 * Instant (JDE) at which the lunar elongation next reaches `targetDeg`,
 * searching forward from `fromJde`. Elongation advances ~12.19°/day; a
 * bisection after the Newton step keeps it stable near the fast-moon extremes.
 */
export function elongationCrossing(targetDeg: number, fromJde: number): number {
  const diffAt = (jde: number) => {
    let d = norm360(lunarElongation(jde) - targetDeg);
    if (d > 180) d -= 360;
    return d;
  };
  // Step forward in half-days until the difference changes from negative to
  // positive, then bisect that bracket.
  let lo = fromJde;
  let loVal = diffAt(lo);
  for (let i = 0; i < 90; i += 1) {
    const hi = lo + 0.5;
    const hiVal = diffAt(hi);
    if (loVal < 0 && hiVal >= 0) {
      let a = lo;
      let b = hi;
      for (let j = 0; j < 40; j += 1) {
        const mid = (a + b) / 2;
        if (diffAt(mid) < 0) a = mid;
        else b = mid;
      }
      return (a + b) / 2;
    }
    lo = hi;
    loVal = hiVal;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Sunrise / sunset
// ---------------------------------------------------------------------------

/** Declination of the Sun, in degrees, for a JDE. */
function solarDeclination(jde: number): number {
  const t = (jde - 2451545) / 36525;
  const eps =
    23.439291 - 0.0130042 * t - 0.00000016 * t * t + 0.000000504 * t ** 3;
  return Math.asin(sin(eps) * sin(solarLongitude(jde))) / RAD;
}

/** Equation of time, in minutes, for a JDE. */
function equationOfTime(jde: number): number {
  const t = (jde - 2451545) / 36525;
  const l0 = norm360(280.46646 + 36000.76983 * t);
  const alpha = solarRightAscension(jde);
  let eot = l0 - 0.0057183 - alpha + 0.00478 * sin(125.04 - 1934.136 * t);
  eot = ((eot + 180) % 360 + 360) % 360 - 180;
  return eot * 4;
}

function solarRightAscension(jde: number): number {
  const t = (jde - 2451545) / 36525;
  const eps = 23.439291 - 0.0130042 * t;
  const lambda = solarLongitude(jde);
  return norm360(Math.atan2(cos(eps) * sin(lambda), cos(lambda)) / RAD);
}

export interface GeoLocation {
  /** Degrees north of the equator (negative = south). */
  latitude: number;
  /** Degrees east of Greenwich (negative = west). */
  longitude: number;
  /** Fixed offset from UTC, in hours. */
  utcOffsetHours: number;
}

export const TOWNSVILLE: GeoLocation = {
  latitude: -19.2589,
  longitude: 146.8169,
  utcOffsetHours: 10,
};

export const TEHRAN: GeoLocation = {
  latitude: 35.6892,
  longitude: 51.389,
  utcOffsetHours: 3.5,
};

/** Reference meridian for the Indian panchāṅga (Ujjain ≈ IST). */
export const UJJAIN: GeoLocation = {
  latitude: 23.1765,
  longitude: 75.7885,
  utcOffsetHours: 5.5,
};

/**
 * Local time of sunrise or sunset, as hours after local midnight, for a civil
 * date at a location. Returns null inside a polar day or night. Standard
 * −0.833° altitude (refraction plus the solar semi-diameter).
 */
function sunEvent(iso: string, loc: GeoLocation, rising: boolean): number | null {
  const { year, month, day } = parseIso(iso);
  const jdMidnightUt = gregorianToJD(year, month, day) - loc.utcOffsetHours / 24;
  const jdNoon = jdMidnightUt + 0.5;
  const decl = solarDeclination(jdNoon);
  const lat = loc.latitude;
  const h0 = -0.833;
  const cosH =
    (sin(h0) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl));
  if (cosH > 1 || cosH < -1) return null;
  const hourAngle = Math.acos(cosH) / RAD; // degrees
  const solarNoonLocal = 12 - loc.longitude / 15 - equationOfTime(jdNoon) / 60 + loc.utcOffsetHours;
  return solarNoonLocal + (rising ? -hourAngle : hourAngle) / 15;
}

/** Local clock time of sunrise, in hours after midnight. */
export function sunriseHours(iso: string, loc: GeoLocation): number | null {
  return sunEvent(iso, loc, true);
}

/** Local clock time of sunset, in hours after midnight. */
export function sunsetHours(iso: string, loc: GeoLocation): number | null {
  return sunEvent(iso, loc, false);
}

/** JDE of sunrise on a civil date at a location. */
export function sunriseJde(iso: string, loc: GeoLocation): number {
  const { year, month, day } = parseIso(iso);
  const h = sunriseHours(iso, loc) ?? 6;
  return gregorianToJD(year, month, day) + (h - loc.utcOffsetHours) / 24;
}

/** JDE of sunset on a civil date at a location. */
export function sunsetJde(iso: string, loc: GeoLocation): number {
  const { year, month, day } = parseIso(iso);
  const h = sunsetHours(iso, loc) ?? 18;
  return gregorianToJD(year, month, day) + (h - loc.utcOffsetHours) / 24;
}

/** Format an hours-after-midnight value as "6:24 pm". */
export function formatHours(h: number): string {
  const total = Math.round(h * 60);
  const hh24 = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const suffix = hh24 >= 12 ? 'pm' : 'am';
  const hh = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${hh}:${String(mm).padStart(2, '0')} ${suffix}`;
}
