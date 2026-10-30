import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { guideAt, ranksAt, samplesOfPixel, type SampledGeometry } from './layout.ts'
import type { SampledLightsSettings } from './parameters.ts'
import { sampledMinSampleWeightEstimate, sampledTransmissionSampleWeight } from './parameters.ts'

/** The words of the uniform of an image of the sampled lighting, in the order `SampledParams` declares them. */
export const SAMPLED_PARAMS_WORDS = 84

/**
 * THE UNIFORM OF THE IMAGE, read by every kernel: the tiles of the view and of the downsampled view, the downsample factor and the samples of
 * a pixel (along x and y), the downsampled view and the samples' size, the words a mode's list holds, the switches (the empty tiles far from a
 * shaded one left out, textured rectangle tiles made, the history guiding the draw, the directional lights joining it, the rays merged, soft
 * shadows), the image's frame, the samples of a pixel in all, the tiles of the guide of the last image, where its hidden sets and its light
 * power ratios start, then the weights: the least a light's estimate must be to be weighed, the least a sample's weight, the share of its
 * weight a hidden light keeps (and on a history miss), the transmission assumed, the directional lights' ratio and their clamping weight, then the
 * view-projection of the image before, which a surface's place in it is found by (`previous`, all zero where there is no image before), the
 * screen trace's distance, thickness and normal bias (`trace`) its switch, iterations and whether hair pixels march (`screenTrace`), then the longest ray toward an unshadowed light for hair (`x`) the first-person stand-ins' least handed-on distance (`y`), the most a sample weighs (`z`) and where its light was hidden (`w`) (`hair`); `screenTrace.w` says the shading confidence is kept; then the temporal filter's history distance, least and longest history and clamp scale (`denoise`), and whether it has a history to filter with (`denoiseU.x`); then the spatial filter's depth weight, radius, disocclusion frames (held to the history's length less one) and the history's deviation threshold (`spatial`), the disocclusion variance scales (`spatialMore`), and whether it runs, its samples and whether the history's variance drives it, and whether the shading keeps the specular light alone (`spatialU`).
 */
/** The uniform's declaration in bind group `group` (0 for the sampled lighting's own kernels, another for a pass that shares a group 0 with the shadow maps). */
export const sampledParamsWgsl = (group: number) =>
  wgslBlock(
    group === 0 ? 'SAMPLED_PARAMS_WGSL' : `SAMPLED_PARAMS_WGSL_${group}`,
    [],
    `struct SampledParams{
 viewTiles:vec2u,downTiles:vec2u,factor:vec2u,samples:vec2u,downView:vec2u,sampleView:vec2u,
 stride:u32,fastClear:u32,textured:u32,guide:u32,
 frame:u32,merge:u32,soft:u32,count1d:u32,
 historyTiles:vec2u,hiddenAt:u32,ratiosAt:u32,
 minEstimate:f32,minWeight:f32,hiddenWeight:f32,hiddenMissWeight:f32,
 transmission:f32,dirRatio:f32,dirMinWeight:f32,directional:u32,
 previous:mat4x4f,
 trace:vec4f,screenTrace:vec4u,hair:vec4f,
 denoise:vec4f,denoiseU:vec4u,spatial:vec4f,spatialMore:vec4f,spatialU:vec4u,
 ranksAt:u32,
}
@group(${group}) @binding(${SAMPLED_BINDINGS.params}) var<uniform> params:SampledParams;`,
  )

export const SAMPLED_PARAMS_WGSL = sampledParamsWgsl(0)

/** What an image gives the uniform besides its geometry and the settings. */
export interface SampledImage {
  /** The image's frame index (the sampling's noise is a function of it). */
  frame: number
  /** Whether the guide of the last image holds anything to guide the draw by. */
  history: boolean
  /** The tiles of that guide (the last image's, which may differ from this image's after a resize). */
  historyTiles: readonly [number, number]
  /** The view-projection (no jitter) of the image before, 16 numbers; zeros for none. */
  previousViewProjection: ArrayLike<number>
  /** Whether a rectangle light textured by an image may reach a tile (the engine has none: false). */
  textured: boolean
  /** Whether the classification leaves out the empty tiles far from a shaded one. */
  fastClear: boolean
  /** Whether an area light's penumbra is sampled. */
  soft: boolean
  /** Whether the shading keeps only the specular light (the nearest translucent layer's `sampledLightsFrontLayerSpecularOnly`). */
  specularOnly: boolean
  /** The lights the guide keeps a ratio and a rank of (`guideWords`): the ranks start that far after the ratios. */
  lightCount: number
}

/** The screen traces' and the shading's words of the uniform. */
function writeTraceWords(
  words: Uint32Array,
  floats: Float32Array,
  settings: SampledLightsSettings,
) {
  floats.set(
    [
      settings.sampledLightsScreenTraceDistance,
      settings.sampledLightsScreenTraceThickness,
      settings.sampledLightsScreenTraceNormalBias,
      settings.sampledLightsScreenTraceHairBias,
    ],
    48,
  )
  words.set(
    [
      settings.sampledLightsScreenTraces ? 1 : 0,
      settings.sampledLightsScreenTraceIterations,
      settings.sampledLightsScreenTraceHair ? 1 : 0,
      settings.sampledLightsShadingConfidence ? 1 : 0,
    ],
    52,
  )
  floats.set(
    [
      settings.sampledLightsHairUnshadowedDistance,
      settings.sampledLightsFirstPersonMinimumHit,
      settings.sampledLightsMaxShadingWeight,
      settings.sampledLightsMaxShadingWeightHidden,
    ],
    56,
  )
}

/** The temporal and spatial denoisers' words of the uniform. */
function writeDenoiserWords(
  words: Uint32Array,
  floats: Float32Array,
  settings: SampledLightsSettings,
  image: SampledImage,
) {
  floats.set(
    [
      settings.sampledLightsTemporalHistoryDistance,
      Math.min(settings.sampledLightsTemporalMinFrames, settings.sampledLightsTemporalMaxFrames),
      settings.sampledLightsTemporalMaxFrames,
      settings.sampledLightsTemporalClampScale,
    ],
    60,
  )
  words.set([settings.sampledLightsTemporal && image.history ? 1 : 0, 0, 0, 0], 64)
  floats.set(
    [
      settings.sampledLightsSpatialDepthWeight,
      settings.sampledLightsSpatialRadius,
      Math.max(
        0,
        Math.min(
          settings.sampledLightsSpatialDisocclusionFrames,
          settings.sampledLightsTemporalMaxFrames - 1,
        ),
      ),
      settings.sampledLightsSpatialHistoryDeviation,
      settings.sampledLightsSpatialDisocclusionDiffuseVariance,
      settings.sampledLightsSpatialDisocclusionSpecularVariance,
      0,
      0,
    ],
    68,
  )
  words.set(
    [
      settings.sampledLightsSpatial ? 1 : 0,
      settings.sampledLightsSpatialSamples,
      settings.sampledLightsSpatialHistoryVariance ? 1 : 0,
      image.specularOnly ? 1 : 0,
    ],
    76,
  )
}

/** Writes the uniform of an image into `out` (`SAMPLED_PARAMS_WORDS` words) and returns it. */
export function writeSampledParams(
  out: ArrayBuffer,
  g: SampledGeometry,
  settings: SampledLightsSettings,
  image: SampledImage,
) {
  const words = new Uint32Array(out)
  const floats = new Float32Array(out)
  const at = guideAt(g)
  words.set(
    [
      ...g.tiles,
      ...g.downsampledTiles,
      ...g.downsample,
      ...g.samplesPerPixel,
      ...g.downsampledView,
      ...g.sampleView,
      g.tileListStride,
      image.fastClear ? 1 : 0,
      image.textured ? 1 : 0,
      settings.sampledLightsGuideByHistory && image.history ? 1 : 0,
      image.frame >>> 0,
      settings.sampledLightsMergeRays ? 1 : 0,
      image.soft ? 1 : 0,
      samplesOfPixel(g),
      ...image.historyTiles,
      at.hidden,
      at.ratios,
    ],
    0,
  )
  floats.set(
    [
      sampledMinSampleWeightEstimate(settings),
      settings.sampledLightsMinSampleWeight,
      settings.sampledLightsHiddenWeight,
      settings.sampledLightsHiddenWeightOnHistoryMiss,
      sampledTransmissionSampleWeight(settings),
      directionalRatio(settings.sampledLightsDirectionalFraction),
      settings.sampledLightsDirectionalMinClampWeight,
    ],
    24,
  )
  words[31] = settings.sampledLightsDirectional ? 1 : 0
  floats.set(
    Array.from(image.previousViewProjection, (v) => Math.fround(v)),
    32,
  )
  writeTraceWords(words, floats, settings)
  writeDenoiserWords(words, floats, settings, image)
  words[80] = ranksAt(g, image.lightCount)
  return out
}

/** The most the directional lights may take of the samples, as a ratio of what the others took: `fraction / (1 - fraction)`, none at 1. */
export const directionalRatio = (fraction: number) => (fraction < 1 ? fraction / (1 - fraction) : 0)
