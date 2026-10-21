// What a world holds per screen pixel, by target, read from the engine's allocation ledger
// (`screenBytesPage.ts`) at two sizes: a label that holds the same bytes a pixel at both follows the
// screen. Their sum is the budget of the frame's images — the formula, per world, at 640 × 400
// (N = 256 000 pixels), the size it is summed at:
//
//   opaque, lit by a sun   105.714 B/px:
//     surfaces                28      the colours' two rgba16float layers 16, the words' three
//                                     r32uint layers 12: the flags 4, the shadow receiver 8
//     shading bin elements     4.032  an r32uint word a pixel, in whole rows of 4096:
//                                     63 × 4096 × 4 B / N
//     HDR lighting            21.332  two targets that take turns, rgba16float with the radiance
//                                     pyramid's 9 levels in their mips: 341 317 texels × 8 B × 2 / N
//     reflection               8      rgba16float
//     display, depth, ids     12      rgba8unorm 4, depth32float 4, the visibility r32uint 4
//     Hi-Z level 0             4      the opaque depth, one layer: no front layer without blends
//     Hi-Z pyramid            12.288  three layers of max(N, 3M) words in whole rows of 8192
//                                     (M = 85 359): 3 × 8192 × 32 × 4 B / N
//     sun's shadow mask        4.0625 its word a pixel, and a word an 8 × 8 tile
//     reflection half grids   12      three rgba32uint, a texel a 2 × 2 block: the
//                                     history's two that take turns and the scratch
//                    28 + 4.032 + 21.332 + 8 + 12 + 4 + 12.288 + 4.0625 + 12 = 105.714
//   + temporal antialiasing +48      history at the display size: geometry 8, colour 8, flicker 4,
//                                     share 4, twice                                 = 153.714
//   + a mirror               0      the reflection's targets exist for every lit surface = 105.714
//   + blends                +30      front depth 10 (the reflection's target r16float 2, its buffer
//                                     4, the Hi-Z level 0's front layer 4), emission and occlusion
//                                     8 (a third colour layer), with water 12 (backdrop 8, depth 4)
//                                                                                     = 135.714
//
// A world with no blend holds a texel of the front depth's target, not 6 B/px, and a level 0 of one
// layer: an opaque scene pays nothing for transparents.
//
//   node bench/dawn/proofs.ts tests/gpu/world/screen-bytes.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  runPageProof,
  assertSoundProof,
  type PageProofResult,
} from '../../kit/device/enginePageProof.ts'
import { KINDS, type Kind, type ScreenReading } from './screenBytesPage.ts'

/** Allocations that are no frame target: the bench canvas stands for the window's, the held
 *  readback of a capture goes after a second. */
const ELSEWHERE = /^(bench canvas|Trillion3D explicit capture)$/

/** The bytes a pixel the labels hold at both sizes, the same at both: the screen's own. */
function screenBytes([small, large]: ScreenReading[Kind]) {
  const labels = Object.keys(small).filter(
    (label) => !ELSEWHERE.test(label) && Math.abs(large[label] / small[label] - 1) < 0.02,
  )
  return { labels, total: labels.reduce((sum, label) => sum + small[label], 0) }
}

/** The bytes a pixel each world holds at 640 × 400: the formula above. */
const BUDGET = {
  opaque: 105.7145,
  glass: 135.7145,
  mirror: 105.7145,
  temporal: 153.7145,
} satisfies Record<Kind, number>

test('what a world holds per screen pixel is the formula', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'screenBytesPage.ts'),
    'screenBytes',
  )) as PageProofResult & { perPixel: ScreenReading }
  assertSoundProof(result)
  for (const kind of KINDS) {
    const expected = BUDGET[kind],
      { labels, total } = screenBytes(result.perPixel[kind])
    console.log(JSON.stringify({ kind, total, labels }))
    assert.ok(Math.abs(total - expected) < 0.3, `${kind}: ${total} B/px, expected ${expected}`)
  }
})
