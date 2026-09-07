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
import type { PhotoPermissions } from './photo-store.ts';
import { DEFAULT_PHOTO_PERMISSIONS, asPhotoPermissions } from './photo-store.ts';
import type { Plan } from './plans.ts';
import { DEFAULT_PLANS, sortPlans } from './plans.ts';
import type {
  AuStateId, PhaseColours, PhasePlan, SchoolTerm, TermSource, WeekDay,
} from './school-terms.ts';
import {
  BUNDLED_TERMS, DEFAULT_PHASE_COLOURS, DEFAULT_PHASE_PLAN, PASTEL_COLOURS, PHASES,
  TERM_SOURCES, boundariesFromTerms, isAuState,
} from './school-terms.ts';
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

/**
 * Where the community is.
 *
 * Needed for the Fast, which runs from sunrise to sunset and so has different
 * hours in every town. Held in the shared configuration rather than fixed in
 * the code, so another community can use this calendar without editing it.
 */
export interface CalendarLocation {
  name: string;
  latitude: number;
  longitude: number;
  /** Fixed offset from UTC. Queensland has no daylight saving, so +10 always. */
  utcOffsetHours: number;
}

export const DEFAULT_LOCATION: CalendarLocation = {
  name: 'Townsville',
  latitude: -19.2589,
  longitude: 146.8169,
  utcOffsetHours: 10,
};

/**
 * How the planning cycles are laid out.
 *
 * This is Assembly business, not a reader's preference: a cycle is when the
 * community has agreed to begin and end a phase of work, and everybody must be
 * looking at the same one. Only which day the grid's columns start on is left
 * to the reader, and that lives in their browser.
 */
export interface CycleSettings {
  state: AuStateId;
  /** Term dates for the chosen state: bundled, fetched, or corrected by hand. */
  terms: SchoolTerm[];
  /** Where those dates came from, so the panel can say so. */
  termsSource?: TermSource;
  /** The day each cycle begins, ascending. One more than there are cycles. */
  boundaries: string[];
  /** How many weeks the two fixed phases take; consolidation gets the rest. */
  phases: PhasePlan;
  phaseColours: PhaseColours;
  /**
   * The day the cycle grid opens a week on.
   *
   * Unlike the month views, this is the Assembly's rather than the reader's.
   * A cycle is a shared plan, and two people discussing "week 7" need the same
   * seven days in mind; the reader still sees the setting, greyed, so the grid
   * is not simply mysterious.
   */
  weekStart: WeekDay;
  /** The global Plans, oldest first. Past ones are kept so history reads right. */
  plans: Plan[];
}

export function defaultCycleSettings(state: AuStateId = 'qld'): CycleSettings {
  const terms = BUNDLED_TERMS[state];
  return {
    state,
    terms: terms ? terms.map((t) => ({ ...t })) : [],
    termsSource: terms ? TERM_SOURCES[state] : undefined,
    boundaries: terms ? boundariesFromTerms(terms) : [],
    phases: { ...DEFAULT_PHASE_PLAN },
    phaseColours: { ...DEFAULT_PHASE_COLOURS },
    // Saturday: a cycle opens with the weekend the holidays begin on.
    weekStart: 6,
    plans: DEFAULT_PLANS.map((p) => ({ ...p })),
  };
}

export interface StoredConfig {
  version: 1;
  calendars: StoredCalendar[];
  location: CalendarLocation;
  cycles: CycleSettings;
  /** Who may see, add, describe, download and destroy a day's photographs. */
  photos: PhotoPermissions;
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
  return {
    version: 1,
    calendars,
    location: { ...DEFAULT_LOCATION },
    cycles: defaultCycleSettings(),
    photos: { ...DEFAULT_PHOTO_PERMISSIONS },
    codeChanged: {},
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asIsoDates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((d): d is string => typeof d === 'string' && ISO_DATE.test(d)))].sort();
}

/**
 * Accept stored term dates only when they are whole and in order.
 *
 * A term whose end precedes its start would produce a cycle running backwards,
 * and a half-written entry would silently shift every boundary after it, so a
 * malformed row is dropped rather than repaired into something plausible.
 */
function asTerms(value: unknown): SchoolTerm[] {
  if (!Array.isArray(value)) return [];
  const terms: SchoolTerm[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Partial<SchoolTerm>;
    if (!Number.isInteger(t.year) || ![1, 2, 3, 4].includes(t.term as number)) continue;
    if (typeof t.start !== 'string' || !ISO_DATE.test(t.start)) continue;
    if (typeof t.end !== 'string' || !ISO_DATE.test(t.end)) continue;
    if (t.end < t.start) continue;
    terms.push({ year: t.year as number, term: t.term as 1 | 2 | 3 | 4, start: t.start, end: t.end });
  }
  return terms.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

function asPhasePlan(value: unknown): PhasePlan {
  const raw = (value ?? {}) as Partial<PhasePlan>;
  // A negative or absurd count would push a phase off the grid, so each is
  // pinned to something a cycle could actually contain.
  const clamp = (n: unknown, fallback: number) =>
    Number.isFinite(n) && (n as number) >= 0 && (n as number) <= 20
      ? Math.floor(n as number)
      : fallback;
  return {
    expansionWeeks: clamp(raw.expansionWeeks, DEFAULT_PHASE_PLAN.expansionWeeks),
    reflectionWeeks: clamp(raw.reflectionWeeks, DEFAULT_PHASE_PLAN.reflectionWeeks),
  };
}

function asPhaseColours(value: unknown): PhaseColours {
  const raw = (value ?? {}) as Partial<PhaseColours>;
  const colours = { ...DEFAULT_PHASE_COLOURS };
  for (const phase of PHASES) {
    const id = raw[phase.id];
    if (typeof id === 'string' && PASTEL_COLOURS.some((c) => c.id === id)) colours[phase.id] = id;
  }
  return colours;
}

/**
 * Plans are only as good as their dates, so a nameless or undated one is
 * dropped rather than kept as an entry that would silently name cycles after
 * nothing.
 */
function asPlans(value: unknown, fallback: Plan[]): Plan[] {
  if (!Array.isArray(value)) return fallback.map((p) => ({ ...p }));
  const plans: Plan[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Partial<Plan>;
    if (typeof p.name !== 'string' || !p.name.trim()) continue;
    if (typeof p.start !== 'string' || !ISO_DATE.test(p.start)) continue;
    plans.push({ name: p.name.trim(), start: p.start });
  }
  return sortPlans(plans);
}

function asCycles(value: unknown): CycleSettings {
  const base = defaultCycleSettings();
  if (!value || typeof value !== 'object') return base;
  const c = value as Partial<CycleSettings>;
  const state = isAuState(c.state) ? c.state : base.state;
  // Terms are kept as stored even when empty: a state with no bundled dates is
  // meant to show blanks for an administrator to fill, not Queensland's dates.
  const terms = 'terms' in (c as object) ? asTerms(c.terms) : base.terms;
  return {
    state,
    terms,
    termsSource: c.termsSource ?? (terms.length ? TERM_SOURCES[state] : undefined),
    boundaries: 'boundaries' in (c as object) ? asIsoDates(c.boundaries) : base.boundaries,
    phases: asPhasePlan(c.phases),
    phaseColours: asPhaseColours(c.phaseColours),
    weekStart: ([0, 1, 2, 3, 4, 5, 6] as const).includes(c.weekStart as WeekDay)
      ? (c.weekStart as WeekDay)
      : base.weekStart,
    plans: 'plans' in (c as object) ? asPlans(c.plans, base.plans) : base.plans,
  };
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
  // A location with a nonsense coordinate would put sunrise at the wrong hour
  // rather than fail visibly, so each number is checked before it is accepted.
  const loc = stored.location;
  const location: CalendarLocation =
    loc &&
    Number.isFinite(loc.latitude) && Math.abs(loc.latitude) <= 90 &&
    Number.isFinite(loc.longitude) && Math.abs(loc.longitude) <= 180 &&
    Number.isFinite(loc.utcOffsetHours) && Math.abs(loc.utcOffsetHours) <= 14
      ? { ...DEFAULT_LOCATION, ...loc, name: String(loc.name ?? DEFAULT_LOCATION.name) }
      : { ...DEFAULT_LOCATION };

  return {
    version: 1,
    calendars: [...byId.values()].sort((a, b) => a.position - b.position),
    location,
    cycles: asCycles(stored.cycles),
    photos: asPhotoPermissions(stored.photos),
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
