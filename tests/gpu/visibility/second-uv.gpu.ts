// A physical map on the second UV set reads that set in the real WebGPU engine
// (`secondUvPage.ts`), whether the geometry comes from the float pool — its set at the tail of the
// normal atlas — or from quantized pages that store it, drawn opaque or blended: a coat on its
// map's right texel covers the plane's left half when read on the mirrored second set, its right
// half on the first.
//
//   node bench/dawn/proofs.ts tests/gpu/visibility/second-uv.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { assertSoundProof, runPageProof } from '../kit/enginePageProof.ts'
import type { SideReading } from './secondUvPage.ts'

test('a coat map on the second UV set reads it, from floats and from pages, opaque and blended', async () => {
  const result = await runPageProof(
    resolve(import.meta.dirname, 'secondUvPage.ts'),
    'secondUv',
    'secondUv',
  )
  assertSoundProof(result)
  const readings = (result as typeof result & { readings: Record<string, SideReading> }).readings
  const { first, ...second } = readings
  assert.ok(first.right > first.left + 20, `the first set: coated right, ${JSON.stringify(first)}`)
  for (const [name, side] of Object.entries(second))
    assert.ok(side.left > side.right + 15, `${name}: coated left, ${JSON.stringify(side)}`)
})
