import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs } from '../src/lib/calendar/ics.ts';

/*
 * The conversion the availability endpoint performs, kept in step with it by
 * hand. Verified against the Centre's real published feed before being fixed
 * here as a sample: two evening bookings, an overlap, an all-day pair, and a
 * weekly recurrence.
 */
const FEED = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Microsoft Corporation//Outlook//EN',
  'X-WR-CALNAME:Baha\'i Centre',
  'BEGIN:VTIMEZONE', 'TZID:E. Australia Standard Time',
  'BEGIN:STANDARD', 'DTSTART:16010101T000000', 'TZOFFSETFROM:+1000', 'TZOFFSETTO:+1000',
  'END:STANDARD', 'END:VTIMEZONE',
  // an ordinary evening booking
  'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Busy',
  'DTSTART;TZID=E. Australia Standard Time:20261102T180000',
  'DTEND;TZID=E. Australia Standard Time:20261102T200000', 'END:VEVENT',
  // two on one day, overlapping
  'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Busy',
  'DTSTART;TZID=E. Australia Standard Time:20261109T160000',
  'DTEND;TZID=E. Australia Standard Time:20261109T200000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c', 'SUMMARY:Busy',
  'DTSTART;TZID=E. Australia Standard Time:20261109T180000',
  'DTEND;TZID=E. Australia Standard Time:20261109T200000', 'END:VEVENT',
  // an all-day booking
  'BEGIN:VEVENT', 'UID:d', 'SUMMARY:Busy',
  'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261111', 'END:VEVENT',
  // one that runs past midnight
  'BEGIN:VEVENT', 'UID:e', 'SUMMARY:Busy',
  'DTSTART;TZID=E. Australia Standard Time:20261114T220000',
  'DTEND;TZID=E. Australia Standard Time:20261115T010000', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const dayAfter = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

function busyFromIcs(text, month, monthEnd) {
  return parseIcs(text, `${month}-01`, monthEnd, 10).map((event) => {
    if (event.allDay) {
      const last = event.endDate ?? event.date;
      return { start: `${event.date}T00:00:00+10:00`, end: `${dayAfter(last)}T00:00:00+10:00` };
    }
    const start = `${event.date}T${event.startTime ?? '00:00'}:00+10:00`;
    let endDay = event.endDate ?? event.date;
    if (endDay === event.date && event.endTime && event.startTime && event.endTime <= event.startTime) {
      endDay = dayAfter(event.date);
    }
    return { start, end: `${endDay}T${event.endTime ?? '23:59'}:00+10:00` };
  });
}

const NOV = () => busyFromIcs(FEED, '2026-11', '2026-11-30');

test('an evening booking becomes the hours it occupies', () => {
  const block = NOV().find((b) => b.start.startsWith('2026-11-02'));
  assert.equal(block.start, '2026-11-02T18:00:00+10:00');
  assert.equal(block.end, '2026-11-02T20:00:00+10:00');
});

test('two bookings on one day stay two blocks', () => {
  // Google merged these into one; the page shades the day either way, but
  // losing one here would lose it everywhere downstream.
  const sameDay = NOV().filter((b) => b.start.startsWith('2026-11-09'));
  assert.equal(sameDay.length, 2);
});

test('an all-day booking runs to the start of the next day, not to 23:59', () => {
  const block = NOV().find((b) => b.start === '2026-11-10T00:00:00+10:00');
  assert.equal(block.end, '2026-11-11T00:00:00+10:00', 'must not leave the last minute bookable');
});

/*
 * A booking finishing at 01:00 having started at 22:00 is three hours long,
 * not minus twenty-one. Treating the clock as the whole story would make the
 * block end before it began and the day read as free.
 */
test('a booking past midnight ends the following day', () => {
  const block = NOV().find((b) => b.start.startsWith('2026-11-14'));
  assert.equal(block.end, '2026-11-15T01:00:00+10:00');
});

test('no block ever ends before it starts', () => {
  for (const b of NOV()) {
    assert.ok(new Date(b.end) > new Date(b.start), `${b.start} → ${b.end}`);
  }
});

test('a month with no bookings yields nothing, rather than failing', () => {
  assert.deepEqual(busyFromIcs(FEED, '2026-05', '2026-05-31'), []);
});
