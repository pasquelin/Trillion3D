// The flicker measure of the temporal resolve (`shadingHistoryWgsl.ts`), run from its shipped
// text: the flicker count and its fade-in, the error, and what moving and transparent pixels keep.
// What reads it — the still mask, the confidence, the curve — is `shadingStill.test.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { FLICKER_COUNT_RATE, SHADING_HISTORY_WGSL, flickerParallax } from './shadingHistoryWgsl.ts';
import { stillViewFields, taaBuiltins } from './taaBuiltins.fixture.ts';

/** The ghosting update's share, the fade of the flicker totals, and the most the count holds. */
const FLICKER_GHOSTING = 0.05,
  FLICKER_COUNT_MAX = 20;
type Moire = { luma: number; gradient: number; variation: number; count: number; error: number };
type Shading = {
  shadingMoire: (
    ...args: [number, number, number, number[], number[], number[], number, number]
  ) => Moire;
};
const { shadingMoire } = shaderRun<Shading>(SHADING_HISTORY_WGSL, ['shadingMoire'], {
  ...taaBuiltins,
  view: { tsr: [1, 0, 0, 0], ...stillViewFields(1920) },
});

/** The measure as the history stores it: the gradient in the share target's eight bits, the total
 *  in a byte, the count already quantised (`shadingPack`). */
const stored = (m: Moire) => [
  m.luma,
  Math.round(m.gradient * 127 + 127) / 127 - 1,
  Math.round(m.variation * 255) / 255,
  m.count,
];

/**
 * A still pixel image after image, its whole 3×3 `swing` above (`+1`) or below (`−1`) a luma
 * history of 0.5 as `pattern(t)` says — each image a full rejection of the history —, the measure
 * fed back as stored. Returns each image's count (as stored, out of 20) and error.
 */
function flickers(
  pattern: (t: number) => number,
  images: number,
  still = 1,
  cover = 0,
  swing = 0.2,
) {
  let prev = [0.5, 0, 0, 0];
  return Array.from({ length: images }, (_, t) => {
    const now = 0.5 + pattern(t) * swing,
      box = [now - 0.01, now + 0.01];
    const m = shadingMoire(now, now, 0.5, box, box, [0.5, ...prev.slice(1)], still, cover);
    prev = stored(m);
    return { count: m.count * FLICKER_COUNT_MAX, error: m.error, gradient: m.gradient };
  });
}
const everyImage = (t: number) => (t % 2 ? 1 : -1);
const everySecond = (t: number) => (Math.floor(t / 2) % 2 ? 1 : -1);

test('the count limits and their fade-in, at a period of two images: the analytic cases', () => {
  const rate = FLICKER_COUNT_RATE;
  assert.ok(Math.abs(rate - (1 - 0.95 ** 2)) < 1e-12);
  const fade = (count: number) => Math.min(Math.max(count * rate - 0.5, 0), 1);
  assert.equal(fade(1), 0, 'one flicker');
  const second = 1 / (1 - (1 - FLICKER_GHOSTING) ** 2);
  assert.ok(Math.abs(second - 10.256) < 1e-3, `a flicker every second image: ${second}`);
  assert.ok(Math.abs(fade(second) - 0.5) < 1e-3);
  const every = 1 / FLICKER_GHOSTING;
  assert.equal(every, 20);
  assert.equal(fade(every), 1, 'a flicker every image');
});

test('one flicker gives no error; a flicker every image the full count, faded in', () => {
  const once = flickers((t) => (t < 30 ? 1 : -1), 40);
  assert.ok(
    once.every(({ error }) => error === 0),
    'one flicker: nothing',
  );
  assert.ok(once[30].count > 0.9 && once[30].count < 1, `counted once, ${once[30].count}`);
  const every = flickers(everyImage, 200).at(-1)!;
  // The eight-bit count, floored to 20/255 each image, settles a little under twenty.
  assert.ok(every.count > 18.4 && every.count <= 20, `count ${every.count}`);
  assert.ok(every.error > 0.15, `faded in whole: error ${every.error}`);
});

test('a flicker every second image holds about ten counts, half faded in', () => {
  const tail = flickers(everySecond, 200).slice(-4);
  // Its analytic 10.26 and 0.5, less the count's floor to 20/255 each image: 9.5 and 0.43.
  const peak = Math.max(...tail.map(({ count }) => count));
  assert.ok(peak > 9.3 && peak < 10.27, `count ${peak}`);
  const fade = (count: number) => Math.min(Math.max(count * FLICKER_COUNT_RATE - 0.5, 0), 1);
  assert.ok(fade(peak) > 0.4 && fade(peak) <= 0.5, `fade ${fade(peak)}`);
  const error = Math.max(...tail.map((image) => image.error));
  assert.ok(error > 0 && error < flickers(everyImage, 200).at(-1)!.error, `error ${error}`);
});

test('a change that holds, or one within the gradient’s rounding, is no flicker', () => {
  // The same side every image: the gradient adds up, nothing is counted.
  const held = flickers(() => 1, 40);
  assert.ok(held.every(({ count, error }) => count === 0 && error === 0));
  assert.ok(held.at(-1)!.gradient > held[0].gradient, 'the accumulated gradient grows');
  // A swing under 1/127 of the luma history's rejection: rounding, not a flicker.
  const small = flickers(everyImage, 60, 1, 0, 0.004);
  assert.ok(
    small.every(({ count }) => count === 0),
    `${small.at(-1)!.count}`,
  );
});

test('a history within the box is not rejected: no gradient, the luma follows at 5 %', () => {
  const box = [0.4, 0.6];
  const m = shadingMoire(0.55, 0.52, 0.5, box, box, [0.5, 0.3, 0.2, 0.5], 1, 0);
  assert.equal(m.gradient, 0.3 * 0.95, 'only the accumulated gradient, faded');
  assert.ok(Math.abs(m.luma - (0.5 + 0.05 * 0.02)) < 1e-9);
});

test('a moving pixel keeps no flicker totals and no error, a transparent one less of both', () => {
  const moving = flickers(everyImage, 120, 0);
  assert.ok(moving.every(({ count, error }) => count <= 1 && error === 0));
  // Half still (parallax half past its limit): the totals fade faster, the error is halved.
  const half = flickers(everyImage, 200, 0.5).at(-1)!;
  const whole = flickers(everyImage, 200).at(-1)!;
  assert.ok(half.count < 2.1, `half still: count ${half.count}`);
  assert.ok(half.error < whole.error);
  // Transparents over the pixel take their coverage off the gradient and off the error.
  const covered = flickers(everyImage, 200, 1, 0.1).at(-1)!;
  assert.ok(covered.error < whole.error - 0.09, `${covered.error} against ${whole.error}`);
  const veiled = flickers(everyImage, 120, 1, 0.5);
  assert.ok(
    veiled.every(({ count, error }) => count === 0 && error === 0),
    'a veil hides the swing',
  );
});

test('the flicker rates are counted in images: two a period, five 1080p pixels an image', () => {
  assert.ok(Math.abs(FLICKER_COUNT_RATE - (1 - (1 - FLICKER_GHOSTING) ** 2)) < 1e-12);
  assert.ok(
    Math.abs(1 / flickerParallax(1920) - 5) < 1e-9,
    'five 1080p pixels an image at 120 Hz, the limit of ten at 60 Hz',
  );
  assert.ok(Math.abs(1 / flickerParallax(3840) - 10) < 1e-9, 'five 1080p pixels at 4K: 10');
});
