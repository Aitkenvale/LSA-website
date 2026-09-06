import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AU_STATES, BUNDLED_TERMS, SERIES_START, alignOnOrAfter, boundariesFromTerms,
  canLoadTerms, cycleContaining, cycleStartAfter, cyclesFromBoundaries, isAuState,
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

test('a cycle begins on the first chosen weekday after term ends', () => {
  // Term 1 2026 ends on the Thursday before Good Friday, not a Friday.
  assert.equal(cycleStartAfter('2026-04-02', SAT), '2026-04-04');
  assert.equal(cycleStartAfter('2026-04-02', SUN), '2026-04-05');
  assert.equal(cycleStartAfter('2026-04-02', MON), '2026-04-06');
  // A Friday end, the ordinary case.
  assert.equal(cycleStartAfter('2026-06-26', SAT), '2026-06-27');
  assert.equal(cycleStartAfter('2026-06-26', SUN), '2026-06-28');
});

test('a term ending the day before the chosen weekday does not skip a week', () => {
  // Friday end, Saturday start: the very next day, not eight days later.
  assert.equal(cycleStartAfter('2026-06-26', SAT), '2026-06-27');
  // A term ending on the chosen weekday itself still yields the following week.
  assert.equal(cycleStartAfter('2026-06-27', SAT), '2026-07-04');
});

test('alignOnOrAfter keeps a date that already falls on the day', () => {
  assert.equal(weekday('2026-01-03'), SAT);
  assert.equal(alignOnOrAfter('2026-01-03', SAT), '2026-01-03');
  assert.equal(alignOnOrAfter('2026-01-01', SAT), '2026-01-03');
});

test('Queensland 2026 gives three twelve-week cycles and a long summer', () => {
  const boundaries = boundariesFromTerms(BUNDLED_TERMS.qld, SAT);
  const cycles = cyclesFromBoundaries(boundaries);

  // The series opens at the start of 2026 because the December 2025 boundary
  // is no longer published anywhere official.
  assert.equal(cycles[0].start, '2026-01-03');
  assert.equal(alignOnOrAfter(SERIES_START, SAT), '2026-01-03');

  const named = cycles.map((c) => [c.start, c.weeks]);
  assert.deepEqual(named.slice(0, 5), [
    ['2026-01-03', 13],
    ['2026-04-04', 12],
    ['2026-06-27', 12],
    ['2026-09-19', 12],
    ['2026-12-12', 15],
  ]);
});

test('cycles are contiguous, whole weeks, and numbered in order', () => {
  const cycles = cyclesFromBoundaries(boundariesFromTerms(BUNDLED_TERMS.qld, SUN));
  for (let i = 0; i < cycles.length; i += 1) {
    assert.equal(cycles[i].number, i + 1);
    assert.equal(weekday(cycles[i].start), SUN);
    assert.ok(cycles[i].weeks >= 11 && cycles[i].weeks <= 17, `odd length ${cycles[i].weeks}`);
    if (i) {
      const prev = cycles[i - 1];
      assert.ok(prev.end < cycles[i].start, 'cycles overlap');
      assert.equal(new Date(cycles[i].start) - new Date(prev.end), 86400000, 'gap between cycles');
    }
  }
});

test('the final boundary yields no cycle, because its end is not yet known', () => {
  const boundaries = boundariesFromTerms(BUNDLED_TERMS.qld, SAT);
  const cycles = cyclesFromBoundaries(boundaries);
  assert.equal(cycles.length, boundaries.length - 1);
  assert.ok(cycles.at(-1).end < boundaries.at(-1));
});

test('today falls inside a cycle, and outside every other', () => {
  const cycles = cyclesFromBoundaries(boundariesFromTerms(BUNDLED_TERMS.qld, SAT));
  const found = cycleContaining('2026-09-07', cycles);
  assert.equal(found.start, '2026-06-27');
  assert.equal(found.end, '2026-09-18');
  assert.equal(cycles.filter((c) => '2026-09-07' >= c.start && '2026-09-07' <= c.end).length, 1);
  assert.equal(cycleContaining('2025-06-01', cycles), null);
});

test('duplicate and unsorted boundaries are tolerated', () => {
  const cycles = cyclesFromBoundaries(['2026-06-27', '2026-01-03', '2026-06-27', '2026-04-04']);
  assert.deepEqual(cycles.map((c) => c.start), ['2026-01-03', '2026-04-04']);
});

test('a state with no bundled dates yields no cycles rather than invented ones', () => {
  assert.equal(BUNDLED_TERMS.wa, undefined);
  assert.deepEqual(cyclesFromBoundaries(boundariesFromTerms([], SAT)), []);
});
