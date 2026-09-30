import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTransportOracle } from './oracle.ts';
import type { TransportSnapshot } from './contracts.ts';

const snapshot = (): TransportSnapshot => ({
  formatVersion: 1,
  algorithmVersion: 'cosine-first-hit-v1',
  patchCount: 2,
  matrix: new Float64Array([1, 2, 3, 4]),
  source: new Float64Array([-8, -10, -12, -18, -24, -30]),
  albedo: new Float64Array(6).fill(1),
});

test('direct transport solve pivots a zero diagonal and preserves independent color channels', () => {
  const value = snapshot();
  const saved = structuredClone(value);
  const events: unknown[] = [];
  const result = solveTransportOracle(value, { onProgress: (event) => events.push(event) });
  assert.deepEqual([...result.radiance], [2, 3, 4, 4, 5, 6]);
  assert.equal(result.residual, 0);
  assert.deepEqual(value, saved);
  assert.deepEqual(
    events,
    [0, 2, 4, 6].map((completed) => ({
      eventVersion: 1,
      stage: 'oracle',
      completed,
      total: 6,
    })),
  );
});

test('direct transport rejects each incompatible snapshot field and singular equations', () => {
  for (const update of [
    { formatVersion: 2 },
    { algorithmVersion: '' },
    { patchCount: 0 },
    { patchCount: 1.5 },
    { patchCount: NaN },
    { patchCount: Number.MAX_SAFE_INTEGER + 1 },
    { matrix: new Float64Array(3) },
    { source: new Float64Array(5) },
    { albedo: new Float64Array(5) },
  ])
    assert.throws(
      () => solveTransportOracle(Object.assign(snapshot(), update) as TransportSnapshot),
      (error: any) => error.code === 'INVALID_SNAPSHOT' && error.message.includes('Incompatible'),
    );
  for (const field of ['matrix', 'source', 'albedo'] as const)
    for (const value of [NaN, Infinity, -Infinity]) {
      const data = snapshot();
      data[field][data[field].length - 1] = value;
      assert.throws(
        () => solveTransportOracle(data),
        (error: any) => error.code === 'INVALID_SNAPSHOT' && error.message.includes('nonfinite'),
      );
    }
  const singular = snapshot();
  singular.matrix.set([1, 0, 0, 1]);
  assert.throws(
    () => solveTransportOracle(singular),
    (error: any) => error.code === 'SINGULAR_TRANSPORT' && error.message.includes('singular'),
  );
  assert.throws(
    () => solveTransportOracle(snapshot(), { cancelled: () => true }),
    (error: any) => error.code === 'CANCELLED',
  );
});

test('direct transport handles unequal reflectances and a triangular three patch system', () => {
  const data: TransportSnapshot = {
    ...snapshot(),
    patchCount: 3,
    matrix: new Float64Array([0, 0.5, 0, 0, 0, 0.25, 0, 0, 0]),
    source: new Float64Array([1, 2, 3, 4, 5, 6, 8, 12, 16]),
    albedo: new Float64Array([0.5, 0.25, 0.75, 0.5, 0.25, 0.75, 0.1, 0.2, 0.3]),
  };
  const result = solveTransportOracle(data);
  assert.deepEqual([...result.radiance], [2.25, 2.71875, 6.375, 5, 5.75, 9, 8, 12, 16]);
  assert.equal(result.residual, 0);
});
