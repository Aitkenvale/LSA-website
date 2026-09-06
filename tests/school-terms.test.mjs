import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AU_STATES, BUNDLED_TERMS, CYCLES_SHOWN, DEFAULT_PHASE_PLAN, PASTEL_COLOURS, PHASES,
  boundariesFromTerms, canLoadTerms, cycleContaining, cycleWeekStarts, cyclesFromBoundaries,
  holidayStart, isAuState, pastelValue, phaseForWeek, phaseRuns, startOfWeek, upcomingCycles,
} from '../src/lib/calendar/school-terms.ts';
import { weekday } from '../src/lib/calendar/astronomy.ts';

const SAT = 6, SUN = 0, MON = 1;

test('every state and territory is offered', () => {
  assert.equal(AU_STATES.length, 8);
  assert.ok(isAuState('qld'));
  assert.ok(!isAuState('nz'));
});

/*
 * New South Wales is deliberately absent. It publishes a school-days CSV that
 * looks like the right thing but stops at 2025 and is marked "Not updated
 * anymore", and a loader that quietly returns stale dates is worse than none.
 */
test('only Victoria can fetch its term dates', () => {
  assert.ok(canLoadTerms('vic'));
  assert.ok(!canLoadTerms('nsw'));
  assert.ok(!canLoadTerms('qld'));
});

/*
 * The weekday of every bundled date is asserted against the day the department
 * printed beside it. A transcription slip moves a date by days, not weeks, so
 * a wrong entry almost always lands on the wrong weekday and is caught here.
 */
test('bundled Queensland dates fall on the weekdays the department published', () => {
  const printed = [
    ['2026-01-27', 2], ['2026-04-02', 4], ['2026-04-20', 1], ['2026-06-26', 5],
    ['2026-07-13', 1], ['2026-09-18', 5], ['2026-10-06', 2], ['2026-12-11', 5],
    ['2027-01-27', 3], ['2027-03-25', 4], ['2027-04-12', 1], ['2027-06-25', 5],
    ['2027-07-12', 1], ['2027-09-17', 5], ['2027-10-05', 2], ['2027-12-10', 5],
    ['2028-01-24', 1], ['2028-03-31', 5], ['2028-04-18', 2], ['2028-06-23', 5],
    ['2028-07-10', 1], ['2028-09-15', 5], ['2028-10-03', 2], ['2028-12-08', 5],
  ];
  for (const [iso, day] of printed) {
    assert.equal(weekday(iso), day, `${iso} is not on the published weekday`);
  }
  const qld = BUNDLED_TERMS.qld;
  assert.equal(qld.length, 12);
  const flat = qld.flatMap((t) => [t.start, t.end]);
  assert.deepEqual(flat, printed.map(([iso]) => iso), 'table order changed');
  for (const t of qld) assert.ok(t.start < t.end);
});

test('a cycle begins the morning after term ends, whatever day that is', () => {
  // Term 1 2026 ends on the Thursday before Good Friday, not a Friday.
  assert.equal(holidayStart('2026-04-02'), '2026-04-03');
  assert.equal(holidayStart('2026-06-26'), '2026-06-27');
  // A year boundary is not a special case.
  assert.equal(holidayStart('2026-12-31'), '2027-01-01');
});

test('Queensland gives three twelve-week cycles and a long summer', () => {
  const cycles = cyclesFromBoundaries(boundariesFromTerms(BUNDLED_TERMS.qld));
  assert.deepEqual(
    cycles.slice(0, 5).map((c) => [c.start, c.weeks]),
    [
      ['2026-04-03', 12],
      ['2026-06-27', 12],
      ['2026-09-19', 12],
      ['2026-12-12', 15],
      ['2027-03-26', 13],
    ],
  );
});

test('cycles are contiguous and numbered in order', () => {
  const cycles = cyclesFromBoundaries(boundariesFromTerms(BUNDLED_TERMS.qld));
  for (let i = 0; i < cycles.length; i += 1) {
    assert.equal(cycles[i].number, i + 1);
    if (i) {
      const prev = cycles[i - 1];
      assert.ok(prev.end < cycles[i].start, 'cycles overlap');
      assert.equal(new Date(cycles[i].start) - new Date(prev.end), 86400000, 'gap between cycles');
    }
  }
});

test('the final boundary yields no cycle, because its end is not yet known', () => {
  const boundaries = boundariesFromTerms(BUNDLED_TERMS.qld);
  const cycles = cyclesFromBoundaries(boundaries);
  assert.equal(cycles.length, boundaries.length - 1);
  assert.ok(cycles.at(-1).end < boundaries.at(-1));
});

test('today falls inside exactly one cycle', () => {
  const cycles = cyclesFromBoundaries(boundariesFromTerms(BUNDLED_TERMS.qld));
  const found = cycleContaining('2026-09-07', cycles);
  assert.equal(found.start, '2026-06-27');
  assert.equal(found.end, '2026-09-18');
  assert.equal(cycleContaining('2025-06-01', cycles), null);
});

/*
 * A finished cycle cannot be planned, so it drops off rather than accumulating.
 * The list always opens on the cycle now running.
 */
test('the planner shows the running cycle and the eight after it', () => {
  const boundaries = boundariesFromTerms(BUNDLED_TERMS.qld);
  const shown = upcomingCycles(boundaries, '2026-09-07');
  assert.equal(shown[0].start, '2026-06-27', 'opens on the cycle now running');
  assert.ok(shown[0].end >= '2026-09-07');
  assert.ok(shown.length <= CYCLES_SHOWN);

  // A day later in the year and the first has gone, the rest moved up.
  const later = upcomingCycles(boundaries, '2026-09-19');
  assert.equal(later[0].start, '2026-09-19');
  assert.deepEqual(later.slice(0, 3).map((c) => c.start), shown.slice(1, 4).map((c) => c.start));
});

test('the last day of a cycle still counts as running', () => {
  const boundaries = boundariesFromTerms(BUNDLED_TERMS.qld);
  assert.equal(upcomingCycles(boundaries, '2026-09-18')[0].start, '2026-06-27');
  assert.equal(upcomingCycles(boundaries, '2026-09-19')[0].start, '2026-09-19');
});

test('no boundaries means no cycles rather than invented ones', () => {
  assert.deepEqual(upcomingCycles([], '2026-09-07'), []);
  assert.deepEqual(cyclesFromBoundaries(boundariesFromTerms([])), []);
  assert.equal(BUNDLED_TERMS.wa, undefined);
});

test('duplicate and unsorted boundaries are tolerated', () => {
  const cycles = cyclesFromBoundaries(['2026-06-27', '2026-01-03', '2026-06-27', '2026-04-04']);
  assert.deepEqual(cycles.map((c) => c.start), ['2026-01-03', '2026-04-04']);
});

// ---- the grid's weeks ------------------------------------------------------

test('a cycle reaches back to the reader\'s first day of the week', () => {
  // 27 June 2026 is a Saturday.
  assert.equal(startOfWeek('2026-06-27', 6), '2026-06-27');
  assert.equal(startOfWeek('2026-06-27', 0), '2026-06-21');
  assert.equal(startOfWeek('2026-06-27', 1), '2026-06-22');
});

test('a twelve-week cycle occupies twelve rows when the week starts with it', () => {
  const cycle = cyclesFromBoundaries(boundariesFromTerms(BUNDLED_TERMS.qld))[1];
  assert.equal(cycle.start, '2026-06-27');
  assert.equal(cycleWeekStarts(cycle, 6).length, 12);
  // Starting the week elsewhere adds the row that reaches back to it.
  assert.equal(cycleWeekStarts(cycle, 0).length, 13);
});

// ---- phases ----------------------------------------------------------------

test('expansion opens the cycle, reflection closes it, consolidation fills', () => {
  const plan = DEFAULT_PHASE_PLAN;
  const of = (w) => phaseForWeek(w, 12, plan);
  assert.deepEqual([1, 2].map(of), ['expansion', 'expansion']);
  assert.deepEqual([3, 10].map(of), ['consolidation', 'consolidation']);
  assert.deepEqual([11, 12].map(of), ['reflection', 'reflection']);
});

test('a longer cycle lengthens consolidation, not the two fixed phases', () => {
  const runs = phaseRuns(16, DEFAULT_PHASE_PLAN);
  assert.deepEqual(runs.map((r) => [r.phase, r.weeks]), [
    ['expansion', 2], ['consolidation', 12], ['reflection', 2],
  ]);
});

/*
 * A cycle short enough for the two fixed phases to collide would otherwise put
 * one week in two phases at once.
 */
test('phases never overlap, however short the cycle', () => {
  for (const total of [1, 2, 3, 4, 5]) {
    const runs = phaseRuns(total, { expansionWeeks: 3, reflectionWeeks: 3 });
    assert.equal(runs.reduce((n, r) => n + r.weeks, 0), total, `weeks lost at ${total}`);
    for (let w = 1; w <= total; w += 1) {
      const matches = runs.filter((r) => w >= r.from && w < r.from + r.weeks);
      assert.equal(matches.length, 1, `week ${w} of ${total} is in ${matches.length} phases`);
    }
  }
});

test('a phase asked for no weeks simply does not appear', () => {
  const runs = phaseRuns(12, { expansionWeeks: 0, reflectionWeeks: 2 });
  assert.deepEqual(runs.map((r) => r.phase), ['consolidation', 'reflection']);
});

test('every phase has a name and a pastel that resolves', () => {
  assert.deepEqual(PHASES.map((p) => p.id), ['expansion', 'consolidation', 'reflection']);
  assert.equal(PHASES[2].name, 'Planning & Reflection');
  for (const c of PASTEL_COLOURS) assert.match(pastelValue(c.id), /^#[0-9a-f]{6}$/);
  assert.equal(pastelValue('not-a-colour'), PASTEL_COLOURS[0].value);
});
