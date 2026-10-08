// The length rule on a capsule's contact (docs/MATHS.md "Lengths"): `separate` moved from a
// division by the distance to a product by its inverse. Swept over capsules beside, above and
// under a tilted triangle against the former expression: the same contacts, each normal, surface
// and depth to the float32 bit, and the feet a push moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { halton } from '../../../math/src/sequence/halton.ts'
import { TAU } from '../../../math/src/constants.ts'
import { capsulePass } from './capsule.ts'
import { closestSegmentTriangle, triangleNormal } from './closest.ts'
import { tiltedTriangle } from './tiltedTriangle.fixture.ts'

const N = 4096,
  H = (i: number, base: number) => halton(i + 1, base)
const same = (a: number, b: number, what: string) =>
  assert.ok(Object.is(Math.fround(a), Math.fround(b)), `${what}: ${a} vs ${b}`)

test('a capsule near a triangle leaves along the former normal, by the former depth', () => {
  const [radius, height] = [0.3, 1.6]
  let separated = 0
  for (let i = 0; i < N; i++) {
    const { tree, v, cx, cy, cz } = tiltedTriangle(i)
    // Beside the triangle out to its edges and past them, the segment's foot from under the
    // plane to a radius above it.
    const turn = H(i, 17) * TAU,
      out = 1.6 * H(i, 19)
    const feet = Float64Array.of(
      cx + out * Math.cos(turn),
      cy - 2 * radius + 2 * radius * H(i, 23),
      cz + out * Math.sin(turn),
    )
    const seen: number[][] = []
    capsulePass(tree, { feet, radius, height }, (c) =>
      seen.push([...c.normal, ...c.surface, c.depth]),
    )
    const segment = [0, radius, 0, 0, height - radius, 0].map((d, k) => feet[k % 3] + d)
    const closest = new Float64Array(6),
      squared = closestSegmentTriangle(closest, segment, v, 0)
    if (squared === 0) continue
    // The former `separate`, then `faceOf`.
    const distance = Math.sqrt(squared),
      n = [0, 1, 2].map((k) => (closest[k] - closest[3 + k]) / distance)
    const touches = squared < radius * radius && radius - distance > 0
    assert.equal(seen.length, touches ? 1 : 0, `contact at ${i}`)
    if (!touches) continue
    separated++
    const face = new Float64Array(3),
      area = Math.sqrt(triangleNormal(face, v, 0)),
      side = face[0] * n[0] + face[1] * n[1] + face[2] * n[2] < 0 ? -1 : 1
    const expected = [...n, ...face.map((f) => f * (side / area)), radius - distance]
    expected.forEach((e, k) => same(seen[0][k], e, `contact ${k} at ${i}`))
    // The push a character answers with: the feet moved out by the depth, the same float32.
    for (let k = 0; k < 3; k++)
      same(feet[k] + seen[0][6] * seen[0][k], feet[k] + expected[6] * n[k], `feet ${k} at ${i}`)
  }
  assert.ok(separated > N / 4, `${separated} separations`)
})
