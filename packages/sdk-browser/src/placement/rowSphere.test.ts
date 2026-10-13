// The world sphere of a row (`rowSphere.ts`) holds every vertex of its box by construction, and is
// the tightest sphere about the box's centre that does: on generated worlds (rotations, uneven and
// negative scales, shears, far from the origin) and boxes, every corner of the world image lies in
// it, none is farther than a rounding from its edge on the farthest, and it is never wider than the
// sphere about the world box the formula replaces (`|W|·h`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { lcgRandom } from '../../../math/src/sequence/random.ts'
import { generated } from './composeDoubles.fixture.ts'
import { sphereRadius } from './rowSphere.ts'

test('the sphere holds every corner of the box in its world, tight on the farthest', () => {
  const next = lcgRandom(23)
  let tight = 0,
    tighter = 0
  for (let i = 0; i < 2000; i++) {
    const far = [1, 1e3, 1e6][i % 3],
      w = generated(next, far)
    const c = [0, 1, 2].map(() => (next() - 0.5) * 40),
      h = [0, 1, 2].map(() => 0.001 + next() * 5)
    const r = sphereRadius(w, c, h)
    // The offsets of the eight corners from the centre's image, in double.
    let farthest = 0
    for (let s = 0; s < 8; s++) {
      const v = [0, 1, 2].map((a) =>
        [0, 1, 2].reduce((sum, j) => sum + w[j * 4 + a] * ((s >> j) & 1 ? h[j] : -h[j]), 0),
      )
      farthest = Math.max(farthest, Math.hypot(v[0], v[1], v[2]))
    }
    const half = [0, 1, 2].map((a) =>
      [0, 1, 2].reduce((sum, j) => sum + Math.abs(w[j * 4 + a]) * h[j], 0),
    )
    const boxy = Math.hypot(half[0], half[1], half[2])
    assert.ok(r >= farthest, `case ${i}: ${r} holds ${farthest}`)
    if (r <= farthest * (1 + 1e-5) + 1e-30) tight++
    assert.ok(r <= boxy * (1 + 1e-5) + 1e-6 * boxy, `case ${i}: no wider than the box's sphere`)
    if (r < boxy * 0.999) tighter++
  }
  assert.ok(tight > 1900, `${tight} of 2000 within a rounding of the farthest corner`)
  assert.ok(tighter > 400, `${tighter} of 2000 tighter than the world box's sphere`)
})
