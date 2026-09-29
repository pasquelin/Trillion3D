import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProxySync } from '../../../sdk-core/src/scene/core/proxyMotion.ts';
import { syncBounceProbes } from './probeSync.ts';

/** Probe-side parts that record what a sync asked of them. */
function parts(change: ProxySync) {
  const calls: string[] = [];
  return {
    calls,
    resident: {
      sync: () => change,
      bounds: [0, 0, 0, 1, 1, 1],
      triangleBoxes: new Float64Array(6),
      changedTriangles: new Uint8Array(1),
    },
    cascades: { replan: () => (calls.push('replan'), true), invalidLevels: 1 },
    occupancy: { moved: () => void calls.push('occupancy') },
    invalidate: () => void calls.push('invalidate'),
    restart: () => void calls.push('restart'),
  };
}

test('a settle uploads its triangles and flags only: no replan, no stale occupancy, no restart', () => {
  const settled = parts('settled');
  assert.equal(
    syncBounceProbes(settled, () => undefined),
    'settled',
  );
  assert.deepEqual(settled.calls, []);
  const still = parts(null);
  assert.equal(
    syncBounceProbes(still, () => undefined),
    null,
  );
  assert.deepEqual(still.calls, []);
  const moved = parts('moved');
  assert.equal(
    syncBounceProbes(moved, () => undefined),
    'moved',
  );
  assert.deepEqual(moved.calls, ['replan', 'invalidate', 'occupancy', 'restart']);
});
