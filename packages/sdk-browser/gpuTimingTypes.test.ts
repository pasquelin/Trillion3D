// Shared-formula batch: nanosecondsToMs, factored out of 4 copies (WebGPU and WebGL2 timers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { nanosecondsToMs } from './gpuTimingTypes.ts';

test('nanosecondsToMs divides by one million', () => {
  assert.equal(nanosecondsToMs(1_000_000), 1);
  assert.equal(nanosecondsToMs(16_666_667), 16.666667);
});

test('nanosecondsToMs returns zero for zero and a negative value for a negative interval', () => {
  assert.equal(nanosecondsToMs(0), 0);
  assert.equal(nanosecondsToMs(-2_000_000), -2);
});

test('nanosecondsToMs propagates NaN or Infinity without throwing', () => {
  assert.ok(Number.isNaN(nanosecondsToMs(NaN)));
  assert.equal(nanosecondsToMs(Infinity), Infinity);
});
