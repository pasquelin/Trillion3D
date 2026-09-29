// A9: a placement's winding is memoised on its root (#1226) and invalidated only when the row table's epoch
// changes, instead of a 3×3 determinant recomputed on every read. Oracle: the uncached version from
// before lot A, in `../../../../../../bench/oracles/browser/pages-webgpu.ts`.
import test from 'node:test';
import { asHostLibrary } from '../../../host/resources.ts';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { setWindingEpoch, windingCw } from './winding.ts';
import { referenceWindingCw } from '../../../../../../bench/oracles/browser/pages-webgpu.ts';
import type { ClusterRoot } from '../../../page/selection/types.ts';

/** A page of rank 0, and the root that places it by `matrix`. */
function rec(matrix: G.Matrix4) {
  const roots: ClusterRoot<unknown>[] = [{ world: matrix, pages: [] }];
  return { matrix, roots, page: { placementIndex: 0 } };
}
const cw = ({ roots, page }: ReturnType<typeof rec>) => windingCw(roots, page);

test('the identity matrix and a mirrored (negative-scale) matrix agree with the reference', () => {
  setWindingEpoch(1);
  const identity = rec(new G.Matrix4());
  const mirrored = rec(new G.Matrix4().makeScale(1, 1, -1));
  assert.equal(cw(identity), referenceWindingCw(identity));
  assert.equal(cw(mirrored), referenceWindingCw(mirrored));
  assert.notEqual(cw(identity), cw(mirrored));
});

test('a cached value from an old epoch is recomputed, and a same-epoch read reuses it verbatim', () => {
  setWindingEpoch(5);
  const page = rec(new G.Matrix4().makeRotationY(0.7));
  const first = cw(page);
  assert.equal(page.roots[0].windingEpoch, 5);
  // Same epoch, matrix mutated without going through the cache: the cached (stale) value still
  // comes back, exactly the point of memoising it on the root.
  asHostLibrary<G.Matrix4>(page.matrix).makeScale(1, 1, -1);
  assert.equal(cw(page), first, 'same epoch: the memoised value is reused, not recomputed');
  setWindingEpoch(6);
  assert.equal(cw(page), referenceWindingCw(page), 'new epoch: recomputed from the current matrix');
});

test('a degenerate (all-zero) matrix never throws and matches the reference verdict', () => {
  setWindingEpoch(9);
  const zero = rec(new G.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
  assert.equal(cw(zero), referenceWindingCw(zero));
});
