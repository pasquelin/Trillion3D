// The shadow maps' tables and mask follow the view, never the world: a light no lit point of the
// frame is in reach of costs no map (`vsmLightSeen`), so neither does it widen the page table, its
// marks and requests, nor add a layer to the projection's mask. Generated worlds of growing extent
// — lamps at a constant spacing, the more the wider — seen through the same view hold the same set.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from '../../../../../../sdk-core/src/index.ts'
import type { SceneLight } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import { SUN } from '../../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts'
import { installGpuGlobals } from '../../../../../../../tests/kit/gpu/globals.ts'
import { BACKEND, fakeDevice } from '../../../../../../../tests/kit/gpu/fakeDevice.ts'
import { SHADOW_LIMITS, camera, disposeQuadRun, quadBackend } from '../../testScenes.fixture.ts'

const light = (id: string, kind: 'point' | 'spot', position: number[], range: number) =>
  ({
    id,
    kind,
    position,
    range,
    ...(kind === 'spot' ? { direction: [0, 0, -1], coneAngle: 0.6 } : {}),
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: true,
  }) as SceneLight

/** The sun, two spots lighting the quad the camera looks at, and `side`² point lamps 4 m apart
 *  behind the camera — out of its view, each within reach of nothing it sees. */
function world(side: number, near = 0) {
  const lights = createSceneLightStore()
  lights.add(SUN)
  // Lamps a step before the quad: each face of each asks finer than one page, a full map.
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
async function shadowSet(side: number, near = 0) {
  installGpuGlobals()
  const gpu = fakeDevice({ ...BACKEND, limits: SHADOW_LIMITS })
  const { fixture, backend } = quadBackend(gpu.device, {
    sceneLights: world(side, near),
    // A view wide enough that a lamp a step away asks its faces finer than one page.
    viewport: [2048, 2048],
  })
  try {
    await backend.prepare()
    for (let image = 0; image < 2; image++) {
      backend.render(camera())
      await backend.flush()
    }
    const live = <T extends { label?: string }>(made: T[], label: RegExp) =>
      made.filter((it) => !gpu.destroyed.includes(it) && label.test(it.label ?? ''))
    return {
      shadowed: backend.metrics().shadowVsmLights,
      tables: live(gpu.buffers, /^vsm\.page(Table|Marks|Requests)/).reduce((s, b) => s + b.size, 0),
      maskLayers: live(gpu.textures, /^vsm\.engine\.shadowMask$/).map((t) => t.depthOrArrayLayers),
    }
  } finally {
    disposeQuadRun(backend, fixture)
  }
}

test('worlds of growing extent seen through the same view hold the same shadow set', async () => {
  const small = await shadowSet(2)
  assert.equal(small.shadowed, 3, 'the sun and both spots cast')
  assert.ok(small.tables > 0 && small.maskLayers.length === 1, JSON.stringify(small))
  for (const side of [8, 16]) assert.deepEqual(await shadowSet(side), small, `${side}² lamps`)
})

test('lamps near the eye past the first set of maps grow its tables in the frame, every one shadowed', async () => {
  const first = await shadowSet(2)
  const near = await shadowSet(2, 16)
  assert.equal(near.shadowed, 3 + 16, 'the sun, both spots and every near lamp cast')
  assert.ok(near.tables > first.tables, `${near.tables} > ${first.tables}: the tables grew`)
})
