// The lighting channels in the cull of the lights of a tile: a light is dropped for a card that shares none with it, before any test of its reach.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { LIGHTS, recordOf } from '../../direct/lightReach.fixture.ts'
import { cullWgsl } from './cullWgsl.ts'
import { add, scale } from '../../../../../math/src/vector/vectorTuple.fixture.ts'
import { atmosphere, cull, tileBox } from './cullWgsl.fixture.ts'

/** A light of `LIGHTS` kind `kind` in the lighting channels `mask`, its record, and a point it surely reaches (metres). */
function channelled(kind: SceneLight['kind'], mask: number) {
  const index = LIGHTS.findIndex((light) => light.kind === kind)
  const light: SceneLight = {
    ...LIGHTS[index],
    lightingChannels: { channel0: !!(mask & 1), channel1: !!(mask & 2), channel2: !!(mask & 4) },
  }
  const r = recordOf(light)
  const reached =
    kind === 'directional'
      ? [0, 0, 0]
      : add(r.positionRange.slice(0, 3), scale(r.directionCone.slice(0, 3), 0.5))
  return { index, r, reached }
}

test('a light is rejected for a card whose object shares no lighting channel with it, before any test of its reach', () => {
  const { tileLightWeight } = cull(atmosphere(-1, false))
  for (const kind of ['point', 'spot', 'rect', 'directional'] as const) {
    const onZero = channelled(kind, 1)
    assert.ok(
      tileLightWeight(onZero.index, onZero.r, tileBox(onZero.reached, 1e-3, 1)) >= 0,
      `${kind}: a card on channel 0 keeps a light on channel 0`,
    )
    assert.equal(
      tileLightWeight(onZero.index, onZero.r, tileBox(onZero.reached, 1e-3, 2)),
      -1,
      `${kind}: a card on channel 1 drops a light on channel 0`,
    )
  }
  const none = channelled('point', 0)
  assert.equal(tileLightWeight(none.index, none.r, tileBox(none.reached, 1e-3, 7)), -1)
  const lit = channelled('point', 1)
  assert.equal(tileLightWeight(lit.index, lit.r, tileBox(lit.reached, 1e-3, 0)), -1)
})

test('a light is kept for a card whose object shares one of its lighting channels, however many the card is in', () => {
  const { tileLightWeight } = cull(atmosphere(-1, false))
  for (const kind of ['point', 'spot', 'rect', 'directional'] as const) {
    const onOne = channelled(kind, 2)
    const both = tileLightWeight(onOne.index, onOne.r, tileBox(onOne.reached, 1e-3, 1 | 2))
    assert.ok(both >= 0, `${kind}: a card on channels 0 and 1 keeps a light on channel 1`)
    assert.equal(
      both,
      tileLightWeight(onOne.index, onOne.r, tileBox(onOne.reached, 1e-3, 2)),
      `${kind}: the weight does not depend on the card's other channels`,
    )
    assert.equal(tileLightWeight(onOne.index, onOne.r, tileBox(onOne.reached, 1e-3, 1)), -1)
  }
})

test('the channel test is the first of the reach of a light and the reach the first of its weight, and the card reads its channels from its flags word', () => {
  const text = wgslSource(cullWgsl(4))
  assert.match(
    text,
    /fn tileLightReached\(light:DirectLight,b:TileBox\)->bool \{\n if\(\(b\.card\.channels&lightChannelsOf\(light\)\)==0u\)\{return false;\}\n/,
  )
  assert.match(
    text,
    /fn tileLightWeight\(rank:u32,light:DirectLight,b:TileBox\)->f32 \{\n if\(!tileLightReached\(light,b\)\)\{return -1\.0;\}\n/,
  )
  assert.match(text, /c\.channels=storedToChannels\(c\.flags>>SC_CARD_CHANNELS_SHIFT\);/)
})
