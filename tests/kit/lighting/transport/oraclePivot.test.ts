import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTransportOracle } from './oracle.ts';

test('oracle pivots after the first column and preserves every right-hand color column', () => {
  const result = solveTransportOracle({
    formatVersion: 1,
    algorithmVersion: 'cosine-first-hit-v1',
    patchCount: 3,
    matrix: new Float64Array([-3, -1, -2, -2, 1, -1, -1, -3, 0]),
    source: new Float64Array([12, 19, 26, 5, 8, 11, 10, 15, 20]),
    albedo: new Float64Array(9).fill(1),
  });
  for (const [index, expected] of [1, 2, 3, 2, 3, 4, 3, 4, 5].entries())
    assert.ok(Math.abs(result.radiance[index] - expected) < 1e-12);
  assert.ok(result.residual < 1e-12);
});

test('oracle rejects empty systems and admits a nonsingular pivot exactly at the minimum magnitude', () => {
  assert.throws(
    () =>
      solveTransportOracle({
        formatVersion: 1,
        algorithmVersion: 'cosine-first-hit-v1',
        patchCount: 0,
        matrix: new Float64Array(),
        source: new Float64Array(),
        albedo: new Float64Array(),
      }),
    (error: any) => error.code === 'INVALID_SNAPSHOT',
  );
  const result = solveTransportOracle({
    formatVersion: 1,
    algorithmVersion: 'cosine-first-hit-v1',
    patchCount: 2,
    matrix: new Float64Array([1, -1, -1e-14, 1]),
    source: new Float64Array([1, 1, 1, 1e-14, 1e-14, 1e-14]),
    albedo: new Float64Array(6).fill(1),
  });
  assert.deepEqual([...result.radiance], [1, 1, 1, 1, 1, 1]);
});
