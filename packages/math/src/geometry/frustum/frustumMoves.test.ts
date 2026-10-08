// The point and sphere tests unrolled over the six planes: on the planes of every matrix kind
// and on swept planes with hostile values, for swept points and radii, every verdict is the loop's.
import assert from 'node:assert/strict'
import test from 'node:test'
import { frustumContainsPoint, frustumExcludesSphere, frustumPlanesFromMatrix } from './frustum.ts'
import { frustumContainsPointBefore, frustumExcludesSphereBefore } from './frustumBefore.fixture.ts'
import { HALTON_SWEEP } from '../../sequence/sweep.fixture.ts'
import { MATRIX_KINDS, sweepInput, sweepMatrix } from '../../sequence/moves.fixture.ts'

test('frustumContainsPoint, frustumExcludesSphere: the unrolled planes give the same verdicts', () => {
  const m = new Float64Array(16),
    planes = new Float64Array(24)
  let kept = 0,
    excluded = 0
  for (let i = 1; i <= HALTON_SWEEP; i++)
    for (let kind = 0; kind <= MATRIX_KINDS; kind++) {
      if (kind < MATRIX_KINDS) frustumPlanesFromMatrix(planes, sweepMatrix(m, i, kind))
      else for (let k = 0; k < 24; k++) planes[k] = sweepInput(i, k, 3, -2, 2)
      const x = sweepInput(i, 30, 2, -3, 3),
        y = sweepInput(i, 31, 5, -3, 3),
        z = sweepInput(i, 32, 7, -3, 3),
        reach = sweepInput(i, 33, 3, -1, 2)
      const inside = frustumContainsPointBefore(planes, x, y, z),
        behind = frustumExcludesSphereBefore(planes, x, y, z, reach)
      assert.equal(frustumContainsPoint(planes, x, y, z), inside, `point ${i} kind ${kind}`)
      assert.equal(
        frustumExcludesSphere(planes, x, y, z, reach),
        behind,
        `sphere ${i} kind ${kind}`,
      )
      if (inside) kept++
      if (behind) excluded++
    }
  assert.ok(kept > 0 && excluded > 0, `${kept} points kept, ${excluded} spheres excluded`)
})
