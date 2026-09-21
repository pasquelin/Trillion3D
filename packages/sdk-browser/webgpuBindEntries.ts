import type { WebgpuTileStreamer } from './webgpuTileStreamer.ts';
import {
  BLEND_BINDINGS,
  SHADE_BINDINGS,
  SMALL_BINDINGS,
  VIS_BINDINGS,
  type AtlasBindings,
} from './webgpuBindLayout.ts';

/** What every pass that samples an atlas needs to bind: the streamer, which holds each atlas's
 *  pool and page table, and the sampler. */
type AtlasResources = { textures: WebgpuTileStreamer; sampler: GPUSampler };

/** Resources of a visibility-pass group: those that change from one constructor to the other are
 *  the uniform (its slot offset), the Hi-Z flags and the two slot buffers, which are `zeroFlags`
 *  on the direct path and the indirect buffers on the per-slot path. */
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
  visView: GPUTextureView;
  cache: GPUBuffer;
  position: GPUBuffer;
  uv: GPUBuffer;
  normal: GPUBuffer;
  pageTable: GPUBuffer;
  uniform: GPUBuffer;
};

/**
 * Lighting a transparent mesh reads: the contract's declared lamps, their shadow slices, the atlas
 * and its sampler, the probe grid and its coefficients. These are the opaque-resolve resources,
 * never a light of the blend's own (P6); those that do not exist yet are held by the deferred
 * resolve's stand-ins.
 */
export type BlendLighting = {
  directLights: GPUBuffer;
  shadowSlices: GPUBuffer;
  shadowAtlas: GPUTextureView;
  shadowSampler: GPUSampler;
  bounceGrid: GPUBuffer;
  probes: GPUBuffer;
  /** Per-tile lamp lists: the blend pass reads the slice that concerns it. */
  tileLights: GPUBuffer;
  /** The resident proxy: the same far-shadow ray as the opaque resolve, not another. */
  proxy: GPUBuffer;
};

/** Resources of a transparent-mesh group: the mesh itself and the scene. */
export type BlendBindResources = AtlasResources &
  BlendLighting & {
    indices: GPUBuffer;
    positions: GPUBuffer;
    uvs: GPUBuffer;
    /** VIEW uniform of the image: projection, eye, lamp tiles, diagnostic flags. One for the
     *  whole pass, and it no longer carries anything that belongs to an item. */
    uniform: GPUBuffer;
    uniformSize: number;
    /** Item records, indexed by the item's rank in the scene (`webgpuBlendItems.ts`). */
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
  uniform: GPUBuffer;
  uniformSize: number;
  uvs: GPUBuffer;
  /** The raster image then, right after it, the list of small triangles. */
  work: GPUBuffer;
  selectionMask: GPUBuffer;
};

/** The four entries of an atlas: its three lane pools and its page table. */
const atlasEntries = (
  bindings: AtlasBindings,
  atlas: WebgpuTileStreamer['color'],
): GPUBindGroupEntry[] => [
  { binding: bindings.raw, resource: atlas.views[0] },
  { binding: bindings.pool, resource: atlas.views[1] },
  { binding: bindings.two, resource: atlas.views[2] },
  { binding: bindings.pages, resource: { buffer: atlas.pages.buffer } },
];

/** The unique entry list of `visBindGroupLayout`. Both of its constructors — the direct group and
 *  that of an indirect slot — go through here, so a binding added to the layout can no longer be
 *  missing from either. */
export function visBindEntries(r: VisBindResources): GPUBindGroupEntry[] {
  const b = VIS_BINDINGS;
  return [
    { binding: b.cache, resource: { buffer: r.cache } },
    { binding: b.position, resource: { buffer: r.position } },
    { binding: b.pageTable, resource: { buffer: r.pageTable } },
    { binding: b.flags, resource: { buffer: r.flags } },
    { binding: b.uniform, resource: { buffer: r.uniform, offset: r.uniformOffset, size: 96 } },
    { binding: b.uv, resource: { buffer: r.uv } },
    ...atlasEntries(b.color, r.textures.color),
    { binding: b.sampler, resource: r.sampler },
    { binding: b.instances, resource: { buffer: r.instances } },
    { binding: b.slotOffsets, resource: { buffer: r.slotOffsets } },
  ];
}

/** The unique entry list of `shadeBindGroupLayout`, shared by the prepare-time construction and by
 *  the rebuild after a buffer change. */
export function shadeBindEntries(r: ShadeBindResources): GPUBindGroupEntry[] {
  const b = SHADE_BINDINGS;
  return [
    { binding: b.visView, resource: r.visView },
    { binding: b.cache, resource: { buffer: r.cache } },
    { binding: b.position, resource: { buffer: r.position } },
    { binding: b.uv, resource: { buffer: r.uv } },
    { binding: b.normal, resource: { buffer: r.normal } },
    { binding: b.pageTable, resource: { buffer: r.pageTable } },
    ...atlasEntries(b.color, r.textures.color),
    { binding: b.sampler, resource: r.sampler },
    { binding: b.uniform, resource: { buffer: r.uniform } },
    ...atlasEntries(b.data, r.textures.data),
  ];
}

/** The unique entry list of `blendBindGroupLayout`. */
export function blendBindEntries(r: BlendBindResources): GPUBindGroupEntry[] {
  const b = BLEND_BINDINGS;
  return [
    { binding: b.indices, resource: { buffer: r.indices } },
    { binding: b.positions, resource: { buffer: r.positions } },
    { binding: b.uvs, resource: { buffer: r.uvs } },
    { binding: b.uniform, resource: { buffer: r.uniform, size: r.uniformSize } },
    { binding: b.items, resource: { buffer: r.items } },
    ...atlasEntries(b.color, r.textures.color),
    { binding: b.sampler, resource: r.sampler },
    ...atlasEntries(b.data, r.textures.data),
    { binding: b.normals, resource: { buffer: r.normals } },
    { binding: b.directLights, resource: { buffer: r.directLights } },
    { binding: b.clusterDiagnostic, resource: { buffer: r.clusterDiagnostic } },
    { binding: b.planInstances, resource: { buffer: r.planInstances } },
    { binding: b.clusterSpans, resource: { buffer: r.clusterSpans } },
    { binding: b.shadowSlices, resource: { buffer: r.shadowSlices } },
    { binding: b.shadowAtlas, resource: r.shadowAtlas },
    { binding: b.shadowSampler, resource: r.shadowSampler },
    { binding: b.bounceGrid, resource: { buffer: r.bounceGrid } },
    { binding: b.probes, resource: { buffer: r.probes } },
    { binding: b.tileLights, resource: { buffer: r.tileLights } },
    { binding: b.proxy, resource: { buffer: r.proxy } },
  ];
}

/** The unique entry list of the small-triangle compute group. */
export function smallBindEntries(r: SmallBindResources): GPUBindGroupEntry[] {
  const b = SMALL_BINDINGS;
  return [
    { binding: b.indices, resource: { buffer: r.indices } },
    { binding: b.positions, resource: { buffer: r.positions } },
    { binding: b.pages, resource: { buffer: r.pages } },
    { binding: b.hizFlags, resource: { buffer: r.hizFlags } },
    { binding: b.uniform, resource: { buffer: r.uniform, offset: 0, size: r.uniformSize } },
    { binding: b.uvs, resource: { buffer: r.uvs } },
    ...atlasEntries(b.color, r.textures.color),
    { binding: b.sampler, resource: r.sampler },
    { binding: b.work, resource: { buffer: r.work } },
    { binding: b.selectionMask, resource: { buffer: r.selectionMask } },
  ];
}
