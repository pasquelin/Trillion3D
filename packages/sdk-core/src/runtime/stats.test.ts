import test from 'node:test';
import assert from 'node:assert/strict';
import { frameStatistics, STUTTER_MS, summarize } from './stats.ts';

test('summary sorts numerically, preserves the input, and reports ranks rather than interpolation', () => {
  const values = [100, 1, 5, 4, 3, 2];
  assert.deepEqual(summarize(values), { mean: 115 / 6, p50: 3, p95: 100, p99: 100, max: 100 });
  assert.deepEqual(values, [100, 1, 5, 4, 3, 2]);
  assert.deepEqual(summarize([10, 20, 30, 40, 60]), {
    mean: 32,
    p50: 30,
    p95: 60,
    p99: 60,
    max: 60,
  });
  assert.deepEqual(summarize([0]), { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  for (const values of [[], [1, -1], [1, NaN], [1, Infinity]])
    assert.equal(summarize(values), null);
});

test('frame statistics drop invalid intervals and leave inputs intact', () => {
  const intervals = [40, 0, -1, NaN, Infinity, 10, 20, 10];
  assert.deepEqual(frameStatistics(intervals), {
    fps: 50,
    p50Ms: 10,
    p95Ms: 40,
    p99Ms: 40,
    onePercentLowFps: 25,
    stutters: 0,
  });
  assert.deepEqual(intervals, [40, 0, -1, NaN, Infinity, 10, 20, 10]);
  assert.deepEqual(frameStatistics([0, NaN, -5, Infinity]), {
    fps: null,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    onePercentLowFps: null,
    stutters: null,
  });
});

test('a stutter is an interval strictly longer than the stutter threshold', () => {
  const intervals = [STUTTER_MS / 2, STUTTER_MS, STUTTER_MS + 1, STUTTER_MS * 3];
  assert.equal(frameStatistics(intervals).stutters, 2);
});

test('the one-percent low averages all of the worst tail, including a fractional tail size', () => {
  // 201 intervals: the worst 1 % rounds up to three, 10, 40 and 60 ms, an average of 110 / 3 ms.
  const intervals = [...Array<number>(199).fill(10), 40, 60];
  const result = frameStatistics(intervals);
  assert.ok(Math.abs(result.onePercentLowFps! - 3000 / 110) < 1e-12);
  assert.equal(result.p50Ms, 10);
  assert.equal(result.p95Ms, 10);
  assert.equal(result.p99Ms, 10);
});
