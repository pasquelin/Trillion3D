// The anisotropic and clear-coat lobes of a transmissive surface in the real WebGPU engine
// (`lobesWaterPage.ts`): the water pass's lobed surface stage leaves a fragment's lobes in the lobes
// target and its composite lights them, as the blend pass lights a transparent surface's
// (`../blend/lobes.gpu.ts`). A sharp coat draws the lamp's highlight over a transmissive matte base;
// a brushed metal's highlight stretches along its tangent and turns with its rotation. A map that
// zeroes the lobe draws, through the lobed stage and composite, the image of the program without
// lobe code, bit for bit: a pixel without lobes sums the same terms (class 1).
//
//   node bench/dawn/proofs.ts tests/gpu/water/lobes.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { lobeReadings, lobeSpread } from '../kit/enginePageProof.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'

const readingsOf = (method: string) =>
  lobeReadings(resolve(import.meta.dirname, 'lobesWaterPage.ts'), 'lobesWater', method)

test('a transmissive clear coat draws its highlight, and its zero map the uncoated image', async () => {
  const { none, coat, coatMapZero } = await readingsOf('clearcoat')
  assert.ok(
    coat.centre > none.centre + 10,
    `the coat's highlight: ${coat.centre} over ${none.centre}`,
  )
  assert.equal(
    compareImages(coatMapZero.pixels, none.pixels).differentPixels,
    0,
    'a zero coat map: the uncoated image',
  )
})

test('a transmissive anisotropic highlight stretches along its direction, and its zero map is isotropic', async () => {
  const { none, along, turned, strengthMapZero } = await readingsOf('anisotropy')
  assert.ok(Math.abs(none.alongX - none.alongY) <= 2, `isotropic: ${lobeSpread(none)}`)
  assert.ok(along.alongX > along.alongY + 10, `along the tangent: ${lobeSpread(along)}`)
  assert.ok(turned.alongY > turned.alongX + 10, `turned a quarter: ${lobeSpread(turned)}`)
  assert.equal(
    compareImages(strengthMapZero.pixels, none.pixels).differentPixels,
    0,
    'a zero strength map: the isotropic image',
  )
})
