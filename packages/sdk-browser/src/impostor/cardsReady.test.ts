// #1527: a mesh's cards are drawn only once its maps hold every tile they read — its finest card's
// level to one past its coarsest's, the level the card pass reads (`card_vs`) — and until then its
// roots keep their clusters: never a hole, never a card coarser than its atlas. Fails on the old
// code: a card took its mesh's atlas whole, whatever the levels its pixels read.
import test from 'node:test'
import assert from 'node:assert/strict'
import './lent.fixture.ts'
import { createImpostorCards, planImpostorCards } from './cards.ts'
import type { CardAsk } from '../webgpu/tile/cardTiles.ts'
import { CARD_FLOATS } from './cardSlots.ts'
import { engineAt, impostorScene, impostorSection, VIEWPORT } from './section.fixture.ts'
import { CARD_ROOT } from '../visibility/shader/spriteWgsl.ts'
import { focalPixels } from '../../../math/src/projection/camera.ts'

/** Cards whose maps answer `ready` for each ask, every ask kept. */
function planned(ready: (ask: CardAsk) => boolean) {
  const { fixture, roots } = impostorScene()
  const asks: CardAsk[] = []
  const state = createImpostorCards(impostorSection, {
    tilesOf: () => [1, 2, 3],
    ready: (_, ask) => (asks.push({ ...ask }), ready(ask)),
  })
  const plan = (z: number) => planImpostorCards(state, roots, engineAt(z), VIEWPORT)
  return { fixture, roots, state, asks, plan }
}

test('a card whose maps lack a tile it reads is not drawn: its root keeps its clusters', () => {
  let resident = false
  const { fixture, roots, state, asks, plan } = planned(() => resident)
  plan(200)
  assert.equal(roots[0].mark ?? 0, 0, 'no card bit: the clusters are drawn')
  assert.equal(state.count, 0)
  assert.equal(asks.length, 1, 'its maps asked')
  resident = true
  plan(200)
  assert.equal(roots[0].mark, CARD_ROOT, 'drawn once every tile it reads resides')
  assert.equal(state.count, 1)
  fixture.geometry.dispose()
})

test('the levels asked hold the level the card pass reads and the one its blend mixes in', () => {
  for (const z of [200, 800, 3000]) {
    const { fixture, state, asks, plan } = planned(() => true)
    plan(z)
    assert.equal(state.count, 1, `drawn at ${z}`)
    // The card pass's level (`card_vs`): log2 of the distance less the texel depth's logarithm and
    // the focal length's, at least 0.
    const cam = engineAt(z),
      record = state.slots.records.subarray(0, CARD_FLOATS)
    // The card's centre: its world's linear part on the pivot, then its translation's two words.
    const centre = [0, 1, 2].map(
      (k) =>
        [0, 1, 2].reduce((sum, j) => sum + record[4 * j + k] * record[40 + j], 0) +
        record[12 + k] +
        record[16 + k],
    )
    const distance = Math.hypot(...centre.map((value, k) => value - cam.eye[k]))
    const focal = focalPixels(cam.projection, VIEWPORT[0], VIEWPORT[1])
    const level = Math.max(0, Math.log2(distance) - record[39] - Math.log2(focal))
    const [ask] = asks.slice(-1)
    assert.ok(ask.from <= Math.floor(level), `${z}: from ${ask.from}, level ${level}`)
    assert.ok(ask.to >= Math.floor(level) + 1, `${z}: to ${ask.to}, level ${level}`)
    assert.ok(ask.to - ask.from <= 2, `${z}: one card reads one level and the next`)
    fixture.geometry.dispose()
  }
})

test('a card nearing past the levels its maps hold gives its root back its clusters', () => {
  // The maps hold the levels a card reads from 3000 m on alone: one nearer reads finer ones.
  let farFrom = Infinity
  const { fixture, roots, asks, plan } = planned((ask) => ask.from >= farFrom)
  plan(3000)
  farFrom = asks[0].from
  plan(3000)
  assert.equal(roots[0].mark, CARD_ROOT, 'far, its levels reside')
  plan(200)
  assert.ok(asks.at(-1)!.from < farFrom, 'nearer, a finer level is read')
  assert.equal(roots[0].mark ?? 0, 0, 'and the clusters are drawn again')
  fixture.geometry.dispose()
})
