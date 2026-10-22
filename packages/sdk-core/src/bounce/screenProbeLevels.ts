/**
 * THE SCREEN PROBES' LEVELS AND CONSTANTS: the values each quality level holds (`SCREEN_PROBE_LEVEL_KNOBS`) and
 * the numbers no level sets (`SCREEN_PROBE_CONSTANTS`), apart from the settings that read them
 * (`./screenProbeOptions.ts`).
 */

/** The levels, `'off'` first, then from the coarsest to the finest. */
export const SCREEN_PROBE_LEVELS = ['off', 'high', 'ultra', 'cinematic'] as const
/** A level of the screen probes. */
export type ScreenProbeLevel = (typeof SCREEN_PROBE_LEVELS)[number]
/** The level of a view that names none. */
export const DEFAULT_SCREEN_PROBE_LEVEL: ScreenProbeLevel = 'ultra'

/** What each quality level below the top writes of the level, the reference's own scalability levels: its two
 *  lowest read the world's probes directly (no screen probe), the third is `high` (`runtime/qualityLevels.ts`);
 *  `max` writes nothing, the default `ultra`. */
export const SCREEN_PROBE_PRESET_LEVELS = {
  smooth: { screenProbes: 'off' },
  balanced: { screenProbes: 'off' },
  fine: { screenProbes: 'high' },
} as const

/** How a probe's light is kept for the pixels that read it: nine spherical-harmonic coefficients, or an
 *  octahedral map of the irradiance (`IRRADIANCE_PROBE_SIDE` texels a side, one of border). */
type IrradianceFormat = 'sh3' | 'octahedral'

/** Texels along a side of a probe's octahedral irradiance, border excluded; the border is one texel. */
export const IRRADIANCE_PROBE_SIDE = 6

/** What a level holds. */
export type LevelKnobs = {
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
  /** The short-range occlusion's reduction: 1 at the image's size, 2 at half. */
  occlusionDownsample: number
  /** Whether the horizon search reads the depth pyramid's first level rather than the depth itself. */
  occlusionPyramid: boolean
  /** The power the foreground occluders' share is raised to. */
  occlusionForegroundPower: number
  /** Whether the level lets a probe's ray be traced against the scene's detail (`screenProbeMeshTraces`
   *  turns it on over a level that allows it). */
  meshTraces: boolean
}

/** The levels' values: each level's tile, probes, rays, irradiance format, interpolation, jitter and
 *  occlusion search. */
export const SCREEN_PROBE_LEVEL_KNOBS: Readonly<
  Record<Exclude<ScreenProbeLevel, 'off'>, LevelKnobs>
> = {
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
    meshTraces: false,
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
    meshTraces: true,
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
    meshTraces: true,
  },
}

/**
 * What no level sets: the screen probes' filter, history and rays, and the short-range
 * occlusion's search and weights. Not settings of a host: each is a constant of the passes built on it.
 */
export const SCREEN_PROBE_CONSTANTS = {
  /** The share of the uniform probes an adaptive placement may add. */
  adaptiveFractionDefault: 0.5,
  /** The weight an interpolation's depth test gives the plane distance, before its scale of -10000. */
  interpolationDepthWeight: 1,
  /** The same for a probe found only as a fallback, where the first test left no weight. */
  interpolationDepthWeightFallback: 0.1,
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
  /** Levels of refinement of the importance sampling past a probe's own resolution. */
  importanceLevels: 1,
  /** The furthest a ray looks for a surface, in metres. */
  maxTraceDistance: 200,
  /** The ray directions a probe turns through before they come round. */
  rayDirections: 8,
  /** Jitters of a probe's tile before they come round. */
  tileJitters: 8,
  /** Frames the temporal pass takes before a pixel's history is as heavy as it gets, at an update speed of 1. */
  maxFramesAccumulated: 10,
  /** Short-range occlusion: the slices of the horizon search, the albedo its multibounce is capped at, the
   *  neighbourhood's clamp scale, the steps of a slice, the foreground a sample may be nearer than, as a fraction
   *  of the depth. */
  occlusionSlices: 2,
  occlusionMaxAlbedo: 0.5,
  occlusionClampScale: 1,
  occlusionSteps: 3,
  occlusionForegroundFraction: 0.3,
} as const
