import { AIR_BINDING } from '../../../lighting/atmosphere/binding.ts'
import { uniformBuffer } from '../../../gpu/core/uniformBlock.ts'
import { cloudShadowDispatch, type createCloudShadowPasses } from './shadow.ts'
import { createCloudShadowHistory, type CloudShadowHistory } from './shadowHistory.ts'
import {
  CLOUD_SHADOW_BINDING as B,
  CLOUD_SHADOW_FORMAT,
  CLOUD_SHADOW_LAYOUT,
  CLOUD_SHADOW_TEMPORAL_BINDING as T,
  CLOUD_SHADOW_TEMPORAL_LAYOUT,
} from './shadowLayout.ts'
import { CLOUD_SHADOW_FILTER_BINDING as F } from './shadowWgsl.ts'
import type { Size } from './reconstructLayout.ts'

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

/** What the trace needs of the slot it writes: its block, its first texture, and the views and
 *  groups it keeps. A light's map has them in its `CloudShadowSlot`, the sky occlusion map in its own. */
export type CloudShadowTraceSlot = Pick<
  CloudShadowSlot,
  'textures' | 'trace' | 'views' | 'traceGroups' | 'held'
>

/** What the trace reads besides the slot: the light buffer and the air's frame (group 0), the
 *  material's bindings (group 1). */
export interface CloudShadowTraceInput {
  readonly air: { readonly buffer: GPUBuffer; readonly frame: GPUBuffer }
  readonly material: readonly GPUBindGroupEntry[]
}

type Passes = ReturnType<typeof createCloudShadowPasses>

/** The usage of a map: written by a compute pass, read by the next and by the lookups. */
export const mapUsage = () => GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING

/** The view of a texture of the slot, made once. */
export function viewOf(slot: Pick<CloudShadowSlot, 'views'>, texture: GPUTexture) {
  let view = slot.views.get(texture)
  if (!view) slot.views.set(texture, (view = texture.createView()))
  return view
}

const runGroup = (
  pass: GPUComputePassEncoder,
  group: GPUBindGroup,
  width: number,
  height: number,
) => {
  const d = cloudShadowDispatch({ width, height })
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(d.x, d.y, d.z)
}

/** The slot's group `name`, made once. */
const ownGroup = (slot: CloudShadowSlot, name: string, make: () => GPUBindGroup) => {
  let group = slot.groups.get(name)
  if (!group) slot.groups.set(name, (group = make()))
  return group
}

/** The trace into the slot's first texture, `tracedSide` texels a side. */
function encodeTrace(
  device: GPUDevice,
  made: Passes,
  pass: GPUComputePassEncoder,
  slot: CloudShadowTraceSlot,
  input: CloudShadowTraceInput,
  tracedSide: number,
) {
  const pipeline = made.trace.get()
  if (!pipeline) return
  const { air, material } = input
  const identities = [air.buffer, air.frame, material]
  if (!slot.held || slot.held.some((x, i) => x !== identities[i])) {
    slot.traceGroups.clear()
    slot.held = identities
  }
  const grouped = (name: string, layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) => {
    let group = slot.traceGroups.get(name)
    if (!group) slot.traceGroups.set(name, (group = device.createBindGroup({ layout, entries })))
    return group
  }
  pass.setPipeline(pipeline)
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
}

/** The temporal filter: the traced map and the whole map of the image before into the other. */
function encodeBlend(
  device: GPUDevice,
  made: Passes,
  lookup: GPUSampler,
  pass: GPUComputePassEncoder,
  slot: CloudShadowSlot,
  side: number,
) {
  const pipeline = made.blending.get()
  if (!pipeline) return
  const before = slot.whole[slot.current]
  const now = slot.whole[1 - slot.current]
  const group = ownGroup(slot, `blend${slot.current}`, () =>
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
  pass.setPipeline(pipeline)
  runGroup(pass, group, side, side)
}

/** The spatial filter that makes texture `i + 1` of the chain from `source`. */
function encodeFilter(
  device: GPUDevice,
  made: Passes,
  pass: GPUComputePassEncoder,
  slot: CloudShadowSlot,
  source: GPUTexture,
  i: number,
) {
  const pipeline = made.filtering.get()
  if (!pipeline) return
  const target = slot.textures[i + 1]
  const group = ownGroup(slot, `filter${i}-${slot.textures.indexOf(source)}-${slot.current}`, () =>
    device.createBindGroup({
      layout: made.filter,
      entries: [
        { binding: F.source, resource: viewOf(slot, source) },
        { binding: F.destination, resource: viewOf(slot, target) },
      ],
    }),
  )
  pass.setPipeline(pipeline)
  runGroup(pass, group, target.width, target.height)
}

/**
 * The passes of a light's map, each encoded on a compute pass: the trace into the first texture,
 * the temporal filter into the whole map the image before did not write, a spatial filter into the
 * next texture of the chain. A group is made once for the resources it names.
 */
export function createCloudShadowEncoders(device: GPUDevice, made: Passes, lookup: GPUSampler) {
  return {
    trace: (
      pass: GPUComputePassEncoder,
      slot: CloudShadowTraceSlot,
      input: CloudShadowTraceInput,
      tracedSide: number,
    ) => encodeTrace(device, made, pass, slot, input, tracedSide),
    blend: (pass: GPUComputePassEncoder, slot: CloudShadowSlot, side: number) =>
      encodeBlend(device, made, lookup, pass, slot, side),
    filter: (pass: GPUComputePassEncoder, slot: CloudShadowSlot, source: GPUTexture, i: number) =>
      encodeFilter(device, made, pass, slot, source, i),
  }
}

/** The slots of the air's two lights' maps: `slotFor` the slot of light `k`, made again when the
 *  sizes of its textures or the temporal filter's switch changed; `release` gives light `k`'s back. */
export function createCloudShadowSlots(device: GPUDevice) {
  const slots: (CloudShadowSlot | undefined)[] = [undefined, undefined]
  function release(k: number) {
    const slot = slots[k]
    if (!slot) return
    for (const t of new Set([...slot.textures, ...slot.whole])) t.destroy()
    slot.trace.destroy()
    slot.blend.destroy()
    slots[k] = undefined
  }
  return {
    slots,
    release,
    slotFor(k: number, sizes: Size[], filtered: boolean) {
      const key = sizes.map((s) => s.width).join(',') + (filtered ? 'f' : '')
      const held = slots[k]
      if (held?.key === key) return held
      release(k)
      const texture = (label: string, size: Size) =>
        device.createTexture({ label, size, format: CLOUD_SHADOW_FORMAT, usage: mapUsage() })
      const textures = sizes.map((size, i) => texture(`Trillion3D cloud shadow ${k}.${i}`, size))
      const whole = filtered
        ? [textures[1], texture(`Trillion3D cloud shadow ${k}.past`, sizes[1])]
        : []
      return (slots[k] = {
        key,
        textures,
        whole,
        current: 0,
        history: createCloudShadowHistory(),
        trace: uniformBuffer(
          device,
          'Trillion3D cloud shadow trace block',
          CLOUD_SHADOW_LAYOUT.words * 4,
        ),
        blend: uniformBuffer(
          device,
          'Trillion3D cloud shadow blend block',
          CLOUD_SHADOW_TEMPORAL_LAYOUT.words * 4,
        ),
        views: new Map(),
        groups: new Map(),
        traceGroups: new Map(),
      })
    },
  }
}
