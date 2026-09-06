/**
 * Officially published Badí‘ dates, which override the computed values.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Naw-Rúz is the Bahá'í day in which the March equinox falls at Tehran, and the
 * Bahá'í day turns at sunset. In most years the equinox misses sunset by many
 * hours and the computation is unambiguous. But in 183 B.E. (2026) the equinox
 * falls within SIXTEEN SECONDS of Tehran sunset — far inside the uncertainty of
 * any sunset model, since atmospheric refraction alone varies by more than that
 * and Tehran sits 1200 m above sea level. Computed naively, 183 B.E. comes out a
 * day early, which would shift every Feast and Holy Day in the year.
 *
 * The Universal House of Justice has published the determinations in advance
 * (172–221 B.E.). Those published dates are authoritative; this table is where
 * they go, and they win over the computation.
 *
 * TO EXTEND: add a row per year from the official table, or from the annual
 * "Significant Bahá'í Dates" sheet issued for each Bahá'í year — either is an
 * authoritative source and should be preferred over the computation whenever
 * one is to hand. Any year absent from this table still works
 * — it is computed — but `nawRuzConfidence()` will report it as 'computed', and
 * as 'marginal' if the equinox lands near Tehran sunset and therefore needs an
 * official date before it can be trusted.
 */

/** Naw-Rúz, as officially published: Bahá'í year -> Gregorian ISO date. */
export const OFFICIAL_NAW_RUZ: Record<number, string> = {
  // From the published "Significant Bahá'í Dates" sheet for 181 B.E.
  181: '2024-03-20',
  // From the published "Significant Bahá'í Dates" sheet for 182 B.E.
  182: '2025-03-20',
  // From the published "Significant Bahá'í Dates" sheet for 183 B.E.
  // (1 Bahá = 21 March 2026). This is the marginal year: computed naively it
  // comes out 20 March, which would shift every Feast and Holy Day in the year.
  183: '2026-03-21',
  // Implied by the 183 B.E. sheet, which ends the Fast on 20 March 2027,
  // and independently computed with a 5.6-hour margin.
  184: '2027-03-21',
};

/**
 * Twin Holy Birthdays, as officially published: Bahá'í year -> Gregorian ISO
 * date of the FIRST of the two (Birth of the Báb). The Birth of Bahá'u'lláh is
 * always the following day.
 */
export const OFFICIAL_TWIN_BIRTHDAYS: Record<number, string> = {
  // From the published "Significant Bahá'í Dates" sheet for 183 B.E.
  // (Birth of the Báb 10 November 2026, Birth of Bahá'u'lláh 11 November 2026).
  183: '2026-11-10',
};
