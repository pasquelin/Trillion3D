import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTransportOracle } from './oracle.ts';

test('overflow in a coupled light component does not contaminate a disconnected finite emitter', () => {
  const result = solveTransportOracle({
    formatVersion: 1,
    algorithmVersion: 'cosine-first-hit-v1',
    patchCount: 3,
    matrix: new Float64Array([0, 0.9, 0, 0.9, 0, 0, 0, 0, 0]),
    source: new Float64Array([1e308, 1e308, 1e308, 1e308, 1e308, 1e308, 1, 2, 3]),
    albedo: new Float64Array(9).fill(1),
  });
  assert.deepEqual([...result.radiance.slice(6)], [1, 2, 3]);
});
