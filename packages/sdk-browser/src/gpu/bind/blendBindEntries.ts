import { GRAPH_FRAME_BYTES } from '../../visibility/shader/graphFrameWgsl.ts'
import { bufferEntry, resourceEntry } from './liveEntries.ts'
import {
  BLEND_BINDINGS,
  BLEND_CLOUD_FOG_BINDINGS,
  BLEND_CLOUD_SHADE_BINDINGS,
  BLEND_RECT_BINDINGS,
  atlasLayoutEntries,
} from './bindLayout.ts'
import {
  cloudFogLayoutEntries,
  type CloudFogSet,
} from '../../modules/sky/clouds/translucentRead.ts'
import {
  cloudShadowLayoutEntries,
  type CloudShadeSet,
} from '../../lighting/atmosphere/cloudShadowRead.ts'
import { bufferLayout, storageTextureLayout, textureLayout } from '../core/computeBindings.ts'
import { BLUE_NOISE_FORMAT } from '../noise/blueNoiseTextures.ts'
import { atlasEntries, type AtlasResources } from './bindEntries.ts'
import { ATLAS_TEXTURE_FORMAT } from '../../lighting/lightFunction/layout.ts'
import { FRONT_TRACED_LAYOUT } from '../../lighting/reflections/frontLayer.ts'
import { rectAtlasLayoutEntries } from '../../lighting/rectLightAtlas/bindings.ts'
import { SURFACE_WORDS_FORMAT } from '../../materials/surface/surfaceOutputs.ts'
import {
  BLEND_OBJECT_SHADOW_BINDINGS,
  foldsProfiles,
  readsAtlasTexture,
  type ObjectShadowAtlasRead,
} from '../core/objectShadowRead.ts'

/** Lighting shared with the opaque resolve; deferred stand-ins cover resources not ready yet. */
export type BlendLighting = {
  directLights: GPUBuffer
  /** The virtual shadow maps a transparent samples (`BLEND_VSM_BINDINGS`), on the old shadow
   *  numbers: page table, projection data, uniforms and the pool's first slice. */
  shadowData: GPUBuffer
  shadowAtlas: GPUBuffer
  shadowSampler: GPUBuffer
  shadowPool: GPUBuffer
  /** What a fragment traces with past the maps (`BLEND_TRACE_BINDINGS`): the shadow projection's
   *  view uniform and blue noise. */
  shadowView: GPUBuffer
  shadowNoise: GPUTextureView
  /** The opaque surfaces' flags, or a stand-in: what a translucent surface's contact shadow ray reads of the surface it hits
   *  (`BLEND_BINDINGS.surfaceFlags`). */
  surfaceFlags: GPUTextureView
  /** Per-tile lamp lists: the blend pass reads the slice that concerns it. */
  tileLights: GPUBuffer
  /** The transparents' front radiance the reflection trace wrote (`../../lighting/reflections/frontLayer.ts`),
   *  or its stand-in: what a fragment of the front surface reflects. */
  frontTraced: GPUTextureView
  /** What the fog reads past the light buffer (`BLEND_FOG_BINDINGS`, `FogRead`): the cubemap, the
   *  volume, the sampler and the lists of the local fog volumes, or their stand-ins. */
  fogCubemap: GPUTextureView
  fogVolume: GPUTextureView
  fogSampler: GPUSampler
  fogTiles: GPUBuffer
  /** What the light functions are read from (`BLEND_LIGHT_FUNCTION_BINDINGS`): the atlas and its
   *  table, or the stand-in, which answers no light function. */
  lightFunctionAtlas: GPUTextureView
  /** The translucency lighting volume the surfaces lit from it read (`../../lighting/translucency/readWgsl.ts`): this image's, or
   *  the one-cell stand-in where none is made (`BlendView.volumeRead` then says so). */
  translucencyVolume: GPUTextureView
  /** The translucency global illumination volume the surfaces read their indirect light from (`../../lighting/translucencyGi/readWgsl.ts`):
   *  this image's ambient and directional light, stacked in one texture of the one grid, or its one-cell stand-in where none is made
   *  (`BlendView.giGrid` then says so), and their trilinear sampler. */
  translucencyGi: GPUTextureView
  translucencyGiSampler: GPUSampler
  /** The light profiles' atlas and its sampler (`BLEND_LIGHT_PROFILE_BINDINGS`), or the stand-in a program that reads none binds. */
  lightProfileAtlas: GPUTextureView
  lightProfileSampler: GPUSampler
  /** The rectangle lights' atlas and its sampler (`BLEND_RECT_BINDINGS`), or the stand-in of no picture: bound where the device grants the
   *  seventeenth sampled texture (`grantsRectPictures`). */
  rectAtlas: GPUTextureView
  rectSampler: GPUSampler
  /** What the blends of a session that reads its object's shadow bind past the rectangle lights' pictures (`BLEND_OBJECT_SHADOW_BINDINGS`): this image's, or the stand-ins that shadow nothing. */
  objectShadow?: {
    /** The subjects' atlas, bound by the native read alone. */
    atlas?: GPUBindingResource
    packed: GPUTextureView
  }
  /** The beer map of the camera and the volumes' radiance in two layers, or the stand-in (`BlendView.volumeCamera` then says none is made). */
  volumeCamera: GPUTextureView
  /** The clouds' shade of the forward directional light, the block and the one map its vertices
   *  read (`BLEND_CLOUD_SHADE_BINDINGS`), or its stand-in, which shades nothing: read by the
   *  programs that read the clouds per vertex alone, bound by every program's group: the pass
   *  always gives it (`blendLightResources`). */
  cloudShade?: CloudShadeSet
  /** The cloud image the vertices of the surfaces whose material has `cloudFog` read
   *  (`BLEND_CLOUD_FOG_BINDINGS`), or its stand-in, which clears the layer: likewise. */
  cloudFog?: CloudFogSet
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
    /** The graph frame (`../../frame/render/graphFrame.ts`). */
    frame: GPUBuffer
    /** Instance list expanded for the image, and each cluster's span in the cache, with the identity
     *  of the cluster (one word per draw-table entry) after the spans. */
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
  // The light buffer is read by the vertex stage too, for the fog it works out per vertex (`fogLaidFar`).
  directLights: ['both', STORAGE],
  planInstances: ['vertex', STORAGE],
  clusterSpans: ['vertex', STORAGE],
  // The virtual shadow maps (`BLEND_VSM_BINDINGS`): page table, projection data, uniforms, pool.
  shadowData: ['fragment', STORAGE],
  shadowAtlas: ['fragment', STORAGE],
  shadowSampler: ['fragment', UNIFORM],
  // The blue noise and the front's radiance are read by load alone: read-only storage textures,
  // which spend none of the sixteen sampled textures of the fragment stage (`loadOnlyTarget`,
  // `BLEND_TRACE_BINDINGS`).
  shadowPool: ['fragment', STORAGE],
  shadowView: ['fragment', UNIFORM],
  shadowNoise: ['fragment', storageTextureLayout(BLUE_NOISE_FORMAT)],
  tileLights: ['fragment', STORAGE],
  // The front's traced radiance, read by load: nothing the fragment stage could write, which would
  // cost the pass its early depth reject (4232 hidden fragment draws).
  frontTraced: ['fragment', FRONT_TRACED_LAYOUT],
  // The opaque surfaces' flags (`BLEND_BINDINGS.surfaceFlags`).
  surfaceFlags: ['fragment', storageTextureLayout(SURFACE_WORDS_FORMAT)],
  // The fog's cubemap and volume, and the sampler they are read through: the entries
  // `fogReadLayoutEntries` makes for a program that binds them.
  // The cubemap and its sampler are read by the vertex stage too, for the same fog.
  fogCubemap: ['both', textureLayout('float', 'cube')],
  fogVolume: ['fragment', textureLayout('float', '3d')],
  fogSampler: ['both', { sampler: { type: 'filtering' } }],
  // The lists of the local fog volumes over each tile: words, read by index; the vertex stage reads them too,
  // for the local fog volumes it lays over the fog of a vertex.
  fogTiles: ['both', STORAGE],
  // The light functions: their atlas and its table, words read by load.
  lightFunctionAtlas: ['fragment', storageTextureLayout(ATLAS_TEXTURE_FORMAT)],
  // The translucency lighting volume: one filterable 3D texture, the ambient and directional light of its two cascades stacked, sampled trilinear.
  translucencyVolume: ['fragment', textureLayout('float', '3d')],
  // The translucency global illumination volume, its ambient and its directional light stacked, and its sampler: the surfaces' indirect light,
  // two filtered fetches.
  translucencyGi: ['fragment', textureLayout('float', '3d')],
  translucencyGiSampler: ['fragment', { sampler: { type: 'filtering' } }],
  // The light profiles' atlas and its sampler, read by the lit programs of a scene whose lights name a profile.
  lightProfileAtlas: ['fragment', textureLayout('float', '2d-array')],
  lightProfileSampler: ['fragment', { sampler: { type: 'filtering' } }],
  // The heterogeneous volumes' camera map and radiance, read by load.
  volumeCamera: ['fragment', textureLayout('unfilterable-float', '2d-array')],
  // The surfaces' records (`../../materials/table/materialTable.ts`), which the vertex stage reads an item's
  // factors and maps from and a lobed fragment its lobes: a texture, the fragment stage holding
  // the eight storage buffers WebGPU guarantees.
  material: ['both', { texture: { sampleType: 'uint', viewDimension: '2d-array' } }],
  // The graph frame (`../../visibility/shader/graphFrameWgsl.ts`): the clocks and the camera an
  // offset moves a vertex by.
  frame: ['both', { buffer: { type: 'uniform', minBindingSize: GRAPH_FRAME_BYTES } }],
}
const SINGLES = Object.keys(BLEND_TABLE) as Single[]
/** The singles of a group: all but the light profiles' atlas where the programs read it from the packed table (`'folded'`), which spends the texture's place on the table. */
const singlesOf = (objectShadow?: ObjectShadowAtlasRead) =>
  foldsProfiles(objectShadow) ? SINGLES.filter((name) => name !== 'lightProfileAtlas') : SINGLES

/** The forward materials' layout entries (`../../blend/pipelines.ts`), the view uniform at least
 *  `viewSize` bytes, and the vertex stage's reads of the clouds' shade (`BLEND_CLOUD_SHADE_BINDINGS`)
 *  and of the cloud image (`BLEND_CLOUD_FOG_BINDINGS`) in every layout: the programs that read them
 *  are a scene's or a setting's, which come and go while the layout stays; and, with `rectPictures` (`grantsRectPictures`), the rectangle
 *  lights' atlas and its sampler (`BLEND_RECT_BINDINGS`). */
export function blendLayoutEntries(
  viewSize: number,
  vertexTextures = false,
  rectPictures = false,
  objectShadow?: ObjectShadowAtlasRead,
): GPUBindGroupLayoutEntry[] {
  const stages = {
    vertex: GPUShaderStage.VERTEX,
    fragment: GPUShaderStage.FRAGMENT,
    both: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
  }
  // The colour atlas is read by the vertex stage where an offset reads a texture (`grantsVertexTextures`).
  const atlas = vertexTextures ? stages.both : stages.fragment
  return [
    ...singlesOf(objectShadow).map((name): GPUBindGroupLayoutEntry => {
      const [stage, layout, sized] = BLEND_TABLE[name],
        binding = BLEND_BINDINGS[name],
        // The sampler is read by the vertex stage too where an offset reads a texture.
        visibility = name === 'sampler' && vertexTextures ? stages.both : stages[stage]
      if (!sized) return { binding, visibility, ...layout }
      return { binding, visibility, buffer: { ...layout.buffer, minBindingSize: viewSize } }
    }),
    ...atlasLayoutEntries(BLEND_BINDINGS.color, atlas),
    ...atlasLayoutEntries(BLEND_BINDINGS.data),
    ...(rectPictures ? rectAtlasLayoutEntries(BLEND_RECT_BINDINGS, GPUShaderStage.FRAGMENT) : []),
    ...(objectShadow ? objectShadowLayoutEntries(objectShadow) : []),
    ...cloudShadowLayoutEntries(BLEND_CLOUD_SHADE_BINDINGS, GPUShaderStage.VERTEX),
    ...cloudFogLayoutEntries(BLEND_CLOUD_FOG_BINDINGS, GPUShaderStage.VERTEX),
  ]
}

/** The layout entries of the object shadow read (`BLEND_OBJECT_SHADOW_BINDINGS`): the subjects' atlas where it is sampled (`ObjectShadowAtlasRead`), and the packed table both stages read. */
const objectShadowLayoutEntries = (read: ObjectShadowAtlasRead): GPUBindGroupLayoutEntry[] => {
  const b = BLEND_OBJECT_SHADOW_BINDINGS
  return [
    ...(readsAtlasTexture(read)
      ? [
          {
            binding: b.atlas,
            visibility: GPUShaderStage.FRAGMENT,
            ...textureLayout('float', '2d-array'),
          },
        ]
      : []),
    {
      binding: b.packed,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      ...textureLayout('uint', '2d-array'),
    },
  ]
}

/** The live entries of the object shadow read: the atlas entry only where the resources hold one. */
const objectShadowEntries = (r: BlendBindResources, native: boolean): GPUBindGroupEntry[] => {
  const b = BLEND_OBJECT_SHADOW_BINDINGS
  return [
    ...(native ? [resourceEntry(b.atlas, () => r.objectShadow?.atlas)] : []),
    resourceEntry(b.packed, () => r.objectShadow?.packed),
  ]
}

/** The entries of the clouds' shade the vertex stage reads (`BLEND_CLOUD_SHADE_BINDINGS`), live. */
const cloudShadeEntries = (r: BlendBindResources): GPUBindGroupEntry[] => {
  const b = BLEND_CLOUD_SHADE_BINDINGS
  return [
    bufferEntry(b.block, () => r.cloudShade?.block),
    resourceEntry(b.map0, () => r.cloudShade?.map),
    resourceEntry(b.sampler, () => r.cloudShade?.sampler),
  ]
}

/** The entries of the cloud image the vertex stage reads (`BLEND_CLOUD_FOG_BINDINGS`), live. */
const cloudFogEntries = (r: BlendBindResources): GPUBindGroupEntry[] => {
  const b = BLEND_CLOUD_FOG_BINDINGS
  return [
    bufferEntry(b.block, () => r.cloudFog?.block),
    resourceEntry(b.colour, () => r.cloudFog?.colour),
    resourceEntry(b.depth, () => r.cloudFog?.depth),
    resourceEntry(b.sampler, () => r.cloudFog?.sampler),
  ]
}

/** The unique entry list of the blend layout, live: each entry reads its resource from `r` when
 *  the group is made. */
export function blendBindEntries(
  r: BlendBindResources,
  rectPictures = false,
  objectShadow?: ObjectShadowAtlasRead,
): GPUBindGroupEntry[] {
  const size = () => r.uniformSize
  return [
    ...singlesOf(objectShadow).map((name) => {
      const [, layout, sized] = BLEND_TABLE[name],
        binding = BLEND_BINDINGS[name]
      if (!layout.buffer) return resourceEntry(binding, () => r[name] as GPUBindingResource)
      return bufferEntry(binding, () => r[name] as GPUBuffer, undefined, sized ? size : undefined)
    }),
    ...atlasEntries(BLEND_BINDINGS.color, () => r.textures?.color),
    ...atlasEntries(BLEND_BINDINGS.data, () => r.textures?.data),
    ...(rectPictures
      ? [
          resourceEntry(BLEND_RECT_BINDINGS.atlas, () => r.rectAtlas),
          resourceEntry(BLEND_RECT_BINDINGS.sampler, () => r.rectSampler),
        ]
      : []),
    ...(objectShadow ? objectShadowEntries(r, readsAtlasTexture(objectShadow)) : []),
    ...cloudShadeEntries(r),
    ...cloudFogEntries(r),
  ]
}
