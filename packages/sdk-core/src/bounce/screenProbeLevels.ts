/**
 * THE SCREEN PROBES' LEVELS AND CONSTANTS: the values each quality level holds (`SCREEN_PROBE_LEVEL_KNOBS`,
 * `SCREEN_PROBE_LOW_KNOBS`) and the numbers no level sets (`SCREEN_PROBE_CONSTANTS`), apart from the settings that
 * read them (`./screenProbeOptions.ts`).
 */

import type { SurfaceCacheOptions } from '../contracts/surfaceCacheOptions.ts'

/** The levels, `'off'` first, then from the coarsest to the finest. */
export const SCREEN_PROBE_LEVELS = ['off', 'low', 'high', 'ultra', 'cinematic'] as const
/** A level of the screen probes. */
export type ScreenProbeLevel = (typeof SCREEN_PROBE_LEVELS)[number]
/** The level of a view that names none. */
export const DEFAULT_SCREEN_PROBE_LEVEL: CastingLevel = 'ultra'

/** The levels that cast screen probes: `'off'` lights nothing, `'low'` takes the sky light's irradiance under the short-range occlusion. */
export type CastingLevel = Exclude<ScreenProbeLevel, 'off' | 'low'>

/** What each quality level below the top writes of the level, the reference's own scalability levels: the lowest
 *  lights nothing (the bounce is off, as its first row has no diffuse global illumination), the second reads the
 *  world's probes under the short-range occlusion, the third is `high` (`runtime/qualityLevels.ts`); `max` writes
 *  nothing, the default `ultra`; `cinematic` is the level of its own name, the reference's fifth row. */
export const SCREEN_PROBE_PRESET_LEVELS = {
  smooth: { screenProbes: 'off', bounce: false },
  balanced: { screenProbes: 'low' },
  fine: { screenProbes: 'high' },
  cinematic: { screenProbes: 'cinematic' },
} as const

/** How a probe's light is kept for the pixels that read it: nine spherical-harmonic coefficients, or an
 *  octahedral map of the irradiance (`IRRADIANCE_PROBE_SIDE` texels a side, one of border). */
type IrradianceFormat = 'sh3' | 'octahedral'

/** Texels along a side of a probe's octahedral irradiance, border excluded; the border is one texel. */
export const IRRADIANCE_PROBE_SIDE = 6

/** What a level holds of the short-range occlusion, every level above `'off'`. */
type OcclusionKnobs = {
  /** The short-range occlusion's reduction: 1 at the image's size, 2 at half. */
  occlusionDownsample: number
  /** Whether the horizon search reads the depth pyramid's first level rather than the depth itself. */
  occlusionPyramid: boolean
  /** The power the foreground occluders' share is raised to. */
  occlusionForegroundPower: number
  /** The slices of the horizon search a pixel makes. */
  occlusionSlices: number
  /** The most the occlusion applies on the pixels with backface diffuse light: 1 (whole) where the world's probes' flatter light needs it, else less (a row of
   *  each level; `screenProbeOcclusionFoliageStrength` replaces it). */
  occlusionFoliageStrength: number
  /** Whether the occlusion keeps a direction, the bent normal, beside its amount: the pass writes it, the temporal pass accumulates
   *  it and the lighting reads the specular occlusion from it (a row of each level). */
  bentNormal: boolean
}

/** What a level that casts probes holds beside it. */
type GatherKnobs = {
  /** Pixels along the side of a probe's tile. */
  downsampleFactor: number
  /** Samples of a tile an adaptive probe may be placed on, a count. */
  adaptiveProbes: number
  /** Rays along a side of the octahedron a probe traces. */
  tracingResolution: number
  irradianceFormat: IrradianceFormat
  /** Whether a pixel reads one probe of its four (drawn by noise) rather than the four. */
  stochasticInterpolation: boolean
  /** How far, in tiles, the probes a pixel reads are jittered. */
  jitterWidth: number
  /** Texels along the side of a world probe's radiance map (the radiance cache): the probe traces this side squared rays
   *  at most, half that side where nothing asks for more. */
  radianceProbeResolution: number
  /** Probes of the radiance cache traced an image, before the update speed scales it. */
  radianceProbeBudget: number
  /** Whether a pixel of a thin double-sided sheet that transmits light gathers the light along its backface
   *  (a row of each level; `screenProbeTwoSidedFoliageBackfaceDiffuse`
   *  turns it off over a level that allows it): else its back takes the sky light's irradiance. */
  backfaceDiffuse: boolean
}

/** What a level holds. */
export type LevelKnobs = OcclusionKnobs & GatherKnobs

/** What the second level holds: its occlusion search alone, no probe is cast. */
export const SCREEN_PROBE_LOW_KNOBS: Readonly<OcclusionKnobs> = {
  occlusionDownsample: 1,
  occlusionPyramid: true,
  occlusionForegroundPower: 1.5,
  occlusionSlices: 1,
  occlusionFoliageStrength: 1,
  bentNormal: false,
}

/** The levels' values: each casting level's tile, probes, rays, irradiance format, interpolation, jitter and
 *  occlusion search. */
export const SCREEN_PROBE_LEVEL_KNOBS: Readonly<Record<CastingLevel, LevelKnobs>> = {
  high: {
    downsampleFactor: 32,
    adaptiveProbes: 16,
    tracingResolution: 8,
    irradianceFormat: 'octahedral',
    stochasticInterpolation: true,
    jitterWidth: 1,
    occlusionDownsample: 2,
    occlusionPyramid: true,
    occlusionForegroundPower: 1.5,
    occlusionSlices: 2,
    occlusionFoliageStrength: 0.7,
    bentNormal: false,
    radianceProbeResolution: 16,
    radianceProbeBudget: 100,
    backfaceDiffuse: false,
  },
  ultra: {
    downsampleFactor: 16,
    adaptiveProbes: 8,
    tracingResolution: 8,
    irradianceFormat: 'sh3',
    stochasticInterpolation: false,
    jitterWidth: 1,
    occlusionDownsample: 1,
    occlusionPyramid: false,
    occlusionForegroundPower: 1,
    occlusionSlices: 2,
    occlusionFoliageStrength: 0.7,
    bentNormal: true,
    radianceProbeResolution: 32,
    radianceProbeBudget: 150,
    backfaceDiffuse: true,
  },
  cinematic: {
    downsampleFactor: 8,
    adaptiveProbes: 4,
    tracingResolution: 16,
    irradianceFormat: 'sh3',
    stochasticInterpolation: false,
    jitterWidth: 0.5,
    occlusionDownsample: 1,
    occlusionPyramid: false,
    occlusionForegroundPower: 1,
    occlusionSlices: 2,
    occlusionFoliageStrength: 0.7,
    bentNormal: true,
    radianceProbeResolution: 32,
    radianceProbeBudget: 350,
    backfaceDiffuse: true,
  },
}

/**
 * What each level of the global illumination holds of the surface cache's settings (`../contracts/surfaceCacheOptions.ts`), the
 * reference's scalability rows: the settings' own defaults are the `'ultra'` row, `'cinematic'` holds the same, `'high'` a smaller
 * atlas and cards, fewer lights a tile, a slower update and coarser, fewer radiosity probes, and `'low'` — which reads the world's
 * probes — a still smaller atlas at half the cards' density and resolution; `'off'` lights nothing with it and holds none. A setting
 * a host names keeps its value over the row (`resolveSurfaceCacheSettings`).
 */
export const SURFACE_CACHE_LEVEL_ROWS: Readonly<Record<ScreenProbeLevel, SurfaceCacheOptions>> = {
  off: {},
  low: {
    surfaceCacheAtlasSize: 2048,
    surfaceCacheCardTexelDensityScale: 50,
    surfaceCacheCardMinResolution: 2,
    surfaceCacheCardMaxResolution: 256,
    surfaceCacheDirectLightingMaxLightsPerTile: 4,
    surfaceCacheDirectLightingUpdateFactor: 128,
    surfaceCacheRadiosityUpdateFactor: 128,
    surfaceCacheRadiosityProbeSpacing: 4,
    surfaceCacheRadiosityHemisphereProbeResolution: 3,
  },
  high: {
    surfaceCacheAtlasSize: 3584,
    surfaceCacheCardTexelDensityScale: 100,
    surfaceCacheCardMinResolution: 4,
    surfaceCacheCardMaxResolution: 512,
    surfaceCacheDirectLightingMaxLightsPerTile: 4,
    surfaceCacheDirectLightingUpdateFactor: 64,
    surfaceCacheRadiosityUpdateFactor: 128,
    surfaceCacheRadiosityProbeSpacing: 8,
    surfaceCacheRadiosityHemisphereProbeResolution: 3,
  },
  ultra: {},
  cinematic: {},
}

/** Whether `level` casts screen probes. */
export const castsProbes = (level: ScreenProbeLevel): level is CastingLevel =>
  level !== 'off' && level !== 'low'

/**
 * What no level sets and no setting reads: the numbers that are literals of the passes, as the reference writes them
 * (a weight under which a probe or a texel is not read, the scale of a plane test in an exponent, the period of a
 * tile's jitter), the defaults the rules take, and the one refinement the importance sampling has.
 */
export const SCREEN_PROBE_CONSTANTS = {
  /** The share of the uniform probes an adaptive placement may add. */
  adaptiveFractionDefault: 0.5,
  /** The weight under which a probe is not read. */
  minInterpolationWeight: 0.01,
  /** The scale the depth weights are multiplied by in the exponent. */
  depthWeightScale: -10000,
  /** The weight under which a probe of the last image is not read for the importance sampling's light, the
   *  same scale in the exponent. */
  importanceHistoryMinWeight: 0.1,
  /** The scale of the plane test a pixel's jittered neighbour passes, in the exponent, and the weight it
   *  must keep (the minimum an interpolation reads). */
  jitterPlaneWeightScale: -1000000,
  /** The bilinear weight under which a texel of the last image is not read as history. */
  historyMinWeight: 0.01,
  /** Levels of refinement of the importance sampling past a probe's own resolution: the parallel path the
   *  engine follows takes one. */
  importanceLevels: 1,
  /** The ray directions a probe turns through before they come round. */
  rayDirections: 8,
  /** Jitters of a probe's tile before they come round. */
  tileJitters: 8,
  /** The scale of the nearest a radiance-cache probe's ray starts at, over its cell's diagonal. */
  radianceProbeMinTraceScale: 1,
  /** The inverse of the cells a level fades over at its edge. */
  radianceInvLevelFadeSize: 1,
  /** The furthest a probe's ray distance is held to, metres: the half float's largest, in the reference's centimetres. */
  radianceMaxHitDistance: 655.04,
  /** The furthest a radiance-cache probe's ray distance is held to, and the distance a ray that met no surface reads back as, metres: one
   *  hundredth of a metre under the half float's largest, in the reference's centimetres (65503). */
  radianceCacheMaxHitDistance: 655.03,
  /** Frames the temporal pass takes before a pixel's history is as heavy as it gets, at an update speed of 1. */
  maxFramesAccumulated: 10,
  /** The most a pixel's frames are coded by in the history's frames byte: four bits. */
  maxFramesCoded: 15,
} as const
