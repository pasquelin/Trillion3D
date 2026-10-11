// A card is told apart from a cluster, and from another card, by an integer: the visibility stage
// writes `VIS_CARD_BASE | slot`, the surface stage keeps the pixels whose identifier is its own.
// No depth is written or compared by the surface stage, so no rounding of a depth formula — a
// compiler's, a driver's — can reject a card the visibility stage drew; and the identifier names a
// row past every page table, which each pass reading identifiers already leaves.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../../impostor/lent.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { cardPassWgsl } from './cardWgsl.ts'
import { VIS_CARD_BASE, VIS_CARD_ROWS, VIS_TRIANGLE_BITS } from '../../visibility/visWords.ts'
import { VIS_MAX_PAGES } from '../../visibility/types.ts'
import { VIEW_ROWS } from '../row/tableRows.ts'
import { NO_PAGE_ID } from '../../taa/pageIdWgsl.ts'

const wgsl = cardPassWgsl()
const body = (entry: string) => wgsl.slice(wgsl.indexOf(`fn ${entry}(`)).split('\n}')[0]

test('the card identifier names a row no page table holds', () => {
  const { cardId } = shaderRun<{ cardId(slot: number): number }>(wgsl, ['cardId'], {})
  for (const slot of [0, 1, 255, 256, 70_000, 2 ** 24 - 1]) {
    const id = cardId(slot) >>> 0
    assert.equal(id, (VIS_CARD_BASE | slot) >>> 0)
    assert.ok(id >>> VIS_TRIANGLE_BITS > VIS_MAX_PAGES, `slot ${slot} is past every row`)
  }
  assert.ok(VIS_MAX_PAGES < VIS_CARD_ROWS && VIEW_ROWS < VIS_CARD_ROWS)
})

test('the surface stage reads the identifier and compares no depth; the visibility stages write it', () => {
  const surface = body('card_fs')
  assert.match(surface, /textureLoad\(cardIds,vec2i\(in\.clip\.xy\),0\)\.r!=cardId\(in\.card\)/)
  assert.doesNotMatch(wgsl, /struct CardOut\{[^}]*frag_depth/)
  assert.doesNotMatch(surface, /px\.depth/)
  for (const entry of ['card_vis_fs', 'card_vis_hiz_fs'])
    assert.match(body(entry), /cardId\(in\.card\)/, entry)
})

test('the temporal passes read a card pixel as the background', () => {
  const none = new Function('id', `return ${NO_PAGE_ID.replaceAll(/(\d+)u/g, '$1')}`) as (
    id: number,
  ) => boolean
  assert.equal(none(0), true)
  assert.equal(none((VIS_CARD_BASE | 5) >>> 0), true)
  assert.equal(none((1 << VIS_TRIANGLE_BITS) | 3), false)
  assert.equal(none((VIS_MAX_PAGES + 1) << VIS_TRIANGLE_BITS), false)
})
