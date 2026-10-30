import { ML_BINDING } from '../manyLightsSampled/volumeBindings.ts'

/**
 * WHERE THE VOLUME'S PROGRAMS BIND what they read and write, in group 0: one table of numbers, so the
 * passes, the layouts and the shaders agree (`programs.ts` writes the programs, `passes.ts` binds them).
 * A program binds only what it names (`FOG_PROGRAM_BINDINGS`).
 */
export const FOG_BINDING = {
  /** The light buffer, read. */
  lights: 0,
  /** The light lists of the light grid (`tileLights`), read. */
  tiles: 1,
  /** The frame (`FOG_VOLUME_FRAME`), a uniform. */
  frame: 2,
  /** The scene's depth, read by the scatter. */
  depth: 3,
  /** This image's furthest depth, read by the scatter. */
  furthest: 4,
  /** The previous image's furthest depth. */
  previousFurthest: 5,
  /** The previous volume the scatter blends in. */
  previousVolume: 6,
  /** The sampler the volumes are read through: linear, clamped. */
  sampler: 7,
  /** The volume the scatter writes, a storage texture. */
  scattering: 8,
  /** The integrated volume, written. */
  integrated: 9,
  /** The furthest depth, written. */
  furthestOut: 10,
  /** The scatter's volume, which the integration reads. */
  scatterIn: 11,
  /** The fog's cubemap, a cube texture (`createFogCubemap`). */
  cubemap: 12,
  /** The virtual shadow maps the sun's shadow reads: the page table, the projection data, the
   *  uniforms, the pool's first slice, and the projection's view. */
  pageTable: 13,
  projectionData: 14,
  shadowUniforms: 15,
  shadowPool: 16,
  shadowView: 17,
  /** The depth pyramid the furthest depth is read from (`hizDepthWgsl`): three bindings from this one. */
  hiz: 18,
  /** The voxelisation's frame (`FOG_VOXEL_FRAME`), a uniform; the objects it voxelises, read; what the
   *  first pass derives of them, written by it (`voxelSpans`) and read by the second (`voxelSpansRead`). */
  voxelFrame: 21,
  voxelObjects: 22,
  voxelSpans: 23,
  voxelSpansRead: 23,
  /** The medium the second pass writes — scattering with extinction, and emissive light — and the
   *  scatter reads. */
  voxelOut: 24,
  voxelEmitOut: 25,
  voxelIn: 26,
  voxelEmitIn: 27,
  /** The light functions' atlas and its table (`lightFunctionReadWgsl`), read by the scatter. */
  lightFunction: 28,
  /** The sun's light function drawn for the fog alone (`sunFunction/`): its texture and its view block, read by the scatter's sun
   *  where the atlas does not hold its function. */
  sunFunction: 130,
  sunFunctionView: 131,
  /** The clouds' shade (`cloudShadowReadWgsl`): its block and the maps of the air's two lights, read
   *  by the scatter's sun through the volumes' sampler. */
  cloudShadow: 29,
  cloudShadowMap0: 30,
  cloudShadowMap1: 31,
  /** The sky light's harmonics and the view's uniform (`skyLightDiffuseWgsl`), read by the scatter's sky. */
  skyHarmonics: 36,
  skyParams: 37,
  /** The translucency volume's light before its history (`published.fogView`), read by the scatter's cells in the place of
   *  the sky light's (`fogGiLight`), through the volumes' sampler. */
  translucencyGi: 38,
  /** The volumetric lightmap's eleven bindings (`volumetricLightmapWgsl`) from this one, read by the static
   *  term's pass. */
  lightmap: 40,
  /** The static term's volume: written by its pass, read by the scatter. */
  staticOut: 52,
  staticIn: 53,
  /** The graphs of the voxelised objects (`voxelGraph.ts`): their values, read, and — where a graph
   *  reads a texture — the colour atlas's pools and page table and the sampler it is read through. */
  graphValues: 60,
  graphPool0: 61,
  graphPool1: 62,
  graphPool2: 63,
  graphPages: 64,
  graphSampler: 65,
  /** The lists of the local fog volumes over each tile of the view (`localFogTileWord`), read by the
   *  scatter's cells: a read-only storage buffer of words. */
  localTiles: 66,
  /** The global distance field's six bindings (`globalDistanceFieldReadWgsl`) from this one, read by the sky scatter. */
  field: 70,
  /** The rectangle lights' atlas and its sampler (`rectSourceWgsl`), read by the scatter's local lights. */
  rectAtlas: 76,
  rectSampler: 77,
  /** The ray traced shadows of the volume's lights (`tracedWgsl.ts`): the word of each cell, a bit a rank of the light buffer, written by the pass that traces them and read by the scatter. */
  tracedOut: 120,
  tracedIn: 121,
  /** The lights of the light buffer whose ray traced shadow the volume holds: a bit a rank, 32 ranks a word. */
  tracedHeld: 122,
  /** The sampled lighting's volume (`manyLightsSampled/volumeBindings.ts`), read by the scatter: its uniform and its samples. */
  mlParams: ML_BINDING.params,
  mlSamplesIn: ML_BINDING.samplesIn,
} as const

/** What a program binds, by name. */
export type FogBindings = Partial<Record<keyof typeof FOG_BINDING, true>>

/** What the scatter binds; the one that sees the sky adds the global distance field's. */
const SCATTER_BINDINGS = {
  lights: true,
  tiles: true,
  frame: true,
  depth: true,
  furthest: true,
  previousFurthest: true,
  previousVolume: true,
  sampler: true,
  scattering: true,
  cubemap: true,
  pageTable: true,
  projectionData: true,
  shadowUniforms: true,
  shadowPool: true,
  shadowView: true,
  voxelIn: true,
  voxelEmitIn: true,
  lightFunction: true,
  sunFunction: true,
  sunFunctionView: true,
  cloudShadow: true,
  cloudShadowMap0: true,
  cloudShadowMap1: true,
  skyHarmonics: true,
  skyParams: true,
  translucencyGi: true,
  staticIn: true,
  localTiles: true,
  rectAtlas: true,
  rectSampler: true,
  tracedIn: true,
  tracedHeld: true,
} as const

/** The bindings of the programs. */
export const FOG_PROGRAM_BINDINGS = {
  furthest: { frame: true, hiz: true, furthestOut: true },
  scatter: SCATTER_BINDINGS,
  scatterSky: { ...SCATTER_BINDINGS, field: true },
  // The same two scatters with the local lights lit by samples (`sampledLightsVolume`).
  scatterSampled: { ...SCATTER_BINDINGS, mlParams: true, mlSamplesIn: true },
  scatterSkySampled: { ...SCATTER_BINDINGS, mlParams: true, mlSamplesIn: true, field: true },
  static: {
    lights: true,
    frame: true,
    depth: true,
    furthest: true,
    previousFurthest: true,
    sampler: true,
    cubemap: true,
    skyHarmonics: true,
    skyParams: true,
    lightmap: true,
    staticOut: true,
  },
  integrate: { frame: true, scatterIn: true, integrated: true },
  prepare: { frame: true, voxelFrame: true, voxelObjects: true, voxelSpans: true },
  voxelize: {
    frame: true,
    voxelFrame: true,
    voxelObjects: true,
    voxelSpansRead: true,
    voxelOut: true,
    voxelEmitOut: true,
  },
} as const satisfies Record<string, FogBindings>

/** What the pass that traces the volume's lights' shadows binds in its group 0 (the cut's tables it walks are bound beside, `tracedPass.ts`). */
export const FOG_TRACED_BINDINGS = {
  frame: true,
  depth: true,
  furthest: true,
  lights: true,
  tracedOut: true,
  tracedHeld: true,
} as const satisfies FogBindings

/** What the voxelisation of the objects that wear a graph binds beside its own (`voxelize`): the
 *  graphs' values, and the colour atlas where one reads a texture. */
export const FOG_GRAPH_BINDINGS = {
  values: { graphValues: true },
  textured: {
    graphValues: true,
    graphPool0: true,
    graphPool1: true,
    graphPool2: true,
    graphPages: true,
    graphSampler: true,
  },
} as const satisfies Record<string, FogBindings>

/** A program of the volume. */
export type FogProgramName = keyof typeof FOG_PROGRAM_BINDINGS
