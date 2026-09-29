import test from 'node:test';
import assert from 'node:assert/strict';
import { screenErrorPass } from './screenErrorVerdict.ts';

test('screen-error acceptance requires a held, error-free and sampled view', () => {
  const sample = { points: 10, max: 0.1, p99: 0.1 };
  const measured = { triangles: 2, forward: sample, reverse: sample };
  assert.equal(screenErrorPass(measured, 8, [], 0), true);
  assert.equal(screenErrorPass(measured, -1, [], 0), false);
  assert.equal(screenErrorPass(measured, 8, ['pageerror'], 0), false);
  assert.equal(screenErrorPass({ ...measured, triangles: 0 }, 8, [], 0), false);
  for (const direction of ['forward', 'reverse']) {
    for (const invalid of [{ points: 0 }, { max: Infinity }, { max: NaN }, { max: 0.101 }]) {
      const result = { ...measured, [direction]: { ...sample, ...invalid } };
      assert.equal(screenErrorPass(result, 8, [], 0), false);
    }
  }
});
