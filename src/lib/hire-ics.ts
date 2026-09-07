/**
 * A calendar file for an approved hire.
 *
 * The booking email already carries a Google Calendar link, which works by
 * pre-filling a form on Google's own site. That is fine while the bookings
 * live in Google, and useless the day they do not — and Microsoft has already
 * changed its equivalent URL once, breaking every link built on the old form.
 *
 * A file has no vendor in it. Outlook, Apple Calendar, Google Calendar and
 * Thunderbird all open the same bytes, so this keeps working whatever the
 * Assembly decides about where the Centre's diary is kept.
 */

export interface HireEvent {
  name: string;
  email: string;
  phone?: string;
  organisation?: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, local Brisbane time */
  startTime: string;
  endTime: string;
  purpose: string;
  attendance: string;
  location: string;
}

/**
 * Queensland keeps no daylight saving, so local time is always ten hours ahead
 * of UTC. Writing the times in UTC therefore says exactly one thing, and needs
 * no VTIMEZONE block for a reader to agree with us about when the booking is.
 */
const BRISBANE_OFFSET_HOURS = 10;

function toUtcStamp(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, hh - BRISBANE_OFFSET_HOURS, mm));
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escape the four characters iCalendar gives meaning to. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold to 75 octets, as the specification requires.
 *
 * Counted in bytes rather than characters: a purpose written with an accented
 * name or a dash from a word processor takes more than one byte per character,
 * and folding by character length would split one in half and produce a file
 * some readers reject.
 */
export function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never cut inside a UTF-8 sequence: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    out.push(new TextDecoder().decode(bytes.slice(start, end)));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return out.join('\r\n ');
}

export function buildHireIcs(event: HireEvent, stamp: string): string {
  const start = toUtcStamp(event.date, event.startTime);
  const end = toUtcStamp(event.date, event.endTime);

  // null for "leave this out", so the deliberate blank line after the purpose
  // survives while an absent phone number does not leave a gap.
  const description = [
    event.purpose,
    '',
    `Contact: ${event.name}`,
    `Email: ${event.email}`,
    event.phone ? `Phone: ${event.phone}` : null,
    event.organisation ? `Organisation: ${event.organisation}` : null,
    `Attendance: ${event.attendance}`,
  ].filter((line): line is string => line !== null).join('\n');

  /*
   * A stable identifier, built from the booking rather than from chance. Sent
   * twice — a resubmission, or a forwarded copy — it updates the entry already
   * in the diary instead of sitting beside it as a second booking.
   */
  const uid = `hire-${event.date}-${event.startTime.replace(':', '')}-`
    + `${event.email.toLowerCase().replace(/[^a-z0-9]/g, '')}@townsville.bahai.org.au`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//Bahá'í Community of Townsville//Centre hire//EN",
    'CALSCALE:GREGORIAN',
    /*
     * No METHOD line, deliberately.
     *
     * METHOD:PUBLISH makes this an iTIP message rather than plain calendar
     * data, and RFC 5546 requires an ORGANIZER in one. Outlook enforces that
     * and refused the file with "Couldn't import calendar"; Apple Calendar and
     * Google accept it regardless, which is why it took a real Outlook to find.
     *
     * Adding an ORGANIZER would satisfy the rule but change what the file
     * means — an invitation from somebody, rather than an entry to file. This
     * is an approved booking being written into a diary, so it should be the
     * second, and without METHOD it is.
     */
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(`Centre hire: ${event.name}`)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // CRLF throughout, which the specification requires and some readers enforce.
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** Base64, for handing the file to the mail API. */
export function icsToBase64(ics: string): string {
  const bytes = new TextEncoder().encode(ics);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
