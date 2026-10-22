import type { ProxyResources } from '../../../geometry/dag/cut/cutReaders.ts'
import type { ScreenProbeResources } from './resources.ts'

/** What the image gives the probes that is not theirs: its normals and flags, the lights (the sky they hold),
 *  the light grid's lists, the cascades' uniform and atlas — the world's probes, or the stand-ins where none are
 *  made —, the proxy their rays walk, the light functions' atlas their lit hits wear (a stand-in where the
 *  bounce's lights wear none), the surfaces' vectors of the image (or the stand-in of none) and the engine's blue noise. */
export interface ScreenProbeInputs {
  normals: GPUTextureView
  flags: GPUTextureView
  lights: GPUBuffer
  lightLists: GPUBuffer
  bounceGrid: GPUBuffer
  probes: GPUTextureView
  proxy: ProxyResources
  lightFunction: GPUTextureView
  vectors: GPUTextureView
  /** The engine's blue noise, both masks (`gpu/noise/blueNoiseTextures.ts`). */
  blue: GPUTextureView
  /** The radiance cache's maps — the final atlas, the raw one, the tags of the maps — and the importance functions the screen probes
   *  add to, or the stand-ins where the cache is none. */
  cacheFinal: GPUTextureView
  cacheRaw: GPUTextureView
  cacheSky: GPUTextureView
  cacheTags: GPUBuffer
  cachePdf: GPUBuffer
}

/** What the groups of one frame are made from: the device, the kernels, the resources and the image's inputs,
 *  the parity of the history's turn, and the entries most groups share. */
export interface GroupParts {
  device: GPUDevice
  r: ScreenProbeResources
  inputs: ScreenProbeInputs
  turn: 0 | 1
  /** The other parity: the last frame's, whose resources are the history. */
  last: 0 | 1
  /** Which of the two gathered textures the spatial filter's last pass wrote (its passes' count, odd or even). */
  final: 0 | 1
  /** The uniform. */
  common: { params: GPUBindingResource }
  /** This frame's probes: their records. */
  probe: { info: GPUTextureView; normal: GPUTextureView }
  /** The records the kernels over the probes read: the probes', their count and their pixels. */
  records: Record<string, GPUBindingResource>
  /** The image's normals and flags. */
  surface: { normals: GPUTextureView; flags: GPUTextureView }
}

/** Buffers named as bindings read them. */
export const buffers = (names: Record<string, GPUBuffer>) =>
  Object.fromEntries(Object.entries(names).map(([name, buffer]) => [name, { buffer }]))

/** A bind group of `kernel` over `entries`. */
export const groupOf = <E extends string>(
  device: GPUDevice,
  kernel: { layout: GPUBindGroupLayout; pipelines: Record<E, GPUComputePipeline> },
  entries: GPUBindGroupEntry[],
) => device.createBindGroup({ layout: kernel.layout, entries })
