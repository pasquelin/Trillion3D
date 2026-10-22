/**
 * The schema of the run-time settings declared by rule (`../contracts/settingRules.ts`) — the
 * geometry streaming, the cluster raster, a partitioned scene's streaming and the HLOD warm-up, the
 * cut, the animation the GPU plays, the material shading, the exposure, the temporal pass —, each by its field with its kind,
 * default, bounds or names and meaning, as the explorer's options name them
 * (`explorerOptionsSchema.ts`). The meanings live here, not in the rules: a bundle that never
 * reads the schema drops them.
 */
import type { JsonSchemaProperty } from './types.ts'
import { ruleSchema } from './schemaParts.ts'
import {
  WORLD_STREAMING_RULES,
  type WorldStreamingField,
} from '../contracts/worldStreamingOptions.ts'
import type { SettingRule } from '../contracts/settingRules.ts'
import { CUT_RULES, type CutField } from '../contracts/cutOptions.ts'
import { ANIMATION_RULES, type AnimationField } from '../contracts/animationOptions.ts'
import { SHADING_RULES, type ShadingField } from '../contracts/shadingOptions.ts'
import { EXPOSURE_RULES, type ExposureField } from '../contracts/exposureOptions.ts'
import { TEMPORAL_RULES, type TemporalField } from '../contracts/temporalOptions.ts'
import {
  DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME,
  DEFAULT_STREAMING_MAX_PENDING_PAGES,
  DEFAULT_STREAMING_MAX_REQUESTS,
  DEFAULT_STREAMING_MIN_REQUESTS,
  DEFAULT_STREAMING_NUM_RETRIES,
  DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT,
  DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT,
  DEFAULT_STREAMING_QUALITY_MIN_SCALE,
  STREAMING_RULES,
  type StreamingField,
} from '../contracts/streamingOptions.ts'
import {
  DEFAULT_HARDWARE_RASTER_EDGE_PIXELS,
  RASTER_RULES,
  type RasterField,
} from '../contracts/rasterOptions.ts'

/** What each setting of the geometry streaming means (`../contracts/streamingOptions.ts`): a
 *  function, its defaults read when the schema is built. */
const streamingMeanings = (): Readonly<Record<StreamingField, string>> => ({
  streamingMaxPendingPages: `Streaming pages of 128 KiB the streaming keeps started at once, read and not yet installed (default ${DEFAULT_STREAMING_MAX_PENDING_PAGES}). Each update starts the new streaming pages the views ask for, highest priority first, while fewer are pending. Any other value is refused.`,
  streamingMaxInstallsPerFrame: `Streaming pages of 128 KiB a frame installs at most, in the order they were started (default ${DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME}, never more than streamingMaxPendingPages). No time budget bounds them. Any other value is refused.`,
  streamingQualityMinPoolPercent: `Streaming pool load, in percent of its slots (a 128 KiB streaming page each), under which the quality rises again: after 30 updates under it, the screen error scale grows by 1 % an update (default ${DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT}). Any other value is refused.`,
  streamingQualityMaxPoolPercent: `Streaming pool load, in percent of its slots (a 128 KiB streaming page each), over which the quality falls: after 2 updates over it, the screen error scale shrinks by 3 % an update (default ${DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT}, read no lower than streamingQualityMinPoolPercent). Any other value is refused.`,
  streamingQualityMinScale: `Lowest scale of the screen error the pool pressure falls to (default ${DEFAULT_STREAMING_QUALITY_MIN_SCALE}); 1 never scales: an overcommitted pool then draws the coarser parents of what does not fit. Any other value is refused.`,
  streamingNumRetries: `Times a failed read of a streaming page is tried again, each after a longer wait (default ${DEFAULT_STREAMING_NUM_RETRIES}); after the last, the object the page belongs to is given up: no page of it is asked for again. A negative value tries without end. Any other value is refused.`,
  streamingMinRequests: `Least requests the readout of the camera's cut holds (default ${DEFAULT_STREAMING_MIN_REQUESTS}, from 4096 to 1048576); a request is a leaf the cut keeps and sees, and the readout also bounds the clusters listed drawn. It starts at this size, grows to a quarter over what the cut asks of it and shrinks by 2 % a readback after 30 under half its size, never under this value nor over streamingMaxRequests. Any other value is refused.`,
  streamingMaxRequests: `Most requests the readout of the camera's cut holds (default ${DEFAULT_STREAMING_MAX_REQUESTS}, from 4096 to 1048576), read no lower than streamingMinRequests: a cut past it is read by its head. Any other value is refused.`,
})

/** What each setting of the cluster raster means (`../contracts/rasterOptions.ts`): a function,
 *  as `streamingMeanings`. */
const rasterMeanings = (): Readonly<Record<RasterField, string>> => ({
  softwareRaster:
    'Rasterizes in compute the clusters whose longest edge projects under hardwareRasterEdgePixels and that cross neither clip plane; the others go to the hardware rasterizer. false draws every cluster with the hardware rasterizer.',
  hardwareRasterEdgePixels: `Projected edge length in pixels, a finite number above zero, from which a cluster goes to the hardware rasterizer instead of the software one; ${DEFAULT_HARDWARE_RASTER_EDGE_PIXELS} by default. Any other value is refused.`,
})

/** What each setting of a partitioned scene's streaming and of the HLOD warm-up means
 *  (`../contracts/worldStreamingOptions.ts`). */
const WORLD_STREAMING_MEANINGS: Readonly<Record<WorldStreamingField, string>> = {
  worldStreamingMaxLoadingCells:
    'Cells of a partitioned scene that may load at once once the first image is shown; the next in load order starts as one ends. 0 or less, no limit: every cell wished starts at once. The initial load holds none back.',
  worldStreamingAngleWeight:
    "How much the angle between the view's heading and a cell weighs in its turn to load, from 0 (none) to 1.",
  worldStreamingSortByExtent:
    'Whether the wider cells load first by their half side; false, by their level on their grid.',
  worldStreamingSortByPriority:
    "Whether a cell's grid priority (the main grid's, an HLOD grid's 100 plus its level) ranks it before its distance; false, after.",
  worldStreamingUseGridRange:
    "Whether the view's streaming circle takes each grid's own loading range, times worldStreamingRangeScale; false, worldStreamingRadius for every grid.",
  worldStreamingRangeScale:
    "Scale of each grid's loading range the view's streaming circle takes, while it takes the grids' ranges.",
  worldStreamingRadius:
    "Radius in metres of the view's streaming circle for every grid, while it takes no grid's range.",
  worldStreamingSector:
    "Whether only a sector of the view's streaming circle around its heading streams cells.",
  worldStreamingSectorAngle: 'Angle in degrees of that sector.',
  worldStreamingZCulling:
    "Whether a cell of a square grid (partitionScheme spatialHash) is wished only while its content's height range meets the view's eye height within the radius; false, height keeps no such cell out.",
  worldStreamingBlockOnSlowStreaming:
    'Whether a grid compiled with blockOnSlowStreaming blocks: once the first image is shown, a cell of it wished and not yet shown near the eye (its ratio under worldStreamingBlockOnSlowStreamingRatio) holds the images back till it shows, only such cells loading meanwhile, no HLOD cell nor warm-up among them. false, no grid blocks.',
  worldStreamingBlockOnSlowStreamingRatio:
    "Ratio under which a cell of a blocking grid not yet shown blocks: on a square grid, its content's distance from the eye less its half side, over the grid's loading range; on a loose grid, the distance to the bounds it streams by over the view's radius for the grid.",
  hlodEnabled:
    "Whether the HLOD actors load and draw; false, no HLOD cell is held, none draws its actor, and the main grid's cells draw alone.",
  hlodWarmup:
    'Whether a switch that draws an HLOD actor whose layer asks a warm-up (every builder but instanced) waits on it: its geometry, and its textures at the size it covers on screen, asked for hlodWarmupFrames frames in a row. Neither asked, no switch waits.',
  hlodWarmupFrames: 'Frames in a row an HLOD warm-up lasts; 0, none.',
  hlodWarmupGeometry:
    "Whether an HLOD warm-up asks the actor's geometry: the pages of its first 16 bundles past its root page, ahead of the views' requests.",
  hlodWarmupTextures: "Whether an HLOD warm-up asks the actor's textures.",
  hlodWarmupTextureScale:
    'Scale of the size an HLOD actor covers on screen its textures are asked at during its warm-up.',
  hlodWarmupTextureClamp: "Most texels an HLOD warm-up asks along a texture's side.",
}

/** What each setting of the cut means (`../contracts/cutOptions.ts`). */
const CUT_MEANINGS: Readonly<Record<CutField, string>> = {
  cutTwoPassOcclusion:
    "Whether each view's cut tests its cells, nodes and clusters against the previous image's depth pyramid, draws what it shows, then tests what it hid again against the pyramid of what it drew: what stays hidden is neither drawn nor streamed. false, or without a previous pyramid, one pass that occludes nothing.",
  cutOcclusionCulling:
    "Whether the cut's boxes are tested against the depth pyramid at all; false, nothing is occluded.",
  cutFrustumCulling: 'Whether the cut culls the cells, nodes and clusters outside the view.',
  cutMinLodCulling:
    'Whether the cut culls a leaf too coarse for the threshold, its least own error showing even at its nearest; false, such a leaf is kept and streams its pages.',
  cutLodBiasFollowsUpscale:
    "Whether an image the temporal pass reconstructs to a wider display is cut at the display's level of detail: its threshold divided by the width ratio; false, at the size it is drawn at.",
  cutLodBiasOffset:
    "Levels of detail an upscaled image's threshold is shifted by: multiplied by 2^offset past the width ratio.",
  cutLodBiasMin:
    'Finest shift an upscaled image takes, in levels of detail: its threshold divided by 2^-min at most.',
  cutMaxNodes:
    'Most hierarchy nodes one pass of the cut opens, rounded down to a multiple of 16: past it, the nodes left and their subtrees are dropped, what fits is drawn and an overflow warning names its high-water mark.',
  cutMaxCandidateClusters:
    "Most candidate clusters one cut lists, both passes' and those the previous image's pyramid hid, rounded down to a multiple of 64: past it, the clusters left are neither tested nor drawn, and an overflow warning names its high-water mark.",
  cutMaxVisibleClusters:
    'Most clusters one cut draws, both passes: past it, the clusters left are not drawn, and an overflow warning names its high-water mark.',
}

/** What each setting of the animation the GPU plays means (`../contracts/animationOptions.ts`). */
const ANIMATION_MEANINGS: Readonly<Record<AnimationField, string>> = {
  animationMinScreenSize:
    "The screen size — an instanced skinned object's bounds' diameter over the view's height — under which it stops animating and is drawn in its rest pose; an object's own skinnedInstance.animationMinScreenSize overrides it.",
  animationBankInterpolation:
    "Whether a bank's track blends its two nearest keys; false, its pose is its earlier key's.",
  animationBankTimeScale:
    "Scale of the world's seconds the banks' tracks advance by: 1 their own pace, 0 held.",
}

/** What each setting of the material shading means (`../contracts/shadingOptions.ts`). */
const SHADING_MEANINGS: Readonly<Record<ShadingField, string>> = {
  shadeBinningMode:
    "How the material pass bins each material's pixels before shading them: 'auto' as the material's shading asks (by pixel for every material of the engine, whose gradients are its triangles' own), 'pixel' every pixel alone, 'quad' every pixel with its 2 × 2 quad. The image is the same in each mode; only the shading's cost moves.",
}

/** What each setting of the temporal pass means (`../contracts/temporalOptions.ts`). */
const TEMPORAL_MEANINGS: Readonly<Record<TemporalField, string>> = {
  temporalThinGeometry:
    "Whether the temporal anti-aliasing looks for geometry thinner than a pixel — a wire, a rail — and relaxes its history there, so it flickers less; off by default, the finding costing every image some work. Applies at any level of temporalAntialiasing but 'off'.",
}

/** What each setting of the exposure means (`../contracts/exposureOptions.ts`); the first twelve
 *  apply where the exposure is 'auto', the default, which measures each image on the GPU, the
 *  local exposure's to a lit view whatever its exposure. */
const EXPOSURE_MEANINGS: Readonly<Record<ExposureField, string>> = {
  exposureBias:
    'Stops added to the target of the automatic exposure: the mean of the image lands at 0.18 times two to the bias, before the display curve.',
  exposureMinBrightness:
    'Lowest mean luminance the automatic exposure follows, in EV100 (a stop is a doubling of luminance, EV100 0 a luminance of 1). The same value as exposureMaxBrightness fixes the exposure.',
  exposureMaxBrightness: 'Highest mean luminance the automatic exposure follows, in EV100.',
  exposureHistogramLogMin:
    "Lowest stop of luminance the exposure's histogram spans; read no higher than one stop under exposureHistogramLogMax. A pixel under it counts in the lowest bucket.",
  exposureHistogramLogMax:
    "Highest stop of luminance the exposure's histogram spans; a pixel over it counts in the highest bucket.",
  exposureLowPercent:
    'Share of the pixels, darkest first, in percent from 1 to 99, left out of the mean; read no higher than exposureHighPercent.',
  exposureHighPercent:
    'Share of the pixels, darkest first, in percent from 1 to 99, past which the brightest are left out of the mean.',
  exposureSpeedUp:
    'Stops a second the automatic exposure moves when the view brightens; 0 holds it. A camera cut jumps to the target.',
  exposureSpeedDown:
    'Stops a second the automatic exposure moves when the view darkens; 0 holds it.',
  exposureTransitionDistance:
    'Distance in stops from its target inside which the automatic exposure slows from its linear speed to an exponential approach.',
  exposureBlackBucketWeight:
    "How much the darkest bucket of the exposure's histogram, the pixels of no light, counts: 0 ignores them, 1 counts them as any pixel.",
  exposureLuminanceMethod:
    "How a pixel's luminance is read for the histogram: 'uniform' the mean of its three channels, 'ntsc' the legacy video weights, 'workingSpace' the weights of the sRGB primaries.",
  localExposureHighlightContrast:
    'Scale of the smooth light of the neighbourhood above middle grey, from 0 up: under 1 the highlights come down, 1 leaves them. 1 for both contrasts and for the detail strength turns the local exposure off.',
  localExposureShadowContrast:
    'Scale of the smooth light of the neighbourhood under middle grey, from 0 up: under 1 the shadows come up, 1 leaves them.',
  localExposureDetailStrength:
    'Scale of what each pixel adds to the light around it, from 0 up: 1 keeps the detail as it is, 0 flattens it.',
  localExposureBlurBlend:
    'Share of the base layer taken from a wide blur of the luminance, from 0 to 1; the rest comes from the bilateral grid, which follows edges but rings at them.',
  localExposureBlurSize:
    "Width of the luminance blur, in percent of the image, read at 1/32 of the image's size.",
  localExposureMiddleGreyBias:
    'Stops added to the middle grey the base layer is pulled toward; an automatic exposure already moves it by exposureBias.',
  localExposureHighlightThreshold:
    'Distance in stops above middle grey inside which the base layer keeps its own contrast, from 0 up.',
  localExposureShadowThreshold:
    'Distance in stops under middle grey inside which the base layer keeps its own contrast, from 0 up.',
  localExposureHighlightThresholdStrength:
    'How sharply the highlight contrast takes over past its threshold, from 0 to 1: 1 the sharpest.',
  localExposureShadowThresholdStrength:
    'How sharply the shadow contrast takes over past its threshold, from 0 to 1: 1 the sharpest.',
}

/** The schema of each setting of a contract's rules by field (`SettingRule`): its kind, its
 *  default, its bounds and what it means. */
function ruleProperties<F extends string>(
  rules: Readonly<Record<F, SettingRule>>,
  meanings: Readonly<Record<F, string>>,
): Record<F, JsonSchemaProperty> {
  const properties = {} as Record<F, JsonSchemaProperty>
  for (const field of Object.keys(rules) as F[]) {
    const rule = rules[field],
      description = meanings[field]
    if (rule.kind === 'choice') {
      properties[field] = {
        type: 'string',
        enum: [...rule.choices],
        default: rule.default,
        description,
      }
      continue
    }
    if (rule.kind === 'flag') {
      properties[field] = { type: 'boolean', default: rule.default, description }
      continue
    }
    if (rule.kind === 'vector') {
      properties[field] = ruleSchema(rule, description)
      continue
    }
    // What the runtime accepts (`settingFits`): a range's start included, excluded for an `above`
    // rule, and none for `ANY_NUMBER`, which bounds nothing.
    const [low, maximum] = rule.range
    const lower =
      low <= -Number.MAX_VALUE ? {} : rule.above ? { exclusiveMinimum: low } : { minimum: low }
    properties[field] = {
      type: rule.kind === 'int' ? 'integer' : 'number',
      default: rule.default,
      ...lower,
      ...(maximum < Number.MAX_SAFE_INTEGER ? { maximum } : {}),
      description,
    }
  }
  return properties
}

/** The schema of the geometry streaming's eight settings, by field. */
export const streamingProperties = () => ruleProperties(STREAMING_RULES, streamingMeanings())

/** The schema of the cluster raster's two settings, by field. */
export const rasterProperties = () => ruleProperties(RASTER_RULES, rasterMeanings())

/** The schema of every other run-time setting declared by rule, by its field: the partition's
 *  streaming and the HLOD warm-up's, then the cut's, then the animation's, then the shading's, then
 *  the exposure's, then the temporal pass's. */
export const settingRuleProperties = () => ({
  ...ruleProperties(WORLD_STREAMING_RULES, WORLD_STREAMING_MEANINGS),
  ...ruleProperties(CUT_RULES, CUT_MEANINGS),
  ...ruleProperties(ANIMATION_RULES, ANIMATION_MEANINGS),
  ...ruleProperties(SHADING_RULES, SHADING_MEANINGS),
  ...ruleProperties(EXPOSURE_RULES, EXPOSURE_MEANINGS),
  ...ruleProperties(TEMPORAL_RULES, TEMPORAL_MEANINGS),
})
