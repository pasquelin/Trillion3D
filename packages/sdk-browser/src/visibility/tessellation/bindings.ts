import { atlasLayoutEntries, type AtlasBindings } from '../../gpu/bind/bindLayout.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
} from '../../gpu/core/computeBindings.ts'

/**
 * The binding numbers of the tessellation's kernels, in the one group each reads: a kernel
 * declares and lists the subset it uses (`bindings` below), so a number means one resource
 * whichever kernel names it. Where each program binds the storage buffers, the compute stage's
 * eight are all the dicing takes: the geometry's `indices`, `positions` and `uvs`, the page table
 * `pages`, the `work` buffer of the visibility, the data atlas's page table, and the two this
 * pass owns — `tess`, the table, the arguments, the queue and the lists, and `disp`, the
 * displaced surfaces' records.
 */
const DATA_ATLAS: AtlasBindings = { lanes: [10, 11, 12], pages: 13 }
export const TESS_BINDINGS = {
  indices: 0,
  positions: 1,
  pages: 2,
  uniform: 3,
  tessUniform: 4,
  mask: 5,
  tess: 6,
  disp: 7,
  uvs: 8,
  normals: 9,
  data: DATA_ATLAS,
  sampler: 14,
  work: 15,
  dispatch: 16,
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
  mask: storage(B.mask, 'selectionMask', 'array<u32>'),
  tess: storage(B.tess, 'tess', 'array<atomic<u32>>', 'read_write'),
  disp: storage(B.disp, 'disp', 'array<DisplacementRecord>'),
  uvs: storage(B.uvs, 'uvs', 'array<f32>'),
  sampler: `@group(0) @binding(${B.sampler}) var mapsSampler:sampler;`,
  work: storage(B.work, 'work', 'array<atomic<u32>>', 'read_write'),
  dispatch: storage(B.dispatch, 'dispatch', 'array<u32>', 'read_write'),
}

/** The tessellation's programs: each its own module, bind group layout and pipelines. */
export type TessProgram = 'seed' | 'plan' | 'split' | 'dice'
/** A resource of a program's group, by the name `TESS_BINDINGS` gives it. */
export type TessBinding = keyof typeof TESS_BINDINGS

/** What each of the tessellation's programs binds, in its own layout: a program binds the least it
 *  reads, so the dicing's eight storage buffers — what the poorest device holds — are the most any
 *  binds, and the kernels the arguments launch (`split`, `dice`) bind no buffer they are launched
 *  from. */
export const TESS_PROGRAMS: Record<TessProgram, readonly TessBinding[]> = {
  seed: ['indices', 'positions', 'pages', 'uniform', 'tessUniform', 'mask', 'tess', 'disp'],
  plan: ['tessUniform', 'tess', 'dispatch'],
  split: ['indices', 'positions', 'pages', 'uniform', 'tessUniform', 'tess', 'disp', 'normals'],
  dice: [
    'indices',
    'positions',
    'pages',
    'uniform',
    'tessUniform',
    'tess',
    'disp',
    'uvs',
    'normals',
    'data',
    'sampler',
    'work',
  ],
}

const buffer = (binding: number, type: GPUBufferBindingType) => [computeBufferEntry(binding, type)]
/** The layout entries of each binding, one or more. */
const LAYOUT: Record<TessBinding, GPUBindGroupLayoutEntry[]> = {
  indices: buffer(B.indices, 'read-only-storage'),
  positions: buffer(B.positions, 'read-only-storage'),
  pages: buffer(B.pages, 'read-only-storage'),
  uniform: buffer(B.uniform, 'uniform'),
  tessUniform: buffer(B.tessUniform, 'uniform'),
  mask: buffer(B.mask, 'read-only-storage'),
  tess: buffer(B.tess, 'storage'),
  disp: buffer(B.disp, 'read-only-storage'),
  uvs: buffer(B.uvs, 'read-only-storage'),
  normals: [computeTextureEntry(B.normals, 'unfilterable-float', '2d-array')],
  data: atlasLayoutEntries(DATA_ATLAS, COMPUTE),
  sampler: [computeSamplerEntry(B.sampler, 'filtering')],
  work: buffer(B.work, 'storage'),
  dispatch: buffer(B.dispatch, 'storage'),
}

/** The layout entries of `program`'s group 0. */
export const tessLayoutEntries = (program: TessProgram): GPUBindGroupLayoutEntry[] =>
  TESS_PROGRAMS[program].flatMap((name) => LAYOUT[name])
