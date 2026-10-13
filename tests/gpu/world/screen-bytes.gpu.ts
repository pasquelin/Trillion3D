// What a world holds per screen pixel, by target, read from the engine's allocation ledger
// (`screenBytesPage.ts`) at two sizes: a label that holds the same bytes a pixel at both follows the
// screen. Their sum is the budget of the frame's images — the formula, per world:
//
//   opaque, lit by a sun      80 B/px, and the sun's shadow mask 4
//   + temporal antialiasing   +48 (history at the display size: geometry 8, colour 8, flicker 4,
//                                  share 4, twice)
//   + a mirror                 0 (the reflection's targets exist for every lit surface)
//   + blends                  +10 front depth (the reflection's: target 2, buffer 4, the folded
//                                  texture the Hi-Z binds 4), +8 emission and occlusion, with water
//                                  +12 (backdrop 8, depth 4)
//
// A world with no blend holds a texel of the front depth's target, not 10 B/px.
//
//   node bench/dawn/proofs.ts tests/gpu/world/screen-bytes.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'
import { KINDS, type Kind, type ScreenReading } from './screenBytesPage.ts'
import type { RuntimeBytes } from './runtimeBytesPage.ts'

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

/** The bytes a pixel each world holds, a few tenths aside (the tile lists): the formula above. */
const BUDGET = { opaque: 84, glass: 114, mirror: 84, temporal: 132 } satisfies Record<Kind, number>

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

test("the run-time proxy's store is eight bytes a screen pixel, asked of the frame's allocation", async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'runtimeBytesPage.ts'),
    'runtimeBytes',
  )) as PageProofResult & RuntimeBytes
  assertSoundProof(result)
  const [small, large] = result.perPixel
  const label = 'Trillion3D run-time proxy store'
  console.log(JSON.stringify({ small: small[label], large: large[label] }))
  assert.ok(Math.abs(small[label] - 8) < 0.01, `${small[label]} B/px at the small size`)
  assert.ok(Math.abs(large[label] - 8) < 0.01, `${large[label]} B/px at the large size`)
})
