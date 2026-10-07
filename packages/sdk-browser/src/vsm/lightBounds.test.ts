// The light's range test against a bounding sphere, against the inline expression it replaced.
import test from 'node:test'
import assert from 'node:assert/strict'
import { halton } from '../../../math/src/sequence/halton.ts'
import { VsmLightCache } from './cacheManager.ts'

const COUNT = 4096

function inline(center: number[], radius: number, origin: number[], range: number) {
  const dx = center[0] - origin[0],
    dy = center[1] - origin[1],
    dz = center[2] - origin[2]
  return dx * dx + dy * dy + dz * dz <= (range + radius) ** 2
}

test('affectsBounds: same answer as the inline expression on a sweep; (r1+r2) ** 2 is s * s', () => {
  const light = new VsmLightCache('sweep', 1)
  for (let i = 1; i <= COUNT; i++) {
    const origin: [number, number, number] = [
      (halton(i, 2) - 0.5) * 200,
      (halton(i, 3) - 0.5) * 200,
      (halton(i, 5) - 0.5) * 200,
    ]
    const center = [
      (halton(i, 7) - 0.5) * 200,
      (halton(i, 11) - 0.5) * 200,
      (halton(i, 13) - 0.5) * 200,
    ]
    const range = halton(i, 17) * 150 + 1e-3
    const radius = halton(i, 19) * 50
    light.lightOrigin = origin
    light.lightRange = range
    const s = range + radius
    assert.ok(Object.is(s ** 2, s * s))
    assert.equal(light.affectsBounds(center, radius), inline(center, radius, origin, range))
  }
  light.lightRange = -1
  assert.equal(light.affectsBounds([1e9, 0, 0], 0), true)
  light.lightRange = 5
  light.lightOrigin = [0, 0, 0]
  assert.equal(light.affectsBounds([5, 0, 0], 0), true)
  assert.equal(light.affectsBounds([6, 0, 0], 0.5), false)
})
