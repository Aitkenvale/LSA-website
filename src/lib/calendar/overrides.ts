/**
 * Verified date overrides.
 *
 * Several traditions fix their dates by observation rather than by rule — the
 * Hijri month begins when the crescent is actually sighted, and lunisolar
 * festivals vary between regional authorities. The engine computes the common
 * astronomical answer and marks it 'approximate'. This file is how a computed
 * date gets replaced by an announced one.
 *
 * An override is keyed "<calendarId>:<occurrence key>", carries the corrected
 * date and — importantly — the source it came from, so the record stays
 * auditable. Confirming a computed date without changing it is also useful: an
 * override with no date simply promotes the occurrence to 'verified'.
 *
 * The table is edited through the CMS and read on the server, never supplied by
 * the browser, so a viewer cannot fabricate one.
 */

import { addDays } from './astronomy.ts';
import type { Occurrence } from './types.ts';

export interface DateOverride {
  /** "<calendarId>:<key>", e.g. "islam:ramadan-1448". */
  key: string;
  /** Corrected first day. Omit to confirm the computed date unchanged. */
  date?: string;
  /** Corrected inclusive last day, for observances spanning several days. */
  endDate?: string;
  /** Where this came from — an announcement, a published sheet, a letter. */
  source: string;
  /** When the administrator recorded it. */
  recordedOn?: string;
}

export type OverrideTable = Record<string, DateOverride>;

/** Index a list of overrides by key. */
export function indexOverrides(list: DateOverride[]): OverrideTable {
  const table: OverrideTable = {};
  for (const o of list) if (o.key) table[o.key] = o;
  return table;
}

/** The key an override must use to match a given occurrence. */
export function overrideKey(o: Pick<Occurrence, 'calendarId' | 'key'>): string {
  return `${o.calendarId}:${o.key}`;
}

/**
 * Apply verified dates to a generated list. An occurrence that matches an
 * override becomes 'verified' and carries its source; dates are only moved when
 * the override actually supplies one.
 */
export function applyOverrides(occurrences: Occurrence[], table: OverrideTable): Occurrence[] {
  if (!Object.keys(table).length) return occurrences;
  const applied = occurrences
    .map((o) => {
      const found = table[overrideKey(o)];
      if (!found) return o;
      const moved = found.date && found.date !== o.date;
      return {
        ...o,
        date: found.date ?? o.date,
        endDate: found.endDate ?? (found.date ? undefined : o.endDate),
        confidence: 'verified' as const,
        note: [
          o.note,
          moved ? `Date confirmed as ${found.date} — ${found.source}.` : `Confirmed — ${found.source}.`,
        ]
          .filter(Boolean)
          .join(' '),
      };
    });

  // Carry a corrected date across to observances defined relative to it, so a
  // linked pair can never be split by verifying only one of them.
  const byKey = new Map(applied.map((o) => [overrideKey(o), o]));
  return applied
    .map((o) => {
      if (!o.linkedTo || table[overrideKey(o)]) return o;
      const anchor = byKey.get(o.linkedTo.key);
      if (!anchor || anchor.confidence !== 'verified') return o;
      const moved = addDays(anchor.date, o.linkedTo.offsetDays ?? 0);
      if (moved === o.date) return o;
      return {
        ...o,
        date: moved,
        endDate: undefined,
        confidence: 'verified' as const,
        note: `${o.note ?? ''} Moved with ${anchor.name}.`.trim(),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/**
 * Occurrences that would benefit from confirmation: those still computed from
 * an observational or regionally variable rule, and not yet verified.
 */
export function needingVerification(occurrences: Occurrence[]): Occurrence[] {
  return occurrences.filter((o) => o.confidence === 'approximate');
}
