/**
 * Regression tests for the calculated calendars.
 *
 * Run with:  npm test
 *
 * The expected values are taken from published sources, not from the code:
 *   - the published "Significant Bahá'í Dates" sheet for 183 B.E., for every
 *     Feast, Holy Day, Ayyám-i-Há and the Fast;
 *   - the published Naw-Rúz dates for 172–184 B.E.;
 *   - Meeus's worked examples and published equinox and lunation times;
 *   - Umm al-Qura for the Hijri month starts;
 *   - the Faith Communities Council of Victoria 2027 Multifaith Calendar, used
 *     here only as an independent published cross-check of the computed dates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  marchEquinox, tdToUt, jdToGregorian, moonPhase, newMoonAfter, fullMoonAfter,
  gregorianToJD, lunarLongitude, solarLongitude, isoDate, addDays,
} from '../src/lib/calendar/astronomy.ts';
import {
  nawRuz, badiMonthStarts, badiHolyDays, ayyamIHaRange, fastRange,
  gregorianToBadi, nawRuzConfidence, equinoxSunsetMarginMinutes,
} from '../src/lib/calendar/badi.ts';
import { westernEaster, orthodoxEaster } from '../src/lib/calendar/christian.ts';
import { roshHashanah, jewishHolyDays } from '../src/lib/calendar/hebrew.ts';
import { hijriMonthStart } from '../src/lib/calendar/islamic.ts';
import { hinduHolyDays, buddhistHolyDays, jainHolyDays } from '../src/lib/calendar/indic.ts';
import { generateBahaiFeast } from '../src/lib/calendar/bahai-generated.ts';
import { parseIcs } from '../src/lib/calendar/ics.ts';
import { applyOverrides, indexOverrides, needingVerification, overrideKey } from '../src/lib/calendar/overrides.ts';
import { generateAll } from '../src/lib/calendar/registry.ts';

const utDate = (jde) => isoDate(jdToGregorian(tdToUt(jde)));
const utTime = (jde) => {
  const jd = tdToUt(jde);
  const mins = Math.round((jd + 0.5 - Math.floor(jd + 0.5)) * 1440);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
test('astronomy: solar and lunar positions match Meeus worked examples', () => {
  // Meeus 25.b — apparent solar longitude, 1992 October 13.0 TD.
  assert.ok(Math.abs(solarLongitude(2448908.5) - 199.90598) < 0.005);
  // Meeus 47.a — apparent lunar longitude, 1992 April 12.0 TD.
  assert.ok(Math.abs(lunarLongitude(2448724.5) - 133.162655) < 0.02);
});

test('astronomy: March equinox matches published times to the minute', () => {
  const expected = {
    2025: ['2025-03-20', '09:01'], 2026: ['2026-03-20', '14:46'],
    2027: ['2027-03-20', '20:25'], 2028: ['2028-03-20', '02:17'],
  };
  for (const [year, [date, time]] of Object.entries(expected)) {
    const jde = marchEquinox(Number(year));
    assert.equal(utDate(jde), date, `equinox date ${year}`);
    const diff = Math.abs(
      Number(utTime(jde).split(':')[0]) * 60 + Number(utTime(jde).split(':')[1]) -
      (Number(time.split(':')[0]) * 60 + Number(time.split(':')[1])),
    );
    assert.ok(diff <= 1, `equinox time ${year}: got ${utTime(jde)}, expected ${time}`);
  }
});

test('astronomy: new and full moons match published times to the minute', () => {
  const newMoons = [['2026-01-18', '19:52'], ['2026-02-17', '12:01'], ['2026-03-19', '01:23'], ['2026-04-17', '11:52']];
  let jde = gregorianToJD(2026, 1, 1);
  for (const [date, time] of newMoons) {
    jde = newMoonAfter(jde + 0.75);
    assert.equal(utDate(jde), date);
    assert.equal(utTime(jde), time);
  }
  const fullMoons = [['2026-01-03', '10:03'], ['2026-02-01', '22:09'], ['2026-03-03', '11:38']];
  let f = gregorianToJD(2026, 1, 1);
  for (const [date, time] of fullMoons) {
    f = fullMoonAfter(f + 0.75);
    assert.equal(utDate(f), date);
    assert.equal(utTime(f), time);
  }
});

// ---------------------------------------------------------------------------
test('Badí‘: 183 B.E. Feast days match the published Significant Dates sheet', () => {
  const expected = [
    ['Bahá', '2026-03-21'], ['Jalál', '2026-04-09'], ['Jamál', '2026-04-28'],
    ['‘Aẓamat', '2026-05-17'], ['Núr', '2026-06-05'], ['Raḥmat', '2026-06-24'],
    ['Kalimát', '2026-07-13'], ['Kamál', '2026-08-01'], ['Asmá’', '2026-08-20'],
    ['‘Izzat', '2026-09-08'], ['Mashíyyat', '2026-09-27'], ['‘Ilm', '2026-10-16'],
    ['Qudrat', '2026-11-04'], ['Qawl', '2026-11-23'], ['Masá’il', '2026-12-12'],
    ['Sharaf', '2026-12-31'], ['Sulṭán', '2027-01-19'], ['Mulk', '2027-02-07'],
    ['‘Alá’', '2027-03-02'],
  ];
  const starts = new Map(badiMonthStarts(183).map((s) => [s.month.name, s.date]));
  for (const [name, date] of expected) assert.equal(starts.get(name), date, `1 ${name}`);
});

test('Badí‘: 183 B.E. Holy Days match the published Significant Dates sheet', () => {
  const expected = {
    'Naw-Rúz': ['2026-03-21', true],
    'First Day of Riḍván': ['2026-04-21', true],
    'Ninth Day of Riḍván': ['2026-04-29', true],
    'Twelfth Day of Riḍván': ['2026-05-02', true],
    'Declaration of the Báb': ['2026-05-24', true],
    'Ascension of Bahá’u’lláh': ['2026-05-29', true],
    'Martyrdom of the Báb': ['2026-07-10', true],
    'Birth of the Báb': ['2026-11-10', true],
    'Birth of Bahá’u’lláh': ['2026-11-11', true],
    'Day of the Covenant': ['2026-11-26', false],
    'Ascension of ‘Abdu’l-Bahá': ['2026-11-28', false],
  };
  const days = badiHolyDays(183);
  assert.equal(days.length, 11);
  for (const h of days) {
    const [date, work] = expected[h.name];
    assert.equal(h.date, date, h.name);
    assert.equal(h.workSuspended, work, `${h.name} work suspended`);
  }
});

test('Badí‘: 183 B.E. Ayyám-i-Há and the Fast match the published sheet', () => {
  assert.deepEqual(ayyamIHaRange(183), { start: '2027-02-26', end: '2027-03-01', length: 4 });
  assert.deepEqual(fastRange(183), { start: '2027-03-02', end: '2027-03-20' });
});

test('Badí‘: Naw-Rúz matches the published dates for 172–184 B.E.', () => {
  const published = {
    172: '2015-03-21', 173: '2016-03-20', 174: '2017-03-20', 175: '2018-03-21',
    176: '2019-03-21', 177: '2020-03-20', 178: '2021-03-20', 179: '2022-03-21',
    180: '2023-03-21', 181: '2024-03-20', 182: '2025-03-20', 183: '2026-03-21',
    184: '2027-03-21',
  };
  for (const [year, date] of Object.entries(published)) {
    assert.equal(nawRuz(Number(year)), date, `Naw-Rúz ${year} B.E.`);
  }
});

/*
 * An archived spreadsheet in the publisher's files ("Badi Gregorian calendar
 * lookup.csv", used to typeset an earlier print calendar) looked like an ideal
 * day-by-day fixture, but it is corrupt: it runs 20, 21, 22 Mulk and then jumps
 * to 25 Mulk across 26 February – 1 March 2023, where Ayyám-i-Há belongs. A
 * Bahá'í month is always exactly nineteen days, so those rows are impossible —
 * a fill series dragged past the end of the month. The error propagates an
 * off-by-one through the surrounding weeks, so the file is not used here.
 * The invariants below are what that fixture was meant to protect.
 */
test('Badí‘: calendar structure holds across thirty years', () => {
  for (let year = 172; year <= 202; year += 1) {
    const starts = badiMonthStarts(year);
    assert.equal(starts.length, 20, `${year}: 19 months plus Ayyám-i-Há`);

    // Naw-Rúz always lands on 19–22 March.
    const nr = nawRuz(year);
    assert.match(nr, /-03-(19|20|21|22)$/, `${year}: Naw-Rúz ${nr}`);

    // Ayyám-i-Há is four or five days, and the year is 365 or 366.
    const ayyam = ayyamIHaRange(year);
    assert.ok(ayyam.length === 4 || ayyam.length === 5, `${year}: Ayyám-i-Há ${ayyam.length} days`);
    const yearLength = Math.round(
      (Date.parse(nawRuz(year + 1)) - Date.parse(nr)) / 86400000,
    );
    assert.ok(yearLength === 365 || yearLength === 366, `${year}: ${yearLength} days`);

    // Every numbered month is exactly nineteen days — the invariant the
    // archived spreadsheet violated.
    for (const s of starts) {
      if (s.month.number === 0) continue;
      const next = s.month.number === 19 ? nawRuz(year + 1) : null;
      const expectedEnd = next ?? starts.find((o) => o.month.number === s.month.number + 1)?.date;
      if (!expectedEnd) continue;
      const span = Math.round((Date.parse(expectedEnd) - Date.parse(s.date)) / 86400000);
      // Mulk is followed by Ayyám-i-Há, so its gap to ‘Alá’ is 19 + Ayyám-i-Há.
      const allowed = s.month.number === 18 ? 19 + ayyam.length : 19;
      assert.equal(span, allowed, `${year}: ${s.month.name} spans ${span} days`);
    }

    // Round-trip every day of the year through both conversions.
    let day = nr;
    const end = nawRuz(year + 1);
    while (day < end) {
      const badi = gregorianToBadi(day);
      assert.equal(badi.year, year, `${day} should be in ${year} B.E.`);
      assert.ok(badi.day >= 1 && badi.day <= 19, `${day}: day ${badi.day} out of range`);
      day = addDays(day, 1);
    }
  }
});

test('Badí‘: 183 B.E. is flagged as needing an official date', () => {
  // The equinox falls within seconds of Tehran sunset in this year, so the
  // computation cannot be trusted and the published table must supply it.
  assert.ok(Math.abs(equinoxSunsetMarginMinutes(183)) < 5);
  assert.equal(nawRuzConfidence(183), 'official');
  // A year with a comfortable margin needs no override.
  assert.ok(Math.abs(equinoxSunsetMarginMinutes(185)) > 60);
  assert.equal(nawRuzConfidence(185), 'computed');
});

test('Badí‘: the Feast may be moved to any day of its month', () => {
  const normal = generateBahaiFeast('2026-11-01', '2026-11-30');
  assert.equal(normal.find((o) => o.name.includes('Qudrat')).date, '2026-11-04');
  const moved = generateBahaiFeast('2026-11-01', '2026-11-30', { '183-13': 5 });
  const feast = moved.find((o) => o.name.includes('Qudrat'));
  assert.equal(feast.date, '2026-11-08');
  assert.match(feast.note, /moved from the first day/);
});

// ---------------------------------------------------------------------------
test('Christian: Easter matches published dates, Western and Orthodox', () => {
  const western = { 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2030: '2030-04-21' };
  for (const [y, d] of Object.entries(western)) assert.equal(westernEaster(Number(y)), d, `Western ${y}`);
  const orthodox = { 2024: '2024-05-05', 2025: '2025-04-20', 2026: '2026-04-12', 2027: '2027-05-02' };
  for (const [y, d] of Object.entries(orthodox)) assert.equal(orthodoxEaster(Number(y)), d, `Orthodox ${y}`);
});

test('Judaism: Rosh Hashanah and the festivals match published dates', () => {
  const expected = { 5785: '2024-10-03', 5786: '2025-09-23', 5787: '2026-09-12', 5788: '2027-10-02' };
  for (const [y, d] of Object.entries(expected)) assert.equal(roshHashanah(Number(y)), d, `${y}`);
  const days = jewishHolyDays(5787);
  const find = (n) => days.find((o) => o.name.startsWith(n)).date;
  assert.equal(find('Yom Kippur'), '2026-09-21');
  assert.equal(find('Purim'), '2027-03-23');
  assert.equal(find('Pesach'), '2027-04-22');
  // Every Jewish festival begins at sunset the evening before.
  assert.ok(days.every((o) => o.startsPreviousEvening));
});

test('Islam: Hijri month starts match Umm al-Qura', () => {
  assert.equal(hijriMonthStart(1447, 1), '2025-06-26');
  assert.equal(hijriMonthStart(1448, 1), '2026-06-16');
  assert.equal(hijriMonthStart(1449, 1), '2027-06-05');
  assert.equal(hijriMonthStart(1447, 9), '2026-02-18'); // 1 Ramadan
  assert.equal(hijriMonthStart(1447, 10), '2026-03-20'); // Eid al-Fitr
});

test('Lunisolar festivals match the FCCV multifaith calendar and published dates', () => {
  const h2027 = Object.fromEntries(hinduHolyDays(2027).map((o) => [o.name, o.date]));
  assert.equal(h2027.MahaShivaratri, '2027-03-06'); // FCCV: Saturday 6 March
  assert.equal(h2027.Holi, '2027-03-22');
  assert.equal(h2027['Rama Navami'], '2027-04-15');
  assert.equal(h2027.Diwali, '2027-10-29');

  const h2026 = Object.fromEntries(hinduHolyDays(2026).map((o) => [o.name, o.date]));
  assert.equal(h2026.Diwali, '2026-11-08');
  assert.equal(h2026['Ganesh Chaturthi'], '2026-09-14');

  const b2027 = Object.fromEntries(buddhistHolyDays(2027).map((o) => [o.name, o.date]));
  assert.equal(b2027['Magha Puja Day'], '2027-02-21'); // FCCV: Sunday 21 February
  assert.equal(b2027['Losar / Tibetan New Year'], '2027-02-07'); // FCCV: Sunday 7 February
  assert.equal(b2027['Lunar New Year'], '2027-02-06'); // FCCV: Saturday 6 February
  assert.equal(b2027['Mahayana New Year'], '2027-01-22'); // FCCV: Friday 22 January
  assert.equal(Object.fromEntries(buddhistHolyDays(2026).map((o) => [o.name, o.date]))['Vesak (Buddha Day)'], '2026-05-01');

  // Mahavira Nirvana is observed on Diwali and must not drift from it.
  const jain = Object.fromEntries(jainHolyDays(2026).map((o) => [o.name, o.date]));
  assert.equal(jain['Mahavira Nirvana (Diwali)'], h2026.Diwali);
});

test('every lunisolar occurrence is honestly flagged as approximate', () => {
  for (const o of [...hinduHolyDays(2027), ...buddhistHolyDays(2027)]) {
    assert.equal(o.confidence, 'approximate', o.name);
  }
});

// ---------------------------------------------------------------------------
test('iCalendar: parses all-day, timed and recurring events', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:a', 'SUMMARY:All day booking', 'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261112',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:b', 'SUMMARY:Devotional', 'LOCATION:Bahá\\, í Centre',
    'DTSTART:20261105T090000Z', 'DTEND:20261105T103000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:c', 'SUMMARY:Weekly study', 'DTSTART:20261102T110000Z',
    'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3',
    'EXDATE:20261109T110000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const events = parseIcs(ics, '2026-11-01', '2026-11-30', 10);

  const allDay = events.find((e) => e.summary === 'All day booking');
  assert.equal(allDay.date, '2026-11-10');
  // An all-day DTEND is exclusive in iCalendar and must become inclusive.
  assert.equal(allDay.endDate, '2026-11-11');
  assert.ok(allDay.allDay);

  const timed = events.find((e) => e.summary === 'Devotional');
  // 09:00 UTC is 19:00 in Brisbane.
  assert.equal(timed.date, '2026-11-05');
  assert.equal(timed.startTime, '19:00');
  assert.equal(timed.location, 'Bahá, í Centre');

  const weekly = events.filter((e) => e.summary === 'Weekly study');
  assert.deepEqual(weekly.map((e) => e.date), ['2026-11-02', '2026-11-16']); // 9 Nov excluded
});


// ---------------------------------------------------------------------------
test('verified dates: an announcement overrides the calculation', () => {
  const computed = generateAll('2027-02-01', '2027-03-31');
  const ramadan = computed.find((o) => o.calendarId === 'islam' && o.key.startsWith('ramadan'));
  assert.ok(ramadan, 'Ramadan should be generated');
  assert.equal(ramadan.confidence, 'approximate');
  assert.equal(overrideKey(ramadan), 'islam:ramadan-1448');

  // A local authority announces the crescent was sighted a day later.
  const table = indexOverrides([
    {
      key: 'islam:ramadan-1448',
      date: '2027-02-08',
      endDate: '2027-03-09',
      source: 'Local moon sighting announcement',
      recordedOn: '2027-02-07',
    },
  ]);
  const applied = applyOverrides(computed, table);
  const fixed = applied.find((o) => overrideKey(o) === 'islam:ramadan-1448');
  assert.equal(fixed.date, '2027-02-08');
  assert.equal(fixed.endDate, '2027-03-09');
  assert.equal(fixed.confidence, 'verified');
  assert.match(fixed.note, /Local moon sighting announcement/);

  // The list stays sorted after a date moves.
  const dates = applied.map((o) => o.date);
  assert.deepEqual(dates, [...dates].sort());
});

test('verified dates: confirming without a date keeps the date and clears the flag', () => {
  const computed = generateAll('2027-10-01', '2027-11-30');
  const diwali = computed.find((o) => o.calendarId === 'hinduism' && o.key.startsWith('diwali'));
  assert.equal(diwali.confidence, 'approximate');

  const applied = applyOverrides(
    computed,
    indexOverrides([{ key: overrideKey(diwali), source: 'Confirmed with the local community' }]),
  );
  const confirmed = applied.find((o) => overrideKey(o) === overrideKey(diwali));
  assert.equal(confirmed.date, diwali.date, 'date must not move');
  assert.equal(confirmed.confidence, 'verified');
  assert.match(confirmed.note, /Confirmed with the local community/);
});

test('verified dates: exact calendars are never listed as needing confirmation', () => {
  const pending = needingVerification(generateAll('2027-01-01', '2027-12-31'));
  const calendars = new Set(pending.map((o) => o.calendarId));
  for (const exact of ['bahai-months', 'bahai-holy-days', 'christian', 'orthodox', 'judaism']) {
    assert.ok(!calendars.has(exact), `${exact} should not need confirmation`);
  }
  assert.ok(calendars.has('islam'), 'Islamic dates should be offered for confirmation');
});

test('verified dates: an empty table changes nothing', () => {
  const computed = generateAll('2027-01-01', '2027-06-30');
  assert.deepEqual(applyOverrides(computed, {}), computed);
});

test('verified dates: linked observances move together', () => {
  const computed = generateAll('2026-10-01', '2026-11-30');
  const diwali = computed.find((o) => overrideKey(o) === 'hinduism:diwali-2026');
  const nirvana = computed.find((o) => overrideKey(o) === 'jainism:mahavira-nirvana-2026');
  assert.equal(nirvana.date, diwali.date, 'they coincide before any override');

  // Correcting Diwali by a day must carry Mahavira Nirvana with it.
  const applied = applyOverrides(
    computed,
    indexOverrides([{ key: 'hinduism:diwali-2026', date: '2026-11-09', source: 'Local community' }]),
  );
  const movedDiwali = applied.find((o) => overrideKey(o) === 'hinduism:diwali-2026');
  const movedNirvana = applied.find((o) => overrideKey(o) === 'jainism:mahavira-nirvana-2026');
  assert.equal(movedDiwali.date, '2026-11-09');
  assert.equal(movedNirvana.date, '2026-11-09', 'Mahavira Nirvana must follow Diwali');
  assert.equal(movedNirvana.confidence, 'verified');
  assert.match(movedNirvana.note, /Moved with Diwali/);
});

test('verified dates: an offset link keeps its offset', () => {
  const computed = generateAll('2027-03-01', '2027-04-30');
  const holi = computed.find((o) => overrideKey(o) === 'hinduism:holi-2027');
  const hola = computed.find((o) => overrideKey(o) === 'sikhism:hola-mohalla-2027');
  assert.equal(hola.date, addDays(holi.date, 1), 'Hola Mohalla is the day after Holi');

  const applied = applyOverrides(
    computed,
    indexOverrides([{ key: 'hinduism:holi-2027', date: '2027-03-23', source: 'Announced locally' }]),
  );
  assert.equal(applied.find((o) => overrideKey(o) === 'sikhism:hola-mohalla-2027').date, '2027-03-24');
});

test('iCalendar: resolves TZID against the feed’s own VTIMEZONE', () => {
  // Sydney observes daylight saving; Brisbane does not. An event at 7pm Sydney
  // is 6pm Brisbane in January and 7pm Brisbane in July. Ignoring TZID, as an
  // earlier version did, silently reports both as 7pm.
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:AUS Eastern Standard Time',
    'BEGIN:STANDARD',
    'DTSTART:16010101T030000', 'TZOFFSETFROM:+1100', 'TZOFFSETTO:+1000',
    'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=4',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:16010101T020000', 'TZOFFSETFROM:+1000', 'TZOFFSETTO:+1100',
    'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=10',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:summer', 'SUMMARY:Summer meeting',
    'DTSTART;TZID=AUS Eastern Standard Time:20270115T190000',
    'DTEND;TZID=AUS Eastern Standard Time:20270115T203000',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:winter', 'SUMMARY:Winter meeting',
    'DTSTART;TZID=AUS Eastern Standard Time:20270715T190000',
    'DTEND;TZID=AUS Eastern Standard Time:20270715T203000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const events = parseIcs(ics, '2027-01-01', '2027-12-31', 10);
  const summer = events.find((e) => e.uid.startsWith('summer'));
  const winter = events.find((e) => e.uid.startsWith('winter'));

  assert.equal(summer.date, '2027-01-15');
  assert.equal(summer.startTime, '18:00', 'Sydney daylight time is an hour ahead of Brisbane');
  assert.equal(summer.endTime, '19:30');
  assert.equal(winter.date, '2027-07-15');
  assert.equal(winter.startTime, '19:00', 'outside daylight saving the two agree');
});

test('iCalendar: an Outlook feed in Brisbane time is left alone', () => {
  // The real shape Outlook publishes for a Queensland mailbox: a TZID whose
  // standard and daylight offsets are identical, so nothing should move.
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:E. Australia Standard Time',
    'BEGIN:STANDARD',
    'DTSTART:16010101T000000', 'TZOFFSETFROM:+1000', 'TZOFFSETTO:+1000',
    'END:STANDARD',
    'BEGIN:DAYLIGHT',
    'DTSTART:16010101T000000', 'TZOFFSETFROM:+1000', 'TZOFFSETTO:+1000',
    'END:DAYLIGHT',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:t1', 'SUMMARY:TEST 01',
    'DTSTART;TZID=E. Australia Standard Time:20260908T000000',
    'DTEND;TZID=E. Australia Standard Time:20260908T003000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const [event] = parseIcs(ics, '2026-09-01', '2026-09-30', 10);
  assert.equal(event.date, '2026-09-08');
  assert.equal(event.startTime, '00:00');
  assert.equal(event.endTime, '00:30');
});
