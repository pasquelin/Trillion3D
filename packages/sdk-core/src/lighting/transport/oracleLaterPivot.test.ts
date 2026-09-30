import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTransportOracle } from './oracle.ts';

test('a zero second pivot selects a smaller nonzero candidate from the last equation', () => {
  // 4x+y+2z=12; 2x+0.5y+3z=12; x+y+z=6. Their solution is (1,2,3).
  const result = solveTransportOracle({
    formatVersion: 1,
    algorithmVersion: 'cosine-first-hit-v1',
    patchCount: 3,
    matrix: new Float64Array([-3, -1, -2, -2, 0.5, -3, -1, -1, 0]),
    source: new Float64Array([12, 12, 12, 12, 12, 12, 6, 6, 6]),
    albedo: new Float64Array(9).fill(1),
  });
  assert.deepEqual([...result.radiance], [1, 1, 1, 2, 2, 2, 3, 3, 3]);
  assert.equal(result.residual, 0);
});

test('a singular final pivot is refused even when the earlier pivots are valid', () => {
  assert.throws(
    () =>
      solveTransportOracle({
        formatVersion: 1,
        algorithmVersion: 'cosine-first-hit-v1',
        patchCount: 2,
        matrix: new Float64Array([0, 0, 0, 1]),
        source: new Float64Array([1, 1, 1, 1, 1, 1]),
        albedo: new Float64Array(6).fill(1),
      }),
    (error: any) => error.code === 'SINGULAR_TRANSPORT',
  );
});
