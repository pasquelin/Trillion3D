// The picture mapped on a rectangle light: what a light may name, how a store holds the slot of its picture, and what moves with it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_FIELD, NO_RECT_ATLAS_SLOT, baseOf } from './fields.ts'
import { createSceneLightStore } from './store.ts'
import type { SceneLight } from './contracts.ts'
import { LIGHT } from './store.fixture.ts'

const RECT: SceneLight = {
  id: 'r0',
  kind: 'rect',
  color: [1, 1, 1],
  castsShadow: false,
  position: [0, 2, 0],
  direction: [0, -1, 0],
  right: [1, 0, 0],
  size: [2, 1],
  range: 10,
  intensity: 5,
}

const refused = (light: SceneLight, pattern: RegExp) => {
  const store = createSceneLightStore()
  assert.throws(() => store.add(light), pattern)
}

test('a rect names a picture, with a share of it and where it starts', () => {
  const store = createSceneLightStore()
  store.add({
    ...RECT,
    sourceTexture: 'window',
    sourceTextureScale: [0.5, 1],
    sourceTextureOffset: [0.25, 0],
  })
  const light = store.light('r0')!
  assert.equal(light.sourceTexture, 'window')
  assert.deepEqual(light.sourceTextureScale, [0.5, 1])
  assert.deepEqual(light.sourceTextureOffset, [0.25, 0])
  assert.equal(store.sourceTextured, 1)
})

test('only a rect has a picture, and a share or offset needs one', () => {
  refused({ ...LIGHT, sourceTexture: 'x' } as SceneLight, /sourceTexture exists only for a rect/)
  refused(
    { ...RECT, sourceTextureScale: [1, 1] },
    /sourceTextureScale exists only beside a sourceTexture/,
  )
  refused(
    { ...RECT, sourceTextureOffset: [0, 0] },
    /sourceTextureOffset exists only beside a sourceTexture/,
  )
  refused({ ...RECT, sourceTexture: '' }, /sourceTexture expects a picture id/)
})

test('the share is above 0 up to 1, the offset from 0 to 1', () => {
  refused(
    { ...RECT, sourceTexture: 'x', sourceTextureScale: [0, 1] },
    /sourceTextureScale expects two numbers above 0 up to 1/,
  )
  refused({ ...RECT, sourceTexture: 'x', sourceTextureScale: [1.5, 1] }, /above 0 up to 1/)
  refused(
    { ...RECT, sourceTexture: 'x', sourceTextureOffset: [-0.1, 0] },
    /sourceTextureOffset expects two numbers from 0 to 1/,
  )
  refused(
    { ...RECT, sourceTexture: 'x', sourceTextureOffset: [0] as unknown as [number, number] },
    /two numbers/,
  )
})

test('the slot of a picture lies in lanes only a rect owns, and a write of the light keeps it', () => {
  const store = createSceneLightStore()
  store.add({ ...RECT, sourceTexture: 'window' })
  assert.equal(store.rectAtlasSlotOf(0).width, 0, 'no place until the atlas gives one')
  store.assignRectAtlasSlot(0, { x: 64, y: 128, width: 256, height: 128 })
  assert.deepEqual(store.rectAtlasSlotOf(0), { x: 64, y: 128, width: 256, height: 128 })
  const at = baseOf(0)
  assert.equal(store.packed[at + LIGHT_FIELD.rectAtlasOriginX], 64)
  assert.equal(store.packed[at + LIGHT_FIELD.rectAtlasWidth], 256)
  assert.equal(store.packed[at + LIGHT_FIELD.rectAtlasHeight], 128)
  store.set('r0', { intensity: 6 })
  assert.deepEqual(
    store.rectAtlasSlotOf(0),
    { x: 64, y: 128, width: 256, height: 128 },
    'the slot stays through another change',
  )
})

test('another picture, or another share of it, has no slot until the atlas gives it one', () => {
  const store = createSceneLightStore()
  store.add({ ...RECT, sourceTexture: 'window' })
  store.assignRectAtlasSlot(0, { x: 8, y: 8, width: 64, height: 64 })
  const epoch = store.rectAtlasEpoch
  store.set('r0', { sourceTextureScale: [0.5, 0.5] })
  assert.deepEqual(store.rectAtlasSlotOf(0), NO_RECT_ATLAS_SLOT)
  assert.equal(store.rectAtlasEpoch, epoch + 1)
  store.assignRectAtlasSlot(0, { x: 8, y: 8, width: 32, height: 32 })
  store.set('r0', { sourceTexture: 'door' })
  assert.deepEqual(store.rectAtlasSlotOf(0), NO_RECT_ATLAS_SLOT)
})

test('a light that is not a rect leaves the lanes it shares to its own fields', () => {
  const store = createSceneLightStore()
  store.add({
    id: 's0',
    kind: 'spot',
    color: [1, 1, 1],
    castsShadow: false,
    position: [0, 0, 0],
    direction: [0, -1, 0],
    range: 10,
    outerConeAngle: 0.5,
    innerConeAngle: 0.2,
    intensity: 3,
  })
  const at = baseOf(0)
  assert.equal(
    store.packed[at + LIGHT_FIELD.cosInner],
    Math.fround(Math.cos(0.2)),
    'a spot keeps its inner cone',
  )
  assert.equal(store.packed[at + LIGHT_FIELD.rectAtlasHeight], 0)
})

test('a rect turned into another kind of light takes nothing of the slot with it', () => {
  const store = createSceneLightStore()
  store.add({ ...RECT, sourceTexture: 'window' })
  store.assignRectAtlasSlot(0, { x: 8, y: 8, width: 64, height: 64 })
  store.remove('r0')
  store.add({ ...RECT, id: 'r1' })
  assert.deepEqual(
    store.rectAtlasSlotOf(0),
    NO_RECT_ATLAS_SLOT,
    'a slot freed is zero for the light that takes it',
  )
  assert.equal(store.sourceTextured, 0)
})

test('a light removed moves the last one into its slot with its picture', () => {
  const store = createSceneLightStore()
  store.add({ ...RECT, id: 'a' })
  store.add({ ...RECT, id: 'b', sourceTexture: 'window' })
  store.assignRectAtlasSlot(1, { x: 16, y: 0, width: 128, height: 64 })
  store.remove('a')
  assert.equal(store.slotOf('b'), 0)
  assert.deepEqual(store.rectAtlasSlotOf(0), { x: 16, y: 0, width: 128, height: 64 })
})
