// The anisotropic and clear-coat lobes of a transparent surface in the real WebGPU engine
// (`lobesBlendPage.ts`): the blend pass lights them in place, as the opaque resolve lights an
// opaque one (`../visibility/clearcoat.gpu.ts`, `anisotropy.gpu.ts`). A sharp coat draws the
// lamp's highlight over a blended matte base; a brushed metal's highlight stretches along its
// tangent and turns with its rotation. A map that zeroes the lobe draws, through the lobed program,
// the image of the program without lobe code, bit for bit: a fragment without lobes sums the same
// terms (class 1).
//
//   node bench/dawn/proofs.ts tests/gpu/blend/lobes.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { lobeReadings, lobeSpread } from '../kit/enginePageProof.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'

const readingsOf = (method: string) =>
  lobeReadings(resolve(import.meta.dirname, 'lobesBlendPage.ts'), 'lobesBlend', method)

test('a transparent clear coat draws its highlight over the base, and its zero map the uncoated image', async () => {
  const { none, coat, coatMapZero } = await readingsOf('clearcoat')
  assert.ok(
    coat.centre > none.centre + 20,
    `the coat's highlight: ${coat.centre} over ${none.centre}`,
  )
  assert.ok(none.corner > 5, `the blended base is lit: ${none.corner}`)
  assert.equal(
    compareImages(coatMapZero.pixels, none.pixels).differentPixels,
    0,
    'a zero coat map: the uncoated image',
  )
})

test('a transparent anisotropic highlight stretches along its direction, and its zero map is isotropic', async () => {
  const { none, along, turned, strengthMapZero } = await readingsOf('anisotropy')
  assert.ok(Math.abs(none.alongX - none.alongY) <= 2, `isotropic: ${lobeSpread(none)}`)
  assert.ok(along.alongX > along.alongY + 15, `along the tangent: ${lobeSpread(along)}`)
  assert.ok(turned.alongY > turned.alongX + 15, `turned a quarter: ${lobeSpread(turned)}`)
  assert.equal(
    compareImages(strengthMapZero.pixels, none.pixels).differentPixels,
    0,
    'a zero strength map: the isotropic image',
  )
})
