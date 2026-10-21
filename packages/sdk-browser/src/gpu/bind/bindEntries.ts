import { bufferEntry, resourceEntry } from './liveEntries.ts'
import type { WebgpuTileStreamer } from '../../materials/virtual/streamer/streamer.ts'
import {
  SHADE_BINDINGS,
  SMALL_BINDINGS,
  VIS_BINDINGS,
  VIS_UNIFORM_BYTES,
  type AtlasBindings,
} from './bindLayout.ts'
/** What every pass that samples an atlas needs to bind: the streamer, which holds each atlas's
 *  pool and page table, and the sampler. */
export type AtlasResources = { textures: WebgpuTileStreamer; sampler: GPUSampler }
/** Direct and indirect visibility paths supply their own slot buffers. */
export type VisBindResources = AtlasResources & {
  cache: GPUBuffer
  position: GPUBuffer
  pageTable: GPUBuffer
  uniform: GPUBuffer
  uniformOffset: number
  uv: GPUBuffer
  instances: GPUBuffer
  slotOffsets: GPUBuffer
  /** The surfaces' records (`../../materials/table/materialTable.ts`). */
  material: GPUTextureView
  /** The float pool's normal atlas (`VIS_BINDINGS.normals`). */
  normals: GPUTextureView
}
/** Resources of the hardware-resolve group, identical for both of its constructors. */
export type ShadeBindResources = AtlasResources & {
  visView: GPUTextureView
  cache: GPUBuffer
  position: GPUBuffer
  uv: GPUBuffer
  /** The float pool's normal atlas (`../core/floatAtlas.ts`). */
  normal: GPUTextureView
  pageTable: GPUBuffer
  uniform: GPUBuffer
  /** The frame's cache (`../../visibility/shader/shadeCacheWgsl.ts`). */
  shadeCache: GPUBuffer
  /** The surfaces' records (`../../materials/table/materialTable.ts`) and the lobes target the resolve writes. */
  material: GPUTextureView
  lobes: GPUTextureView
  /** The voxel trace's counters (`../../visibility/passes/voxelSteps.ts`). */
  voxelSteps: GPUBuffer
}
/** Resources of the software raster of small triangles: it only reads the alpha cutout. */
export type SmallBindResources = AtlasResources & {
  indices: GPUBuffer
  positions: GPUBuffer
  pages: GPUBuffer
  /** The visibility-buffer uniform (`VIS_UNIFORM_BYTES`), read from its first slot. */
  uniform: GPUBuffer
  uvs: GPUBuffer
  /** The visibility buffer then, right after it, the software raster's triangle lists. */
  work: GPUBuffer
  /** The surfaces' records (`../../materials/table/materialTable.ts`). */
  material: GPUTextureView
  /** The float pool's normal atlas (`SMALL_BINDINGS.normals`). */
  normals: GPUTextureView
}

/** The four entries of an atlas: one view per lane, in `PREVIEW_LAYOUT_NAMES` order, and its page table. */
export const atlasEntries = (
  bindings: AtlasBindings,
  read: () => WebgpuTileStreamer['color'],
): GPUBindGroupEntry[] => [
  ...bindings.lanes.map((binding, lane) => resourceEntry(binding, () => read()?.views[lane])),
  bufferEntry(bindings.pages, () => read()?.pages.buffer),
]

/** The unique entry list of `visBindGroupLayout`: every indirect slot's group goes through here, so
 *  a binding added to the layout can no longer be missing from one. */
export function visBindEntries(r: VisBindResources): GPUBindGroupEntry[] {
  const b = VIS_BINDINGS
  return [
    bufferEntry(b.cache, () => r.cache),
    bufferEntry(b.position, () => r.position),
    bufferEntry(b.pageTable, () => r.pageTable),
    bufferEntry(
      b.uniform,
      () => r.uniform,
      () => r.uniformOffset,
      () => VIS_UNIFORM_BYTES,
    ),
    bufferEntry(b.uv, () => r.uv),
    ...atlasEntries(b.color, () => r.textures?.color),
    resourceEntry(b.sampler, () => r.sampler),
    bufferEntry(b.instances, () => r.instances),
    bufferEntry(b.slotOffsets, () => r.slotOffsets),
    resourceEntry(b.material, () => r.material),
    resourceEntry(b.normals, () => r.normals),
  ]
}

/** The unique entry list of `shadeBindGroupLayout`, shared by the prepare-time construction and by
 *  the rebuild after a buffer change. */
export function shadeBindEntries(r: ShadeBindResources): GPUBindGroupEntry[] {
  const b = SHADE_BINDINGS
  return [
    resourceEntry(b.visView, () => r.visView),
    bufferEntry(b.cache, () => r.cache),
    bufferEntry(b.position, () => r.position),
    bufferEntry(b.uv, () => r.uv),
    resourceEntry(b.normal, () => r.normal),
    bufferEntry(b.pageTable, () => r.pageTable),
    ...atlasEntries(b.color, () => r.textures?.color),
    resourceEntry(b.sampler, () => r.sampler),
    bufferEntry(b.uniform, () => r.uniform),
    ...atlasEntries(b.data, () => r.textures?.data),
    bufferEntry(b.shadeCache, () => r.shadeCache),
    resourceEntry(b.material, () => r.material),
    resourceEntry(b.lobes, () => r.lobes),
    bufferEntry(b.voxelSteps, () => r.voxelSteps),
  ]
}

/** The unique entry list of the small-triangle compute group. */
export function smallBindEntries(r: SmallBindResources): GPUBindGroupEntry[] {
  const b = SMALL_BINDINGS
  return [
    bufferEntry(b.indices, () => r.indices),
    bufferEntry(b.positions, () => r.positions),
    bufferEntry(b.pages, () => r.pages),
    bufferEntry(
      b.uniform,
      () => r.uniform,
      () => 0,
      () => VIS_UNIFORM_BYTES,
    ),
    bufferEntry(b.uvs, () => r.uvs),
    ...atlasEntries(b.color, () => r.textures?.color),
    resourceEntry(b.sampler, () => r.sampler),
    bufferEntry(b.work, () => r.work),
    resourceEntry(b.material, () => r.material),
    resourceEntry(b.normals, () => r.normals),
  ]
}
