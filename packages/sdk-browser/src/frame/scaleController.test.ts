import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshClock, createScaleController, nextScale } from './scaleController.ts';

/** 120 Hz: the boss's display. */
const BUDGET = 1000 / 120;

/** Runs `frames` frames of a synthetic `cost = k·s²`, times `noise(frame)`; returns the scales. */
function run(k: number, frames: number, noise = (_frame: number) => 1, min = 0.5, max = 1) {
  const c = createScaleController(min, max, BUDGET),
    scales: number[] = [];
  for (let frame = 0; frame < frames; frame++)
    scales.push(nextScale(c, k * c.s * c.s * noise(frame)));
  return { c, scales };
}

/** A small deterministic noise of ±5 %. */
const jitter = (frame: number) => 1 + 0.05 * Math.sin(frame * 1.7);

test('a scene over budget settles within 60 frames, on target, without oscillating', () => {
  // Sponza at the boss's size: 23.1 ms at s = 1 (#685).
  const { scales } = run(23.1, 400, jitter);
  const settled = scales[59];
  const cost = 23.1 * settled * settled;
  assert.ok(cost <= BUDGET, `settled cost ${cost} holds the budget`);
  assert.ok(cost >= 0.7 * BUDGET, `settled cost ${cost} does not waste it`);
  assert.equal(new Set(scales.slice(59)).size, 1, 'no step after settling');
});

test('a scene under budget stays at the maximum', () => {
  const { scales } = run(4, 200, jitter);
  assert.ok(scales.every((s) => s === 1));
});

test('a lighter scene climbs back once its time sits under the dead band', () => {
  const c = createScaleController(0.5, 1, BUDGET);
  for (let frame = 0; frame < 60; frame++) nextScale(c, 23.1 * c.s * c.s);
  const low = c.s;
  for (let frame = 0; frame < 200; frame++) nextScale(c, 5 * c.s * c.s);
  assert.ok(c.s > low, 'the scale went up');
  assert.ok(5 * c.s * c.s <= BUDGET, 'and still holds the budget');
});

test('a spike drops the scale at the very frame it is measured', () => {
  const c = createScaleController(0.5, 1, BUDGET);
  for (let frame = 0; frame < 60; frame++) nextScale(c, 6 * c.s * c.s);
  assert.equal(c.s, 1);
  nextScale(c, 2 * BUDGET);
  assert.ok(c.s < 1, 'dropped within one frame');
});

test('the scale never leaves [min, max]', () => {
  for (const k of [0.1, 3, 23.1, 400]) {
    const { scales } = run(k, 300, jitter, 0.6, 0.9);
    assert.ok(
      scales.every((s) => s >= 0.6 && s <= 0.9),
      `k = ${k}`,
    );
  }
});

test('the refresh interval is the shortest frame interval, pauses aside', () => {
  const clock = createRefreshClock(1000 / 60);
  assert.equal(clock.interval, 1000 / 60, 'the fallback before any frame');
  let now = 0;
  for (const gap of [0, 8.4, 16.7, 8.3, 500, 9]) clock.tick((now += gap));
  assert.ok(Math.abs(clock.interval - 8.3) < 1e-9);
});

/** The refresh measured from frames drawn every `frameMs` on a display refreshing every `vsyncMs`:
 *  each frame begins at the first refresh after it is ready, as rAF does. */
function measured(vsyncMs: number, frameMs: number) {
  const clock = createRefreshClock(1000 / 60);
  for (let frame = 0; frame < 60; frame++)
    clock.tick(Math.ceil((frame * frameMs) / vsyncMs - 1e-9) * vsyncMs);
  return clock.interval;
}

// #1343: the budget follows the display, no fixed cap; slow frames never pass for a slow display.
test('the refresh budget follows the display, a device that misses its cadence included', () => {
  assert.ok(Math.abs(measured(1000 / 120, 1000 / 120) - 8.33) < 0.01, '120 Hz: 8.3 ms');
  assert.ok(Math.abs(measured(1000 / 60, 1000 / 60) - 16.67) < 0.01, '60 Hz: 16.7 ms');
  assert.ok(Math.abs(measured(1000 / 120, 1000 / 16) - 8.33) < 0.01, '16 fps at 120 Hz: 8.3 ms');
});
