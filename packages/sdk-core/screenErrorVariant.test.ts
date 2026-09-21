// The EXPERIMENT variant of the screen-error metric: by default ours, unchanged bit-exact,
// and on request the simple projection of the external reference, CPU and WGSL text at
// the same result. `screenErrorVariant.ts` carries the formula and its public source.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  referenceScreenError,
  screenErrorBound,
  screenErrorVariant,
  setScreenErrorVariant,
} from './index.ts';

const CAS = [
  [0.05, 1, 0, 10, 1, 600, 0.1],
  [0.5, 1.25, 8, 12, 2, 900, 0.1],
  [7, 1, 40, 60, 3, 512, 0.05],
  [0.02, 2, 0.5, 3, 0.25, 700, 0.1],
] as const;

test('the default variant is ours, and the bound does not move by a bit', () => {
  assert.equal(screenErrorVariant(), 'certifiee');
  const bound = ([error, stretch, lateral, depth, radius, focal, near]: (typeof CAS)[number]) =>
    screenErrorBound(error, stretch, lateral, depth, radius, focal, near);
  const before = CAS.map(bound);
  setScreenErrorVariant('reference');
  setScreenErrorVariant(null);
  assert.equal(screenErrorVariant(), 'certifiee');
  assert.deepEqual(CAS.map(bound), before);
  // Both metrics share stretch: the certified bound then stays always above
  // that of the reference, which has neither a lateral term, nor a radius, nor a displacement in the denominator.
  for (const [error, stretch, lateral, depth, radius, focal, near] of CAS)
    assert.ok(
      screenErrorBound(error, stretch, lateral, depth, radius, focal, near) >=
        referenceScreenError(error, stretch, depth, focal, near),
      `bound under the reference for ε=${error}`,
    );
});

test('the reference variant yields δ × focal / depth, infinity at the near plane', () => {
  setScreenErrorVariant('reference');
  try {
    assert.equal(screenErrorVariant(), 'reference');
    for (const [error, stretch, lateral, depth, radius, focal, near] of CAS)
      assert.equal(
        screenErrorBound(error, stretch, lateral, depth, radius, focal, near),
        (error * stretch * focal) / depth,
      );
    // Neither the bounding radius nor the distance to the axis enter the metric.
    assert.equal(screenErrorBound(0.5, 3, 40, 12, 9, 900, 0.1), (0.5 * 3 * 900) / 12);
    assert.equal(screenErrorBound(0.5, 1, 0, 0.05, 0, 900, 0.1), Infinity);
    assert.equal(screenErrorBound(0.5, 1, 0, -4, 0, 900, 0.1), Infinity);
  } finally {
    setScreenErrorVariant(null);
  }
});

test('an unknown variant is rejected and does not replace the one in place', () => {
  assert.throws(() => setScreenErrorVariant('rapide' as never), /Unknown screen-error variant/);
  assert.equal(screenErrorVariant(), 'certifiee');
});
