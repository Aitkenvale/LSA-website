/** The shared configuration, and what each tier is allowed to know of it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultCycleSettings,
  defaultStoredConfig,
  feedFor,
  normaliseConfig,
  visibleTo,
} from '../src/lib/calendar/config-store.ts';

const withLinked = (overrides = {}) => {
  const config = defaultStoredConfig();
  config.calendars.push({
    id: 'lsa', kind: 'linked', name: 'LSA Meetings',
    icsUrl: 'https://outlook.office365.com/owa/calendar/x/y/calendar.ics',
    viewLabel: 'LSA Meeting', colour: 'red', section: 'bahai',
    visibility: 'community', detailFrom: 'assembly', position: 500,
    ...overrides,
  });
  return config;
};

test('generated calendars are public; linked ones start restricted', () => {
  const config = defaultStoredConfig();
  const months = config.calendars.find((c) => c.id === 'bahai-months');
  assert.equal(months.visibility, 'public');
  // A calendar someone has just attached must not become public by accident.
  const feast = config.calendars.find((c) => c.id === 'feast-event');
  assert.equal(feast.visibility, 'assembly');
  assert.equal(feast.detailFrom, 'assembly');
});

test('a tier sees only the calendars it is entitled to', () => {
  const config = withLinked();
  const idsFor = (tier) => visibleTo(config, tier).map((c) => c.id);

  assert.ok(!idsFor('public').includes('lsa'), 'the public cannot see a community calendar');
  assert.ok(idsFor('community').includes('lsa'));
  assert.ok(idsFor('assembly').includes('lsa'));
  // Generated calendars are visible throughout.
  assert.ok(idsFor('public').includes('bahai-holy-days'));
});

test('no response below admin carries a calendar address', () => {
  const config = withLinked();
  for (const tier of ['public', 'community', 'hoods', 'assembly']) {
    const serialised = JSON.stringify(visibleTo(config, tier));
    assert.ok(!serialised.includes('outlook.office365.com'), `${tier} must not receive the address`);
    assert.ok(!/icsUrl/.test(serialised), `${tier} must not receive an icsUrl field`);
  }
});

test('detail is granted separately from visibility', () => {
  const config = withLinked();
  const at = (tier) => visibleTo(config, tier).find((c) => c.id === 'lsa');
  // Community may see that the meeting exists, but not what it is called.
  assert.equal(at('community').showsDetail, false);
  assert.equal(at('community').viewLabel, 'LSA Meeting');
  assert.equal(at('assembly').showsDetail, true);
});

test('feed access is refused for a tier below the calendar', () => {
  const config = withLinked();
  assert.equal(feedFor(config, 'public', 'lsa'), null);
  assert.equal(feedFor(config, 'community', 'lsa').showsDetail, false);
  assert.equal(feedFor(config, 'assembly', 'lsa').showsDetail, true);
  // A calendar with no address yet is not fetchable at any tier.
  assert.equal(feedFor(config, 'admin', 'feast-event'), null);
  assert.equal(feedFor(config, 'admin', 'nonexistent'), null);
});

test('a malformed stored document cannot widen access', () => {
  const tampered = {
    version: 1,
    calendars: [
      // Nonsense tiers must fall back to the stricter value, not to public.
      { id: 'lsa', kind: 'linked', name: 'LSA', icsUrl: 'https://calendar.google.com/x',
        visibility: 'everyone', detailFrom: null, position: 5 },
      { id: 'bahai-months', kind: 'generated', visibility: 42, position: 1 },
    ],
  };
  const config = normaliseConfig(tampered);
  const lsa = config.calendars.find((c) => c.id === 'lsa');
  assert.equal(lsa.visibility, 'assembly', 'an unknown tier must not mean public');
  assert.equal(lsa.detailFrom, 'assembly');
  // A generated calendar keeps its known default rather than the junk value.
  assert.equal(config.calendars.find((c) => c.id === 'bahai-months').visibility, 'public');
});

test('junk in place of a document falls back to the defaults', () => {
  for (const junk of [null, undefined, 'nope', 42, {}, { calendars: 'no' }]) {
    const config = normaliseConfig(junk);
    assert.ok(config.calendars.length > 0);
    assert.equal(config.version, 1);
  }
});

// ---- planning cycles -------------------------------------------------------

test('a fresh configuration is planned to Queensland terms', () => {
  const config = defaultStoredConfig();
  assert.equal(config.cycles.state, 'qld');
  assert.equal(config.cycles.terms.length, 12);
  assert.equal(config.cycles.termsSource.name, 'Queensland Department of Education');
  assert.equal(config.cycles.boundaries[0], '2026-04-03');
  assert.deepEqual(config.cycles.phases, { expansionWeeks: 2, reflectionWeeks: 2 });
  assert.equal(config.cycles.phaseColours.expansion, 'apricot');
});

test('a nonsense state, phase length or date is refused rather than stored', () => {
  const config = normaliseConfig({
    ...defaultStoredConfig(),
    cycles: {
      state: 'nz',
      terms: [],
      boundaries: ['2026-02-01', 'not-a-date', '2026-02-01', 42],
      phases: { expansionWeeks: -3, reflectionWeeks: 999 },
      phaseColours: { expansion: 'chartreuse', reflection: 'mint' },
    },
  });
  assert.equal(config.cycles.state, 'qld', 'unknown state fell back');
  assert.deepEqual(config.cycles.boundaries, ['2026-02-01'], 'junk dates dropped, duplicates merged');
  assert.deepEqual(config.cycles.phases, { expansionWeeks: 2, reflectionWeeks: 2 }, 'absurd lengths fell back');
  assert.equal(config.cycles.phaseColours.expansion, 'apricot', 'unknown colour fell back');
  assert.equal(config.cycles.phaseColours.reflection, 'mint', 'a real colour was kept');
});

/*
 * A half-written term would shift every boundary after it without looking
 * wrong, which is the failure worth being strict about.
 */
test('a term missing an end, or ending before it starts, is dropped', () => {
  const config = normaliseConfig({
    ...defaultStoredConfig(),
    cycles: {
      ...defaultStoredConfig().cycles,
      terms: [
        { year: 2026, term: 1, start: '2026-01-27', end: '2026-04-02' },
        { year: 2026, term: 2, start: '2026-04-20' },
        { year: 2026, term: 3, start: '2026-09-18', end: '2026-07-13' },
        { year: 2026, term: 9, start: '2026-10-06', end: '2026-12-11' },
      ],
    },
  });
  assert.deepEqual(config.cycles.terms, [
    { year: 2026, term: 1, start: '2026-01-27', end: '2026-04-02' },
  ]);
});

test("a state with no bundled dates keeps its empty table rather than Queensland's", () => {
  const config = normaliseConfig({
    ...defaultStoredConfig(),
    cycles: { ...defaultStoredConfig().cycles, state: 'wa', terms: [], boundaries: [] },
  });
  assert.equal(config.cycles.state, 'wa');
  assert.deepEqual(config.cycles.terms, []);
  assert.deepEqual(config.cycles.boundaries, []);
});

test('a document written before cycles existed gains the defaults', () => {
  const old = defaultStoredConfig();
  delete old.cycles;
  const config = normaliseConfig(old);
  assert.equal(config.cycles.state, 'qld');
  assert.equal(config.cycles.terms.length, 12);
  assert.equal(config.cycles.boundaries.length, 12);
});
