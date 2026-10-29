import { gpuAllocator } from '../../../gpu/core/resourceAllocator.ts'
import type { RayFogRead } from '../../reflections/rayFog.ts'
import type { GlobalFieldRead } from '../../distanceField/view.ts'
import type { SurfaceHitResources } from '../../surfaceCache/hitWgsl.ts'
import type { KernelFeatures } from './kernels.ts'
import type { ScreenProbeResources } from './resources.ts'

/** What the image gives the probes that is not theirs: its normals, flags and lobes, its base colours with metalness and its emission with occlusion, the lights (the sky they hold),
 *  the cascades' uniform and atlas — the world's probes, or the stand-ins where none are made —, the global distance field their
 *  rays are marched through and the surface cache their hits read (`surfaceHitReads`), the surfaces' vectors of the image (or the
 *  stand-in of none) and the engine's blue noise. */
export interface ScreenProbeInputs {
  normals: GPUTextureView
  flags: GPUTextureView
  /** The lobes target of the physical material (`SurfaceBuffer.lobesView`): the anisotropy and the clear coat of a pixel, read where its flag says it has them. */
  lobes: GPUTextureView
  /** The surfaces' base colour and metalness, and their emission and occlusion (`SURFACE_OUTPUTS`): what the integration puts the albedo and the material's occlusion of a pixel from. */
  base: GPUTextureView
  emissiveAo: GPUTextureView
  lights: GPUBuffer
  /** The fog's own cubemap and the sampler it is read through, which tint the height fog laid over the probes' rays (`rayFogWgsl.ts`): the stand-in white cube while the fog has none. */
  fog: RayFogRead
  bounceGrid: GPUBuffer
  probes: GPUTextureView
  field: GlobalFieldRead
  hit: SurfaceHitResources
  vectors: GPUTextureView
  /** The engine's blue noise, both masks (`gpu/noise/blueNoiseTextures.ts`). */
  blue: GPUTextureView
  /** The radiance cache's maps — the final atlas, the raw one, the sky's share — or the stand-ins where the cache is none. */
  cacheFinal: GPUTextureView
  cacheRaw: GPUTextureView
  cacheSky: GPUTextureView
  cachePdf: GPUBuffer
  /** The poses of the cut's placements and those the last drawn frame drew (`GpuSelection.worlds`, `previous`), which the scene stage tells the speed of a hit by (`stHitVelocity`): the stand-in of none where the image holds no cut. */
  worlds: GPUTextureView
  previous: GPUTextureView
}

/** What the groups of one frame are made from: the device, the kernels, the resources and the image's inputs,
 *  the parity of the history's turn, and the entries most groups share. */
export interface GroupParts {
  device: GPUDevice
  r: ScreenProbeResources
  inputs: ScreenProbeInputs
  /** The options the kernels were made for that change what the groups bind. */
  features: KernelFeatures
  turn: 0 | 1
  /** The other parity: the last frame's, whose resources are the history. */
  last: 0 | 1
  /** Which of the two gathered textures the spatial filter's last pass wrote (its passes' count, odd or even). */
  final: 0 | 1
  /** The uniform of each pass of the spatial filter, whose first word is the pass's rank. */
  ranks: GPUBuffer[]
  /** The uniform. */
  common: { params: GPUBindingResource }
  /** This frame's probes: their records. */
  probe: { info: GPUTextureView; normal: GPUTextureView }
  /** The records the kernels over the probes read: the probes', their count and their pixels. */
  records: Record<string, GPUBindingResource>
  /** The image's normals and flags. */
  surface: { normals: GPUTextureView; flags: GPUTextureView }
}

/** The uniforms of the passes of the spatial filter, the first word of each its rank, and the call that destroys them together. */
export interface PassRanks {
  buffers: GPUBuffer[]
  destroy(): void
}

/** The uniforms of the `passes` of the spatial filter, made by an allocator of their own that the view destroys when it makes others. */
export function passRanks(device: GPUDevice, passes: number): PassRanks {
  const allocator = gpuAllocator(device, 'Trillion3D screen probes spatial pass')
  const buffers = Array.from({ length: passes }, (_, rank) => {
    const buffer = allocator.buffer(`${rank}`, 1, 'uniform')
    device.queue.writeBuffer(buffer, 0, new Uint32Array([rank]))
    return buffer
  })
  return { buffers, destroy: () => allocator.destroy() }
}

/** Buffers named as bindings read them. */
export const buffers = (names: Record<string, GPUBuffer>) =>
  Object.fromEntries(Object.entries(names).map(([name, buffer]) => [name, { buffer }]))

/** A bind group of `kernel` over `entries`. */
export const groupOf = (
  device: GPUDevice,
  kernel: { layout: GPUBindGroupLayout },
  entries: GPUBindGroupEntry[],
) => device.createBindGroup({ layout: kernel.layout, entries })
