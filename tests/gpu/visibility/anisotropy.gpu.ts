// The anisotropic lobe in the real WebGPU engine (`physicalLobesPage.ts`): a brushed metal plane's
// highlight stretches along its direction — the tangent of its first UV set, turned by
// `anisotropyRotation` —, a direction map turns it as the rotation does, and a strength map at
// zero draws the isotropic image, bit for bit.
//
//   node bench/dawn/proofs.ts tests/gpu/visibility/anisotropy.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { assertSoundProof, runPageProof } from '../kit/enginePageProof.ts'
import { difference } from '../kit/sceneImageProof.ts'
import type { LobeReading } from './physicalLobesPage.ts'

test('the anisotropic highlight stretches along its direction, and its map turns or zeroes it', async () => {
  const result = await runPageProof(
    resolve(import.meta.dirname, 'physicalLobesPage.ts'),
    'physicalLobes',
    'anisotropy',
  )
  assertSoundProof(result)
  const { none, along, turned, strengthMapZero, directionMap } = (
    result as typeof result & { readings: Record<string, LobeReading> }
  ).readings
  const say = (r: LobeReading) => `x ${r.alongX}, y ${r.alongY}, centre ${r.centre}`
  // Isotropic: the plane and the lamp are symmetric about the view axis.
  assert.ok(Math.abs(none.alongX - none.alongY) <= 2, `isotropic: ${say(none)}`)
  assert.ok(along.alongX > along.alongY + 20, `along the tangent: ${say(along)}`)
  assert.ok(along.alongX > none.alongX + 20, `wider than the isotropic lobe: ${say(along)}`)
  assert.ok(turned.alongY > turned.alongX + 20, `turned a quarter: ${say(turned)}`)
  assert.ok(
    directionMap.alongY > directionMap.alongX + 20,
    `turned by its map: ${say(directionMap)}`,
  )
  assert.equal(
    difference(strengthMapZero.pixels, none.pixels),
    0,
    'a zero strength map: the isotropic image',
  )
})
