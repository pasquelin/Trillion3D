// A card resolves textured whatever the two stages' depths: the visibility stage writes the card's
// identifier (`VIS_CARD_BASE | slot`), the surface stage keeps the pixels whose identifier is its
// own and compares no depth. The proof gives the visibility stage a view whose depth differs from
// the surface stage's by 2⁻¹⁸ — thirty-two units in the last place, four times the 2⁻²⁰ nudge the
// surface stage once relied on, where Chrome's compiler could round the two apart — and the card is
// still drawn with its atlas colour, a nearer card still covers a farther one, and no pixel outside
// a card is written.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts'

type Texel = { id: number; colour: number[]; wanted: number[] }
type Reading = Awaited<ReturnType<typeof import('./cardIdPage.ts').runCardId>> & {
  base: number
  one: Texel & {
    depth: number
    rebuilt: number
    written: number
    tagged: number
    outside: boolean
  }
  two: { middle: Texel; ring: Texel; written: number; tagged: number }
}

const near = (a: number[], b: number[], within: number) =>
  a.every((v, k) => Math.abs(v - b[k]) <= within)

test('a card is drawn textured when the depths of its two stages differ by thirty-two ulps', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'cardIdPage.ts'),
    'cardIdProof',
    'runCardId',
  )) as unknown as Reading
  assertSoundProof(reading as unknown as Parameters<typeof assertSoundProof>[0])
  const { one, two, base } = reading
  console.log(JSON.stringify({ adapter: reading.adapter, one, two }))
  // The rule the surface stage had: its depth, nudged by 2⁻²⁰, no less than the visibility stage's.
  assert.ok(
    one.rebuilt * (1 + 2 ** -20) < one.depth,
    'the old rule would have rejected this card: the stages differ past its nudge',
  )
  assert.equal(one.id >>> 24, base >>> 24, 'the visibility stage wrote the card identifier')
  assert.ok(one.tagged > 100, 'the card covers pixels')
  assert.equal(one.written, one.tagged, 'every pixel the card kept is written, and no other')
  assert.ok(near(one.colour, one.wanted, 0.02), `the atlas colour, not white: ${one.colour}`)
  assert.equal(one.outside, false, 'a pixel outside the card is not written')
  assert.ok(near(two.middle.colour, two.middle.wanted, 0.02), 'the nearer card covers the middle')
  assert.equal(two.middle.id & 0xff, 1, 'by its slot')
  assert.ok(near(two.ring.colour, two.ring.wanted, 0.02), 'the farther one shows around it')
  assert.equal(two.ring.id & 0xff, 0)
  assert.equal(two.written, two.tagged, 'each pixel is written by the one card that kept it')
})
