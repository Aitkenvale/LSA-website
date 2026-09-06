/**
 * A small iCalendar reader, enough for Google Calendar feeds.
 *
 * Google emits one VEVENT per series with an RRULE, so recurring events have to
 * be expanded here. Supported: FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL,
 * COUNT, UNTIL, BYDAY for weekly rules, plus EXDATE and RECURRENCE-ID overrides.
 * Anything more exotic is emitted as a single occurrence rather than dropped.
 */

import { addDays, daysBetween, isoDate, jdToGregorian, gregorianToJD, weekday } from './astronomy.ts';

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** Gregorian date, ISO. */
  date: string;
  /** Inclusive last day for multi-day events. */
  endDate?: string;
  /** Local start time "HH:MM", absent for all-day events. */
  startTime?: string;
  endTime?: string;
  allDay: boolean;
}

/** Undo RFC 5545 line folding, where continuations begin with a space or tab. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\;/g, ';')
    .replace(/\\\\/g, '\\');
}

interface RawProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): RawProp | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(';');
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: parts[0].toUpperCase(), params, value };
}

interface ParsedStamp {
  date: string;
  time?: string;
  /** UTC "Z" form, which must be shifted into the display timezone. */
  utc: boolean;
}

/** Parse a DATE or DATE-TIME value. */
function parseStamp(prop: RawProp): ParsedStamp | null {
  const v = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) {
    return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, utc: false };
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return null;
  return {
    date: `${dt[1]}-${dt[2]}-${dt[3]}`,
    time: `${dt[4]}:${dt[5]}`,
    utc: dt[7] === 'Z',
  };
}

/** Shift a UTC stamp into a fixed-offset timezone. */
function shiftToOffset(stamp: ParsedStamp, offsetHours: number): ParsedStamp {
  if (!stamp.utc || !stamp.time) return stamp;
  const [y, m, d] = stamp.date.split('-').map(Number);
  const [hh, mm] = stamp.time.split(':').map(Number);
  const jd = gregorianToJD(y, m, d) + (hh + offsetHours) / 24 + mm / 1440;
  const g = jdToGregorian(jd);
  const frac = jd + 0.5 - Math.floor(jd + 0.5);
  const totalMinutes = Math.round(frac * 1440);
  return {
    date: isoDate(g),
    time: `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`,
    utc: false,
  };
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Expand an RRULE into start dates within [from, to]. */
function expandRrule(rule: string, start: string, from: string, to: string): string[] {
  const parts: Record<string, string> = {};
  for (const kv of rule.split(';')) {
    const eq = kv.indexOf('=');
    if (eq > -1) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  const freq = parts.FREQ;
  const interval = Number(parts.INTERVAL ?? 1) || 1;
  const count = parts.COUNT ? Number(parts.COUNT) : undefined;
  const untilStamp = parts.UNTIL ? parseStamp({ name: 'UNTIL', params: {}, value: parts.UNTIL }) : null;
  const until = untilStamp?.date;
  const byDay = parts.BYDAY ? parts.BYDAY.split(',').map((d) => d.slice(-2).toUpperCase()) : null;

  const limit = until && until < to ? until : to;
  const dates: string[] = [];
  let emitted = 0;

  const push = (d: string) => {
    if (d >= from && d <= limit) dates.push(d);
    emitted += 1;
  };

  if (freq === 'WEEKLY' && byDay?.length) {
    // Walk week by week from the start's week, emitting each requested weekday.
    const startDow = weekday(start);
    let weekStart = addDays(start, -startDow);
    for (let i = 0; i < 600 && weekStart <= limit; i += 1) {
      for (const code of byDay) {
        const dow = WEEKDAY_CODES.indexOf(code);
        if (dow < 0) continue;
        const d = addDays(weekStart, dow);
        if (d < start) continue;
        if (count !== undefined && emitted >= count) return dates;
        push(d);
      }
      weekStart = addDays(weekStart, 7 * interval);
    }
    return dates;
  }

  let cursor = start;
  for (let i = 0; i < 1200 && cursor <= limit; i += 1) {
    if (count !== undefined && emitted >= count) break;
    push(cursor);
    if (freq === 'DAILY') cursor = addDays(cursor, interval);
    else if (freq === 'WEEKLY') cursor = addDays(cursor, 7 * interval);
    else if (freq === 'MONTHLY') {
      const [y, m, d] = cursor.split('-').map(Number);
      const nm = m + interval;
      cursor = isoDate({ year: y + Math.floor((nm - 1) / 12), month: ((nm - 1) % 12) + 1, day: d });
    } else if (freq === 'YEARLY') {
      const [y, m, d] = cursor.split('-').map(Number);
      cursor = isoDate({ year: y + interval, month: m, day: d });
    } else break;
  }
  return dates;
}

/**
 * Parse an iCalendar document into dated events within [from, to].
 * `utcOffsetHours` is the fixed offset events are displayed in (Brisbane, +10).
 */
export function parseIcs(text: string, from: string, to: string, utcOffsetHours = 10): IcsEvent[] {
  const lines = unfold(text);
  const events: IcsEvent[] = [];
  let current: Record<string, RawProp> | null = null;
  let exdates: string[] = [];

  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) {
      current = {};
      exdates = [];
      continue;
    }
    if (line.startsWith('END:VEVENT')) {
      if (current) events.push(...buildEvents(current, exdates, from, to, utcOffsetHours));
      current = null;
      continue;
    }
    if (!current) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'EXDATE') {
      for (const v of prop.value.split(',')) {
        const s = parseStamp({ ...prop, value: v });
        if (s) exdates.push(s.date);
      }
      continue;
    }
    // Keep the first occurrence of each property.
    if (!current[prop.name]) current[prop.name] = prop;
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}

function buildEvents(
  props: Record<string, RawProp>,
  exdates: string[],
  from: string,
  to: string,
  utcOffsetHours: number,
): IcsEvent[] {
  const dtstart = props.DTSTART;
  if (!dtstart) return [];
  const rawStart = parseStamp(dtstart);
  if (!rawStart) return [];
  const allDay = dtstart.params.VALUE === 'DATE' || !rawStart.time;
  const start = allDay ? rawStart : shiftToOffset(rawStart, utcOffsetHours);

  const rawEnd = props.DTEND ? parseStamp(props.DTEND) : null;
  const end = rawEnd && !allDay ? shiftToOffset(rawEnd, utcOffsetHours) : rawEnd;
  // An all-day DTEND is exclusive in iCalendar; make it inclusive.
  const spanDays = end ? Math.max(0, daysBetween(start.date, end.date) - (allDay ? 1 : 0)) : 0;

  const uid = props.UID?.value ?? `${start.date}-${props.SUMMARY?.value ?? ''}`;
  const base = {
    uid,
    summary: unescapeText(props.SUMMARY?.value ?? '(untitled)'),
    description: props.DESCRIPTION ? unescapeText(props.DESCRIPTION.value) : undefined,
    location: props.LOCATION ? unescapeText(props.LOCATION.value) : undefined,
    startTime: allDay ? undefined : start.time,
    endTime: allDay ? undefined : end?.time,
    allDay,
  };

  const starts = props.RRULE
    ? expandRrule(props.RRULE.value, start.date, from, to)
    : start.date >= from && start.date <= to
      ? [start.date]
      : [];

  return starts
    .filter((d) => !exdates.includes(d))
    .map((d) => ({
      ...base,
      uid: `${uid}-${d}`,
      date: d,
      endDate: spanDays > 0 ? addDays(d, spanDays) : undefined,
    }));
}
