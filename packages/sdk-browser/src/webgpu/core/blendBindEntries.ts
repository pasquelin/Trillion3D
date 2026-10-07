import { bufferEntry, resourceEntry } from './liveEntries.ts'
import { BLEND_BINDINGS, atlasLayoutEntries, readOnly } from './bindLayout.ts'
import { atlasEntries, type AtlasResources } from './bindEntries.ts'

/** Lighting shared with the opaque resolve; deferred stand-ins cover resources not ready yet. */
export type BlendLighting = {
  directLights: GPUBuffer
  /** The virtual shadow maps a transparent samples (`BLEND_VSM_BINDINGS`), on the old shadow
   *  numbers: page table, projection data, uniforms and the pool's dynamic slice. */
  shadowData: GPUBuffer
  shadowAtlas: GPUBuffer
  shadowSampler: GPUBuffer
  /** The translucent casters' transmission atlas (`vsmTransmissionReadWgsl`), or its one-texel
   *  stand-in. */
  shadowTransmittance: GPUTextureView
  shadowTranslucentDepth: GPUBuffer
  bounceGrid: GPUBuffer
  /** The probes' atlas (`../../bounce/atlas.ts`). */
  probes: GPUTextureView
  /** Per-tile lamp lists: the blend pass reads the slice that concerns it. */
  tileLights: GPUBuffer
  /** The resident proxy, the very one the opaque resolve binds. */
  proxy: GPUBuffer
  /** The bounce surface cache transparent and water reflections read (`../../bounce/reflectWgsl.ts`). */
  surfaceCache: GPUTextureView
}

/** Resources of a transparent-mesh group: the mesh itself and the scene. */
export type BlendBindResources = AtlasResources &
  BlendLighting & {
    indices: GPUBuffer
    positions: GPUBuffer
    uvs: GPUBuffer
    /** One VIEW uniform for the pass: projection, eye, lamp tiles and diagnostic flags. */
    uniform: GPUBuffer
    uniformSize: number
    /** Item records, indexed by the item's rank in the scene (`../blend/items.ts`). */
    items: GPUBuffer
    /** The float pool's normal atlas, or the empty one. */
    normals: GPUTextureView
    /** The physical records (`../visibility/physicalTable.ts`), the opaque resolve's own. */
    physical: GPUTextureView
    /** Identity of a transparent cluster, one per draw-table entry. */
    clusterDiagnostic: GPUBuffer
    /** Instance list expanded for the image, and each cluster's span in the cache. */
    planInstances: GPUBuffer
    clusterSpans: GPUBuffer
  }

/** The stages a binding is read in, and its layout past its number and stage. */
type Stage = 'vertex' | 'fragment' | 'both'
type Layout = Omit<GPUBindGroupLayoutEntry, 'binding' | 'visibility'>
/** A single binding of the group: its stage, its layout, and with `sized` the view uniform, laid
 *  out at its size at least and bound at it (`uniformSize`). */
type Row = readonly [stage: Stage, layout: Layout, sized?: 'sized']
type Single = Exclude<keyof typeof BLEND_BINDINGS, 'color' | 'data'>

const STORAGE: Layout = { buffer: readOnly },
  UNIFORM: Layout = { buffer: { type: 'uniform' } },
  FLOAT_ARRAY: Layout = { texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }

/**
 * Every single binding of the forward materials' group, by its name in `BLEND_BINDINGS`, in one
 * table: the layout (`blendLayoutEntries`) and the live entries (`blendBindEntries`), which the
 * group's identity compares, are both made of it — with the two atlases (`atlasLayoutEntries`,
 * `atlasEntries`) —, and a binding of `BLEND_BINDINGS` missing from it is a type error.
 */
const BLEND_TABLE: { readonly [name in Single]: Row } = {
  indices: ['vertex', STORAGE],
  positions: ['vertex', STORAGE],
  uvs: ['vertex', STORAGE],
  uniform: ['both', UNIFORM, 'sized'],
  // Each item's record, read at the rank the vertex index carries: it is what replaces the
  // dynamic uniform offset, and therefore the bind group per draw.
  items: ['vertex', STORAGE],
  sampler: ['fragment', { sampler: { type: 'filtering' } }],
  // Every normal a transparent reads is a float atlas (`floatAtlas.ts`, #1410).
  normals: ['vertex', FLOAT_ARRAY],
  directLights: ['fragment', STORAGE],
  clusterDiagnostic: ['vertex', STORAGE],
  planInstances: ['vertex', STORAGE],
  clusterSpans: ['vertex', STORAGE],
  // The virtual shadow maps (`BLEND_VSM_BINDINGS`): page table, projection data, uniforms, pool.
  shadowData: ['fragment', STORAGE],
  shadowAtlas: ['fragment', STORAGE],
  shadowSampler: ['fragment', UNIFORM],
  shadowTransmittance: ['fragment', { texture: { sampleType: 'uint', viewDimension: '2d-array' } }],
  shadowTranslucentDepth: ['fragment', STORAGE],
  bounceGrid: ['fragment', UNIFORM],
  probes: ['fragment', FLOAT_ARRAY],
  tileLights: ['fragment', STORAGE],
  // The resident proxy, **read-only**: a binding the fragment stage could write would cost the
  // pass its early depth reject (4232 hidden fragment draws). The probes and the surface cache are
  // atlases (`../../bounce/atlas.ts`), no storage buffer.
  proxy: ['fragment', STORAGE],
  surfaceCache: ['fragment', { texture: { sampleType: 'unfilterable-float' } }],
  // The physical records a lobed blend reads (`../blend/physicalWgsl.ts`): a texture, the
  // fragment stage holding the eight storage buffers WebGPU guarantees.
  physical: ['fragment', { texture: { sampleType: 'uint' } }],
}
const SINGLES = Object.keys(BLEND_TABLE) as Single[]

/** The forward materials' layout entries (`../blend/pipelines.ts`), the view uniform at least
 *  `viewSize` bytes. */
export function blendLayoutEntries(viewSize: number): GPUBindGroupLayoutEntry[] {
  const stages = {
    vertex: GPUShaderStage.VERTEX,
    fragment: GPUShaderStage.FRAGMENT,
    both: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
  }
  return [
    ...SINGLES.map((name): GPUBindGroupLayoutEntry => {
      const [stage, layout, sized] = BLEND_TABLE[name],
        binding = BLEND_BINDINGS[name],
        visibility = stages[stage]
      if (!sized) return { binding, visibility, ...layout }
      return { binding, visibility, buffer: { ...layout.buffer, minBindingSize: viewSize } }
    }),
    ...atlasLayoutEntries(BLEND_BINDINGS.color),
    ...atlasLayoutEntries(BLEND_BINDINGS.data),
  ]
}

/** The unique entry list of the blend layout, live: each entry reads its resource from `r` when
 *  the group is made. */
export function blendBindEntries(r: BlendBindResources): GPUBindGroupEntry[] {
  const size = () => r.uniformSize
  return [
    ...SINGLES.map((name) => {
      const [, layout, sized] = BLEND_TABLE[name],
        binding = BLEND_BINDINGS[name]
      if (!layout.buffer) return resourceEntry(binding, () => r[name] as GPUBindingResource)
      return bufferEntry(binding, () => r[name] as GPUBuffer, undefined, sized ? size : undefined)
    }),
    ...atlasEntries(BLEND_BINDINGS.color, () => r.textures?.color),
    ...atlasEntries(BLEND_BINDINGS.data, () => r.textures?.data),
  ]
}
