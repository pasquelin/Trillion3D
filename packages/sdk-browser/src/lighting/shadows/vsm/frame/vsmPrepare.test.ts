// The shadow maps' pipelines are compiled off the thread before the first frame
// (`prepareVsmPipelines`): for the set the scene's casting lights are first granted, every compute
// pipe of the shadow passes — invalidation, marking, page management, the raster's candidates,
// views, cull, expand and arguments —, the raster's render pipeline of every tier and the
// projection's pipeline of every kind set. The first lit frame then creates no shadow pipeline, at
// once or off the thread.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from '../../../../../../sdk-core/src/scene/light/store.ts'
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
import { VSM_RENDER_CORNER_TIERS, VSM_RENDER_TIERS } from '../render/renderParamsWgsl.ts'

/** A pipeline's name, before the tag the session gives its label (`vsm.projection @t3d:1`). */
const nameOf = (descriptor: { label?: string }) => (descriptor.label ?? '').split(' ')[0]

test('the first lit frame creates no shadow pipeline at once: prepare compiled them off the thread', async () => {
  installGpuGlobals()
  const gpu = fakeDevice({ ...BACKEND, limits: SHADOW_LIMITS })
  const sceneLights = createSceneLightStore()
  sceneLights.add(SUN)
  const { fixture, backend } = quadBackend(gpu.device, { sceneLights })
  const made = { sync: [] as string[], async: [] as string[] }
  const device = gpu.device as GPUDevice
  const compute = device.createComputePipeline.bind(device),
    render = device.createRenderPipeline.bind(device)
  device.createComputePipeline = (d) => (made.sync.push(nameOf(d)), compute(d))
  device.createRenderPipeline = (d) => (made.sync.push(nameOf(d)), render(d))
  device.createComputePipelineAsync = async (d) => (made.async.push(nameOf(d)), compute(d))
  device.createRenderPipelineAsync = async (d) => (made.async.push(nameOf(d)), render(d))
  const shadow = (names: string[]) => names.filter((name) => name.startsWith('vsm.'))
  try {
    await backend.prepare()
    assert.deepEqual(shadow(made.sync), [], 'prepare creates none at once')
    const prepared = shadow(made.async)
    assert.ok(prepared.length >= 20, `${prepared.length} shadow pipelines compiled by prepare`)
    assert.ok(prepared.includes('vsm.projection'), "the projection's pipeline")
    for (let tier = 0; tier < VSM_RENDER_CORNER_TIERS; tier++)
      assert.ok(prepared.includes(`vsm.render.raster${tier}`), `the raster of tier ${tier}`)
    // A scene with no voxel row compiles no voxel tier.
    for (let tier = VSM_RENDER_CORNER_TIERS; tier < VSM_RENDER_TIERS; tier++)
      assert.ok(!prepared.includes(`vsm.render.raster${tier}`), `no raster of voxel tier ${tier}`)
    made.sync.length = made.async.length = 0
    backend.render(camera())
    await backend.flush()
    assert.ok(backend.metrics().shadowVsmLights, 'the frame shadowed its sun')
    assert.deepEqual(shadow(made.sync), [], 'the frame creates none at once')
    assert.deepEqual(shadow(made.async), [], 'nor any off the thread: its kind set was prepared')
  } finally {
    disposeQuadRun(backend, fixture)
  }
})
