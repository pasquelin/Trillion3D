// A ground worn with `material.shadow` is seen only where a shadow falls: elsewhere the background
// shows through untouched, under the box's shadow it darkens toward its black at half opacity.
// The kind was drawn as a basic surface, the whole ground half black.
//
//   node bench/dawn/proofs.ts tests/gpu/blend/shadow-catcher.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  assertSoundProof,
  runPageProof,
  type PageProofResult,
} from '../../kit/device/enginePageProof.ts'
import { BACKGROUND } from './shadowCatcherPage.ts'

test('a shadow catcher shows the background, darkened only under the shadow', async () => {
  const page = resolve(import.meta.dirname, 'shadowCatcherPage.ts')
  const result = (await runPageProof(page, 'shadowCatcher')) as PageProofResult & {
    pixels?: Uint8Array
    width?: number
  }
  assertSoundProof(result)
  const { pixels, width } = result as { pixels: Uint8Array; width: number }
  const height = pixels.length / 4 / width
  const bg = [1, 3, 5].map((at) => parseInt(BACKGROUND.slice(at, at + 2), 16))
  // The ground left of the box, its middle third of rows, lies in no shadow: the background itself.
  let off = 0
  for (let y = Math.floor(height / 3); y < (2 * height) / 3; y++)
    for (let x = 0; x < width / 8; x++)
      for (let c = 0; c < 3; c++)
        off = Math.max(off, Math.abs(pixels[(y * width + x) * 4 + c] - bg[c]))
  assert.ok(off <= 3, `the unshadowed ground is the background (off by ${off})`)
  // The shadow: the background darkened, at most to its half.
  let shaded = 0
  for (let i = 0; i < pixels.length; i += 4)
    if (bg.every((v, c) => pixels[i + c] <= v - 20 && pixels[i + c] >= v * 0.45)) shaded++
  assert.ok(shaded > 100, `the box's shadow darkens the ground (${shaded} pixels)`)
})
