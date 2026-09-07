import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHireIcs, escapeIcsText, foldIcsLine, icsToBase64 } from '../src/lib/hire-ics.ts';

const BOOKING = {
  name: 'Jane Example',
  email: 'jane@example.org',
  phone: '0400 000 000',
  organisation: 'Example Group',
  date: '2026-09-14',
  startTime: '18:00',
  endTime: '21:30',
  purpose: 'Community gathering; with music, and refreshments',
  attendance: '40',
  location: "Bahá'í Centre, Townsville QLD",
  organiser: 'no-reply@townsville.bahai.org.au',
};
const STAMP = '20260907T000000Z';

const unfold = (ics) => ics.replace(/\r\n /g, '');
const field = (ics, name) =>
  unfold(ics).split('\r\n').find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1);

test('Brisbane local time is written as UTC, ten hours behind', () => {
  const ics = buildHireIcs(BOOKING, STAMP);
  // 18:00 Brisbane on the 14th is 08:00Z the same day.
  assert.equal(field(ics, 'DTSTART'), '20260914T080000Z');
  assert.equal(field(ics, 'DTEND'), '20260914T113000Z');
});

test('a booking early enough to cross midnight lands on the day before, in UTC', () => {
  const ics = buildHireIcs({ ...BOOKING, startTime: '08:00', endTime: '09:00' }, STAMP);
  assert.equal(field(ics, 'DTSTART'), '20260913T220000Z', 'a morning here is the previous evening UTC');
  assert.equal(field(ics, 'DTEND'), '20260913T230000Z');
});

test('the four characters iCalendar reserves are escaped', () => {
  assert.equal(escapeIcsText('a;b'), 'a\\;b');
  assert.equal(escapeIcsText('a,b'), 'a\\,b');
  assert.equal(escapeIcsText('a\\b'), 'a\\\\b');
  assert.equal(escapeIcsText('a\nb'), 'a\\nb');
  // A purpose with a semicolon must not split the DESCRIPTION into parameters.
  const ics = buildHireIcs(BOOKING, STAMP);
  // The purpose now sits on its own labelled line, after the contact details.
  assert.match(unfold(ics), /Purpose: Community gathering\\; with music\\, and refreshments/);
});

test('lines are folded at 75 octets, and never inside a character', () => {
  const long = 'x'.repeat(200);
  const folded = foldIcsLine(`DESCRIPTION:${long}`);
  for (const line of folded.split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `line of ${line.length} is too long`);
  }
  assert.match(folded, /\r\n /, 'continuations begin with a space');
  assert.equal(folded.replace(/\r\n /g, ''), `DESCRIPTION:${long}`, 'unfolds to the original');

  // Accented text: folding by character count would cut a two-byte sequence.
  const accented = foldIcsLine(`DESCRIPTION:${'á'.repeat(120)}`);
  assert.ok(!accented.includes('�'), 'a character was cut in half');
  assert.equal(accented.replace(/\r\n /g, ''), `DESCRIPTION:${'á'.repeat(120)}`);
});

test('the same booking always gets the same identifier', () => {
  const a = buildHireIcs(BOOKING, STAMP);
  const b = buildHireIcs(BOOKING, '20260908T111111Z');
  assert.equal(field(a, 'UID'), field(b, 'UID'), 'a resend must update, not duplicate');
  // A different booking must not collide with it.
  const other = buildHireIcs({ ...BOOKING, date: '2026-09-15' }, STAMP);
  assert.notEqual(field(a, 'UID'), field(other, 'UID'));
  const otherPerson = buildHireIcs({ ...BOOKING, email: 'someone@else.org' }, STAMP);
  assert.notEqual(field(a, 'UID'), field(otherPerson, 'UID'));
});

test('the file is well formed, with CRLF endings throughout', () => {
  const ics = buildHireIcs(BOOKING, STAMP);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'a bare newline would break strict readers');
  for (const required of ['VERSION:2.0', 'BEGIN:VEVENT', 'END:VEVENT', 'UID:', 'DTSTAMP:']) {
    assert.ok(ics.includes(required), `missing ${required}`);
  }
  assert.equal(field(ics, 'SUMMARY'), 'Jane Example');
  assert.match(unfold(ics), /LOCATION:Bahá'í Centre\\, Townsville QLD/);
});

test('an absent phone or organisation leaves no empty line', () => {
  const ics = unfold(buildHireIcs({ ...BOOKING, phone: '', organisation: '' }, STAMP));
  const description = ics.split('\r\n').find((l) => l.startsWith('DESCRIPTION:'));
  assert.ok(!description.includes('Phone:'));
  assert.ok(!description.includes('Organisation:'));
  assert.match(description, /DESCRIPTION:Name: Jane Example\\nEmail: jane@example\.org/);
});

test('base64 round-trips the bytes, accents included', () => {
  const ics = buildHireIcs(BOOKING, STAMP);
  assert.equal(Buffer.from(icsToBase64(ics), 'base64').toString('utf8'), ics);
});

/*
 * Outlook refused the file with "Couldn't import calendar" because it declared
 * METHOD:PUBLISH without an ORGANIZER, which RFC 5546 requires of any iTIP
 * message. Apple Calendar and Google accepted it either way. Either both go in
 * or neither does, and neither is right here: this is an entry to file, not an
 * invitation from somebody.
 */
test('METHOD and ORGANIZER are both present, or neither is', () => {
  const ics = buildHireIcs(BOOKING, STAMP);
  const hasMethod = /^METHOD:/m.test(ics);
  const hasOrganizer = /^ORGANIZER/m.test(ics);
  assert.equal(hasMethod, hasOrganizer, 'a METHOD without an ORGANIZER is an invalid iTIP message');
  assert.ok(hasMethod, 'the attachment button in Outlook reads this as an iTIP message');
  assert.match(ics, /^METHOD:PUBLISH/m, 'PUBLISH, not REQUEST: nothing here is to be accepted');
  // The line wraps at 75 octets, so it has to be unfolded before matching.
  assert.match(unfold(ics), /ORGANIZER;CN=[^:]+:mailto:no-reply@townsville\.bahai\.org\.au/);
});
