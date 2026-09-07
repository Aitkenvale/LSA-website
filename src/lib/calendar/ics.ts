/**
 * A small iCalendar reader, enough for Google Calendar and Outlook feeds.
 *
 * One VEVENT is published per series with an RRULE, so recurring events have to
 * be expanded here. Supported: FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL,
 * COUNT, UNTIL, BYDAY for weekly rules, EXDATE, and RECURRENCE-ID overrides —
 * where a single occurrence has been edited, the calendar publishes the series
 * AND a separate event replacing that one date. Anything more exotic is emitted
 * as a single occurrence rather than dropped.
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

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

interface TzRule {
  /** Offset from UTC in minutes. */
  offsetMinutes: number;
  /** Month the rule takes effect, 1–12, if it switches. */
  month?: number;
  /** Weekday it switches on, 0 = Sunday. */
  weekday?: number;
  /** Which weekday of the month; -1 means the last. */
  nth?: number;
}

interface TimeZoneDef {
  standard: TzRule;
  daylight?: TzRule;
}

function parseOffset(value: string): number {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(value.trim());
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Read the VTIMEZONE blocks a feed declares.
 *
 * Outlook stamps every event with a TZID and defines it here; Google usually
 * emits UTC instead. Without this, a calendar kept in a daylight-saving state
 * renders an hour out for half the year — silently, which is the worst kind of
 * wrong for a calendar.
 */
function parseTimeZones(lines: string[]): Map<string, TimeZoneDef> {
  const zones = new Map<string, TimeZoneDef>();
  let tzid: string | null = null;
  let section: 'STANDARD' | 'DAYLIGHT' | null = null;
  let rule: Partial<TzRule> = {};

  const commit = () => {
    if (!tzid || !section || rule.offsetMinutes === undefined) return;
    const zone = zones.get(tzid) ?? { standard: { offsetMinutes: 0 } };
    if (section === 'STANDARD') zone.standard = rule as TzRule;
    else zone.daylight = rule as TzRule;
    zones.set(tzid, zone);
  };

  for (const line of lines) {
    if (line.startsWith('BEGIN:VTIMEZONE')) { tzid = null; continue; }
    if (line.startsWith('END:VTIMEZONE')) { tzid = null; continue; }
    if (!line.startsWith('TZID:') && !tzid && !line.startsWith('BEGIN:')) continue;

    if (line.startsWith('TZID:')) { tzid = line.slice(5).trim(); continue; }
    if (line.startsWith('BEGIN:STANDARD') || line.startsWith('BEGIN:DAYLIGHT')) {
      section = line.endsWith('STANDARD') ? 'STANDARD' : 'DAYLIGHT';
      rule = {};
      continue;
    }
    if (line.startsWith('END:STANDARD') || line.startsWith('END:DAYLIGHT')) {
      commit();
      section = null;
      continue;
    }
    if (!section) continue;
    if (line.startsWith('TZOFFSETTO:')) rule.offsetMinutes = parseOffset(line.slice(11));
    else if (line.startsWith('RRULE:')) {
      const month = /BYMONTH=(\d+)/.exec(line);
      const day = /BYDAY=(-?\d)?([A-Z]{2})/.exec(line);
      if (month) rule.month = Number(month[1]);
      if (day) {
        rule.nth = day[1] ? Number(day[1]) : 1;
        rule.weekday = DAY_CODES.indexOf(day[2]);
      }
    }
  }
  return zones;
}

/** Civil date a "nth weekday of month" rule falls on, in a given year. */
function ruleDate(year: number, rule: TzRule): string | null {
  if (!rule.month || rule.weekday === undefined || rule.nth === undefined) return null;
  if (rule.nth > 0) {
    const first = isoDate({ year, month: rule.month, day: 1 });
    const shift = (rule.weekday - weekday(first) + 7) % 7;
    return addDays(first, shift + (rule.nth - 1) * 7);
  }
  // Negative means counting back from the end of the month.
  const nextMonth = rule.month === 12
    ? isoDate({ year: year + 1, month: 1, day: 1 })
    : isoDate({ year, month: rule.month + 1, day: 1 });
  const last = addDays(nextMonth, -1);
  const back = (weekday(last) - rule.weekday + 7) % 7;
  return addDays(last, -back - (-rule.nth - 1) * 7);
}

/** Offset in minutes that a zone is running at on a given civil date. */
function offsetOn(zone: TimeZoneDef, iso: string): number {
  const { daylight, standard } = zone;
  if (!daylight || daylight.offsetMinutes === standard.offsetMinutes) {
    return standard.offsetMinutes;
  }
  const year = Number(iso.slice(0, 4));
  const dstStart = ruleDate(year, daylight);
  const stdStart = ruleDate(year, standard);
  if (!dstStart || !stdStart) return standard.offsetMinutes;

  return dstStart < stdStart
    // Northern hemisphere: daylight runs between the two dates.
    ? (iso >= dstStart && iso < stdStart ? daylight.offsetMinutes : standard.offsetMinutes)
    // Southern: daylight wraps the new year, so it runs outside them.
    : (iso >= dstStart || iso < stdStart ? daylight.offsetMinutes : standard.offsetMinutes);
}

/** Shift a stamp from `fromMinutes` east of UTC to `toHours` east of UTC. */
function shiftBy(stamp: ParsedStamp, deltaMinutes: number): ParsedStamp {
  if (!stamp.time || deltaMinutes === 0) return stamp;
  const [y, m, d] = stamp.date.split('-').map(Number);
  const [hh, mm] = stamp.time.split(':').map(Number);
  const jd = gregorianToJD(y, m, d) + hh / 24 + (mm + deltaMinutes) / 1440;
  const g = jdToGregorian(jd);
  const frac = jd + 0.5 - Math.floor(jd + 0.5);
  const total = Math.round(frac * 1440);
  return {
    date: isoDate(g),
    time: `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
    utc: false,
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
  const zones = parseTimeZones(lines);

  interface RawEvent {
    props: Record<string, RawProp>;
    exdates: string[];
  }
  const records: RawEvent[] = [];
  let current: Record<string, RawProp> | null = null;
  let exdates: string[] = [];

  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) {
      current = {};
      exdates = [];
      continue;
    }
    if (line.startsWith('END:VEVENT')) {
      if (current) records.push({ props: current, exdates });
      current = null;
      continue;
    }
    if (!current) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'EXDATE') {
      for (const v of prop.value.split(',')) {
        const stamp = parseStamp({ ...prop, value: v });
        if (stamp) {
          exdates.push(toDisplayStamp(stamp, prop, zones, utcOffsetHours).date);
        }
      }
      continue;
    }
    // Keep the first occurrence of each property.
    if (!current[prop.name]) current[prop.name] = prop;
  }

  /*
   * Editing one occurrence of a series does not modify the series. The calendar
   * publishes the series unchanged AND a second event carrying RECURRENCE-ID,
   * naming the occurrence it stands in for. Both share a UID. Emitting both, as
   * an earlier version did, showed the meeting twice on that day — once at its
   * original time and once as edited.
   */
  const masters: RawEvent[] = [];
  const edited: RawEvent[] = [];
  const replacedByUid = new Map<string, Set<string>>();

  for (const record of records) {
    const rid = record.props['RECURRENCE-ID'];
    if (!rid) {
      masters.push(record);
      continue;
    }
    edited.push(record);
    const uid = record.props.UID?.value ?? '';
    const stamp = parseStamp(rid);
    if (!stamp) continue;
    const isDateOnly = rid.params.VALUE === 'DATE' || !stamp.time;
    const date = isDateOnly ? stamp.date : toDisplayStamp(stamp, rid, zones, utcOffsetHours).date;
    const set = replacedByUid.get(uid) ?? new Set<string>();
    set.add(date);
    replacedByUid.set(uid, set);
  }

  const events = [
    ...masters.flatMap((r) =>
      buildEvents(
        r.props,
        r.exdates,
        from,
        to,
        utcOffsetHours,
        zones,
        replacedByUid.get(r.props.UID?.value ?? '') ?? new Set(),
      ),
    ),
    // The edited occurrences themselves, at whatever date they were moved to.
    ...edited.flatMap((r) =>
      buildEvents(r.props, r.exdates, from, to, utcOffsetHours, zones).map((e) => ({
        ...e,
        uid: `${e.uid}-edited`,
      })),
    ),
  ];

  return events.sort(
    (a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''),
  );
}

/**
 * Bring a stamp into the display timezone.
 *
 * Google writes UTC and marks it with a trailing Z. Outlook writes local time
 * with a TZID naming a zone the feed defines, so that offset has to be looked up
 * for the event's own date — a Sydney calendar is +11 in January and +10 in
 * July. A stamp with neither is taken as already local, which is all the
 * standard allows us to assume.
 */
function toDisplayStamp(
  stamp: ParsedStamp,
  prop: RawProp,
  zones: Map<string, TimeZoneDef>,
  utcOffsetHours: number,
): ParsedStamp {
  if (stamp.utc) return shiftToOffset(stamp, utcOffsetHours);
  const zone = prop.params.TZID ? zones.get(prop.params.TZID) : undefined;
  if (!zone) return stamp;
  return shiftBy(stamp, utcOffsetHours * 60 - offsetOn(zone, stamp.date));
}

function buildEvents(
  props: Record<string, RawProp>,
  exdates: string[],
  from: string,
  to: string,
  utcOffsetHours: number,
  zones: Map<string, TimeZoneDef>,
  /** Occurrence dates this series has an edited replacement for. */
  replaced: Set<string> = new Set(),
): IcsEvent[] {
  const dtstart = props.DTSTART;
  if (!dtstart) return [];
  const rawStart = parseStamp(dtstart);
  if (!rawStart) return [];
  const allDay = dtstart.params.VALUE === 'DATE' || !rawStart.time;

  const toDisplay = (stamp: ParsedStamp, prop: RawProp) =>
    allDay ? stamp : toDisplayStamp(stamp, prop, zones, utcOffsetHours);

  const start = toDisplay(rawStart, dtstart);

  const rawEnd = props.DTEND ? parseStamp(props.DTEND) : null;
  const end = rawEnd && props.DTEND ? (allDay ? rawEnd : toDisplay(rawEnd, props.DTEND)) : rawEnd;
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

  /*
   * An event belongs to a window if it OVERLAPS it, not if it begins in it.
   *
   * Filtering on the start alone loses anything already under way: a booking
   * running from the last day of one cycle into the next disappeared from the
   * second entirely, and a hire spanning the turn of a month vanished from the
   * month it finished in. The window is therefore searched from `spanDays`
   * earlier, and each occurrence kept only if it actually reaches `from`.
   */
  const reachBack = spanDays > 0 ? addDays(from, -spanDays) : from;
  const overlaps = (d: string) => d <= to && (spanDays > 0 ? addDays(d, spanDays) : d) >= from;

  const starts = (props.RRULE
    ? expandRrule(props.RRULE.value, start.date, reachBack, to)
    : start.date >= reachBack && start.date <= to
      ? [start.date]
      : []
  ).filter(overlaps);

  return starts
    .filter((d) => !exdates.includes(d) && !replaced.has(d))
    .map((d) => ({
      ...base,
      uid: `${uid}-${d}`,
      date: d,
      endDate: spanDays > 0 ? addDays(d, spanDays) : undefined,
    }));
}
