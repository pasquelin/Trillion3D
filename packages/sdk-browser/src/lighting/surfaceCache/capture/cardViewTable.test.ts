import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_TABLE_HEAD, CARD_VIEW, cardTableWords, writeCardViews } from './cardViewTable.ts'
import type { CardView } from '../../../../../sdk-core/src/lighting/surfaceCache/cardViews.ts'

// The table's views are in the frame of the rows the decode gives the raster: a world whose
// translation is the root's own, rounded once to single precision. A view composed for another
// frame — the eye's — misses every page by the eye's place, which a root at the origin never shows:
// the root here is fifty kilometres out.

/** A card's orthographic view: ten metres a side about `anchor`, its depth over twenty, onto a page
 *  of 128 pixels at the atlas's corner. */
const viewAt = (anchor: [number, number, number]): CardView => {
  const m = new Float64Array(16)
  m[0] = m[5] = 0.2
  m[10] = -0.05
  m[14] = 0.5
  m[15] = 1
  return { anchor, viewProjection: m, rect: { minX: 0, minY: 0, maxX: 128, maxY: 128 } }
}

/** What the GPU computes: the table's single-precision matrix by a single-precision point, each
 *  product and sum rounded as the shader rounds them. */
function clipOf(f: Float32Array, p: readonly number[]) {
  const at = CARD_TABLE_HEAD + CARD_VIEW.at.viewProj
  return [0, 1, 2].map((r) => {
    let sum = f[at + 12 + r]!
    for (let c = 0; c < 3; c++)
      sum = Math.fround(sum + Math.fround(f[at + c * 4 + r]! * Math.fround(p[c]!)))
    return sum
  })
}

test('a card view takes a point of the decoded rows’ world to its page within an eighth of a texel, fifty kilometres out', () => {
  const anchor: [number, number, number] = [50_000.25, 12.5, -37.75]
  const view = viewAt(anchor)
  const words = new Uint32Array(cardTableWords(1))
  const image = { u: words, f: new Float32Array(words.buffer) }
  writeCardViews(image, [{ view, place: 0 }], [])
  const texel = 2 / 128
  for (const offset of [
    [1.5, -2, 3],
    [-4.9, 4.9, -9.5],
    [0, 0, 0],
  ]) {
    const p = offset.map((o, k) => anchor[k]! + o)
    const clip = clipOf(image.f, p)
    const m = view.viewProjection
    const expected = [0, 1, 2].map(
      (r) => m[12 + r]! + m[r]! * offset[0]! + m[4 + r]! * offset[1]! + m[8 + r]! * offset[2]!,
    )
    for (let r = 0; r < 3; r++)
      assert.ok(
        Math.abs(clip[r]! - expected[r]!) < texel / 8,
        `${offset} axis ${r}: ${clip[r]} against ${expected[r]}`,
      )
  }
})
