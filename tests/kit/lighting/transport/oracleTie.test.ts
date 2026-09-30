import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTransportOracle } from './oracle.ts';

test('equal-magnitude pivot candidates retain accuracy across widely separated equation scales', () => {
  // The three equations have solution (1, 2, 3):
  // x - 10000y = -19999; -x + 10000y - 0.0001z = 19998.9997;
  // -x - 10^12 y + 10^-8 z = -2000000000001 (rounded at the input precision).
  const result = solveTransportOracle({
    formatVersion: 1,
    algorithmVersion: 'cosine-first-hit-v1',
    patchCount: 3,
    matrix: new Float64Array([0, 10000, 0, 1, -9999, 0.0001, 1, 1e12, 0.99999999]),
    source: new Float64Array([
      -19999, -19999, -19999, 19998.9997, 19998.9997, 19998.9997, -2000000000001, -2000000000001,
      -2000000000001,
    ]),
    albedo: new Float64Array(9).fill(1),
  });
  for (const [index, expected] of [1, 1, 1, 2, 2, 2, 3, 3, 3].entries())
    assert.ok(Math.abs(result.radiance[index] - expected) < 1e-7);
  assert.ok(result.residual < 1e-7);
});
