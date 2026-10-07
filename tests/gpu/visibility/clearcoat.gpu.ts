// The clear coat in the real WebGPU engine (`physicalLobesPage.ts`): over a matte base with no
// highlight of its own, a sharp coat draws the lamp's mirror highlight and lets a little less of the
// base through away from it; a coat map at zero draws the uncoated image, bit for bit.
//
//   node bench/dawn/proofs.ts tests/gpu/visibility/clearcoat.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { assertSoundProof, runPageProof } from '../kit/enginePageProof.ts'
import { difference } from '../kit/sceneImageProof.ts'
import type { LobeReading } from './physicalLobesPage.ts'

test('a clear coat draws its highlight over the base, and its map zeroes it', async () => {
  const result = await runPageProof(
    resolve(import.meta.dirname, 'physicalLobesPage.ts'),
    'physicalLobes',
    'clearcoat',
  )
  assertSoundProof(result)
  const { none, coat, coatMapZero } = (
    result as typeof result & { readings: Record<string, LobeReading> }
  ).readings
  assert.ok(
    coat.centre > none.centre + 30,
    `the coat's highlight: ${coat.centre} over ${none.centre}`,
  )
  assert.ok(
    coat.corner <= none.corner,
    `the coat lets less through: ${coat.corner} ≤ ${none.corner}`,
  )
  assert.ok(none.corner > 10, `the base is lit: ${none.corner}`)
  assert.equal(
    difference(coatMapZero.pixels, none.pixels),
    0,
    'a zero coat map: the uncoated image',
  )
})
