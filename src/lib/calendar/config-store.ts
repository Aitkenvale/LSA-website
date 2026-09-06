/**
 * The shared calendar configuration.
 *
 * Which calendars exist, what they are called, where their feeds live and who
 * may see them is a property of the community, not of whoever happens to be
 * looking. It is held on the server so that an administrator sets it once for
 * everyone, and so that entitlement can be enforced rather than merely
 * displayed.
 *
 * Only two things stay in the reader's browser: which calendars they have
 * switched on, and which sections they have collapsed. Those are preferences,
 * and nobody else is affected by them.
 *
 * Stored as one small document in the Worker's KV namespace. It is read on
 * nearly every request and written rarely, which is what KV is good at; the
 * cost is that a change can take up to a minute to reach every location.
 */

import type { CalendarSection } from './registry.ts';
import { CALENDAR_SECTIONS, GENERATED_CALENDARS, SEEDED_GOOGLE_CALENDARS } from './registry.ts';
import type { Tier } from './tiers.ts';
import { isTier, meetsTier } from './tiers.ts';

export const CONFIG_KEY = 'calendar:config';

export interface StoredCalendar {
  id: string;
  kind: 'generated' | 'linked';
  /** Display name. Generated calendars fall back to their registry name. */
  name?: string;
  /** Private iCal address. Never sent to a browser below the admin tier. */
  icsUrl?: string;
  /** Shown in place of real event titles below `detailFrom`. */
  viewLabel?: string;
  colour?: string;
  section?: CalendarSection;
  /** Lowest tier that may see this calendar at all. */
  visibility: Tier;
  /** Lowest tier that may see real event titles rather than the view label. */
  detailFrom: Tier;
  /** The generated calendar this one is listed beneath. */
  after?: string;
  position: number;
}

export interface StoredConfig {
  version: 1;
  calendars: StoredCalendar[];
  /** When each tier's code was last changed, so the record is a fact. */
  codeChanged: Partial<Record<Tier, string>>;
}

/**
 * The configuration a community starts with.
 *
 * Generated calendars are public: they are computed facts about the calendar
 * itself, not anybody's business. Linked calendars start at `assembly`, because
 * a calendar someone has just attached should not become public by default —
 * making it visible has to be a decision.
 */
export function defaultStoredConfig(): StoredConfig {
  const calendars: StoredCalendar[] = [];
  let position = 0;

  for (const c of GENERATED_CALENDARS) {
    calendars.push({
      id: c.id,
      kind: 'generated',
      section: c.group === 'other-faith' ? 'interfaith' : c.group === 'secular' ? 'secular' : 'bahai',
      visibility: 'public',
      detailFrom: 'public',
      position: position += 10,
    });
    for (const seed of SEEDED_GOOGLE_CALENDARS.filter((s) => s.after === c.id)) {
      calendars.push({
        id: seed.id,
        kind: 'linked',
        name: seed.name,
        icsUrl: '',
        viewLabel: '',
        colour: seed.colour,
        section: 'bahai',
        visibility: 'assembly',
        detailFrom: 'assembly',
        after: seed.after,
        position: position += 10,
      });
    }
  }
  return { version: 1, calendars, codeChanged: {} };
}

function asTier(value: unknown, fallback: Tier): Tier {
  return isTier(value) ? value : fallback;
}

/** Accept a stored document defensively — it may predate the current shape. */
export function normaliseConfig(raw: unknown): StoredConfig {
  const base = defaultStoredConfig();
  if (!raw || typeof raw !== 'object') return base;
  const stored = raw as Partial<StoredConfig>;
  if (!Array.isArray(stored.calendars)) return base;

  const byId = new Map(base.calendars.map((c) => [c.id, c]));
  for (const entry of stored.calendars) {
    if (!entry || typeof entry.id !== 'string') continue;
    const existing = byId.get(entry.id);
    const kind = entry.kind === 'linked' ? 'linked' : existing?.kind ?? 'linked';
    byId.set(entry.id, {
      ...(existing ?? { id: entry.id, kind, visibility: 'assembly', detailFrom: 'assembly', position: 999 }),
      ...entry,
      kind,
      // A malformed tier must never widen access, so both fall back to the
      // stricter of the stored value and the default.
      visibility: asTier(entry.visibility, existing?.visibility ?? 'assembly'),
      detailFrom: asTier(entry.detailFrom, existing?.detailFrom ?? 'assembly'),
      section: CALENDAR_SECTIONS.some((s) => s.id === entry.section)
        ? entry.section
        : existing?.section ?? 'bahai',
    });
  }
  return {
    version: 1,
    calendars: [...byId.values()].sort((a, b) => a.position - b.position),
    codeChanged: stored.codeChanged ?? {},
  };
}

export async function readConfig(kv: KVNamespace | undefined): Promise<StoredConfig> {
  if (!kv) return defaultStoredConfig();
  const raw = await kv.get(CONFIG_KEY, 'json');
  return normaliseConfig(raw);
}

export async function writeConfig(kv: KVNamespace, config: StoredConfig): Promise<void> {
  await kv.put(CONFIG_KEY, JSON.stringify(config));
}

/** One calendar as a given tier is allowed to know it. */
export interface VisibleCalendar {
  id: string;
  kind: 'generated' | 'linked';
  /** Always resolved: a generated calendar's name comes from the registry. */
  name: string;
  /** Whether this calendar's dates are exact, so the list can say so. */
  confidence?: 'exact' | 'approximate' | 'verified';
  /** On by default for a reader who has expressed no preference. */
  defaultOn: boolean;
  colour?: string;
  section: CalendarSection;
  /** True when this viewer sees real event titles rather than the view label. */
  showsDetail: boolean;
  /** What replaces the title when they do not. */
  viewLabel?: string;
  after?: string;
  position: number;
}

/**
 * The calendars a tier may see, with addresses removed.
 *
 * The address never leaves the server below the admin tier — not hidden in the
 * page, not present in a response the browser could read. That is the whole
 * point of moving this off the device.
 */
export function visibleTo(config: StoredConfig, tier: Tier): VisibleCalendar[] {
  return config.calendars
    .filter((c) => meetsTier(tier, c.visibility))
    .map((c) => {
      const generated = GENERATED_CALENDARS.find((g) => g.id === c.id);
      return {
      id: c.id,
      kind: c.kind,
      name: c.name || generated?.name || c.id,
      confidence: generated?.confidence,
      defaultOn: generated ? generated.defaultOn : true,
      colour: c.colour,
      section: c.section ?? 'bahai',
      showsDetail: meetsTier(tier, c.detailFrom),
      viewLabel: c.viewLabel || undefined,
      after: c.after,
      position: c.position,
      };
    })
    .sort((a, b) => a.position - b.position);
}

/** Find a calendar the given tier is entitled to read a feed from. */
export function feedFor(
  config: StoredConfig,
  tier: Tier,
  id: string,
): { calendar: StoredCalendar; showsDetail: boolean } | null {
  const calendar = config.calendars.find((c) => c.id === id && c.kind === 'linked');
  if (!calendar || !calendar.icsUrl) return null;
  if (!meetsTier(tier, calendar.visibility)) return null;
  return { calendar, showsDetail: meetsTier(tier, calendar.detailFrom) };
}
