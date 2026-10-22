import { bufferEntry, resourceEntry } from './liveEntries.ts'
import { BLEND_BINDINGS, atlasLayoutEntries } from './bindLayout.ts'
import { bufferLayout, storageTextureLayout, textureLayout } from '../core/computeBindings.ts'
import { VSM_BLUE_NOISE_FORMAT } from '../../lighting/shadows/vsm/blueNoise.ts'
import { VSM_TRANSMISSION_FORMAT } from '../../lighting/shadows/vsm/transmission/transmissionLayout.ts'
import { atlasEntries, type AtlasResources } from './bindEntries.ts'
import { ATLAS_TEXTURE_FORMAT } from '../../lighting/lightFunction/layout.ts'
import { FRONT_TRACED_LAYOUT } from '../../lighting/reflections/frontLayer.ts'

/** Lighting shared with the opaque resolve; deferred stand-ins cover resources not ready yet. */
export type BlendLighting = {
  directLights: GPUBuffer
  /** The virtual shadow maps a transparent samples (`BLEND_VSM_BINDINGS`), on the old shadow
   *  numbers: page table, projection data, uniforms and the pool's first slice. */
  shadowData: GPUBuffer
  shadowAtlas: GPUBuffer
  shadowSampler: GPUBuffer
  /** The translucent casters' transmission atlas (`vsmTransmissionReadWgsl`), or its one-texel
   *  stand-in. */
  shadowTransmittance: GPUTextureView
  shadowPool: GPUBuffer
  /** What a fragment traces with past the maps (`BLEND_TRACE_BINDINGS`): the shadow projection's
   *  view uniform and blue noise. */
  shadowView: GPUBuffer
  shadowNoise: GPUTextureView
  bounceGrid: GPUBuffer
  /** The probes' atlas (`../../lighting/bounce/atlas.ts`). */
  probes: GPUTextureView
  /** Per-tile lamp lists: the blend pass reads the slice that concerns it. */
  tileLights: GPUBuffer
  /** The transparents' front radiance the reflection trace wrote (`../../lighting/reflections/frontLayer.ts`),
   *  or its stand-in: what a fragment of the front surface reflects. */
  frontTraced: GPUTextureView
  /** What the fog reads past the light buffer (`BLEND_FOG_BINDINGS`, `FogRead`): the cubemap, the
   *  volume and the sampler, or their stand-ins. */
  fogCubemap: GPUTextureView
  fogVolume: GPUTextureView
  fogSampler: GPUSampler
  /** What the light functions are read from (`BLEND_LIGHT_FUNCTION_BINDINGS`): the atlas and its
   *  table, or the stand-in, which answers no light function. */
  lightFunctionAtlas: GPUTextureView
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
    /** Item records, indexed by the item's rank in the scene (`../../blend/items.ts`). */
    items: GPUBuffer
    /** The float pool's normal atlas, or the empty one. */
    normals: GPUTextureView
    /** The surfaces' records (`../../materials/table/materialTable.ts`), the opaque resolve's own. */
    material: GPUTextureView
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

const STORAGE: Layout = bufferLayout('read-only-storage'),
  UNIFORM: Layout = bufferLayout('uniform'),
  FLOAT_ARRAY: Layout = textureLayout('unfilterable-float', '2d-array')

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
  // Every normal a transparent reads is a float atlas (`../core/floatAtlas.ts`, #1410).
  normals: ['vertex', FLOAT_ARRAY],
  directLights: ['fragment', STORAGE],
  clusterDiagnostic: ['vertex', STORAGE],
  planInstances: ['vertex', STORAGE],
  clusterSpans: ['vertex', STORAGE],
  // The virtual shadow maps (`BLEND_VSM_BINDINGS`): page table, projection data, uniforms, pool.
  shadowData: ['fragment', STORAGE],
  shadowAtlas: ['fragment', STORAGE],
  shadowSampler: ['fragment', UNIFORM],
  // The casters' memory, the blue noise and the front's radiance are read by load alone: read-only
  // storage textures, which spend none of the sixteen sampled textures of the fragment stage
  // (`loadOnlyTarget`, `BLEND_TRACE_BINDINGS`).
  shadowTransmittance: ['fragment', storageTextureLayout(VSM_TRANSMISSION_FORMAT, '2d-array')],
  shadowPool: ['fragment', STORAGE],
  shadowView: ['fragment', UNIFORM],
  shadowNoise: ['fragment', storageTextureLayout(VSM_BLUE_NOISE_FORMAT)],
  bounceGrid: ['fragment', UNIFORM],
  probes: ['fragment', FLOAT_ARRAY],
  tileLights: ['fragment', STORAGE],
  // The front's traced radiance, read by load: nothing the fragment stage could write, which would
  // cost the pass its early depth reject (4232 hidden fragment draws).
  frontTraced: ['fragment', FRONT_TRACED_LAYOUT],
  // The fog's cubemap and volume, and the sampler they are read through: the entries
  // `fogReadLayoutEntries` makes for a program that binds them.
  fogCubemap: ['fragment', textureLayout('float', 'cube')],
  fogVolume: ['fragment', textureLayout('float', '3d')],
  fogSampler: ['fragment', { sampler: { type: 'filtering' } }],
  // The light functions: their atlas and its table, words read by load.
  lightFunctionAtlas: ['fragment', storageTextureLayout(ATLAS_TEXTURE_FORMAT)],
  // The surfaces' records (`../../materials/table/materialTable.ts`), which the vertex stage reads an item's
  // factors and maps from and a lobed fragment its lobes: a texture, the fragment stage holding
  // the eight storage buffers WebGPU guarantees.
  material: ['both', { texture: { sampleType: 'uint', viewDimension: '2d-array' } }],
}
const SINGLES = Object.keys(BLEND_TABLE) as Single[]

/** The forward materials' layout entries (`../../blend/pipelines.ts`), the view uniform at least
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
