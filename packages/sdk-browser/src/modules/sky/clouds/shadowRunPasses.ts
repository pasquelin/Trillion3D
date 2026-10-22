import { AIR_BINDING } from '../../../lighting/atmosphere/binding.ts'
import { cloudShadowDispatch, type createCloudShadowPasses } from './shadow.ts'
import type { CloudShadowHistory } from './shadowHistory.ts'
import { CLOUD_SHADOW_BINDING as B, CLOUD_SHADOW_TEMPORAL_BINDING as T } from './shadowLayout.ts'
import { CLOUD_SHADOW_FILTER_BINDING as F } from './shadowWgsl.ts'

/** What a light's map keeps from one image to the next: its textures, its history, its blocks. */
export interface CloudShadowSlot {
  readonly key: string
  /** The chain: the traced map, the whole map when the temporal filter runs, the spatial maps. */
  readonly textures: GPUTexture[]
  /** The two whole maps the temporal filter alternates between (the chain's second is the first). */
  readonly whole: GPUTexture[]
  /** Which of the two the last image wrote. */
  current: number
  readonly history: CloudShadowHistory
  readonly trace: GPUBuffer
  readonly blend: GPUBuffer
  readonly views: Map<GPUTexture, GPUTextureView>
  /** The groups of the passes that name only the slot's own textures and blocks. */
  readonly groups: Map<string, GPUBindGroup>
  /** The trace's groups, made for the identities in `held`. */
  readonly traceGroups: Map<string, GPUBindGroup>
  held?: readonly unknown[]
}

/** What the trace reads besides the slot: the light buffer and the air's frame (group 0), the
 *  material's bindings (group 1). */
export interface CloudShadowTraceInput {
  readonly air: { readonly buffer: GPUBuffer; readonly frame: GPUBuffer }
  readonly material: readonly GPUBindGroupEntry[]
}

type Passes = ReturnType<typeof createCloudShadowPasses>

/** The view of a texture of the slot, made once. */
export function viewOf(slot: CloudShadowSlot, texture: GPUTexture) {
  let view = slot.views.get(texture)
  if (!view) slot.views.set(texture, (view = texture.createView()))
  return view
}

/**
 * The passes of a light's map, each encoded on a compute pass: the trace into the first texture,
 * the temporal filter into the whole map the image before did not write, a spatial filter into the
 * next texture of the chain. A group is made once for the resources it names.
 */
export function createCloudShadowEncoders(device: GPUDevice, made: Passes, lookup: GPUSampler) {
  const run = (pass: GPUComputePassEncoder, group: GPUBindGroup, width: number, height: number) => {
    const d = cloudShadowDispatch({ width, height })
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(d.x, d.y, d.z)
  }
  const own = (slot: CloudShadowSlot, name: string, make: () => GPUBindGroup) => {
    let group = slot.groups.get(name)
    if (!group) slot.groups.set(name, (group = make()))
    return group
  }
  return {
    /** The trace into the slot's first texture, `tracedSide` texels a side. */
    trace(
      pass: GPUComputePassEncoder,
      slot: CloudShadowSlot,
      input: CloudShadowTraceInput,
      tracedSide: number,
    ) {
      const { air, material } = input
      const identities = [air.buffer, air.frame, material]
      if (!slot.held || slot.held.some((x, i) => x !== identities[i])) {
        slot.traceGroups.clear()
        slot.held = identities
      }
      const grouped = (name: string, layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) => {
        let group = slot.traceGroups.get(name)
        if (!group)
          slot.traceGroups.set(name, (group = device.createBindGroup({ layout, entries })))
        return group
      }
      pass.setPipeline(made.trace.get())
      pass.setBindGroup(
        0,
        grouped('air', made.air, [
          { binding: AIR_BINDING.air, resource: { buffer: air.buffer } },
          { binding: AIR_BINDING.frame, resource: { buffer: air.frame } },
        ]),
      )
      const cloud = grouped('trace', made.cloud, [
        ...material,
        { binding: B.block, resource: { buffer: slot.trace } },
        { binding: B.output, resource: viewOf(slot, slot.textures[0]) },
      ])
      pass.setBindGroup(1, cloud)
      const d = cloudShadowDispatch({ width: tracedSide, height: tracedSide })
      pass.dispatchWorkgroups(d.x, d.y, d.z)
    },
    /** The temporal filter: the traced map and the whole map of the image before into the other. */
    blend(pass: GPUComputePassEncoder, slot: CloudShadowSlot, side: number) {
      const before = slot.whole[slot.current]
      const now = slot.whole[1 - slot.current]
      const group = own(slot, `blend${slot.current}`, () =>
        device.createBindGroup({
          layout: made.temporal,
          entries: [
            { binding: T.block, resource: { buffer: slot.blend } },
            { binding: T.current, resource: viewOf(slot, slot.textures[0]) },
            { binding: T.previous, resource: viewOf(slot, before) },
            { binding: T.destination, resource: viewOf(slot, now) },
            { binding: T.sampler, resource: lookup },
          ],
        }),
      )
      slot.current = 1 - slot.current
      pass.setPipeline(made.blending.get())
      run(pass, group, side, side)
    },
    /** The spatial filter that makes texture `i + 1` of the chain from `source`. */
    filter(pass: GPUComputePassEncoder, slot: CloudShadowSlot, source: GPUTexture, i: number) {
      const target = slot.textures[i + 1]
      const group = own(slot, `filter${i}-${slot.textures.indexOf(source)}-${slot.current}`, () =>
        device.createBindGroup({
          layout: made.filter,
          entries: [
            { binding: F.source, resource: viewOf(slot, source) },
            { binding: F.destination, resource: viewOf(slot, target) },
          ],
        }),
      )
      pass.setPipeline(made.filtering.get())
      run(pass, group, target.width, target.height)
    },
  }
}
