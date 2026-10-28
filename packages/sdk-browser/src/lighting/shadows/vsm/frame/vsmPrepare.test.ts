// The shadow maps' pipelines are compiled off the thread before the first frame
// (`prepareVsmPipelines`): for the set the scene's casting lights are first granted, every compute
// pipe of the shadow passes — invalidation, marking, page management, the raster's candidates,
// views, cull, expand and arguments —, the raster's render pipeline of every one-sided and
// two-sided tier (the voxel tiers' wait for a voxel brick) and the
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
import { VSM_RENDER_SOFTWARE_BIN, vsmRenderTiersDrawn } from '../render/renderParamsWgsl.ts'

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
    // The one-sided and the two-sided tiers: a first double-sided material waits for no compile.
    const drawn = vsmRenderTiersDrawn({ twoSided: true, voxels: false })
    for (const tier of drawn)
      assert.ok(prepared.includes(`vsm.render.raster${tier}`), `the raster of tier ${tier}`)
    // A scene with no voxel brick compiles no tier of theirs.
    for (let tier = 0; tier < VSM_RENDER_SOFTWARE_BIN; tier++)
      if (!drawn.includes(tier))
        assert.ok(!prepared.includes(`vsm.render.raster${tier}`), `no raster of tier ${tier}`)
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

test('a sun with shadows added after the opening finds the shadow pipelines compiled: a scene with no light is laid out for one sun', async () => {
  installGpuGlobals()
  const gpu = fakeDevice({ ...BACKEND, limits: SHADOW_LIMITS })
  const sceneLights = createSceneLightStore()
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
    assert.ok(shadow(made.async).length >= 20, 'prepare compiled them with no light in the scene')
    made.sync.length = made.async.length = 0
    sceneLights.add(SUN)
    backend.render(camera())
    await backend.flush()
    assert.ok(backend.metrics().shadowVsmLights, 'the frame shadowed its sun')
    assert.deepEqual(shadow(made.sync), [], 'the frame creates none at once')
    assert.deepEqual(shadow(made.async), [], 'nor any off the thread')
  } finally {
    disposeQuadRun(backend, fixture)
  }
})
