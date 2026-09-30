import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTransportOracle } from './oracle.ts';

test('oracle solves a singleton and reports progress through a larger diagonal system', () => {
  for (const patchCount of [1, 16, 17]) {
    const matrix = new Float64Array(patchCount * patchCount);
    for (let index = 0; index < patchCount; index++) matrix[index * patchCount + index] = 0.5;
    const source = new Float64Array(patchCount * 3).fill(3);
    const events: unknown[] = [];
    const result = solveTransportOracle(
      {
        formatVersion: 1,
        algorithmVersion: 'cosine-first-hit-v1',
        patchCount,
        matrix,
        source,
        albedo: new Float64Array(patchCount * 3).fill(0.5),
      },
      { onProgress: (event) => events.push(event) },
    );
    assert.ok(result.radiance.every((value) => value === 4));
    assert.equal(result.residual, 0);
    assert.deepEqual(
      events,
      (patchCount === 1
        ? [0, 1, 2, 3]
        : patchCount === 16
          ? [0, 16, 32, 48]
          : [0, 16, 17, 33, 34, 50, 51]
      ).map((completed) => ({
        eventVersion: 1,
        stage: 'oracle',
        completed,
        total: patchCount * 3,
      })),
    );
  }
});
