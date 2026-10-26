// The shadow maps' tables and mask follow the view, never the world: a light no lit point of the
// frame is in reach of costs no map (`vsmLightSeen`), so neither does it widen the page table, its
// marks and requests, nor add a layer to the projection's mask. Generated worlds of growing extent
// — lamps at a constant spacing, the more the wider — seen through the same view hold the same set.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from '../../../../../../sdk-core/src/scene/light/store.ts'
import type { SceneLight } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import type { ShadowOptions } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { SUN } from '../../../../../../sdk-core/src/scene/light/shadow/lightShadow.fixture.ts'
import { installGpuGlobals } from '../../../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  SHADOW_LIMITS,
  camera,
  disposeQuadRun,
  quadBackend,
} from '../../../../frame/backend/testScenes.fixture.ts'

const light = (id: string, kind: 'point' | 'spot', position: number[], range: number) =>
  ({
    id,
    kind,
    position,
    range,
    ...(kind === 'spot' ? { direction: [0, 0, -1], outerConeAngle: 0.6 } : {}),
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: true,
  }) as SceneLight

/** The sun, two spots lighting the quad the camera looks at, and `side`² point lamps 4 m apart
 *  behind the camera — out of its view, each within reach of nothing it sees. */
function world(side: number, near = 0, extra: SceneLight[] = []) {
  const lights = createSceneLightStore()
  lights.add(SUN)
  for (const light of extra) lights.add(light)
  // Lamps a step before the quad: each face of each asks its finest mip but one, a quarter of a
  // page-table block (`tableBlocks.ts`).
  for (let i = 0; i < near; i++) lights.add(light(`near ${i}`, 'point', [i / near - 0.5, 0, 1], 3))
  for (const x of [-0.5, 0.5]) lights.add(light(`spot ${x}`, 'spot', [x, 0, 2], 4))
  for (let i = 0; i < side * side; i++) {
    const [x, z] = [(i % side) * 4 - 2 * side, 20 + Math.floor(i / side) * 4]
    lights.add(light(`lamp ${i}`, 'point', [x, 1, z], 1))
  }
  return lights
}

/** The set a frame of `world(side)` holds: the lights it shadows, the bytes of its page table,
 *  marks and requests, and its mask's layers. */
async function shadowSet(
  side: number,
  near = 0,
  settings: ShadowOptions = {},
  extra: SceneLight[] = [],
) {
  installGpuGlobals()
  const gpu = fakeDevice({ ...BACKEND, limits: SHADOW_LIMITS })
  const { fixture, backend } = quadBackend(gpu.device, {
    sceneLights: world(side, near, extra),
    // A view wide enough that a lamp a step away asks its faces finer than one page, drawn at its
    // own size: the display's default fraction (about 0.58 here) would ask them a mip coarser.
    viewport: [2048, 2048],
    renderScale: 1,
    ...settings,
  })
  try {
    await backend.prepare()
    for (let image = 0; image < 2; image++) {
      backend.render(camera())
      await backend.flush()
    }
    const live = <T extends { label?: string }>(made: T[], label: RegExp) =>
      made.filter((it) => !gpu.destroyed.includes(it) && label.test(it.label ?? ''))
    const shadowed = backend.metrics().shadowVsmLights
    assert.ok(typeof shadowed === 'number', 'the frame reports how many lights it shadows')
    return {
      shadowed,
      tables: live(gpu.buffers, /^vsm\.page(Table|Marks|Requests)/).reduce((s, b) => s + b.size, 0),
      // The projection's masks, one of each pass: the suns' layers (a sun a layer) and the local lights' texture.
      sunMaskLayers: live(gpu.textures, /^vsm\.engine\.sunMask$/).map((t) => t.depthOrArrayLayers),
      localMasks: live(gpu.textures, /^vsm\.engine\.localMask$/).length,
    }
  } finally {
    disposeQuadRun(backend, fixture)
  }
}

test('worlds of growing extent seen through the same view hold the same shadow set', async () => {
  const small = await shadowSet(2)
  assert.equal(small.shadowed, 3, 'the sun and both spots cast')
  assert.ok(
    small.tables > 0 && small.sunMaskLayers.length === 1 && small.localMasks === 1,
    JSON.stringify(small),
  )
  for (const side of [8, 16]) assert.deepEqual(await shadowSet(side), small, `${side}² lamps`)
})

test('lamps near the eye past the first set of maps grow its tables in the frame, every one shadowed', async () => {
  const first = await shadowSet(2)
  // 40 lamps of six faces a quarter block each, beside the sun's levels and the spots: past the
  // first set's 64 blocks (`fullMapsFor`).
  const near = await shadowSet(2, 40)
  assert.equal(near.shadowed, 3 + 40, 'the sun, both spots and every near lamp cast')
  assert.ok(near.tables > first.tables, `${near.tables} > ${first.tables}: the tables grew`)
})

test("a sun's tables follow the clipmap levels the settings ask, its maps all the same cast", async () => {
  const first = await shadowSet(2)
  // Thirty-one levels, from 0 to 30: more maps than the first set's 64 blocks hold beside the rest.
  const deep = await shadowSet(2, 0, { shadowClipmapFirstLevel: 0, shadowClipmapLastLevel: 30 })
  assert.equal(deep.shadowed, first.shadowed, 'the same lights cast')
  assert.ok(deep.tables > first.tables, `${deep.tables} > ${first.tables}: the tables follow`)
})

/** A rectangle a step before the quad, facing it, that casts a shadow. */
const PANEL = {
  ...{ id: 'panel', kind: 'rect', position: [0, 0, 1], range: 3, direction: [0, 0, -1] },
  ...{ right: [1, 0, 0], size: [1, 1], color: [1, 1, 1], intensity: 1, castsShadow: true },
} as SceneLight

test('a rectangle that casts takes a shadow like a point light, unless the point-light gates say no', async () => {
  const first = await shadowSet(2)
  const panel = await shadowSet(2, 0, {}, [PANEL])
  assert.equal(panel.shadowed, first.shadowed + 1, 'the rectangle casts beside the sun and spots')
  for (const off of ['shadowPointLightShadows', 'shadowPointLightCubemaps'] as const)
    assert.deepEqual(await shadowSet(2, 0, { [off]: false }, [PANEL]), first, off)
  // The fade: a minimum resolution no light reaches takes every local light's shadow away.
  const faded = await shadowSet(2, 0, { shadowMinResolution: 1e6, shadowFadeResolution: 2e6 }, [
    PANEL,
  ])
  assert.equal(faded.shadowed, 1, 'only the sun is left')
})
