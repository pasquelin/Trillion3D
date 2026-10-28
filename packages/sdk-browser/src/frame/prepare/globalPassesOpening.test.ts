// The passes that depend on no light — the exposure's measure, the tone table, the blue noise, the fog, the shadow maps' pipelines — are asked at the opening of a scene with
// no light yet: the lamp its page adds after the opening finds them compiled, and the frame that draws it creates none of them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { SUN } from '../../../../sdk-core/src/scene/light/shadow/lightShadow.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  SHADOW_LIMITS,
  camera,
  disposeQuadRun,
  quadBackend,
} from '../backend/testScenes.fixture.ts'

/** The passes of no light: by the name their pipelines are labelled with. */
const GLOBAL = /exposure|tone|blue ?noise|height ?fog|^vsm\./i

test('a lamp added after the opening finds the global passes compiled: the frame that draws it creates none', async () => {
  installGpuGlobals()
  const gpu = fakeDevice({ ...BACKEND, limits: SHADOW_LIMITS })
  const sceneLights = createSceneLightStore()
  const { fixture, backend } = quadBackend(gpu.device, { sceneLights })
  const made: string[] = []
  const device = gpu.device as GPUDevice
  const label = (descriptor: { label?: string }) => (descriptor.label ?? '').trim()
  const compute = device.createComputePipeline.bind(device),
    render = device.createRenderPipeline.bind(device)
  device.createComputePipeline = (d) => (made.push(label(d)), compute(d))
  device.createRenderPipeline = (d) => (made.push(label(d)), render(d))
  device.createComputePipelineAsync = async (d) => (made.push(label(d)), compute(d))
  device.createRenderPipelineAsync = async (d) => (made.push(label(d)), render(d))
  try {
    await backend.prepare()
    assert.ok(
      made.some((name) => /^vsm\./.test(name)),
      'the shadow maps are compiled by the preparation, with no light in the scene',
    )
    made.length = 0
    sceneLights.add(SUN)
    backend.render(camera())
    await backend.flush()
    assert.deepEqual(
      made.filter((name) => GLOBAL.test(name)),
      [],
      'the frame of the first lamp creates no global pass',
    )
  } finally {
    disposeQuadRun(backend, fixture)
  }
})
