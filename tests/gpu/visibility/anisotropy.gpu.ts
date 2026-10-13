// The anisotropic lobe in the real WebGPU engine (`physicalLobesPage.ts`): a brushed metal plane's
// highlight stretches along its direction — the tangent of its first UV set, turned by
// `anisotropyRotation` —, a direction map turns it as the rotation does, and a strength map at
// zero draws the isotropic image, bit for bit.
//
//   node bench/dawn/proofs.ts tests/gpu/visibility/anisotropy.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { lobeReadings, lobeSpread } from '../kit/enginePageProof.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'

test('the anisotropic highlight stretches along its direction, and its map turns or zeroes it', async () => {
  const { none, along, turned, strengthMapZero, directionMap } = await lobeReadings(
    resolve(import.meta.dirname, 'physicalLobesPage.ts'),
    'physicalLobes',
    'anisotropy',
  )
  // Isotropic: the plane and the lamp are symmetric about the view axis.
  assert.ok(Math.abs(none.alongX - none.alongY) <= 2, `isotropic: ${lobeSpread(none)}`)
  assert.ok(along.alongX > along.alongY + 20, `along the tangent: ${lobeSpread(along)}`)
  assert.ok(along.alongX > none.alongX + 20, `wider than the isotropic lobe: ${lobeSpread(along)}`)
  assert.ok(turned.alongY > turned.alongX + 20, `turned a quarter: ${lobeSpread(turned)}`)
  assert.ok(
    directionMap.alongY > directionMap.alongX + 20,
    `turned by its map: ${lobeSpread(directionMap)}`,
  )
  assert.equal(
    compareImages(strengthMapZero.pixels, none.pixels).differentPixels,
    0,
    'a zero strength map: the isotropic image',
  )
})
