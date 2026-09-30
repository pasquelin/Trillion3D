import assert from 'node:assert/strict';
import test from 'node:test';
import { frameStatistics, summarize } from './stats.ts';

test('summary sorts numerically, preserves the input, and reports ranks rather than interpolation', () => {
  const values = [100, 1, 5, 4, 3, 2];
  assert.deepEqual(summarize(values), { mean: 115 / 6, p50: 3, p95: 100, p99: 100, max: 100 });
  assert.deepEqual(values, [100, 1, 5, 4, 3, 2]);
  assert.deepEqual(summarize([0]), { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  for (const values of [[], [1, -1], [1, NaN], [1, Infinity]])
    assert.equal(summarize(values), null);
});

test('frame statistics drop invalid intervals, retain zero stutters at the inclusive boundary, and leave inputs intact', () => {
  const intervals = [50, 0, -1, NaN, Infinity, 10, 20, 20];
  assert.deepEqual(frameStatistics(intervals), {
    fps: 40,
    p50Ms: 20,
    p95Ms: 50,
    p99Ms: 50,
    onePercentLowFps: 20,
    stutters: 0,
  });
  assert.deepEqual(intervals, [50, 0, -1, NaN, Infinity, 10, 20, 20]);
  assert.deepEqual(frameStatistics([0, NaN, -5, Infinity]), {
    fps: null,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    onePercentLowFps: null,
    stutters: null,
  });
  assert.equal(frameStatistics([50, 51]).stutters, 1);
});

test('the one-percent low averages all of the worst tail, including a fractional tail size', () => {
  const intervals = [...Array<number>(199).fill(10), 40, 60];
  const result = frameStatistics(intervals);
  assert.ok(Math.abs(result.onePercentLowFps! - 27.272727272727273) < 1e-12);
  assert.equal(result.p50Ms, 10);
  assert.equal(result.p95Ms, 10);
  assert.equal(result.p99Ms, 10);
  assert.equal(result.stutters, 1);
});
