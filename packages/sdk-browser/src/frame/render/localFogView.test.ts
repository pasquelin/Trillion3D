// The local fog volumes of the view in the light buffer and the lists of their tiles (`./localFogView.ts`,
// `./encodeLocalFog.ts`), on the kit's device: what an image writes — nothing for a scene with none, the
// volumes of the camera, a write only where the block changed, the volumes taken away —, the directional
// light they are lit by, the buffer of the lists made for the tile grid and held while a volume is drawn,
// and the passes that fill it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { LOCAL_FOG_SLOT } from '../../lighting/fog/localLayout.ts'
import { fakeHizDepth } from '../../lighting/shadows/vsm/hizDepth.fixture.ts'
import { LIGHT_BUFFER_AT } from '../backend/state/lightBufferLayout.ts'
import { fogReadOf } from './localFogGpu.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { at, harness, later, sunStore } from './localFogView.fixture.ts'

test('an image writes the volumes of its camera into the light buffer: none for a scene with none, all the volumes once, again only where they changed', async () => {
  const { gpu, volumes, image, written, header } = harness(sunStore())
  image([0, 2, 0])
  assert.deepEqual(written(), [], 'a scene with none writes nothing')
  assert.equal(gpu.computePipelines.length, 0, 'and makes no pass')
  volumes.add({ id: 'a', matrix: at(0, 2, -12) })
  volumes.add({ id: 'behind', matrix: at(0, 2, 30) })
  // Both are written, the one behind the eye too: the culling pass lists them by tile.
  image([0, 2, 0])
  assert.equal(written().length, 2)
  assert.equal(written()[0].offset, LIGHT_BUFFER_AT.localFog)
  assert.deepEqual(written()[0].floats.slice(0, 2), [2, 1], 'two volumes, in the fog’s volume')
  assert.equal(written()[1].offset, LIGHT_BUFFER_AT.localFog + LOCAL_FOG_SLOT.instances * 16)
  // The farther first: the one behind the eye is 30 m from it, the other 12.
  near(
    written()[1].floats.slice(0, 4),
    [0, 0, 30, 5],
    'the farther, from the eye, its radius',
    1e-6,
  )
  // The same image again writes nothing; the eye moved, the volumes' places from it did.
  await later()
  image([0, 2, 0])
  assert.deepEqual(written().length, 1, 'the header only: the pass is ready, the view is tiled')
  image([0, 2, 0])
  assert.deepEqual(written(), [])
  image([0, 2, 2])
  assert.equal(written().length, 1)
  near(written()[0].floats.slice(0, 4), [0, 0, 28, 5], 'moved', 1e-6)
  // The volumes taken away: the header says none, and not tiled, and nothing else is written.
  volumes.remove('a')
  volumes.remove('behind')
  image([0, 2, 2])
  assert.equal(written().length, 1)
  assert.deepEqual(header(0).slice(0, 1), [0])
  assert.deepEqual(header(LOCAL_FOG_SLOT.tiling), [0, 0, 0, 0])
  image([0, 2, 2])
  assert.deepEqual(written(), [])
})

test('the sun the volumes are lit by: the forward directional light, its colour times its strength, through the air toward it where it is the air’s', () => {
  const sunOf = (lights: ReturnType<typeof createSceneLightStore>) => {
    const { volumes, image, header } = harness(lights)
    volumes.add({ id: 'a', matrix: at(0, 2, -12) })
    image([0, 2, 0])
    return { light: header(1), toward: header(2) }
  }
  const store = sunStore()
  const sun = sunOf(store)
  near(sun.light, [4, 2, 1, 1], 'light', 1e-6)
  near(sun.toward, [-0.6, 0.8, 0, 0], 'toward the sun', 1e-6)
  // No directional light, no sun.
  const lamp = createSceneLightStore()
  lamp.add({
    id: 'lamp',
    kind: 'point',
    position: [0, 3, 0],
    color: [1, 1, 1],
    intensity: 5,
    range: 20,
    castsShadow: false,
  })
  assert.deepEqual(sunOf(lamp), { light: [0, 0, 0, 0], toward: [0, 0, 0, 0] })
  // The air's sun is seen through the air toward it at the ground: its transmittance, per channel.
  const air = new Float32Array(76)
  air[ATMOSPHERE_SLOT.planet * 4] = 1
  air[ATMOSPHERE_SLOT.lightSlots * 4] = store.forwardDirectionalSlot
  air.set([0.9, 0.6, 0.3, 1], ATMOSPHERE_SLOT.sunTransmittance * 4)
  const aired = Object.create(store, { atmospherePacked: { value: air } })
  near(sunOf(aired).light, [3.6, 1.2, 0.3, 1], 'through the air', 1e-6)
  // A light that is not the air's is not tinted by it.
  air[ATMOSPHERE_SLOT.lightSlots * 4] = store.forwardDirectionalSlot + 1
  near(sunOf(aired).light, [4, 2, 1, 1], 'not the air’s', 1e-6)
})

test('the lists of the tiles: a buffer made for the tile grid while a volume is drawn, the programs bound to it, the passes that fill it, the buffer let go with the last volume', async () => {
  const { gpu, rt, volumes, stand, image, header } = harness(sunStore())
  volumes.add({ id: 'a', matrix: at(0, 2, -12) })
  image([0, 2, 0])
  assert.deepEqual(header(LOCAL_FOG_SLOT.tiling), [0, 0, 0, 0], 'the pass is compiling: not tiled')
  assert.equal(rt.gpu.localFog?.tiles, undefined, 'and no buffer')
  assert.deepEqual(
    [rt.gpu.localFog?.plan.count, rt.gpu.localFog?.plan.active],
    [1, false],
    'one volume drawn, with no lists',
  )
  assert.equal(fogReadOf(rt)!.tiles, stand.read.tiles, 'the programs bind the stand-in')
  await later()
  const encoder = image([0, 2, 0])
  // 160 × 90 pixels in tiles of 128: two across, one down; 32 volumes at most, four to a word: nine words a tile
  // and one flag a volume.
  const words = 2 * 9 + 32
  assert.deepEqual(header(LOCAL_FOG_SLOT.tiling), [128, 2, 1, 9])
  assert.equal(header(LOCAL_FOG_SLOT.screen)[3], words)
  const tiles = rt.gpu.localFog!.tiles!
  assert.equal(tiles.size, words * 4, 'made for the grid')
  assert.equal(fogReadOf(rt)!.tiles, tiles, 'the programs bind it')
  assert.equal(fogReadOf(rt), fogReadOf(rt), 'one object while nothing changed')
  assert.deepEqual(
    dispatchedEntries(gpu.dispatches),
    ['localCullMain'],
    'the frustum alone, no pyramid',
  )
  assert.equal(encoder !== undefined, true)
  // The depth pyramid of the image: a thread a volume finds the verdicts, then the tiles' pass.
  Object.assign(rt.run, { depthDrawn: true })
  Object.assign(rt.gpu, { reflection: { front: { drawn: -5 } } })
  Object.assign(rt.vis, { gpuHiz: { depth: () => fakeHizDepth } })
  image([0, 2, 0])
  assert.deepEqual(dispatchedEntries(gpu.dispatches), ['localCullVolumesMain', 'localCullMain'])
  // The setting off: the frustum alone again.
  Object.assign(rt.context, { localFogVolumeUsesDepthPyramid: false })
  image([0, 2, 0])
  assert.deepEqual(dispatchedEntries(gpu.dispatches), ['localCullMain'])
  // The view resized: a buffer for the new grid, the old one let go.
  Object.assign(rt.context, { localFogVolumeTileSize: 32 })
  image([0, 2, 0])
  const finer = rt.gpu.localFog!.tiles!
  assert.equal(finer.size, (5 * 3 * 9 + 32) * 4)
  assert.ok(
    finer !== tiles && !gpu.destroyed.includes(tiles),
    'the old grid lives until the image is submitted',
  )
  destroyRetired(gpu.device)
  assert.ok(gpu.destroyed.includes(tiles))
  assert.notEqual(fogReadOf(rt), undefined)
  assert.equal(fogReadOf(rt)!.tiles, finer)
  // The last volume taken away: no buffer, the stand-in again, no pass.
  volumes.remove('a')
  image([0, 2, 0])
  assert.equal(rt.gpu.localFog!.tiles, undefined)
  assert.equal(fogReadOf(rt)!.tiles, stand.read.tiles)
  assert.deepEqual(dispatchedEntries(gpu.dispatches), [])
})

test('the tile side is the run’s, never raised: lists that would not fit a storage buffer — the device’s smaller limit, of the binding or of the buffer — leave the view untiled, said once', async () => {
  const smaller: Record<string, number>[] = [
    { maxStorageBufferBindingSize: 64 },
    { maxBufferSize: 64 },
  ]
  for (const limits of smaller) {
    const { gpu, rt, volumes, said, image, header } = harness(sunStore(), limits)
    volumes.add({ id: 'a', matrix: at(0, 2, -12) })
    image([0, 2, 0])
    await later()
    image([0, 2, 0])
    image([0, 2, 0])
    assert.deepEqual(header(LOCAL_FOG_SLOT.tiling), [0, 0, 0, 0], JSON.stringify(limits))
    assert.equal(rt.gpu.localFog?.tiles, undefined)
    assert.deepEqual(said, ['fog-local-tiles-too-large'], 'said once')
    assert.deepEqual(dispatchedEntries(gpu.dispatches), [])
  }
})

test('the project switch off makes nothing for the volumes: no block written, no pass, no buffer, the programs bound to the stand-in', async () => {
  const { gpu, rt, volumes, stand, image, written } = harness(sunStore())
  Object.assign(rt.setup, { localFog: false })
  volumes.add({ id: 'a', matrix: at(0, 2, -12) })
  image([0, 2, 0])
  await later()
  image([0, 2, 0])
  assert.deepEqual(written(), [])
  assert.equal(gpu.computePipelines.length, 0)
  assert.equal(rt.gpu.localFog, undefined)
  assert.equal(fogReadOf(rt)!.tiles, stand.read.tiles)
})
