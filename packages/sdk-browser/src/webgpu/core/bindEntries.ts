import { bufferEntry, resourceEntry } from './liveEntries.ts';
import type { WebgpuTileStreamer } from '../tile/streamer.ts';
import {
  BLEND_BINDINGS,
  SHADE_BINDINGS,
  SMALL_BINDINGS,
  VIS_BINDINGS,
  VIS_UNIFORM_BYTES,
  type AtlasBindings,
} from './bindLayout.ts';
/** What every pass that samples an atlas needs to bind: the streamer, which holds each atlas's
 *  pool and page table, and the sampler. */
type AtlasResources = { textures: WebgpuTileStreamer; sampler: GPUSampler };
/** Direct and indirect visibility paths supply their own flags and slot buffers. */
export type VisBindResources = AtlasResources & {
  cache: GPUBuffer;
  position: GPUBuffer;
  pageTable: GPUBuffer;
  flags: GPUBuffer;
  uniform: GPUBuffer;
  uniformOffset: number;
  uv: GPUBuffer;
  instances: GPUBuffer;
  slotOffsets: GPUBuffer;
};
/** Resources of the hardware-resolve group, identical for both of its constructors. */
export type ShadeBindResources = AtlasResources & {
  shadingOffset: GPUBuffer;
  subsurface: GPUTextureView;
  visView: GPUTextureView;
  cache: GPUBuffer;
  position: GPUBuffer;
  uv: GPUBuffer;
  normal: GPUBuffer;
  pageTable: GPUBuffer;
  uniform: GPUBuffer;
};
/** Lighting shared with the opaque resolve; deferred stand-ins cover resources not ready yet. */
export type BlendLighting = {
  directLights: GPUBuffer;
  shadowData: GPUBuffer;
  shadowAtlas: GPUTextureView;
  shadowSampler: GPUSampler;
  /** The pool's transmittance layer and its translucent depth, or the one-texel stand-ins. */
  shadowTransmittance: GPUTextureView;
  shadowTranslucentDepth: GPUTextureView;
  bounceGrid: GPUBuffer;
  probes: GPUBuffer;
  /** Per-tile lamp lists: the blend pass reads the slice that concerns it. */
  tileLights: GPUBuffer;
  /** The resident proxy: the same far-shadow ray as the opaque resolve, not another. */
  proxy: GPUBuffer;
  /** The bounce surface cache transparent and water reflections read (`../../bounce/reflectWgsl.ts`). */
  surfaceCache: GPUBuffer;
};

/** Resources of a transparent-mesh group: the mesh itself and the scene. */
export type BlendBindResources = AtlasResources &
  BlendLighting & {
    indices: GPUBuffer;
    positions: GPUBuffer;
    uvs: GPUBuffer;
    /** One VIEW uniform for the pass: projection, eye, lamp tiles and diagnostic flags. */
    uniform: GPUBuffer;
    uniformSize: number;
    /** Item records, indexed by the item's rank in the scene (`../blend/items.ts`). */
    items: GPUBuffer;
    normals: GPUBuffer;
    /** Identity of a transparent cluster, one per draw-table entry. */
    clusterDiagnostic: GPUBuffer;
    /** Instance list expanded for the image, and each cluster's span in the cache. */
    planInstances: GPUBuffer;
    clusterSpans: GPUBuffer;
  };

/** Resources of the software raster of small triangles: it only reads the alpha cutout. */
export type SmallBindResources = AtlasResources & {
  indices: GPUBuffer;
  positions: GPUBuffer;
  pages: GPUBuffer;
  hizFlags: GPUBuffer;
  /** The visibility-buffer uniform (`VIS_UNIFORM_BYTES`), read from its first slot. */
  uniform: GPUBuffer;
  uvs: GPUBuffer;
  /** The raster image then, right after it, the list of small triangles. */
  work: GPUBuffer;
  selectionMask: GPUBuffer;
};

/** The four entries of an atlas: one view per lane, in `POOL_LANES` order, and its page table. */
const atlasEntries = (
  bindings: AtlasBindings,
  read: () => WebgpuTileStreamer['color'],
): GPUBindGroupEntry[] => [
  ...bindings.lanes.map((binding, lane) => resourceEntry(binding, () => read()?.views[lane])),
  bufferEntry(bindings.pages, () => read()?.pages.buffer),
];

/** The unique entry list of `visBindGroupLayout`. Both of its constructors — the direct group and
 *  that of an indirect slot — go through here, so a binding added to the layout can no longer be
 *  missing from either. */
export function visBindEntries(r: VisBindResources): GPUBindGroupEntry[] {
  const b = VIS_BINDINGS;
  return [
    bufferEntry(b.cache, () => r.cache),
    bufferEntry(b.position, () => r.position),
    bufferEntry(b.pageTable, () => r.pageTable),
    bufferEntry(b.flags, () => r.flags),
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
  ];
}

/** The unique entry list of `shadeBindGroupLayout`, shared by the prepare-time construction and by
 *  the rebuild after a buffer change. */
export function shadeBindEntries(r: ShadeBindResources): GPUBindGroupEntry[] {
  const b = SHADE_BINDINGS;
  return [
    resourceEntry(b.visView, () => r.visView),
    bufferEntry(b.shadingOffset, () => r.shadingOffset),
    resourceEntry(b.subsurface, () => r.subsurface),
    bufferEntry(b.cache, () => r.cache),
    bufferEntry(b.position, () => r.position),
    bufferEntry(b.uv, () => r.uv),
    bufferEntry(b.normal, () => r.normal),
    bufferEntry(b.pageTable, () => r.pageTable),
    ...atlasEntries(b.color, () => r.textures?.color),
    resourceEntry(b.sampler, () => r.sampler),
    bufferEntry(b.uniform, () => r.uniform),
    ...atlasEntries(b.data, () => r.textures?.data),
  ];
}

/** The unique entry list of `blendBindGroupLayout`. */
export function blendBindEntries(r: BlendBindResources): GPUBindGroupEntry[] {
  const b = BLEND_BINDINGS;
  return [
    bufferEntry(b.indices, () => r.indices),
    bufferEntry(b.positions, () => r.positions),
    bufferEntry(b.uvs, () => r.uvs),
    bufferEntry(
      b.uniform,
      () => r.uniform,
      undefined,
      () => r.uniformSize,
    ),
    bufferEntry(b.items, () => r.items),
    ...atlasEntries(b.color, () => r.textures?.color),
    resourceEntry(b.sampler, () => r.sampler),
    ...atlasEntries(b.data, () => r.textures?.data),
    bufferEntry(b.normals, () => r.normals),
    bufferEntry(b.directLights, () => r.directLights),
    bufferEntry(b.clusterDiagnostic, () => r.clusterDiagnostic),
    bufferEntry(b.planInstances, () => r.planInstances),
    bufferEntry(b.clusterSpans, () => r.clusterSpans),
    bufferEntry(b.shadowData, () => r.shadowData),
    resourceEntry(b.shadowAtlas, () => r.shadowAtlas),
    resourceEntry(b.shadowSampler, () => r.shadowSampler),
    resourceEntry(b.shadowTransmittance, () => r.shadowTransmittance),
    resourceEntry(b.shadowTranslucentDepth, () => r.shadowTranslucentDepth),
    bufferEntry(b.bounceGrid, () => r.bounceGrid),
    bufferEntry(b.probes, () => r.probes),
    bufferEntry(b.tileLights, () => r.tileLights),
    bufferEntry(b.proxy, () => r.proxy),
    bufferEntry(b.surfaceCache, () => r.surfaceCache),
  ];
}

/** The unique entry list of the small-triangle compute group. */
export function smallBindEntries(r: SmallBindResources): GPUBindGroupEntry[] {
  const b = SMALL_BINDINGS;
  return [
    bufferEntry(b.indices, () => r.indices),
    bufferEntry(b.positions, () => r.positions),
    bufferEntry(b.pages, () => r.pages),
    bufferEntry(b.hizFlags, () => r.hizFlags),
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
    bufferEntry(b.selectionMask, () => r.selectionMask),
  ];
}
