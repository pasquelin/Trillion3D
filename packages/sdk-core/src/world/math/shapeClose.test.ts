// An outline drops its closing point by the verdict it always had (curves.ts `closes`): swept over
// closing gaps within a few ulps of 1e-12, where the length rule's root would fall the other side.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Shape } from './curves.ts'
import { hypot2 } from '../../../../math/src/float/hypot.ts'
import { length2 } from '../../../../math/src/vector/vector.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { TAU } from '../../../../math/src/constants.ts'

const N = 65_536

test('an outline closing within an ulp of 1e-12 keeps the point count of the former verdict', () => {
  let dropped = 0,
    kept = 0,
    ruleWouldFlip = 0
  for (let i = 1; i <= N; i++) {
    // A triangle from the origin whose last point returns a gap of 1e-12 ± 4 ulps: the
    // differences from the origin are the gap's exact components.
    const turn = TAU * halton(i, 2),
      gap = 1e-12 * (1 + (Math.floor(halton(i, 3) * 9) - 4) * 2 ** -52)
    const [dx, dy] = [gap * Math.cos(turn), gap * Math.sin(turn)]
    const corner = 10 ** (4 * halton(i, 5) - 2)
    const points = new Shape([
      [0, 0],
      [corner, 0],
      [0, corner],
      [dx, dy],
    ]).getPoints()
    // The former expression: `Vector2.distanceTo`, then `hypot2`, of first minus last.
    const before = hypot2(0 - dx, 0 - dy) < 1e-12
    assert.equal(points.length, before ? 3 : 4, `gap ${dx}, ${dy}`)
    if (before) dropped++
    else kept++
    if (length2(0 - dx, 0 - dy) < 1e-12 !== before) ruleWouldFlip++
  }
  assert.ok(dropped > N / 4 && kept > N / 4, `${dropped} dropped, ${kept} kept`)
  // Why the verdict keeps `hypot2`: the length rule decides otherwise on part of these gaps.
  assert.ok(ruleWouldFlip > 0, `${ruleWouldFlip} gaps the rule would decide otherwise`)
})

test('a closed outline drops its repeated point; a far one keeps it', () => {
  assert.equal(
    new Shape([
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ]).getPoints().length,
    3,
  )
  assert.equal(
    new Shape([
      [0, 0],
      [1, 0],
      [0, 1],
      [1e-11, 0],
    ]).getPoints().length,
    4,
  )
  assert.equal(
    new Shape([
      [0, 0],
      [1, 0],
      [0, 1],
      [-1e-13, 1e-13],
    ]).getPoints().length,
    3,
  )
})
