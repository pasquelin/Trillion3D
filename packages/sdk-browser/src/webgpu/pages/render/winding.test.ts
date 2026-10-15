// A placement's winding is memoised on its root at the root's world version (`worldMoved`), instead
// of a 3×3 determinant recomputed on every read. Oracle: the uncached verdict, `matrixWindingCw` of
// the maths package.
import test from 'node:test'
import { asHostLibrary } from '../../../host/resources.ts'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { windingCw } from './winding.ts'
import { matrixWindingCw } from '../../../../../math/src/matrix/orientation.ts'
import { worldMoved } from '../../../page/selection/rootWorld.ts'
import type { ClusterRoot } from '../../../page/selection/types.ts'

/** A page of root rank 0, and the root that places it by `matrix`. */
function rec(matrix: Matrix4) {
  const roots: ClusterRoot<unknown>[] = [{ world: matrix, pages: [] }]
  return { matrix, roots, page: {} }
}
const cw = ({ roots }: ReturnType<typeof rec>) => windingCw(roots, 0)

test('the identity matrix and a mirrored (negative-scale) matrix agree with the reference', () => {
  const identity = rec(new Matrix4())
  const mirrored = rec(new Matrix4().makeScale(1, 1, -1))
  assert.equal(cw(identity), matrixWindingCw(identity.matrix.elements))
  assert.equal(cw(mirrored), matrixWindingCw(mirrored.matrix.elements))
  assert.notEqual(cw(identity), cw(mirrored))
})

test('a read at the same world version reuses the memo verbatim; a world moved recomputes it', () => {
  const page = rec(new Matrix4().makeRotationY(0.7))
  const first = cw(page)
  assert.equal(page.roots[0].windingEpoch, 0)
  // Same version, matrix mutated without the move being taken: the memoised value comes back.
  asHostLibrary<Matrix4>(page.matrix).makeScale(1, 1, -1)
  assert.equal(cw(page), first, 'same version: the memoised value is reused, not recomputed')
  worldMoved(page.roots[0])
  assert.equal(
    cw(page),
    matrixWindingCw(page.matrix.elements),
    'world moved: recomputed from the current matrix',
  )
  assert.equal(page.roots[0].windingEpoch, 1)
})

test('a degenerate (all-zero) matrix never throws and matches the reference verdict', () => {
  const zero = rec(new Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))
  assert.equal(cw(zero), matrixWindingCw(zero.matrix.elements))
})
