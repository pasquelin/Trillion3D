import test from 'node:test'
import assert from 'node:assert/strict'
import { probeExplorerCapabilities } from './capabilityProbe.ts'
import { grantedGpuFeatures } from '../gpu/core/gpuCaps.ts'
import { requestExplorerDevice } from './gpuDevice.ts'
import type { ExplorerSession } from './session.ts'
import { WEBGPU_REQUIRED_LIMITS } from './engine/common.ts'

/** An adapter offering `offered`; its device grants exactly what was asked. */
function adapterOffering(offered: string[], limits: Record<string, number> = {}) {
  const asked: GPUFeatureName[][] = []
  const limitsAsked: Record<string, number>[] = []
  const adapter = {
    features: new Set(offered),
    limits,
    requestDevice: async ({ requiredFeatures = [], requiredLimits = {} }: GPUDeviceDescriptor) => {
      asked.push([...requiredFeatures])
      limitsAsked.push(requiredLimits as Record<string, number>)
      return { features: new Set(requiredFeatures) } as unknown as GPUDevice
    },
  } as unknown as GPUAdapter
  return { adapter, asked, limitsAsked }
}

const OFFERED = [
  'shader-f16',
  'float32-filterable',
  'subgroups',
  'texture-compression-bc',
  'depth-clip-control',
]

test('the device asks exactly the optional features the adapter offers, and publishes them', async () => {
  const { adapter, asked } = adapterOffering(OFFERED)
  const device = await requestExplorerDevice(adapter, [])
  assert.deepEqual(asked, [
    [
      'subgroups',
      'shader-f16',
      'depth-clip-control',
      'float32-filterable',
      'texture-compression-bc',
    ],
  ])
  assert.deepEqual(grantedGpuFeatures(device), asked[0])
})

test('a feature the URL forces off is neither asked for nor published', async () => {
  const { adapter, asked } = adapterOffering(OFFERED)
  // `?trillion3dGpuFeaturesOff=subgroups,%20shader-f16`, as written: a name keeps its spaces.
  const device = await requestExplorerDevice(adapter, ['subgroups', ' shader-f16'])
  const kept = ['depth-clip-control', 'float32-filterable', 'texture-compression-bc']
  assert.deepEqual(asked, [kept])
  assert.deepEqual(grantedGpuFeatures(device), kept)
})

// The device carries the adapter's own colour bytes, whatever the engine's widest pass.
test("the device asks the adapter's own colour bytes per sample, above or at WebGPU's default", async () => {
  for (const offered of [128, 64, 32]) {
    const { adapter, limitsAsked } = adapterOffering([], {
      maxColorAttachmentBytesPerSample: offered,
    })
    await requestExplorerDevice(adapter, [])
    assert.equal(limitsAsked[0].maxColorAttachmentBytesPerSample, offered)
  }
})

// Every stage binds at most WebGPU's guaranteed 16 sampled textures (`gpu/core/stageLimits.test.ts`):
// the device asks no more, from an adapter that offers more as from one that offers the default.
test("the device asks the sampled textures a stage binds: 17 where the adapter offers them (the blends read the rectangle lights' pictures), else its 16", async () => {
  const need = WEBGPU_REQUIRED_LIMITS.maxSampledTexturesPerShaderStage
  assert.equal(need, 17, "the guaranteed 16 and the blends' pictures")
  for (const offered of [48, 17, 16]) {
    const { adapter, limitsAsked } = adapterOffering([], {
      maxSampledTexturesPerShaderStage: offered,
      maxTextureDimension2D: 16384,
    })
    await requestExplorerDevice(adapter, [])
    assert.equal(limitsAsked[0].maxSampledTexturesPerShaderStage, Math.min(offered, 17))
    assert.equal(limitsAsked[0].maxTextureDimension2D, 16384, 'an uncapped limit: all offered')
  }
})

// The shadow maps' masked patches bind nine storage buffers in the vertex stage: the device asks the
// adapter's own count of them, as of the storage buffers a stage, and asks none from an adapter that
// has no such limit.
test("the device asks the adapter's own storage buffers a vertex stage, where it has the limit", async () => {
  for (const offered of [16, 9, 8]) {
    const { adapter, limitsAsked } = adapterOffering([], {
      maxStorageBuffersPerShaderStage: 16,
      maxStorageBuffersInVertexStage: offered,
    })
    await requestExplorerDevice(adapter, [])
    assert.equal(limitsAsked[0].maxStorageBuffersInVertexStage, offered)
  }
  const { adapter, limitsAsked } = adapterOffering([], { maxStorageBuffersPerShaderStage: 16 })
  await requestExplorerDevice(adapter, [])
  assert.equal('maxStorageBuffersInVertexStage' in limitsAsked[0], false)
})

test('the session says which optional features its WebGPU device was granted', async () => {
  const said: [string, Record<string, unknown> | undefined][] = []
  const session = {
    options: {
      gpuDevice: { features: new Set(['subgroups', 'timestamp-query']) } as unknown as GPUDevice,
    },
    scope: 'test',
    emit: () => {},
    diagnose: (_phase: string, message: string, context?: Record<string, unknown>) =>
      said.push([message, context]),
  } as unknown as ExplorerSession
  await probeExplorerCapabilities(session)
  const granted = said.find(([message]) => message === 'WebGPU device granted')
  assert.deepEqual(granted?.[1]?.features, ['timestamp-query', 'subgroups'])
})
