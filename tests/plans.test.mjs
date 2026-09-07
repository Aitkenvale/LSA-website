import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PLANS, cycleMidpoint, monthsBetween, nameCycle, planAt, planCycleNumber, planEnd, planQuarterBoundaries,
} from '../src/lib/calendar/plans.ts';
import { BUNDLED_TERMS, boundariesFromTerms, cyclesFromBoundaries } from '../src/lib/calendar/school-terms.ts';

const NINE_YEAR = DEFAULT_PLANS.find((p) => p.name === 'Nine Year Plan');

test('whole months count a part-month as none', () => {
  assert.equal(monthsBetween('2022-04-22', '2022-05-21'), 0);
  assert.equal(monthsBetween('2022-04-22', '2022-05-22'), 1);
  assert.equal(monthsBetween('2022-04-22', '2026-08-06'), 51);
});

test('the Plan running on a day is the latest one to have begun', () => {
  assert.equal(planAt('2026-09-07', DEFAULT_PLANS).name, 'Nine Year Plan');
  assert.equal(planAt('2021-06-01', DEFAULT_PLANS).name, 'One Year Plan');
  assert.equal(planAt('2017-01-01', DEFAULT_PLANS).name, 'Five Year Plan');
  // The day a Plan begins belongs to it, not to the one before.
  assert.equal(planAt('2022-04-22', DEFAULT_PLANS).name, 'Nine Year Plan');
  assert.equal(planAt('2022-04-21', DEFAULT_PLANS).name, 'One Year Plan');
  assert.equal(planAt('2010-01-01', DEFAULT_PLANS), null);
});

test('a Plan runs until the next begins, and the last one is open', () => {
  const one = DEFAULT_PLANS.find((p) => p.name === 'One Year Plan');
  assert.equal(planEnd(one, DEFAULT_PLANS), '2022-04-21');
  assert.equal(planEnd(NINE_YEAR, DEFAULT_PLANS), null);
});

test('the midpoint of a cycle, not its first day, decides the Plan cycle', () => {
  assert.equal(cycleMidpoint('2026-06-27', '2026-09-18'), '2026-08-07');
  assert.equal(cycleMidpoint('2026-01-01', '2026-01-01'), '2026-01-01');
});

/*
 * The anchor the whole numbering rests on: the cycle running in September 2026
 * is the eighteenth of the Nine Year Plan — "183-18".
 */
test('September 2026 is cycle 18 of the Nine Year Plan', () => {
  const { label, number, plan } = nameCycle('2026-06-27', '2026-09-18', DEFAULT_PLANS);
  assert.equal(number, 18);
  assert.equal(plan.name, 'Nine Year Plan');
  assert.equal(label, 'Cycle 18 — Nine Year Plan');
});

test('the Plan cycle advances by one for each local cycle, without a repeat or a gap', () => {
  const cycles = cyclesFromBoundaries(boundariesFromTerms(BUNDLED_TERMS.qld));
  const nineYear = cycles.filter((c) => c.start >= '2022-04-22');
  const numbered = nineYear.map((c) => nameCycle(c.start, c.end, DEFAULT_PLANS).number);
  // Every cycle of the Nine Year Plan the term dates cover, in order.
  assert.deepEqual(numbered, Array.from({ length: numbered.length }, (_, i) => i + 2));
  // The anchor: September 2026 is the eighteenth.
  const now = cycles.find((c) => '2026-09-07' >= c.start && '2026-09-07' <= c.end);
  assert.equal(nameCycle(now.start, now.end, DEFAULT_PLANS).number, 18);
});

test('the Plan begins at cycle one', () => {
  assert.equal(planCycleNumber('2022-04-22', NINE_YEAR), 1);
  assert.equal(planCycleNumber('2022-07-21', NINE_YEAR), 1);
  assert.equal(planCycleNumber('2022-07-22', NINE_YEAR), 2);
  assert.equal(planCycleNumber('2022-04-21', NINE_YEAR), null, 'before the Plan began');
});

/*
 * A day either side of the stated Riḍván must not renumber anything: the
 * Universal House of Justice dates the Plan to Riḍván, and sources differ by a
 * day on which Gregorian date that is.
 */
test('a one-day shift in the Plan start changes no cycle number', () => {
  const shifted = { name: 'Nine Year Plan', start: '2022-04-21' };
  const cycles = cyclesFromBoundaries(boundariesFromTerms(BUNDLED_TERMS.qld));
  for (const c of cycles) {
    const mid = cycleMidpoint(c.start, c.end);
    assert.equal(planCycleNumber(mid, NINE_YEAR), planCycleNumber(mid, shifted), `differs at ${c.start}`);
  }
});

test('a cycle before any known Plan is named plainly rather than wrongly', () => {
  const { label, plan, number } = nameCycle('2010-01-01', '2010-03-31', DEFAULT_PLANS);
  assert.equal(plan, null);
  assert.equal(number, null);
  assert.equal(label, 'Cycle');
});

test('browsing into a Plan that has been added takes its name', () => {
  const plans = [...DEFAULT_PLANS, { name: 'Ten Year Plan', start: '2031-04-21' }];
  // The cycle straddling Riḍván is the new Plan's first; the one after it, the
  // second — the same shape as 2026, where June to September is cycle 18.
  assert.equal(nameCycle('2031-04-05', '2031-06-26', plans).label, 'Cycle 1 — Ten Year Plan');
  assert.equal(nameCycle('2031-06-27', '2031-09-18', plans).label, 'Cycle 2 — Ten Year Plan');
  // Until it begins, the Plan before it still names the cycle.
  assert.equal(nameCycle('2031-01-05', '2031-04-04', plans).plan.name, 'Nine Year Plan');
});

test('plans given out of order are still read in sequence', () => {
  const jumbled = [DEFAULT_PLANS[2], DEFAULT_PLANS[0], DEFAULT_PLANS[1]];
  assert.equal(planAt('2021-06-01', jumbled).name, 'One Year Plan');
});

// ---- reaching back before the term dates ----------------------------------

test('the Plan supplies boundaries where the local dates run out', () => {
  const boundaries = planQuarterBoundaries(DEFAULT_PLANS, '2026-04-03');
  assert.ok(boundaries.length > 0);
  assert.equal(boundaries[0], '2016-04-20', 'starts at the earliest Plan');
  assert.ok(boundaries.every((b) => b < '2026-04-03'), 'never overlaps the real dates');
  // Quarters, three months apart, within a Plan.
  assert.deepEqual(boundaries.slice(0, 4), ['2016-04-20', '2016-07-20', '2016-10-20', '2017-01-20']);
});

test('each Plan restarts its own quarters at its Riḍván', () => {
  const boundaries = planQuarterBoundaries(DEFAULT_PLANS, '2026-04-03');
  // The One Year Plan begins 20 April 2021 and the Nine Year Plan 22 April
  // 2022, so each appears rather than the first Plan's grid running on.
  assert.ok(boundaries.includes('2021-04-20'));
  assert.ok(boundaries.includes('2022-04-22'));
  // No boundary sits within six weeks of the Plan that follows it, which
  // would otherwise leave a two-day cycle at the handover.
  for (const start of ['2021-04-20', '2022-04-22']) {
    const stub = boundaries.filter(
      (b) => b < start && (new Date(start) - new Date(b)) / 86400000 < 42,
    );
    assert.deepEqual(stub, [], `stub cycle before ${start}`);
  }
});

test('no stub cycle is left against the first real boundary', () => {
  const boundaries = planQuarterBoundaries(DEFAULT_PLANS, '2026-04-03');
  const last = boundaries[boundaries.length - 1];
  const days = (new Date('2026-04-03') - new Date(last)) / 86400000;
  assert.ok(days >= 42, `last fallback boundary is only ${days} days before the real one`);
});

test('the backfilled cycles number continuously into the real ones', () => {
  const real = boundariesFromTerms(BUNDLED_TERMS.qld);
  const all = [...planQuarterBoundaries(DEFAULT_PLANS, real[0]), ...real];
  const cycles = cyclesFromBoundaries(all);
  const numbers = cycles.map((c) => nameCycle(c.start, c.end, DEFAULT_PLANS).number);
  // Cycle 1 of the Five Year Plan through to the far end, with no gap or
  // repeat where the Plan's dates hand over to Queensland's.
  assert.equal(numbers[0], 1);
  // Cycle 1 of a Plan is the one Riḍván falls inside, not the first to begin
  // after it — the local cycle straddles the Plan's opening day.
  const opens = cycles.findIndex((c) => '2022-04-22' >= c.start && '2022-04-22' <= c.end);
  assert.equal(numbers[opens], 1, 'the Nine Year Plan restarts at one');
  assert.equal(numbers[opens + 1], 2);
  const handover = cycles.findIndex((c) => c.start === real[0]);
  assert.ok(handover > 0, 'the fallback supplies cycles before the term dates');
  assert.equal(numbers[handover] - numbers[handover - 1], 1, 'no gap at the handover');
  assert.ok(cycles[handover - 1].end < cycles[handover].start, 'no overlap at the handover');
  // And the anchor still holds across the joined series.
  const now = cycles.find((c) => '2026-09-07' >= c.start && '2026-09-07' <= c.end);
  assert.equal(nameCycle(now.start, now.end, DEFAULT_PLANS).label, 'Cycle 18 — Nine Year Plan');
});
