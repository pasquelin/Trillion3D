// A transmissive glass composes over the WebGPU engine's own image (`glassOverOpaquePage.ts`), lit
// by the bench sun, before an opaque blue backdrop:
//
//  - the backdrop shows through a clear glass at the light it lets pass, still blue, close to bare;
//  - the glass's volume attenuates what it lets through: a red volume stops the blue;
//  - an opaque tile in front of the glass hides it: that pixel is the tile's alone, as without it;
//  - a glass out of view changes nothing: the image is the backdrop's alone, byte for byte.
//
//   node bench/dawn/proofs.ts tests/gpu/blend/glass-over-opaque.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, publishAndVerify, type PageProofResult } from '../kit/enginePageProof.ts'
import type { Images } from './glassOverOpaquePage.ts'

type Result = PageProofResult & Images

test('a transmissive glass composes over the WebGPU image', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'glassOverOpaquePage.ts'),
    'glassOverOpaque',
  )) as Result
  const { bare, clear, volume, front, frontAlone, away } = result
  const centres = { bare, clear, volume, front, frontAlone, away }
  publishAndVerify({
    ...result,
    passes: Object.fromEntries(
      Object.entries(centres).map(([name, image]) => [name, [image.held, image.centre]]),
    ),
  })
  for (const [name, image] of Object.entries(centres)) assert.ok(image.held, `${name}: not held`)
  // Through clear glass the backdrop is still blue, within what the surface reflects of it.
  const [r, g, b] = clear.centre
  assert.ok(
    b > r + 30 && b > g,
    `clear glass: the backdrop does not show through (${clear.centre})`,
  )
  for (const [c, value] of clear.centre.entries())
    assert.ok(
      Math.abs(value - bare.centre[c]) <= 48,
      `clear glass: ${clear.centre} vs ${bare.centre}`,
    )
  // A red volume stops the blue the clear glass lets through.
  assert.ok(volume.centre[2] + 30 < clear.centre[2], `volume: ${volume.centre} vs ${clear.centre}`)
  // In front of the glass, an opaque tile is all that pixel shows.
  assert.deepEqual(front.centre, frontAlone.centre, 'the glass shows through an opaque tile')
  // Out of view, the glass leaves no trace.
  assert.equal(result.awayChanged, 0, 'a glass out of view changed the image')
})
