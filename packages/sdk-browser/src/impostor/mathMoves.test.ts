// The impostor card's distance to the eye moved from `hypot3` to the engine's one length rule,
// `length3` (docs/MATHS.md "Lengths"; `cards.ts`). The distance only reaches the GPU as the card's
// mip level, `max(0, log2(distance / texel depth))`, in the float32 record: the sweep holds the old
// expression as its oracle and proves the level's float32 bits do not move.
import test from 'node:test'
import assert from 'node:assert/strict'
import { hypot3 } from '../../../math/src/float/hypot.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import {
  assertSameFloat32,
  edgeValues,
  HALTON_SWEEP,
  haltonSpan,
} from '../../../math/src/sequence/sweep.fixture.ts'

/** The card's mip level at `distance` for a texel `depth` one pixel covers (`planImpostorCards`). */
const level = (distance: number, depth: number) => Math.max(0, Math.log2(distance / depth))

test('the card mip level reads the same float32 from length3 as from hypot3', () => {
  let parted = 0
  const check = (x: number, y: number, z: number, depth: number, label: string) => {
    const old = hypot3(x, y, z),
      now = length3(x, y, z)
    if (old !== now) parted++
    assertSameFloat32(level(old, depth), level(now, depth), label)
  }
  for (let i = 1; i <= HALTON_SWEEP; i++)
    check(
      haltonSpan(i, 2, -5000, 5000),
      haltonSpan(i, 3, -5000, 5000),
      haltonSpan(i, 5, -5000, 5000),
      haltonSpan(i, 7, 0.001, 20),
      `card ${i}`,
    )
  // Edge offsets on one axis, at the depth of a texel and of a hundred.
  for (const edge of edgeValues(-1e6, 1e6))
    for (const depth of [1, 100]) check(edge, 3, -4, depth, `edge ${edge} at ${depth}`)
  // The sweep meets distances where the two rules part.
  assert.ok(parted > 0, 'no distance parts')
})
