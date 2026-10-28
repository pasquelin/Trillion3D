import type { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import type { CloudSkyOcclusionLight } from '../../../../../sdk-core/src/modules/sky/cloudSkyOcclusion.ts'
import type { CloudSkyMapFrame } from '../../../lighting/atmosphere/cloudShadowRead.ts'
import { uniformBuffer } from '../../../gpu/core/uniformBlock.ts'
import { loadOnlyUsage } from '../../../gpu/core/loadOnlyTarget.ts'
import { cloudShadowDispatch } from './shadow.ts'
import { CLOUD_SHADOW_FORMAT, CLOUD_SHADOW_LAYOUT, type CloudShadowImage } from './shadowLayout.ts'
import {
  viewOf,
  type CloudShadowTraceInput,
  type CloudShadowTraceSlot,
  type createCloudShadowEncoders,
} from './shadowRunPasses.ts'
import { createSkyOcclusionPasses } from './skyOcclusion.ts'
import { skyOcclusionPlan, type SkyOcclusionPlanInput } from './skyOcclusionFrame.ts'
import { writeSkyOcclusionFilter, writeSkyOcclusionTrace } from './skyOcclusionLayout.ts'
import {
  SKY_OCCLUSION_FILTER_BINDING as F,
  SKY_OCCLUSION_FILTER_LAYOUT,
} from './skyOcclusionWgsl.ts'

/**
 * THE CLOUDS' SKY OCCLUSION MAP IN A FRAME, built where the sky light asks for it
 * (`cloudSkyOcclusionWanted`): the cloud shadow map's trace (`./shadowWgsl.ts`) along the planet's
 * vertical into a map of the plan's side, with the sky light's strength and no bias, no temporal
 * blend and no spatial halving; then, when `cloudSkyAOFiltering` is on, the hemisphere filter
 * (`./skyOcclusionWgsl.ts`) into a second texture of the same side. The map the air reads is the
 * second, else the first (`SkyOcclusionMap`).
 *
 * The map is made again when its side or the filter's switch changes, and the passes of the filter
 * are asked when the map is first wanted: a sky light that never asks costs nothing.
 */

/** What an image tells the map beside the sky light: the plan's inputs (`SkyOcclusionPlanInput`),
 *  the time in seconds and what the trace reads besides its slot (the light buffer, the air's
 *  frame, the material). */
export interface SkyOcclusionInput extends SkyOcclusionPlanInput, CloudShadowTraceInput {
  readonly time: number
}

/** The map of an image: the view the air reads and what its block holds of it. */
export interface SkyOcclusionMap {
  readonly view: GPUTextureView
  readonly frame: CloudSkyMapFrame
}

/** What the map keeps from one image to the next: its textures (the traced one, the filtered one
 *  where the filter runs), its blocks and the groups of its passes. */
interface SkyOcclusionSlot extends CloudShadowTraceSlot {
  readonly key: string
  readonly filterBlock: GPUBuffer
  filterGroup?: GPUBindGroup
}

/** The traced pixel's scale and offset where nothing halves the trace: one to one. */
const WHOLE_PIXEL = [1, 1, 0, 0] as const

/** What the run holds: the filter's passes, asked when the map is first wanted, and the slot. */
interface RunState {
  passes?: ReturnType<typeof createSkyOcclusionPasses>
  slot?: SkyOcclusionSlot
}

/** The slot given back: its textures and blocks destroyed. */
function releaseSlot(state: RunState) {
  const { slot } = state
  if (!slot) return
  for (const t of slot.textures) t.destroy()
  slot.trace.destroy()
  slot.filterBlock.destroy()
  state.slot = undefined
}

/** The slot of a map of `side` texels, with the filter's texture where it runs; made again where
 *  the side or the filter's switch changed. */
function slotFor(device: GPUDevice, state: RunState, side: number, filtered: boolean) {
  const key = `${side}${filtered ? 'f' : ''}`
  if (state.slot?.key === key) return state.slot
  releaseSlot(state)
  const texture = (label: string) =>
    device.createTexture({
      label: `Trillion3D cloud sky occlusion ${label}`,
      size: { width: side, height: side },
      format: CLOUD_SHADOW_FORMAT,
      usage: loadOnlyUsage(),
    })
  return (state.slot = {
    key,
    textures: filtered ? [texture('traced'), texture('filtered')] : [texture('traced')],
    trace: uniformBuffer(
      device,
      'Trillion3D cloud sky occlusion trace block',
      CLOUD_SHADOW_LAYOUT.words * 4,
    ),
    filterBlock: uniformBuffer(
      device,
      'Trillion3D cloud sky occlusion filter block',
      SKY_OCCLUSION_FILTER_LAYOUT.words * 4,
    ),
    views: new Map(),
    traceGroups: new Map(),
  })
}

/** The filter's group: the traced map read bilinearly through `lookup`, its block, the filtered map
 *  written. */
function filterGroupOf(
  device: GPUDevice,
  lookup: GPUSampler,
  held: SkyOcclusionSlot,
  layout: GPUBindGroupLayout,
) {
  return (held.filterGroup ??= device.createBindGroup({
    layout,
    entries: [
      { binding: F.source, resource: viewOf(held, held.textures[0]) },
      { binding: F.sampler, resource: lookup },
      { binding: F.block, resource: { buffer: held.filterBlock } },
      { binding: F.destination, resource: viewOf(held, held.textures[1]) },
    ],
  }))
}

const OCCLUSION_PASS: GPUComputePassDescriptor = { label: 'Trillion3D cloud sky occlusion' }

/** The sky occlusion map's run: `encode` builds the map of an image in the run `steps`, or none while its
 *  pipeline is not compiled; `release` gives its textures back (the sky light no longer asks). */
export function createSkyOcclusionRun(
  device: GPUDevice,
  encoders: Pick<ReturnType<typeof createCloudShadowEncoders>, 'trace'>,
  lookup: GPUSampler,
  failed: (error: unknown) => void,
) {
  const state: RunState = {}
  const trace = new Float32Array(CLOUD_SHADOW_LAYOUT.words)
  const filter = new Float32Array(SKY_OCCLUSION_FILTER_LAYOUT.words)
  return {
    encode(
      steps: ComputeRun,
      input: SkyOcclusionInput,
      light: CloudSkyOcclusionLight,
    ): SkyOcclusionMap | undefined {
      const passes = (state.passes ??= createSkyOcclusionPasses(device, failed))
      if (!passes.filtering.ready) return undefined
      const plan = skyOcclusionPlan(input, light)
      const { side, frame } = plan
      const held = slotFor(device, state, side, plan.filtered)
      const image: CloudShadowImage = {
        frame,
        side,
        temporal: { tracedSide: side, pixel: WHOLE_PIXEL },
        time: input.time,
        planetRadiusKm: input.planetRadiusKm,
      }
      writeSkyOcclusionTrace(trace, image, light, input.part)
      device.queue.writeBuffer(held.trace, 0, trace)
      const pass = steps.pass(OCCLUSION_PASS)
      encoders.trace(pass, held, input, side)
      const filtering = plan.filtered ? passes.filtering.get() : undefined
      if (plan.filtered && filtering) {
        writeSkyOcclusionFilter(filter, side, light, input.part)
        device.queue.writeBuffer(held.filterBlock, 0, filter)
        pass.setPipeline(filtering)
        pass.setBindGroup(0, filterGroupOf(device, lookup, held, passes.filter))
        const d = cloudShadowDispatch({ width: side, height: side })
        pass.dispatchWorkgroups(d.x, d.y, d.z)
      }
      return {
        view: viewOf(held, held.textures[held.textures.length - 1]),
        frame: { clipFromCamera: frame.clipFromCamera, farDepthKm: frame.farDepthKm },
      }
    },
    release: () => releaseSlot(state),
  }
}
