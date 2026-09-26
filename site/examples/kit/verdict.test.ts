import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/scene/light/contracts.ts';
import { failures } from './failure.ts';
import { BUDGETS, healthCheck, type Counters as Metrics } from './verdict.ts';

/** Draws `count` frames of `part`, `gap` ms apart, each with `metrics(k)`, and returns the
 *  verdict's lines as name → [green, motif]. */
function judged(
  frames: [part: string, count: number, gap: number, metrics: (k: number) => Metrics][],
  refused: string[] = [],
) {
  let now = 0,
    part: string | null = null;
  const hooks: ((frame: { metrics: Metrics }) => void)[] = [];
  mock.method(performance, 'now', () => now);
  const check = healthCheck({ onFrame: (hook) => (hooks.push(hook), () => {}) }, () => part);
  for (const [name, count, gap, metrics] of frames) {
    part = name;
    for (let k = 0; k < count; k++, now += gap)
      hooks.forEach((hook) => hook({ metrics: metrics(k) }));
  }
  refused.forEach(check.refuse);
  mock.restoreAll();
  const verdict = check.verdict();
  return {
    correct: verdict.correct,
    lines: Object.fromEntries(
      verdict.resultats.map((line) => [line.name, [line.correct, line.motif]]),
    ),
  };
}

const healthy = () => ({ gpuFrameMs: 6, shadowPagesDrawn: 3, shadowPagesRefetched: 40 });

test('a part drawn at 120 Hz within its budgets is green on every line, part by part', () => {
  const { correct, lines } = judged([
    ['close', 121, 1000 / 120, healthy],
    ['far', 61, 1000 / 120, healthy],
  ]);
  assert.equal(correct, true);
  assert.deepEqual(lines['close: FPS'], [true, '120 ≥ 60']);
  assert.deepEqual(lines['far: GPU frame'], [true, '6.00 ms ≤ 16.67 ms']);
  assert.deepEqual(lines['far: shadow pages drawn'], [true, '3 ≤ 24']);
  assert.deepEqual(lines['close: shadow pages refetched'], [true, '0 ≤ 0']);
  assert.deepEqual(lines.refused, [true, '—']);
});

test("the shadow pages a part may draw a frame are one of the engine's batches", () => {
  assert.equal(BUDGETS.shadowPagesDrawn, LIGHT_SETTINGS.shadowPagesPerBatch);
});

test('a slowed build turns its rate line red, and the overall verdict with it', () => {
  const { correct, lines } = judged([['still', 31, 1000 / 30, healthy]]);
  assert.equal(correct, false);
  assert.deepEqual(lines['still: FPS'], [false, '30 ≥ 60']);
  assert.equal(lines['still: GPU frame'][0], true);
});

test('each counter over its budget turns its own line red; one the engine does not measure is neither', () => {
  const { lines } = judged([
    [
      'pan',
      11,
      10,
      (k) => ({ gpuFrameMs: 20, shadowPagesDrawn: k < 5 ? 2 : 90, shadowPagesRefetched: k }),
    ],
    ['close', 11, 10, () => ({ gpuFrameMs: null, shadowPagesDrawn: null })],
    ['far', 1, 10, healthy],
  ]);
  assert.deepEqual(lines['far: FPS'], [null, '—']);
  assert.deepEqual(lines['pan: GPU frame'], [false, '20.00 ms ≤ 16.67 ms']);
  assert.deepEqual(lines['pan: shadow pages drawn'], [false, '90 ≤ 24']);
  assert.deepEqual(lines['pan: shadow pages refetched'], [false, '10 ≤ 0']);
  for (const quantity of ['GPU frame', 'shadow pages drawn', 'shadow pages refetched'])
    assert.deepEqual(lines[`close: ${quantity}`], [null, '—']);
});

test('what a backend refuses and every uncaught error are one red line; frames outside a part count nowhere', () => {
  failures.add('boom');
  const { correct, lines } = judged(
    [[null as never, 10, 10, healthy]],
    ['no shadows', 'no toon', 'no shadows'],
  );
  assert.equal(correct, false);
  assert.deepEqual(Object.keys(lines), ['refused']);
  assert.deepEqual(lines.refused, [false, 'boom; no shadows; no toon']);
});
