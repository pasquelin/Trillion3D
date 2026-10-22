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
  /** The clouds' shade (`cloudShadowReadWgsl`): its block and the maps of the air's two lights, read
   *  by the scatter's sun through the volumes' sampler. */
  cloudShadow: 29,
  cloudShadowMap0: 30,
  cloudShadowMap1: 31,
  /** The global distance field's four bindings (`globalDistanceFieldReadWgsl`) from this one, read by the sky scatter. */
  field: 32,
  /** The sky light's harmonics and the view's uniform (`skyLightDiffuseWgsl`), read by the scatter's sky. */
  skyHarmonics: 36,
  skyParams: 37,
  /** The volumetric lightmap's twelve bindings (`volumetricLightmapWgsl`) from this one, read by the static
   *  term's pass. */
  lightmap: 40,
  /** The static term's volume: written by its pass, read by the scatter. */
  staticOut: 52,
  staticIn: 53,
} as const

/** What a program binds, by name. */
export type FogBindings = Partial<Record<keyof typeof FOG_BINDING, true>>

/** The bindings of the programs. */
export const FOG_PROGRAM_BINDINGS = {
  furthest: { frame: true, hiz: true, furthestOut: true },
  scatter: {
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
    cloudShadow: true,
    cloudShadowMap0: true,
    cloudShadowMap1: true,
    skyHarmonics: true,
    skyParams: true,
    staticIn: true,
  },
  scatterSky: {
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
    cloudShadow: true,
    cloudShadowMap0: true,
    cloudShadowMap1: true,
    skyHarmonics: true,
    skyParams: true,
    staticIn: true,
    field: true,
  },
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

/** A program of the volume. */
export type FogProgramName = keyof typeof FOG_PROGRAM_BINDINGS
