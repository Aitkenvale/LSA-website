import test from 'node:test';
import assert from 'node:assert/strict';

import { parseIcs } from '../src/lib/calendar/ics.ts';

// ---- events that straddle the edge of the window ---------------------------

/*
 * Reported from the cycle view: a booking starting on the last day of cycle 18
 * and running three days did not appear in cycle 19 at all. The window was
 * filtered on the event's start, so anything already under way when the window
 * opened was dropped — which also lost a hire spanning the turn of a month
 * from the month it finished in.
 */
const spanning = (start, end) => [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:span-1', 'SUMMARY:Three day booking',
  `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`,
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

test('an event under way when the window opens is still returned', () => {
  // 18–20 September inclusive (DTEND is exclusive for an all-day event).
  const feed = spanning('20260918', '20260921');
  const found = parseIcs(feed, '2026-09-19', '2026-12-11');
  assert.equal(found.length, 1, 'the booking vanished from the window it runs into');
  assert.equal(found[0].date, '2026-09-18', 'it keeps its real start date');
  assert.equal(found[0].endDate, '2026-09-20');
});

test('an event finishing before the window is not returned', () => {
  const feed = spanning('20260918', '20260921');
  assert.deepEqual(parseIcs(feed, '2026-09-21', '2026-12-11'), []);
});

test('an event starting after the window is not returned', () => {
  const feed = spanning('20260918', '20260921');
  assert.deepEqual(parseIcs(feed, '2026-06-01', '2026-09-17'), []);
});

test('the day it ends and the day it starts are both inside', () => {
  const feed = spanning('20260918', '20260921');
  assert.equal(parseIcs(feed, '2026-09-20', '2026-09-20').length, 1, 'last day');
  assert.equal(parseIcs(feed, '2026-09-18', '2026-09-18').length, 1, 'first day');
});

/* A repeating booking that also spans days must reach back the same way. */
test('a recurring multi-day event is caught mid-run too', () => {
  const feed = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:span-2', 'SUMMARY:Weekly two-dayer',
    'DTSTART;VALUE=DATE:20260907', 'DTEND;VALUE=DATE:20260909',
    'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  // 14 September is a Monday; its second day is the 15th. A window opening on
  // the 15th must still see it.
  const found = parseIcs(feed, '2026-09-15', '2026-09-15');
  assert.equal(found.length, 1);
  assert.equal(found[0].date, '2026-09-14');
});
