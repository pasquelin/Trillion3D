// The deformation stage's lengths moved from `hypot3` to the engine's one rule, `length3`
// (docs/MATHS.md "Lengths"): the two may part in the last bit of a double. Each sweep holds the old
// expression as its oracle and proves that what the stage sends the GPU does not move: a soft
// body's reach, read as a float32 and as the half float of its mark word (`softSource.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { receiveSoftSource, type SoftSource } from './softSource.ts'
import { rootMark } from './halfFloat.ts'
import { hypot3 } from '../../../math/src/float/hypot.ts'
import {
  assertSameFloat32,
  edgeValues,
  HALTON_SWEEP,
  haltonSpan,
} from '../../../math/src/sequence/sweep.fixture.ts'

/** A soft source of one vertex, resting at `rest`. */
function oneVertex(rest: ArrayLike<number>): SoftSource {
  const at = Float32Array.from(rest)
  return {
    rest: at,
    positions: at.slice(),
    normals: new Float32Array(3),
    indices: new Uint32Array(0),
    version: 1,
    reach: 0,
  }
}

test('a soft body reach is the hypot3 one as a float32 and as its mark half float', () => {
  const moved = new Float32Array(3)
  let parted = 0
  const check = (rest: number[], label: string) => {
    const source = oneVertex(rest)
    assert.ok(receiveSoftSource(source, moved))
    const r = source.rest
    const old = Math.max(0, hypot3(moved[0] - r[0], moved[1] - r[1], moved[2] - r[2]))
    if (old !== source.reach) parted++
    assertSameFloat32(old, source.reach, label)
    assert.equal(
      rootMark({ mark: 0, reach: source.reach }),
      rootMark({ mark: 0, reach: old }),
      `${label} mark`,
    )
  }
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const rest = [haltonSpan(i, 2, -50, 50), haltonSpan(i, 3, -50, 50), haltonSpan(i, 5, -50, 50)]
    moved[0] = rest[0] + haltonSpan(i, 7, -2, 2)
    moved[1] = rest[1] + haltonSpan(i, 11, -2, 2)
    moved[2] = rest[2] + haltonSpan(i, 13, -2, 2)
    check(rest, `vertex ${i}`)
  }
  // Edge displacements on one axis, the vertex resting at the origin.
  for (const edge of edgeValues(-1e6, 1e6)) {
    moved.set([edge, 0.5, -0.25])
    check([0, 0, 0], `edge ${edge}`)
  }
  assert.ok(parted > 0, 'no reach parts in double')
})
