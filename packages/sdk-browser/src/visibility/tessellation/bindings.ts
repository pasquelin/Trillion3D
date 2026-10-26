import { atlasLayoutEntries, VIS_BINDINGS, type AtlasBindings } from '../../gpu/bind/bindLayout.ts'
import { tileDeclarations } from '../../materials/virtual/wgsl.ts'
import { graphFrameEntry } from '../shader/graphFrameWgsl.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'

/**
 * The binding numbers of the tessellation's kernels, in the one group each reads: a kernel
 * declares and lists the subset it uses (`bindings` below), so a number means one resource
 * whichever kernel names it. The geometry, the colour atlas, the sampler, the surfaces' records and
 * the normal atlas keep the numbers the visibility passes give them (`VIS_BINDINGS`), so that the
 * cutout the dicing evaluates (`maskKeep`) is the rasters' own text. Where each program binds the
 * storage buffers, the compute stage's eight are all the dicing takes: the geometry's `indices`,
 * `positions` and `uvs`, the page table `pages`, the `work` buffer of the visibility, the two atlases'
 * page tables, and the one this pass owns — `tess`: the table, the displaced surfaces' records, the
 * arguments, the queue and the lists.
 */
const DATA_ATLAS: AtlasBindings = { lanes: [15, 16, 17], pages: 18 }
export const TESS_BINDINGS = {
  indices: VIS_BINDINGS.cache,
  positions: VIS_BINDINGS.position,
  pages: VIS_BINDINGS.pageTable,
  tessUniform: 3,
  uniform: VIS_BINDINGS.uniform,
  uvs: VIS_BINDINGS.uv,
  color: VIS_BINDINGS.color,
  sampler: VIS_BINDINGS.sampler,
  lists: 11,
  tess: 12,
  material: VIS_BINDINGS.material,
  normals: VIS_BINDINGS.normals,
  data: DATA_ATLAS,
  work: 19,
  dispatch: 20,
  pyramid: 21,
  levels: 22,
  occluded: 23,
  /** The graph frame (`../shader/graphFrameWgsl.ts`) the dicing's cutouts and offsets read. */
  frame: 24,
} as const

const B = TESS_BINDINGS
const storage = (binding: number, name: string, type: string, access = 'read') =>
  `@group(0) @binding(${binding}) var<storage,${access}> ${name}:${type};`

/** The declarations of each binding a program lists, as WGSL: the geometry, the page table and the
 *  visibility uniform the passes share, and the tessellation's own. */
export const TESS_DECLARATIONS = {
  indices: storage(B.indices, 'indices', 'array<u32>'),
  positions: storage(B.positions, 'positions', 'array<f32>'),
  pages: storage(B.pages, 'pages', 'array<PageInfo>'),
  uniform: `@group(0) @binding(${B.uniform}) var<uniform> uni:Uniforms;`,
  tessUniform: `@group(0) @binding(${B.tessUniform}) var<uniform> tu:TessUni;`,
  lists: storage(B.lists, 'lists', 'array<u32>'),
  tess: storage(B.tess, 'tess', 'array<atomic<u32>>', 'read_write'),
  uvs: storage(B.uvs, 'uvs', 'array<f32>'),
  color: tileDeclarations(B.color, 'color'),
  sampler: `@group(0) @binding(${B.sampler}) var mapsSampler:sampler;`,
  dispatch: storage(B.dispatch, 'dispatch', 'array<u32>', 'read_write'),
  /** The Hi-Z pyramid and its levels uniform, which the occlusion test of the patches reads
   *  (`PYRAMID_BOX_WGSL`), and the patches the main pass hid: written by the splitting, read by the
   *  post pass's seeding. */
  pyramid: `@group(0) @binding(${B.pyramid}) var hizPyramid:texture_2d_array<u32>;`,
  levels: `@group(0) @binding(${B.levels}) var<uniform> hizLevels:HizLevels;`,
  occluded: storage(B.occluded, 'occluded', 'array<u32>', 'read_write'),
  occludedRead: storage(B.occluded, 'occluded', 'array<u32>'),
}

/** The tessellation's programs: each its own module, bind group layout and pipelines — the cut's four,
 *  then the shadow maps' (`../../lighting/shadows/vsm/tessellation/`): the seeding over the pairs of
 *  a chunk, its splitting, and the vertex stage that dices the visible patches. */
export type TessProgram =
  | 'seed'
  | 'plan'
  | 'split'
  | 'dice'
  | 'shadowSeed'
  | 'shadowSplit'
  | 'shadowRaster'
  | 'shadowRasterMasked'
/** A resource of a program's group, by the name `TESS_BINDINGS` gives it — the patches the main pass
 *  hid twice, as the splitting writes them and as the seeding reads them, and the `tess` buffer
 *  twice, as the kernels write it and as a vertex stage reads it. */
export type TessBinding = keyof typeof TESS_BINDINGS | 'occludedRead' | 'tessRead'

/** What each of the tessellation's programs binds, in its own layout: a program binds the least it
 *  reads, so the eight storage buffers of the seeding and the dicing — what the poorest device
 *  holds — are the most any binds, and the kernels the arguments launch (`split`, `dice`) bind no
 *  buffer they are launched from. */
export const TESS_PROGRAMS: Record<TessProgram, readonly TessBinding[]> = {
  // The seeding, the splitting and the dicing place a patch's corners alike, by the surface's offset
  // (`wpoSets.ts`): each binds what an offset reads — the geometry's UVs, the colour atlas and its
  // sampler, the surfaces' records and the normal atlas, the graph frame — whichever offsets the
  // session holds, so that its layout is the same for all.
  seed: [
    'indices',
    'positions',
    'pages',
    'uniform',
    'tessUniform',
    'lists',
    'tess',
    'occludedRead',
    'uvs',
    'color',
    'material',
    'normals',
    'sampler',
    'frame',
  ],
  plan: ['tessUniform', 'tess', 'dispatch'],
  split: [
    'indices',
    'positions',
    'pages',
    'uniform',
    'tessUniform',
    'tess',
    'normals',
    'pyramid',
    'levels',
    'occluded',
    'uvs',
    'color',
    'material',
    'sampler',
    'frame',
  ],
  dice: [
    'indices',
    'positions',
    'pages',
    'uniform',
    'tessUniform',
    'tess',
    'uvs',
    'color',
    'material',
    'normals',
    'data',
    'sampler',
    'work',
    'frame',
  ],
  // The shadow maps' programs read the pairs of the chunk and the projections in groups of their
  // own; here is what they bind of the tessellation. The vertex stage binds, besides the page
  // group's four storage buffers and the pairs' and the projections', two: `tess` and the data
  // atlas's page table — the eight any device holds.
  shadowSeed: ['indices', 'positions', 'pages', 'tessUniform', 'tess'],
  // The shadow maps' splitting reads the offsets that read no texture alone: its stage already binds
  // eight storage buffers with the UVs, the colour atlas's page table would be a ninth.
  shadowSplit: [
    'indices',
    'positions',
    'pages',
    'tessUniform',
    'tess',
    'normals',
    'uvs',
    'material',
    'frame',
  ],
  shadowRaster: ['tessUniform', 'tessRead', 'data', 'sampler'],
  // With the colour atlas, which a masked row's cutout reads: a ninth storage buffer in the vertex
  // stage, on a device that grants it (`vsmMaskedPatches`).
  shadowRasterMasked: ['tessUniform', 'tessRead', 'data', 'color', 'sampler'],
}

const buffer = (binding: number, type: GPUBufferBindingType) => [computeBufferEntry(binding, type)]
/** The layout entries of each binding, one or more. */
const LAYOUT: Record<TessBinding, GPUBindGroupLayoutEntry[]> = {
  indices: buffer(B.indices, 'read-only-storage'),
  positions: buffer(B.positions, 'read-only-storage'),
  pages: buffer(B.pages, 'read-only-storage'),
  uniform: buffer(B.uniform, 'uniform'),
  tessUniform: buffer(B.tessUniform, 'uniform'),
  lists: buffer(B.lists, 'read-only-storage'),
  tess: buffer(B.tess, 'storage'),
  tessRead: buffer(B.tess, 'read-only-storage'),
  uvs: buffer(B.uvs, 'read-only-storage'),
  color: atlasLayoutEntries(B.color, COMPUTE),
  // The surfaces' records, which the cutout reads (`materialTableWgsl`).
  material: [computeTextureEntry(B.material, 'uint', '2d-array')],
  normals: [computeTextureEntry(B.normals, 'unfilterable-float', '2d-array')],
  data: atlasLayoutEntries(DATA_ATLAS, COMPUTE),
  sampler: [computeSamplerEntry(B.sampler, 'filtering')],
  work: buffer(B.work, 'storage'),
  dispatch: buffer(B.dispatch, 'storage'),
  pyramid: [computeTextureEntry(B.pyramid, 'uint', '2d-array')],
  levels: [computeUniformEntry(B.levels)],
  occluded: buffer(B.occluded, 'storage'),
  occludedRead: buffer(B.occluded, 'read-only-storage'),
  frame: [graphFrameEntry(B.frame, COMPUTE)],
}

/** The layout entries of `program`'s group, seen by the compute stage or by `visibility`. */
export const tessLayoutEntries = (
  program: TessProgram,
  visibility = COMPUTE,
): GPUBindGroupLayoutEntry[] =>
  TESS_PROGRAMS[program].flatMap((name) => LAYOUT[name].map((entry) => ({ ...entry, visibility })))
