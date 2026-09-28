import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewLimit } from './lightCutViewLimit.ts';

/** A limit of 24 views bisected down to 15, the most views the catalogue holds. */
function settledAt15() {
  const limit = createViewLimit(24);
  for (const [count, dropped] of [
    [24, true],
    [12, false],
    [18, true],
    [15, false],
    [16, true],
  ] as const)
    limit.read(count, dropped);
  assert.equal(limit.value, 15, 'bisected to what fits');
  return limit;
}

/** Runs `batches` batches at the limit against a catalogue that holds `holds` views; returns the
 *  drops and the most views a batch drew in. */
function run(
  limit: ReturnType<typeof createViewLimit>,
  holds: number,
  batches: number,
  moves: boolean,
) {
  let drops = 0,
    most = 0;
  for (let i = 0; i < batches; i++) {
    if (moves) limit.residencyChanged();
    const views = limit.value;
    most = Math.max(most, views);
    if (views > holds) drops++;
    limit.read(views, views > holds);
  }
  return { drops, most };
}

// #525: a residency change reset the limit to `viewCap`, so the next batch dropped and its pages
// were drawn again in full.
test('a residency change after a drop keeps the limit below the count that dropped', () => {
  const limit = settledAt15();
  limit.residencyChanged();
  assert.equal(limit.value, 15, 'not back to 24');
});

// Streaming moves residency every frame: with a catalogue that stays the same, the probes above the
// limit thin out (patience doubles), no drop and redraw per residency change.
test('repeated residency changes with a stable catalogue drop no batch per change', () => {
  const { drops, most } = run(settledAt15(), 15, 64, true);
  assert.equal(most, 16, 'only one view above what fits is ever probed');
  assert.ok(drops <= Math.log2(64), `${drops} drops in 64 residency changes`);
});

// A residency change that lets more views fit: batches at the limit fit, and the limit climbs a
// view at a time to what fits now, never straight back to a count that dropped before.
test('the limit grows back when batches at the limit fit after a residency change', () => {
  const limit = settledAt15();
  limit.residencyChanged();
  const { drops, most } = run(limit, 20, 12, false);
  assert.equal(limit.value, 20, 'grown to what the catalogue now holds');
  assert.equal(most, 21, 'never above one view past what fits');
  assert.equal(drops, 1, 'one probe past what fits dropped');
});

// A probe frame whose batches carry different work: one fits at the probed count, the next drops at
// it. The drop wins, whichever is read first, and the probes still thin out.
test('a probe that both fits and drops backs off like one that drops', () => {
  for (const order of [
    [false, true],
    [true, false],
  ]) {
    const limit = settledAt15();
    let drops = 0;
    for (let i = 0; i < 64; i++) {
      limit.residencyChanged();
      const views = limit.value;
      assert.ok(views <= 16, 'never above one view past what fitted');
      if (views <= 15) {
        limit.read(views, false);
        continue;
      }
      for (const dropped of order) limit.read(views, dropped);
      drops++;
      assert.equal(limit.value, 15, 'a count that dropped is not kept');
    }
    assert.ok(drops <= Math.log2(64), `${drops} mixed probes in 64 residency changes`);
  }
});
