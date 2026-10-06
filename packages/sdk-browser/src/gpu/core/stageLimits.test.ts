// Every lighting program of the opaque resolve, the blends and the water pass binds no more of a
// kind in one stage than the session's device holds: the counts it asks of the adapter
// (`WEBGPU_REQUIRED_LIMITS`), WebGPU's defaults for the others. The kit's device refuses a
// pipeline layout past them (`tests/kit/gpu/bindRules.ts`), as a real one does, and the widest
// layout binds exactly the sampled textures the device asks for: no more is asked than bound.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { BLEND_MODES, hostBlending } from '../../scene/materialBlending.ts'
import { WEBGPU_REQUIRED_LIMITS } from '../../backend/common.ts'
import {
  createContractVariants,
  FULL_CONTRACT,
  type ContractKey,
} from '../../lighting/deferred/contractVariants.ts'
import { createDeferredLighting } from '../../lighting/deferred/deferred.ts'
import { createDeferredPlaceholders } from '../../lighting/deferred/setup.ts'
import { createDeferredView } from '../../lighting/deferred/view.ts'
import { createWebgpuBlendPipelines } from '../../webgpu/blend/pipelines.ts'
import type { BlendGpuItem } from '../../webgpu/blend/state.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { stageBindingCounts } from '../../../../../tests/kit/gpu/bindRules.ts'

/** A kit device that keeps every pipeline layout it was asked for, after the kit checked it. */
function recordingDevice() {
  const { device } = fakeDevice()
  const layouts: GPUPipelineLayoutDescriptor[] = []
  const make = device.createPipelineLayout.bind(device)
  Object.assign(device, {
    createPipelineLayout: (descriptor: GPUPipelineLayoutDescriptor) => (
      layouts.push(descriptor),
      make(descriptor)
    ),
  })
  return { device, layouts }
}

/** The most sampled textures one stage of these layouts binds. */
const widestSampled = (layouts: GPUPipelineLayoutDescriptor[]) =>
  Math.max(
    0,
    ...layouts.flatMap((layout) =>
      stageBindingCounts(layout)
        .filter(({ limit }) => limit === 'maxSampledTexturesPerShaderStage')
        .map(({ count }) => count),
    ),
  )

/** Every key a frame can ask the opaque resolve for: both list widths, each set of cuts. */
const KEYS: ContractKey[] = [false, true].flatMap((narrow) =>
  Array.from({ length: 16 }, (_, set) => ({
    narrow,
    unshadowed: !!(set & 1),
    rectless: !!(set & 2),
    sunless: !!(set & 4),
    localless: !!(set & 8),
  })),
)

test("every opaque resolve program fits the device's per-stage limits, the widest exactly", async () => {
  const { device, layouts } = recordingDevice()
  const failures: unknown[] = []
  const onFailure = (error: unknown) => void failures.push(error)
  const unlit = await createDeferredLighting(device)
  const bindings = {
    uniform: createDeferredView(device).buffer,
    placeholders: createDeferredPlaceholders(device),
  }
  const variants = createContractVariants(device, bindings, undefined, { onFailure })
  for (const bounce of [false, true]) for (const key of KEYS) await variants.precompile(bounce, key)
  assert.deepEqual(failures, [])
  assert.equal(
    widestSampled(layouts),
    WEBGPU_REQUIRED_LIMITS.maxSampledTexturesPerShaderStage,
    'the device asks for the sampled textures the widest program binds',
  )
  variants.release()
  unlit.dispose()
})

test("the blends and the water pass fit the device's per-stage limits", async () => {
  const { device, layouts } = recordingDevice()
  const failures: unknown[] = []
  // One item per blending mode, every display route among them, and one that transmits: every
  // blend set, the routed ones and the water stage and composite are built.
  const items = [...BLEND_MODES.map(hostBlending), undefined].map((blending, index, all) => {
    const surface = G.basicSurface()
    Object.assign(surface, { blending })
    return { surface: surfaceOf(surface), transmissive: index === all.length - 1 }
  }) as unknown as BlendGpuItem[]
  const lit = { precompile: true, key: FULL_CONTRACT, onFailure: (e: unknown) => failures.push(e) }
  for (const share of [false, true]) {
    const built = await createWebgpuBlendPipelines(
      device,
      items,
      undefined,
      true,
      undefined,
      share,
      {
        lit,
      },
    )
    assert.equal(built.waterRefused, undefined)
    assert.ok(built.water, 'the water pass is built')
  }
  assert.deepEqual(failures, [])
  assert.ok(layouts.length > 0)
  assert.ok(widestSampled(layouts) <= WEBGPU_REQUIRED_LIMITS.maxSampledTexturesPerShaderStage)
})
