/**
 * The schema of the run-time settings declared by rule (`../contracts/settingRules.ts`) — the
 * geometry streaming, the cluster raster, a partitioned scene's streaming and the HLOD warm-up, the
 * cut, the animation the GPU plays, the material shading, the exposure, the temporal pass, the sun's shadows —, each by its field with its kind,
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
import { CUT_VIEW_MEANINGS, type CutViewField } from './cutViewMeanings.ts'
import { CUT_BUDGET_MEANINGS, type CutBudgetField } from './cutBudgetMeanings.ts'
import { ANIMATION_RULES, type AnimationField } from '../contracts/animationOptions.ts'
import { SHADING_RULES, type ShadingField } from '../contracts/shadingOptions.ts'
import { EXPOSURE_RULES, type ExposureField } from '../contracts/exposureOptions.ts'
import { SKY_QUALITY_RULES, type SkyQualityField } from '../modules/sky/quality.ts'
import { TEMPORAL_RULES, type TemporalField } from '../contracts/temporalOptions.ts'
import { HIZ_RULES, type HizField } from '../contracts/hizOptions.ts'
import { SHADOW_RULES, type ShadowField } from '../contracts/shadowOptions.ts'
import { SHADOW_VIEW_MEANINGS, type ShadowViewField } from './shadowViewMeanings.ts'
import { MOTION_BLUR_RULES } from '../contracts/motionBlurOptions.ts'
import { MOTION_BLUR_MEANINGS } from './motionBlurMeanings.ts'
import { DEPTH_OF_FIELD_RULES } from '../contracts/depthOfFieldRules.ts'
import { DEPTH_OF_FIELD_MEANINGS } from './depthOfFieldMeanings.ts'
import { TESSELLATION_RULES } from '../contracts/tessellationOptions.ts'
import { TESSELLATION_MEANINGS } from './tessellationMeanings.ts'
import { BLOOM_RULES } from '../contracts/bloomRules.ts'
import { BLOOM_MEANINGS } from './bloomMeanings.ts'
import { FILM_RULES } from '../contracts/filmOptions.ts'
import { FILM_MEANINGS } from './filmMeanings.ts'
import { VOLUMETRIC_FOG_RULES, type VolumetricFogField } from '../contracts/volumetricFogOptions.ts'
import { SCREEN_PROBE_RULES } from '../bounce/screenProbeOptions.ts'
import { SCREEN_PROBE_MEANINGS } from './screenProbeMeanings.ts'
import { REFLECTION_RULES } from '../contracts/reflectionOptions.ts'
import { REFLECTION_MEANINGS } from './reflectionMeanings.ts'
import { AMBIENT_OCCLUSION_RULES } from '../contracts/ambientOcclusionOptions.ts'
import { AMBIENT_OCCLUSION_MEANINGS } from './ambientOcclusionMeanings.ts'
import { choiceSchema } from './schemaParts.ts'
import { STREAMING_RULES } from '../contracts/streamingOptions.ts'
import { streamingMeanings } from './streamingMeanings.ts'
import {
  DEFAULT_HARDWARE_RASTER_EDGE_PIXELS,
  RASTER_RULES,
  type RasterField,
} from '../contracts/rasterOptions.ts'

/** What each setting of the cluster raster means (`../contracts/rasterOptions.ts`): a function,
 *  as `streamingMeanings` (`./streamingMeanings.ts`). */
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
  worldStreamingUpdateOptimization:
    'Whether the cells the view wishes are worked out again only once its position or heading moved enough (worldStreamingLocationQuantization, worldStreamingRotationQuantization), at once while a cell wished is still loading or not yet shown or the initial load runs; false, at every frame. Both quantizations at 0 count as false.',
  worldStreamingLocationQuantization:
    "Metres: the squares the view's position is cut into on the ground, and in height on a grid that streams in 3D, to tell whether it moved enough for the cells to be wished again; 0, its exact position.",
  worldStreamingRotationQuantization:
    "Degrees: the steps the view's yaw is cut into, and its pitch on a grid that streams in 3D, to tell whether it turned enough for the cells to be wished again; 0, its exact angle.",
  worldStreamingForceUpdateFrameCount:
    'Frames: every that many frames the cells the view wishes are worked out again whatever the view did (worldStreamingUpdateOptimization); 0, never forced.',
  worldStreamingForce2D:
    "Whether a loose grid (partitionScheme hashSet) that streams in 3D wishes its cells by their footprint on the ground, the view's height ignored, as a flat grid does; no effect on a flat or a square grid.",
  worldStreamingExtraRadius:
    "Metres added to the radius of the view's streaming circle (a sphere on a grid that streams in 3D).",
  worldStreamingExtraAngle:
    "Degrees added to the angle of the view's sector (worldStreamingSector), a whole turn at most.",
  worldStreamingTargetState:
    'What the view asks of the cells it reaches: activated, to load and draw them; loaded, to load them and keep them placed in memory without activating them: nothing of them draws, no HLOD cell, HLOD 0 actor nor cell file, and none holds the images back. Cells of a scene whose cut packs no world DAG have nothing to hide and stay drawn.',
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
const CUT_MEANINGS: Readonly<Record<Exclude<CutField, CutViewField | CutBudgetField>, string>> = {
  cutTwoPassOcclusion:
    "Whether each view's cut tests its cells, nodes and clusters against the previous image's depth pyramid, draws what it shows, then tests what it hid again against the pyramid of what it drew: what stays hidden is neither drawn nor streamed. false, or without a previous pyramid, one pass that occludes nothing.",
  cutOcclusionCulling:
    "Whether the cut's boxes are tested against the depth pyramid at all; false, nothing is occluded.",
  cutFrustumCulling: 'Whether the cut culls the cells, nodes and clusters outside the view.',
  cutMinLodCulling:
    'Whether the cut culls a leaf too coarse for the threshold, its least own error showing even at its nearest; false, such a leaf is kept and streams its pages.',
  cutDrawDistanceCulling:
    "Whether the cut culls an object that names a draw distance (drawDistance, in the compile job's object settings) when its centre lies nearer than the distance's min or farther than its max from the eye, and a group of 64 placements when none of its objects can be drawn at its distance; false, every object is drawn at every distance.",
  cutViewDistanceScale:
    "Scale every object's draw distance, min and max, is multiplied by: 2 doubles the distances, 0 culls every object that names one; objects that name none are not affected. The quality presets write it: 0.4 at smooth, 0.6 at balanced, 0.8 at fine, 1 (nothing written) at max.",
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

/** What each setting of the depth pyramid means (`../contracts/hizOptions.ts`). */
const HIZ_MEANINGS: Readonly<Record<HizField, string>> = {
  hizTrace:
    "How the reflections' screen trace reads the depth pyramid: 'reference' walks the closest depth of the opaque image, each texel at its centre, mip by mip; 'planes' reads each pixel as a plane, half its slopes' sum nearer and farther at its edge, which keeps a hit on a grazing surface that the centre alone passes over.",
  hizFoldTransparents:
    "Whether the trace layers of the pyramid hold, beside the opaque depth, the nearest transparent surface of each pixel, so that a ray stops at glass; off by default, the traces read the opaque depth alone. The cut's occlusion never reads it.",
  hizTransparentTest:
    "How a transparent cluster is tested against the opaque depth already drawn: 'finer' reads up to sixteen texels a side of a level fine enough to hold its rectangle and rejects the clusters wholly behind it; 'reference' reads four texels a side of the lowest level that holds it. Neither rejects a visible cluster; 'finer' rejects more.",
  hizRelativeDepthThickness:
    "The thickness the reflections' 'reference' screen trace gives a surface, as a share of the surface's depth (a ray no further behind it than that share of its depth hits it); 0.005 by default, scaled by the projection's depth scale (1 under a perspective). The 'planes' trace keeps its pixel thickness.",
}

/** What each setting of the sun's shadows means (`../contracts/shadowOptions.ts`). */
const SHADOW_MEANINGS: Readonly<Record<Exclude<ShadowField, ShadowViewField>, string>> = {
  shadowDistanceScale:
    'Factor from 0 to 2 on the shadow distance of every directional light (its shadowDistance, 400 metres by default): the quality levels write 0.6, 0.7 and 0.85 below the top one. 0 leaves the far-shadow culling nothing to test against: it culls nothing.',
  farShadowCulling:
    "Whether a directional light's shadow maps leave out the casters past the edge of its shadow distance, scaled — a little farther than the distance, 427 metres at 400 —: a caster whose depth along the view, less its bounding radius, is past the edge is left out unless its object sets castFarShadow. The far part of the shadows is then not drawn; false draws every caster at any distance.",
  farShadowCullsAllMeshes:
    "Whether that test reaches every caster, or, false, the default, only the merged far-field shells of the world's coarser levels of detail: the objects drawn as themselves, at the finest level and as the instanced actors of the first, keep casting at any distance.",
  shadowNearLevels:
    "How many near levels a directional light's shadows have, from 0 to 10, never more than the light's own four: they shape the edge of the far-shadow test. 10, the default, is the light's four; the quality levels write 1 at the two coarser ones and 4 below the top. 0 leaves no near level, so no edge: nothing is culled.",
  shadowOverlapScale:
    'Factor from 0 to 2 on the tenth of its span the last near level overlaps into the next: it moves the edge of the far-shadow test past the shadow distance, when a far-field shadow follows. The quality levels write 0, 0.25 and 0.8 below the top one.',
  shadowFarField:
    'Whether a far-field shadow follows the near levels of a directional light whose scaled shadow distance is under 512 metres: the edge of the far-shadow test then lies past the distance by the overlap of the last near level; false puts the edge at the distance. The quality levels turn it off at the two coarser ones.',
}

/** What each setting of the fog's volume means (`../contracts/volumetricFogOptions.ts`); they apply
 *  where the scene's fog turns its volume on (`scene.fog.volumetric`). */
const VOLUMETRIC_FOG_MEANINGS: Readonly<Record<VolumetricFogField, string>> = {
  volumetricFogQuality:
    "The quality of the fog's volume, which fixes its grid: off draws none (the analytic fog alone); low cells of 16 pixels, 64 slices deep, 4 lighting samples where a cell has no history; high, the default, 8 pixels, 128 slices, 4 samples; ultra 4 pixels, 128 slices, 16 samples.",
  volumetricFogReadFilter:
    "How a surface reads the fog's volume: trilinear, one read; bicubic, a cubic B-spline across the screen from four reads; tricubic, across the depth too from eight.",
  volumetricFogUsesHistory:
    "Whether the fog's volume of the image before is blended into this one, so that the samples of many images average: smoother, at the cost of some lag on a light that moves.",
  volumetricFogMovesSamples:
    "Whether each image's lighting samples sit at another place in the cell (a low-discrepancy sequence), so that the blend over images averages them; effective with volumetricFogUsesHistory.",
  volumetricFogHistoryShare:
    'The share of the previous volume kept in each cell, from 0 to 1: the nearer 1, the smoother and the slower to follow.',
  volumetricFogSliceSpread:
    "How the slices are spread along the depth of the fog's volume: the smaller, the more of them lie near the eye.",
  volumetricFogGlow:
    'Whether the light the fog emits by itself (scene.fog.volumetric.glow) is read.',
  volumetricFogSkipHidden:
    'Whether a cell wholly behind the surfaces of its pixels is left unlit, which spares its lighting and keeps what stands behind a wall out of the history.',
  volumetricFogLampSoftening:
    "Scale of the cell's size added to the distance a local light's inverse-square falloff is taken at, against the spike near the light.",
  volumetricFogSampleScatter:
    'A random offset, in cells, added to each lighting sample, 0 none; effective with volumetricFogMovesSamples.',
  volumetricFogSurfaceLift:
    "Cells: how far a cell's sample is moved out of the depth buffer along the depth, so that a cell on a surface does not light itself with what stands behind it; -1, not at all.",
  volumetricFogLiftRange:
    'Cells: how far behind the depth buffer a sample is still brought forward (volumetricFogSurfaceLift); only the cells the surface cuts are moved at 1.',
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

/** What each quality setting of the sky means (`../modules/sky/quality.ts`). The atmosphere's and
 *  the light shafts' are written by the quality presets; the clouds' and the sky light's capture
 *  stay at their defaults at every preset. */
const SKY_QUALITY_MEANINGS: Readonly<Record<SkyQualityField, string>> = {
  skyTableFast:
    'Whether the sky is read from a table of the view directions instead of marched per pixel: faster, with artefacts where the sky has fine detail such as the earth shadow or a scattering lobe.',
  aerialFastOnOpaque:
    'Whether the haze on opaque surfaces is read from the low-resolution volume made for translucent ones: faster, with the same artefacts.',
  atmosphereSamplesMin:
    'Fewest samples of the atmosphere march, from 1; the count grows with the distance up to atmosphereSamplesMax.',
  atmosphereSamplesMax:
    'Most samples of the atmosphere march, from 1; read no lower than atmosphereSamplesMin.',
  skyTableSamplesMin: 'Fewest samples of the march that fills the sky table, from 1.',
  skyTableSamplesMax:
    'Most samples of the march that fills the sky table, from 1; read no lower than skyTableSamplesMin.',
  aerialSamplesPerSlice: 'Most samples a slice of the haze volume takes, from 1.',
  aerialDepthSlices: 'Slices of the haze volume along the depth, a whole number from 4.',
  transmittanceSamples: 'Samples that build the transmittance table, from 1.',
  multiScatterSamples: 'Samples that build the multiple-scattering table, from 1.',
  transmittanceSmallFormat:
    'Whether the transmittance table is kept in four 8-bit channels, at lower quality.',
  cloudViewSamplesMax: 'Most samples a cloud view ray takes; read no lower than 2.',
  cloudReflectionSamplesMax:
    'Most samples a cloud ray seen in a reflection takes; read no lower than 2.',
  cloudShadowSamplesMax: 'Most samples a cloud shadow ray takes; read no lower than 2.',
  cloudReflectionShadowSamplesMax:
    'Most samples a cloud shadow ray seen in a reflection takes; read no lower than 2.',
  cloudSamplesMin:
    'Fewest samples a cloud ray takes, a whole number from 0; it keeps a layer used as low fog fine near the eye.',
  cloudDistanceToMaxSamplesKm:
    'Distance in kilometres over which the samples of a cloud ray grow from their minimum to their maximum, from 0.00001.',
  cloudStepOnEmpty:
    'Step of the cloud march, in samples, where the density bound is zero, a whole number from 1: more is faster but bands.',
  cloudShadowMapResolutionMax: 'Largest side of the clouds shadow map, a whole number.',
  cloudShadowMapSamplesMax:
    'Most samples a ray of the clouds shadow map takes; read no lower than 4.',
  cloudShadowMapHorizonMultiplier:
    'Factor on the samples of the clouds shadow map when the sun reaches the horizon, from 1; 1 leaves them.',
  cloudShadowMapSpatialFiltering:
    'Blur passes smoothing the clouds shadow map, from 0 (none) to 4.',
  cloudShadowMapNewFrameWeight:
    "Share of the current image in the clouds shadow map's temporal blend, from 0 to 1; 1 turns the blend off.",
  cloudDistantSkyLight: 'Whether the distant sky light lights the clouds.',
  atmosphereOn: 'Whether the atmosphere is drawn at all.',
  cloudsOn: 'Whether the clouds are drawn at all.',
  atmosphereDistanceToMaxSamplesKm:
    'Distance in kilometres at which the atmosphere march takes its most samples, from 0.0001.',
  atmosphereSampleLightShadowMap:
    "Whether the atmosphere march reads the light's shadow map, for the shadows the air shows.",
  skyTableDistanceToMaxSamplesKm:
    'Distance in kilometres at which the march that fills the sky table takes its most samples, from 0.0001.',
  aerialDepthKm:
    'Length in kilometres of the haze volume, from 1; the last slice is used beyond it.',
  aerialWidth: 'Side in texels of the haze volume, a whole number from 4.',
  aerialDepthTest:
    'Whether the haze is kept from being drawn on pixels closer than where it starts, which saves time.',
  transmittanceTable: 'Whether the transmittance table is built.',
  distantSkyLightTable: 'Whether the table of the distant sky light is built.',
  multiScatterHighQuality:
    'Whether the multiple scattering is built from more directions: more exact, dearer.',
  distantSkyLightAltitudeKm:
    'Altitude in kilometres at which the sky is sampled to integrate the distant sky light.',
  skyTablesFullPrecision: 'Whether every sky table is kept in 32 bits per channel.',
  transmittanceWidth: 'Width in texels of the transmittance table, a whole number from 4.',
  transmittanceHeight: 'Height in texels of the transmittance table, a whole number from 4.',
  multiScatterWidth: 'Width in texels of the multiple-scattering table, a whole number from 4.',
  multiScatterHeight: 'Height in texels of the multiple-scattering table, a whole number from 4.',
  skyTableWidth: 'Width in texels of the sky table, a whole number from 4.',
  skyTableHeight: 'Height in texels of the sky table, a whole number from 4.',
  cloudSamplesClamp:
    'Most samples a cloud ray takes once its count is worked out, a whole number from 0; it keeps a long ray from holding the GPU, and set too low leaves the clouds incomplete.',
  cloudSampleLightShadowMap: "Whether the clouds read the light's shadow map.",
  cloudAerialPerspective: 'Whether the haze lights the clouds.',
  cloudAtmosphericLights: 'Whether the sun and the moon light the clouds.',
  cloudHighQualityAerial:
    'Whether the haze on the clouds is traced per pixel in a second pass instead of read from its volume; it needs cloudAerialPerspective.',
  cloudFogOnAllPixels:
    'Whether the fog is applied where the clouds do not cover as well, a little dearer, which removes a jump where the coverage reaches 0.',
  cloudLocalLights: 'Whether the lamps light the clouds: experimental and dear.',
  cloudLocalLightShadowSamples:
    'Samples of the shadow of a lamp on the clouds, from 0 to 128; read only with cloudLocalLights.',
  cloudShadowMap:
    'Whether the clouds shadow map of the sun is built, for a sun that casts cloud shadows.',
  cloudShadowMapLightRotationCutDegrees:
    "Turn of the sun in degrees past which the clouds shadow map's temporal blend starts again.",
  cloudShadowMapSnapKm:
    "Length in kilometres the clouds shadow map's position is snapped to so it does not flicker; 0 or less breaks the map's position.",
  cloudShadowMapSnapToPixelGrid:
    "Whether the clouds shadow map's origin is snapped to its texels, so it does not shimmer when the camera moves.",
  cloudShadowMapLightDistanceOverrideKm:
    'Above 0, the distance in kilometres of the light from the ground for the clouds shadow map; 0 or less leaves the distance from its extent.',
  cloudSkyAO:
    "Whether the clouds' occlusion of the sky light is built, for a sky light that asks for it.",
  cloudSkyAOResolutionMax: "Largest side of the clouds' sky occlusion map, a whole number.",
  cloudSkyAOTraceSamples:
    'Samples taken to find the ground occlusion of the clouds sky occlusion, a whole number.',
  cloudSkyAOFiltering: 'Whether the clouds sky occlusion map is dilated and smoothed.',
  cloudSkyAOSnapKm:
    "Length in kilometres the clouds sky occlusion map's position is snapped to so it does not flicker; 0 or less breaks the map's position.",
  cloudEmptySpaceSkipping:
    'Whether a table of where the clouds start lets the rays skip the empty air: experimental.',
  cloudEmptySpaceSkippingDepthKm: 'Distance in kilometres the empty-space table covers, from 1.',
  cloudEmptySpaceSkippingSliceBias:
    'Slices the start of the empty-space table is moved by; -1 moves it one slice toward the eye.',
  cloudEmptySpaceSkippingCorners:
    'Whether the corners of a cell of the empty-space table are read as well as its centre.',
  cloudRenderTarget:
    'Whether the clouds are traced into a target of their own, at the size cloudTraceSize says, and laid over the scene.',
  cloudUpsampling:
    "The way the traced clouds are laid over the scene: 'bilinear'; 'bilinearJitter'; 'nearestDepth', the nearest with a depth test; 'bilinearJitterClosest', with a jitter keeping the closest; 'bilateral'. A cloudTraceSize of 'quarterToFull' or 'full' reads 'nearestDepth' whatever is asked.",
  cloudRenderTargetScale:
    "Size of the clouds' target, from 0.1 to 1; read only with a cloudTraceSize of 'quarterToFull'.",
  cloudReprojectionBoxConstraint:
    'Whether the reprojected cloud image is held to the neighbourhood of the new one.',
  cloudReprojectionMinDistanceKm:
    "Distance in kilometres a cloud surface must be at for the last image to be reprojected, from 0; 4 hides the errors of reprojecting a layer's single front depth, at the price of a noisier near cloud.",
  cloudDisocclusionMaxDistanceKm:
    'Distance in kilometres past which the pixels uncovered by a moving cloud are no longer rebuilt, from 0.',
  cloudFogLateOnTranslucent:
    'Whether the late fog pass also gives the clouds with their fog, for the translucent surfaces behind them; dearer and takes more memory; read only with cloudFogLate.',
  cloudTraceSize:
    "Size the clouds are traced at: 'quarterToHalf' a quarter of the view rebuilt at half, then enlarged; 'half' half of the view, then enlarged; 'quarterToFull' a quarter rebuilt at the full size, where a cloud cannot hide behind an opaque mesh; 'full' the full size, so that clouds also show on translucent surfaces.",
  cloudFogLate:
    'Whether the fog is applied to the clouds late in the frame, after they are rebuilt and enlarged, so it does not lag with them; the enlarging pass costs about twice as much.',
  lightShafts: 'Whether the sun and the lamps that ask for them draw light shafts.',
  lightShaftDownsample:
    'Factor the light shafts are computed at under the view size, a whole number from 1 to 8.',
  lightShaftTemporalFilter: 'Whether the light shafts are filtered over the images.',
  lightShaftAfterDof:
    'Whether the light shafts are drawn in the separate translucency, after the depth of field.',
  lightShaftBlurPasses: 'Radial blur passes of the light shafts, a whole number from 0.',
  lightShaftFirstPassDistance:
    'Fraction of the distance to the light that the first radial blur pass blurs over.',
  lightShaftTemporalFilterSize:
    "Size of the kernel the light shafts' temporal filter weighs the pixels around a jittered sample with: 1 is smoother, a smaller value sharper but aliased; above 0.",
  lightShaftTemporalCatmullRom:
    "Whether the light shafts' temporal filter uses a Catmull-Rom kernel, sharper than the Gaussian.",
  skyLightRealTimeCapture: "Whether the platform allows the sky light's real-time capture at all.",
  skyLightTimeSlicing:
    "Whether the sky light's capture and convolutions are spread over several images to lower the cost of each.",
  skyLightFacesPerFrame:
    'Cube faces whose clouds are drawn per image when the capture is time sliced, a whole number from 1 to 6: more is less lag between faces when the sun moves fast.',
  skyLightCloudDivider:
    "Factor the clouds' size is divided by in the sky light's capture, a whole number from 1 to 8.",
  skyLightShadowFromOpaque:
    "Whether opaque meshes shadow the sky and the clouds from the sun in the sky light's capture.",
  skyLightDepthBuffer:
    "Whether the sky light's capture has a depth buffer, so that meshes cover each other and the height fog follows the depth.",
  skyLightAlwaysClear:
    "Whether the sky light's capture is cleared to black before the sky is drawn.",
  skyLightResolutionOverride:
    "Side in texels of the sky light's capture, from 16, in place of the sky light's own; a lower value leaves its own.",
  skyLightCubemapMaxResolution:
    "Largest side in texels of the sky light's cube when above 0; below that the sky light's own side is kept.",
  skyLightIntensityScale:
    "Factor on the sky light's intensity: it keeps the contrast of a level that draws less occlusion.",
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
      properties[field] = { ...choiceSchema(rule, description), default: rule.default }
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

/** The schema of the sky's quality settings, by field. */
export const skyQualityProperties = () => ruleProperties(SKY_QUALITY_RULES, SKY_QUALITY_MEANINGS)

/** The schema of the geometry streaming's nine settings, by field. */
export const streamingProperties = () => ruleProperties(STREAMING_RULES, streamingMeanings())

/** The schema of the cluster raster's two settings, by field. */
export const rasterProperties = () => ruleProperties(RASTER_RULES, rasterMeanings())

/** The schema of every other run-time setting declared by rule, by its field: the partition's
 *  streaming and the HLOD warm-up's, then the cut's, then the animation's, then the shading's, then
 *  the exposure's, then the temporal pass's, then the depth pyramid's, then the sun's shadows', then the motion blur's. */
export const settingRuleProperties = () => ({
  ...ruleProperties(WORLD_STREAMING_RULES, WORLD_STREAMING_MEANINGS),
  ...ruleProperties(CUT_RULES, { ...CUT_MEANINGS, ...CUT_VIEW_MEANINGS, ...CUT_BUDGET_MEANINGS }),
  ...ruleProperties(ANIMATION_RULES, ANIMATION_MEANINGS),
  ...ruleProperties(SHADING_RULES, SHADING_MEANINGS),
  ...ruleProperties(EXPOSURE_RULES, EXPOSURE_MEANINGS),
  ...ruleProperties(TEMPORAL_RULES, TEMPORAL_MEANINGS),
  ...ruleProperties(HIZ_RULES, HIZ_MEANINGS),
  ...ruleProperties(SHADOW_RULES, { ...SHADOW_MEANINGS, ...SHADOW_VIEW_MEANINGS }),
  ...ruleProperties(MOTION_BLUR_RULES, MOTION_BLUR_MEANINGS),
  ...ruleProperties(DEPTH_OF_FIELD_RULES, DEPTH_OF_FIELD_MEANINGS),
  ...ruleProperties(TESSELLATION_RULES, TESSELLATION_MEANINGS),
  ...ruleProperties(BLOOM_RULES, BLOOM_MEANINGS),
  ...ruleProperties(FILM_RULES, FILM_MEANINGS),
  ...ruleProperties(VOLUMETRIC_FOG_RULES, VOLUMETRIC_FOG_MEANINGS),
  ...ruleProperties(SCREEN_PROBE_RULES, SCREEN_PROBE_MEANINGS),
  ...ruleProperties(REFLECTION_RULES, REFLECTION_MEANINGS),
  ...ruleProperties(AMBIENT_OCCLUSION_RULES, AMBIENT_OCCLUSION_MEANINGS),
})
