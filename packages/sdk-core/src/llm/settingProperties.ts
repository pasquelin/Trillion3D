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
import { contrastCurveProperty, exposureCurveProperty } from './exposureCurveSchema.ts'
import {
  WORLD_STREAMING_RULES,
  type WorldStreamingField,
} from '../contracts/worldStreamingOptions.ts'
import type { SettingRule } from '../contracts/settingRules.ts'
import { CUT_RULES, type CutField } from '../contracts/cutOptions.ts'
import { WORLD_SOURCE_MEANINGS, type WorldSourceField } from './worldSourceMeanings.ts'
import { CUT_VIEW_MEANINGS, type CutViewField } from './cutViewMeanings.ts'
import { CUT_SCALE_MEANINGS, type CutScaleField } from './cutScaleMeanings.ts'
import { ANIMATION_RULES, type AnimationField } from '../contracts/animationOptions.ts'
import { SHADING_RULES, type ShadingField } from '../contracts/shadingOptions.ts'
import { EXPOSURE_RULES } from '../contracts/exposureOptions.ts'
import { EXPOSURE_MEANINGS } from './exposureMeanings.ts'
import { SKY_QUALITY_RULES, type SkyQualityField } from '../modules/sky/quality.ts'
import { SKY_TRANSLUCENT_MEANINGS, type SkyTranslucentField } from './skyTranslucentMeanings.ts'
import { TEMPORAL_RULES, type TemporalField } from '../contracts/temporalOptions.ts'
import { HIZ_RULES, type HizField } from '../contracts/hizOptions.ts'
import { LIGHT_FUNCTION_RULES, type LightFunctionField } from '../contracts/lightFunctionOptions.ts'
import { LIGHT_PROFILE_RULES, type LightProfileField } from '../contracts/lightProfileOptions.ts'
import {
  GLOBAL_DISTANCE_FIELD_RULES,
  type GlobalDistanceFieldField,
} from '../contracts/globalDistanceFieldOptions.ts'
import {
  VOLUMETRIC_LIGHTMAP_RULES,
  type VolumetricLightmapField,
} from '../contracts/volumetricLightmapOptions.ts'
import { DISTANCE_FIELD_OCCLUSION_RULES } from '../contracts/distanceFieldOcclusionOptions.ts'
import { DISTANCE_FIELD_OCCLUSION_MEANINGS } from './distanceFieldOcclusionMeanings.ts'
import { HIZ_PRIME_MEANINGS, type HizPrimeField } from './hizPrimeMeanings.ts'
import { HZB_OCCLUSION_MEANINGS, type HzbOcclusionField } from './hzbOcclusionMeanings.ts'
import { SHADOW_RULES } from '../contracts/shadowOptions.ts'
import { SHADOW_SUN_MEANINGS } from './shadowSunMeanings.ts'
import { CONTACT_SHADOW_MEANINGS } from './contactShadowMeanings.ts'
import { CAPSULE_SHADOW_MEANINGS } from './capsuleShadowMeanings.ts'
import { RAY_TRACED_SHADOW_MEANINGS } from './rayTracedShadowMeanings.ts'
import { SHADOW_VIEW_MEANINGS } from './shadowViewMeanings.ts'
import { MOTION_BLUR_RULES } from '../contracts/motionBlurOptions.ts'
import { MOTION_BLUR_MEANINGS } from './motionBlurMeanings.ts'
import { DEPTH_OF_FIELD_RULES } from '../contracts/depthOfFieldRules.ts'
import { DEPTH_OF_FIELD_MEANINGS } from './depthOfFieldMeanings.ts'
import { TESSELLATION_RULES } from '../contracts/tessellationOptions.ts'
import { TESSELLATION_MEANINGS } from './tessellationMeanings.ts'
import { TEXTURE_FILTERING_RULES } from '../contracts/textureFilteringOptions.ts'
import { TEXTURE_FILTERING_MEANINGS } from './textureFilteringMeanings.ts'
import { BLOOM_RULES } from '../contracts/bloomRules.ts'
import { GAUSSIAN_BLUR_RULES } from '../contracts/gaussianBlurRules.ts'
import { BLOOM_MEANINGS } from './bloomMeanings.ts'
import { GAUSSIAN_BLUR_MEANINGS } from './gaussianBlurMeanings.ts'
import { FILM_RULES } from '../contracts/filmOptions.ts'
import { FILM_MEANINGS } from './filmMeanings.ts'
import { COLOR_GRADING_RULES } from '../contracts/colorGradingOptions.ts'
import { COLOR_GRADING_MEANINGS } from './colorGradingMeanings.ts'
import { SUBSURFACE_SCATTERING_RULES } from '../contracts/subsurfaceScatteringOptions.ts'
import { SUBSURFACE_SCATTERING_MEANINGS } from './subsurfaceScatteringMeanings.ts'
import { VOLUMETRIC_FOG_RULES } from '../contracts/volumetricFogOptions.ts'
import { VOLUMETRIC_FOG_MEANINGS } from './volumetricFogMeanings.ts'
import { SINGLE_LAYER_WATER_RULES } from '../contracts/singleLayerWaterOptions.ts'
import { SINGLE_LAYER_WATER_MEANINGS } from './singleLayerWaterMeanings.ts'
import { HAIR_STRANDS_RULES } from '../contracts/hairStrandsOptions.ts'
import { HAIR_STRANDS_MEANINGS } from './hairStrandsMeanings.ts'
import { HETEROGENEOUS_VOLUME_RULES } from '../contracts/heterogeneousVolumeOptions.ts'
import { HETEROGENEOUS_VOLUME_MEANINGS } from './heterogeneousVolumeMeanings.ts'
import { SAMPLED_LIGHTS_RULES } from '../contracts/sampledLightsOptions.ts'
import { SAMPLED_LIGHTS_MEANINGS } from './sampledLightsMeanings.ts'
import { RECT_LIGHT_ATLAS_MEANINGS } from './rectLightAtlasMeanings.ts'
import { RECT_LIGHT_ATLAS_RULES } from '../contracts/rectLightAtlasOptions.ts'
import { SIMPLE_LIGHT_MEANINGS } from './simpleLightMeanings.ts'
import { SIMPLE_LIGHT_RULES } from '../contracts/simpleLightOptions.ts'
import { PATH_TRACING_RULES } from '../contracts/pathTracingOptions.ts'
import { PATH_TRACING_MEANINGS } from './pathTracingMeanings.ts'
import { TRANSLUCENCY_VOLUME_RULES } from '../contracts/translucencyVolumeOptions.ts'
import { TRANSLUCENCY_VOLUME_MEANINGS } from './translucencyVolumeMeanings.ts'
import { TRANSLUCENCY_GI_RULES } from '../contracts/translucencyGiOptions.ts'
import { TRANSLUCENCY_GI_MEANINGS } from './translucencyGiMeanings.ts'
import { SCREEN_PROBE_RULES } from '../bounce/screenProbeOptions.ts'
import { SCREEN_PROBE_MEANINGS } from './screenProbeMeanings.ts'
import { REFLECTION_RULES } from '../contracts/reflectionOptions.ts'
import { REFLECTION_MEANINGS } from './reflectionMeanings.ts'
import { SCREEN_SPACE_TRACING_RULES } from '../contracts/screenSpaceTracingOptions.ts'
import { LIGHTING_DATA_FORMAT_RULES } from '../contracts/lightingDataFormatOptions.ts'
import { LIGHTING_DATA_FORMAT_MEANINGS } from './lightingDataFormatMeanings.ts'
import { MESH_DISTANCE_FIELD_TRACE_RULES } from '../contracts/meshDistanceFieldTraceOptions.ts'
import { MESH_DISTANCE_FIELD_TRACE_MEANINGS } from './meshDistanceFieldTraceMeanings.ts'
import { SCREEN_SPACE_TRACING_MEANINGS } from './screenSpaceTracingMeanings.ts'
import { SURFACE_CACHE_RULES } from '../contracts/surfaceCacheOptions.ts'
import { SURFACE_CACHE_MEANINGS } from './surfaceCacheMeanings.ts'
import { AMBIENT_OCCLUSION_RULES } from '../contracts/ambientOcclusionOptions.ts'
import { AMBIENT_OCCLUSION_MEANINGS } from './ambientOcclusionMeanings.ts'
import { AMBIENT_CUBEMAP_RULES } from '../contracts/ambientCubemapOptions.ts'
import { REFLECTION_CAPTURE_RULES } from '../contracts/reflectionCaptureOptions.ts'
import { REFLECTION_CAPTURE_MEANINGS } from './reflectionCaptureMeanings.ts'
import { AMBIENT_CUBEMAP_MEANINGS } from './ambientCubemapMeanings.ts'
import { choiceSchema } from './schemaParts.ts'
import { STREAMING_RULES } from '../contracts/streamingOptions.ts'
import { streamingMeanings } from './streamingMeanings.ts'
import { DYNAMIC_RESOLUTION_RULES } from '../contracts/dynamicResolutionOptions.ts'
import { DYNAMIC_RESOLUTION_MEANINGS } from './dynamicResolutionMeanings.ts'
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
  depthBucketing:
    "Orders the software rasterizer's cutout clusters nearest first by the view depth of their box, so that a hidden cutout pixel leaves before its texture is read; true by default, and, as in the reference, it orders only where the scene holds voxels. false keeps the clusters unordered.",
  depthBucketsMinZ: `Depth in metres, a finite number above zero, at which the depth buckets start; ${RASTER_RULES.depthBucketsMinZ.default} by default. Any other value is refused.`,
  depthBucketsMaxZ: `Depth in metres, a finite number above zero, at which the depth buckets end; ${RASTER_RULES.depthBucketsMaxZ.default} by default. Any other value is refused.`,
})

/** What each setting of a partitioned scene's streaming and of the HLOD warm-up means
 *  (`../contracts/worldStreamingOptions.ts`). */
const WORLD_STREAMING_MEANINGS: Readonly<
  Record<Exclude<WorldStreamingField, WorldSourceField>, string>
> = {
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
const CUT_MEANINGS: Readonly<Record<Exclude<CutField, CutViewField | CutScaleField>, string>> = {
  cutTwoPassOcclusion:
    "Whether each view's cut tests its cells, nodes and clusters against the previous image's depth pyramid, draws what it shows, then tests what it hid again against the pyramid of what it drew: what stays hidden is neither drawn nor streamed. false, or without a previous pyramid, one pass that occludes nothing.",
  cutOcclusionCulling:
    "Whether the cut's boxes are tested against the depth pyramid at all; false, nothing is occluded.",
  cutFrustumCulling: 'Whether the cut culls the cells, nodes and clusters outside the view.',
  cutMinLodCulling:
    'Whether the cut culls a leaf too coarse for the threshold, its least own error showing even at its nearest; false, such a leaf is kept and streams its pages.',
  cutDrawDistanceCulling:
    "Whether the cut culls an instance of an instanced mesh (drawDistance with perInstance, in the compile job's object settings) when its bounds' centre lies nearer than the distance's min or farther than its max from the eye, and a group of 64 placements when none of its objects can be drawn at its distance; false, every instance is drawn at every distance. An object of its own is always culled by the sphere of its bounds (cutDistanceCullToSphereEdge): this switch does not reach it.",
  cutViewDistanceScale:
    "Scale every object's draw distance, min and max, is multiplied by: 2 doubles the distances, 0 culls every object that names one; objects that name none are not affected. The quality presets write it: 0.4 at smooth, 0.6 at balanced, 0.8 at fine, 1 (nothing written) at max, 10 at cinematic.",
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
const SHADING_MEANINGS: Readonly<Record<ShadingField, string>> = /* @__PURE__ */ (() => ({
  shadeBinningMode:
    "How the material pass bins each material's pixels before shading them: 'auto' as the material's shading asks (by pixel for every material of the engine, whose gradients are its triangles' own), 'pixel' every pixel alone, 'quad' every pixel with its 2 × 2 quad. The image is the same in each mode; only the shading's cost moves.",
  clearCoatNormal:
    "Whether the clear coat shading model keeps a base normal beside the coat's: true, a graph that wires the clearCoatBottomNormal output (a float3 in tangent space, like normal) gives the base this normal and the normal output is the coat's, the difference between the two kept in 8 bits as the reference's surface buffer keeps it, and the coat's highlight moves its half vector without the Newton step; false (the default), the coat and its base share the one normal.",
  gpuTimingDetail:
    "Whether the GPU timing goes inside the material pass: true, a frame sampled for the timing encodes the shading bins and each material class's shading as passes of their own ('Trillion3D material bins', 'Trillion3D material shading <class key>'), each with its own duration in the pass profile; false (the default), one pass for all, as cheap as can be. The image is the same either way.",
  gpuShadeStage:
    "Diagnostic: the stage at which each material class's shading stops, to time the stages by difference with gpuTimingDetail: 0 (the default) the whole kernel; 1 after finding the binned pixel; 2 after the triangle's header and index decode; 3 after the vertex fetch and transform; 4 after the interpolation and the derivatives; 5 after the material record and the surface. A stage under 5 writes no surface (a stage 5 none either), the image is not the scene's; compiles each class again when it changes.",
  normalCurvatureScale:
    'Scale of the roughness a material with normalCurvatureToRoughness takes from the change of its vertex normal across a pixel; any number, held to [0, 2] where it is read; 1 by default.',
  normalCurvatureBias:
    'Bias added to the roughness a material with normalCurvatureToRoughness takes from the change of its vertex normal across a pixel; any number, held to [-1, 1] where it is read; 0 by default.',
  normalCurvatureExponent:
    'Exponent on the change of the vertex normal across a pixel (the larger of the squared changes right and down) a material with normalCurvatureToRoughness takes its roughness from; any number, held to [0.05, 20] where it is read; 0.333 by default.',
  shadingRoughDiffuse:
    "Whether the diffuse light of a lit surface is the energy-preserving rough diffuse (Oren-Nayar-like, its roughness weighed by 0.4): true (the default), a rough surface is brighter against the light and darker at grazing views than Lambert's, as a new project's; false, Lambert's diffuse whatever the roughness. A rectangle light and a light of a size past 20 cm are Lambert's whatever this says, as the indirect light and the surface cache are.",
  shadingAccurate:
    "Whether the specular lobes of a lit surface use the exact joint Smith visibility of the GGX lobe: true (the default), a desktop project's, the visibility is the exact one on every isotropic lobe (a light's, a coat's, the water's); false, the cheaper approximation of it, a mobile project's. The anisotropic lobe keeps its exact lengths either way.",
  irisNormal:
    "Whether the eye shading model lights its iris by an iris normal of its own: true, the graph's clearCoatBottomNormal output (the surface's normal where it is not wired) is the iris normal, the caustic normal is the tangent output bent toward the opposite of the normal by the iris mask times its distance, and the eye's specular is held at 0.25; false (the default), the tangent output is the iris direction, in the world's axes, and the clearCoat and clearCoatRoughness outputs are the iris mask and distance.",
}))()

/** What each setting of the temporal pass means (`../contracts/temporalOptions.ts`). */
const TEMPORAL_MEANINGS: Readonly<Record<TemporalField, string>> = {
  temporalResurrection:
    "Whether the temporal anti-aliasing keeps older frames to bring a pixel's detail back after a disocclusion: 'level' (the default) as the level of temporalAntialiasing says (medium and above), 'on' or 'off' whatever the level. 'on' costs the bytes of the frames temporalResurrectionFrames sets.",
  temporalReprojectionField:
    "Whether the temporal anti-aliasing reprojects its history by a field — a vector, its jacobian and a boundary — rather than by the dilated vector alone, so a fast geometric edge is not extruded: 'level' (the default) as the level of temporalAntialiasing says (high and above), 'on' or 'off' whatever the level.",
  temporalShadingRejectionFlickering:
    "Whether the temporal anti-aliasing widens its shading rejection by the flicker measure, so a texel that oscillates is let ghost to steady the image: 'level' (the default) as the level of temporalAntialiasing says (high and above), 'on' or 'off' whatever the level. 'on' runs the measure temporalFlickeringPeriod sets, unless that is 0.",
  temporalShadingRejectionMode:
    "How the temporal anti-aliasing's flicker measure sets its clamp: 'stability' (the default) is steadier and controls the rejection better but ghosts more; 'responsive' widens the clamp by the blur of the lesser total variation of the input's change and of the input, so it rejects less and ghosts less, with blockier artifacts. It applies where the flicker measure runs (temporalShadingRejectionFlickering).",
  temporalThinGeometry:
    "Whether the temporal anti-aliasing looks for geometry thinner than a pixel — a wire, a rail — and relaxes its history there, so it flickers less; off by default, the finding costing every image some work. Applies at any level of temporalAntialiasing but 'off'.",
  temporalResurrectionFrames:
    "How many older frames the temporal anti-aliasing keeps for good, beside the last two, to bring a pixel's detail back after a disocclusion (rounded up to an even count, 2 by default); each costs the bytes of a history. Applies where the pass resurrects (temporalResurrection).",
  temporalResurrectionInterval:
    'How many images pass between two frames the temporal anti-aliasing stores for good for its resurrection (made odd, 31 by default). Applies where the pass resurrects (temporalResurrection).',
  temporalReprojectionFieldSpeed:
    "The speed, in display pixels an image, from which the temporal anti-aliasing's reprojection field anti-aliases its dilation by the depth, so a fast geometric edge is not extruded (0.125 by default). Applies where the pass reprojects by a field (temporalReprojectionField).",
  temporalWaveOps:
    "Whether the temporal anti-aliasing's programs that gather over a tile (the half-size image of its update) run through the lanes of a subgroup instead of workgroup memory, where the device grants subgroups and runs them at 16, 32 or 64 lanes (true by default); the image is the same either way.",
  temporalWaveSize:
    "The lanes a subgroup holds in the temporal anti-aliasing's wave programs: 16, 32 or 64 where the device runs that size, 0 (the default) the device's smallest size from 16. Applies where temporalWaveOps is true.",
  temporalHalfPrecision:
    "Whether the temporal anti-aliasing's programs that have a 16-bit float variant (its spatial anti-aliaser) compute in it, where the device grants 16-bit shader floats (true by default); false, or a device without them, computes in 32 bits. The image differs by a hundredth of a texel at most.",
  temporalHistoryPacked:
    "Whether the temporal anti-aliasing's history keeps its colour in the 11-11-10 format where the device stores to it, four bytes a pixel (true by default); false keeps half floats, eight bytes a pixel, a finer blue and shadows: the cinematic preset's value. Read when the pass is made, and made again when it changes.",
  temporalHistorySampleCount:
    "The most samples a display pixel's history holds in the temporal anti-aliasing, 8 to 32 (16 by default): higher is steadier on highlights of a still image but ghosts more on fireflies. A history at twice the display's size holds a quarter of it a history pixel.",
  temporalShadingRejectionSampleCount:
    "The most samples a display pixel's history keeps after a total shading rejection (2 by default): lower is clearer after a rejection but less steady while the pixel accumulates its new details.",
  temporalVelocityWeightClampingSampleCount:
    'The samples a history pixel keeps once its pixel moves at temporalVelocityWeightClampingPixelSpeed (4 by default): higher is steadier on a movement at the cost of blur from each resampling of the history.',
  temporalVelocityWeightClampingPixelSpeed:
    'The speed, in half display pixels an image (the motion vector spans two per image), at which temporalVelocityWeightClampingSampleCount holds (1 by default); a slower pixel is clamped less, in proportion.',
  temporalFlickeringPeriod:
    'The period, in images, at which a luma oscillation, or a faster one, is taken for a flicker the temporal anti-aliasing lets ghost to steady the image (2 by default); 0 runs no flicker measure. Applies where the shading rejection widens by it (temporalShadingRejectionFlickering).',
  temporalFlickeringAdjustToFrameRate:
    'Whether temporalFlickeringPeriod shortens in proportion where the frame rate falls below temporalFlickeringFrameRateCap, so an effect animated in time is not taken for a flicker at a low frame rate (true by default).',
  temporalFlickeringFrameRateCap:
    'The frame rate, in hertz, below which temporalFlickeringPeriod is adjusted to the frame rate (60 by default).',
  temporalFlickeringMaxParallaxVelocity:
    'The parallax speed, in pixels of a 1080p image at temporalFlickeringFrameRateCap, past which a texel is taken for moving, not flickering, as the window interiors a material fakes by parallax (10 by default).',
  temporalShadingExposureOffset:
    "Stops added to the exposure the temporal anti-aliasing's shading rejection measures the colours at, -20 to 20 (0 by default): higher lifts the shadows, so the rejection sees subtler changes there and fewer in the highlights.",
  temporalThinGeometryErrorMultiplier:
    'The depth step, in pixel depth errors taken at a twentieth of this number (200 by default, ten errors), past which a texel stands out as a thin line for the thin geometry detection; lower finds thinner steps. Applies where temporalThinGeometry is true.',
  temporalThinGeometryMinKeepLineContrast:
    'The luma contrast, 0 to 1 (0.3 by default), past which a texel stands out as a thin line of light for the thin geometry detection. Applies where temporalThinGeometry is true.',
  temporalThinGeometryLineFadeRate:
    'How often a high contrast line the thin geometry detection does not see again fades, outside a cluster hole region, 0 never to 1 at once (0.1 by default). Applies where temporalThinGeometry is true.',
  temporalThinGeometryLineFadeRateInsideRegion:
    'How often a high contrast line the thin geometry detection does not see again fades inside a cluster hole region, 0 never to 1 at once (0.03 by default). Applies where temporalThinGeometry is true.',
  temporalThinGeometryLineWeight:
    'The weight by which the thin geometry detection relaxes the history near a high contrast line where no cluster relaxes it, 0 to 1 (0.6 by default). Applies where temporalThinGeometry is true.',
  temporalThinGeometryMaxRelaxationWeight:
    'The greatest weight, 0 to 1 (0.037 by default), by which the thin geometry detection relaxes the history on a cluster hole region, before a 3×3 average spreads it to the neighbouring texels; higher relaxes the history clamp more on thin geometry. Applies where temporalThinGeometry is true.',
  temporalThinGeometryRejectTranslucency:
    'The share of the luma of a texel that the translucent layers make, 0 to 1 (0.6 by default), past which the thin geometry detection rejects its thin geometry in the next image; 0 never. Applies where temporalThinGeometry is true.',
  temporalThinGeometryShadingRange:
    "The shading models the thin geometry detection counts as thin geometry: 'foliage' the two-sided foliage alone, 'foliageAndHair' it and the hair, 'all' every lit surface, 'varying' (the default) every lit surface, the foliage relaxed with the dilation and the other surfaces by their edge alone. 'varying' needs the flicker measure running (temporalShadingRejectionFlickering on and temporalFlickeringPeriod above 0) or temporalThinGeometryMinKeepLineContrast above 0, else it counts the foliage alone. Applies where temporalThinGeometry is true.",
  temporalThinGeometryAntiFlickering:
    'Whether the flicker measure considers the relaxation the thin geometry detection gives the history (true by default), since the detection can fail to find some thin geometry; false measures the flicker as if the history were not relaxed. Applies where temporalThinGeometry is true and the flicker measure runs (temporalShadingRejectionFlickering on and temporalFlickeringPeriod above 0).',
  temporalDownsampleQuality:
    "How the half-size image the exposure and the bloom read is made: 'low' (the default) has the temporal anti-aliasing and the motion blur write it beside their own image, one filtered sample of the four pixels a texel covers, and the chain's own pass only where neither draws; 'high' has the chain's own pass draw it from the image, four filtered samples of the 4 × 4 pixels around a texel, which keeps a bright pixel steadier as it moves, at the cost of that pass.",
}

/** What each setting of the depth pyramid means (`../contracts/hizOptions.ts`). */
const HIZ_MEANINGS: Readonly<Record<Exclude<HizField, HizPrimeField | HzbOcclusionField>, string>> =
  {
    hizTrace:
      "How the reflections' screen trace reads the depth pyramid: 'reference' walks the closest depth of the opaque image, each texel at its centre, mip by mip; 'planes' reads each pixel as a plane, half its slopes' sum nearer and farther at its edge, which keeps a hit on a grazing surface that the centre alone passes over.",
    hizFoldTransparents:
      "Whether the trace layers of the pyramid hold, beside the opaque depth, the nearest transparent surface of each pixel, so that a ray stops at glass; off by default, the traces read the opaque depth alone. The cut's occlusion never reads it.",
    hizTransparentTest:
      "How a transparent cluster is tested against the opaque depth already drawn: 'finer' reads up to sixteen texels a side of a level fine enough to hold its rectangle (the half-resolution mip at the finest) and rejects the clusters wholly behind it; 'reference' reads four texels a side of the lowest level that holds it. Neither rejects a visible cluster; 'finer' rejects more.",
    hizFullResDepth:
      "Whether the screen probes' 'reference' screen trace goes down to the full-resolution depth, which is more accurate and adds incoherency to the inner loop (true, the default), or stops at the half-resolution level of the pyramid, a texel there taking the closest depth of its 2 × 2 pixels, a little farther at the start of the ray. The reflections' trace always goes down to the full-resolution depth.",
    lightGridHizCull:
      "Whether the light grid leaves empty the cells no pixel can read: those whose nearest face is behind the farthest depth of the opaque image in their 64-pixel column (read from the depth pyramid the image built, with the margin the fog volume reads the lists behind a surface with), and ends every light's run at the cell that holds that depth. true by default; false lists every cell the lights reach.",
    lightGridLinkedLists:
      'Whether the light grid makes the lists of its cells from chains of links taken from one shared pool: each light a cell takes asks the next link of the pool, the chains are then written out as contiguous lists in light order, and the number of lights per cell is no longer limited, only the pool as a whole (true, the default). false gives each cell its own share of the pool, lightGridMaxCulledLightsPerCell words, and keeps its first lights up to it.',
    lightGridMaxCulledLightsPerCell:
      "The light entries the view's light grid holds for each of its cells (32 by default, from 1 to 1024): the grid's pool is its cells times this. With lightGridLinkedLists on, that is a limit on the whole grid: the lights are put in the cells as they come, and those asked once the pool is used up are dropped, so a cell keeps the lights it got, in light order; with it off, each cell keeps its own first lights up to this number. The lights dropped neither light nor shadow their pixels; the engine says so once on the console, as the count it needed rises. It does nothing to the bounce's world grid.",
    lightGridDebug:
      'Which view of the light grid is drawn over the image, a whole number from 0 to 3: 0 off (the default), 1 the number of lights in the grid cell of each pixel depth, 2 the greatest number over the slices of the cell column but the last, 3 over all the slices; each cell in a heat colour from blue to red with its count written, its borders in grey.',
    lightGridDebugMaxThreshold:
      'The number of lights drawn red by the light grid view (lightGridDebug), a whole number from 1 to 1024; 8 by default.',
    lightGridDebugSlice:
      'The one depth slice of the light grid that its view (lightGridDebug) shows, a whole number from 0 to 1023, read no higher than the last slice; -1, the default, shows the slice of each pixel depth or the greatest count over the slices.',
  }

/** What the volumetric lightmap's setting means (`../contracts/volumetricLightmapOptions.ts`). */
const VOLUMETRIC_LIGHTMAP_MEANINGS: Readonly<Record<VolumetricLightmapField, string>> = {
  volumetricLightmap:
    "Whether the precomputed indirect light of the scene (its volumetric lightmap) is read, by the fog's static term and by the lighting of movable objects; true by default. False, every read of it answers black, as a scene without one does. It does nothing where the scene has no lightmap.",
  volumetricLightmapLoadingRange:
    "The distance, in metres, around the view within which the cells of the lightmap's finest bricks are loaded and kept; the others are let go (64 by default). It does nothing where the scene's lightmap holds no cells.",
  volumetricLightmapBrickMemory:
    "The memory, in megabytes, the loaded finest bricks of the lightmap may take (30 by default); the cells nearest the view win it, and a cell that does not fit is not loaded. It does nothing where the scene's lightmap holds no cells.",
}

const GDF = GLOBAL_DISTANCE_FIELD_RULES

/** The field, its clipmaps and how they are updated. */
const FIELD_UPDATE_MEANINGS = /* @__PURE__ */ (() =>
  ({
    globalDistanceField:
      "Whether the global distance field is made from the meshes' distance fields; true by default. It does nothing where no mesh built a field.",
    globalDistanceFieldUpdate:
      'Whether the clipmaps are updated; false keeps what they hold. true by default.',
    globalDistanceFieldClipmaps:
      'How many clipmaps, 0 to 6; 4 by default. While the reflections march rays through the field (on by default) the field adds one or two to it where globalDistanceFieldTraceViewDistance reaches.',
    globalDistanceFieldViewDistance:
      'The view distance of the field in centimetres; the outermost clipmap is this over the exponent squared. 20000 by default. No effect while the reflections march rays through the field (on by default): globalDistanceFieldTraceClipmapExtent sizes the clipmaps then.',
    globalDistanceFieldClipmapExponent:
      "The factor between one clipmap's extent and the next, at least 1; 2 by default. No effect while the reflections march rays through the field (on by default): the factor is 2 then.",
    globalDistanceFieldResolution:
      'The voxels along a clipmap, rounded up to whole groups of 4 pages of 7; 128 by default. No effect while the reflections march rays through the field (on by default): globalDistanceFieldTraceResolution is the count then.',
    globalDistanceFieldMipFactor: "The divider of a clipmap's coarse mip, 1 to 8; 4 by default.",
    globalDistanceFieldOccupancyRatio:
      'The share of its pages the page atlas expects filled, 0.1 to 1; 0.3 by default.',
    globalDistanceFieldCacheMostlyStaticSeparately:
      'Whether the static meshes are composited into a clipmap of their own, so a moving mesh recomposites the movable ones alone; true by default.',
    globalDistanceFieldPartialUpdates:
      'Whether a clipmap updates only the pages that moved or changed; true by default.',
    globalDistanceFieldStaggeredUpdates:
      'Whether the larger clipmaps update less often; true by default.',
    globalDistanceFieldUpdatesPerFrame:
      'How many clipmaps update each frame, at least 1; 2 by default.',
    globalDistanceFieldForceFullUpdate:
      'Whether every clipmap is composited whole on every frame; false by default.',
    globalDistanceFieldForceUpdateOnce:
      'One whole composition of every clipmap each time this turns on; false by default.',
    globalDistanceFieldFastCameraMode:
      'Whether the field follows a fast camera at lower quality: clipmaps centred ahead of the camera, one more clipmap, one updated a frame, larger smallest meshes; false by default.',
    globalDistanceFieldCameraVelocityDecay:
      "The share of the camera's velocity offset kept after a second in the fast camera mode; 0.7 by default.",
    globalDistanceFieldAverageCulledObjectsPerCell:
      'The objects a cell of the culling grid is expected to hold, 1 to 8192, which sizes its list; 512 by default.',
    globalDistanceFieldRecacheOnStreaming:
      'Whether a clipmap composited while a mesh had only its coarsest mip is composited again when the streaming is done; true by default.',
    globalDistanceFieldForceRecacheOnStreaming:
      'Whether each such update is always whole; false by default.',
    globalDistanceFieldDebugShowStats:
      'Whether the image shows, over its upper right, the pages of the global field: the most the atlas holds, those allocated and free, those of the clipmaps combined, the ones among them with no surface in them and the ones composited this image; false by default.',
    globalDistanceFieldStartDistance:
      "The distance along an occlusion cone from which the global field replaces the meshes' own, in centimetres; 100 by default.",
    globalDistanceFieldMinMeshRadius:
      'A mesh whose bounding sphere is smaller (centimetres) is left out of the field, unless the voxel rule below is larger; 20 by default.',
  }) satisfies Partial<Record<GlobalDistanceFieldField, string>>)()

/** The field's rays and the mesh distance fields' atlas. */
const FIELD_TRACE_AND_MESH_MEANINGS = /* @__PURE__ */ (() =>
  ({
    globalDistanceFieldMinMeshRadiusInVoxels: 'The same in voxels of the clipmap; 0.5 by default.',
    globalDistanceFieldTraceResolution: `The voxels along a clipmap while the reflections march rays through the field, rounded up to whole groups of 4 pages of 7 (${GDF.globalDistanceFieldTraceResolution.default} by default); the field takes it in place of globalDistanceFieldResolution then.`,
    globalDistanceFieldTraceClipmapExtent: `The half-extent in centimetres of the first clipmap while rays are marched through the field (${GDF.globalDistanceFieldTraceClipmapExtent.default} by default); each next clipmap is twice the one before, the field taking it and that factor in place of globalDistanceFieldViewDistance and globalDistanceFieldClipmapExponent.`,
    globalDistanceFieldTraceViewDistance: `The distance in centimetres the scene is kept to while rays are marched through the field (${GDF.globalDistanceFieldTraceViewDistance.default} by default). The field makes one clipmap more than globalDistanceFieldClipmaps when the extent of the next clipmap is within it, two more when the extent of the one after that is; with a first clipmap of 2500 and 4 clipmaps, 40000 gives a fifth and 80000 a sixth.`,
    globalDistanceFieldCoveredExpandSurfaceScale: `The scale of the half voxel by which a marched ray expands the surface it meets, in the pages the meshes cover, to close surfaces thinner than the gap between two voxels (${GDF.globalDistanceFieldCoveredExpandSurfaceScale.default} by default).`,
    globalDistanceFieldNotCoveredExpandSurfaceScale: `The same scale in the pages only two-sided meshes reach, foliage and thin cloth (${GDF.globalDistanceFieldNotCoveredExpandSurfaceScale.default} by default).`,
    globalDistanceFieldSimpleCoverageBasedExpand: `Whether a page only two-sided meshes reach counts as wholly not covered by a marched ray (${GDF.globalDistanceFieldSimpleCoverageBasedExpand.default} by default). False reads the coverage atlas, the coverage of each voxel of the page, so that a wall beside foliage keeps its full expansion; true saves that read.`,
    globalDistanceFieldNotCoveredMinStepScale: `The scale of the least step of a marched ray in the pages only two-sided meshes reach (${GDF.globalDistanceFieldNotCoveredMinStepScale.default} by default); a larger one costs less.`,
    globalDistanceFieldDitheredTransparencyStepThreshold: `For a dithered ray: the noise, at each step, under which a surface of the pages only two-sided meshes reach stops it (${GDF.globalDistanceFieldDitheredTransparencyStepThreshold.default} by default).`,
    globalDistanceFieldDitheredTransparencyTraceThreshold: `For a dithered ray: the noise, along the whole ray, under which such a surface stops it (${GDF.globalDistanceFieldDitheredTransparencyTraceThreshold.default} by default); under 1 it lets some rays through.`,
    meshDistanceFieldMaxObjectRadius:
      "A placement whose bounding sphere is larger (centimetres) is left out of the scene's fields; 100000 by default.",
    meshDistanceFieldSurfaceBiasExpand:
      "The share of a voxel a mesh's surface is expanded by when a distance is taken; 0.25 by default.",
    meshDistanceFieldBrickAtlasSize:
      'The bricks along the first two axes of the brick atlas, a power of two; 128 by default. Read when the atlas is made.',
    meshDistanceFieldBrickAtlasDepth:
      'The bricks the atlas grows to along its third axis before it drops the finer mips; 32 by default (256 MiB).',
    meshDistanceFieldUploadKiB:
      'The KiB of finer mips uploaded to the atlas each frame; 8192 by default.',
    meshDistanceFieldBlockBricks:
      'The bricks an allocation of the atlas holds; 16 by default. Read when the atlas is made.',
    meshDistanceFieldForceMips:
      '1 to 3 loads that many mips of every mesh whatever the view; 0, the default, follows the view.',
    meshDistanceFieldReverseAllocation:
      "Whether the mips added in a frame take the atlas's space in the reverse order; false by default.",
    runtimeMeshDistanceFields:
      "Whether a mesh made at run time, which no compiler gave a distance field, gets one built on the page's GPU, by the compiler's own program, a few frames after it appears: the rays marched through the field then meet it. A mesh that deforms, or has no ray-tracing tree, gets none. false by default; it costs the build, once for each distinct mesh.",
  }) satisfies Partial<Record<GlobalDistanceFieldField, string>>)()

/** What each setting of the global distance field means (`../contracts/globalDistanceFieldOptions.ts`). */
const GLOBAL_DISTANCE_FIELD_MEANINGS: Readonly<Record<GlobalDistanceFieldField, string>> =
  /* @__PURE__ */ (() => ({
    ...FIELD_UPDATE_MEANINGS,
    ...FIELD_TRACE_AND_MESH_MEANINGS,
  }))()

/** What each setting of the light functions means (`../contracts/lightFunctionOptions.ts`). */
const LIGHT_FUNCTION_MEANINGS: Readonly<Record<LightFunctionField, string>> = {
  lightFunctionAtlas:
    'Whether the light functions are drawn: a light that wears a light function material multiplies its colour, point by point, by what the material gives there; the materials are drawn once each into one atlas that the lighting, the volumetric fog and the translucent layers read. true by default; false draws none and every light shines plain.',
  lightFunctionSlotResolution:
    "The texels a side of an atlas slot, one slot a material, at least 32; 128 by default. The slot is cut to fit where the atlas would pass the device's largest texture.",
  lightFunctionAtlasSize:
    'The slots a side of the atlas, from 2 to 16, so 4 gives 16 materials, the default, and 16 gives 256. A light whose material has no slot left shines plain.',
  lightFunctionMaxLights:
    'The most lights that read the atlas, the nearest to the eye kept, a sun counting as at the eye; a light past it shines plain. -1, the default, no limit.',
  lightFunctionFormat:
    "What an atlas texel holds: 'grey', the default, the mean of the colour, one channel; 'colour', the three channels.",
  lightFunctionDeferred:
    "Whether the lighting of the opaque image and the translucency volume's injection read the atlas (diffuse and specular alike); true by default.",
  lightFunctionFog:
    "Whether the volumetric fog's local lights read the atlas; true by default. The fog's sun always reads it.",
  lightFunctionBounce:
    "Whether the bounce's lights read the atlas, the probes' rays and the screen probes' scene traces: a surface they hit is lit through the light functions; true by default.",
  lightFunctionTranslucent: 'Whether the translucent layers read the atlas; false by default.',
}

/** What each setting of the atlas of the light profiles means (`../contracts/lightProfileOptions.ts`). */
const LIGHT_PROFILE_MEANINGS: Readonly<Record<LightProfileField, string>> = {
  lightProfileAtlasResolution:
    'The texels a side of a slice of the atlas of the light profiles, from 16 to 4096; 256 by default. A profile of another side is resampled to it when it is written.',
  lightProfileAtlasMaxProfiles:
    'The most profiles the atlas of the light profiles holds, from 1 to 32; 32 by default. The atlas is made with the profiles the lights ask, up to this, and made again when more are asked; a light whose profile has no slice shines as a lamp with none.',
}

/** What each quality setting of the sky means (`../modules/sky/quality.ts`). The atmosphere's and
 *  the light shafts' are written by the quality presets; the clouds' and the sky light's capture
 *  stay at their defaults at every preset. */
const SKY_QUALITY_MEANINGS: Readonly<
  Record<Exclude<SkyQualityField, SkyTranslucentField>, string>
> = {
  skyTableFast:
    'Whether the sky is read from a table of the view directions instead of marched per pixel (its samples between atmosphereSamplesMin and atmosphereSamplesMax, jittered by blue noise): faster, with artefacts where the sky has fine detail such as the earth shadow or a scattering lobe.',
  aerialFastOnOpaque:
    'Whether the haze on opaque surfaces is read from the low-resolution volume made for translucent ones: faster, with the same artefacts. Off, a pass over the lit image marches the haze of each opaque pixel from the eye to its depth, shaded by the shadow maps and the clouds; translucent surfaces read the volume either way.',
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
    'Blur passes smoothing the clouds shadow map, read from 0 (none) to 4: a value beyond is read as the nearer end.',
  cloudShadowMapNewFrameWeight:
    "Share of the current image in the clouds shadow map's temporal blend, read from 0 to 1 (a value beyond is read as the nearer end); 1 turns the blend off.",
  cloudDistantSkyLight: 'Whether the distant sky light lights the clouds.',
  atmosphereOn: 'Whether the atmosphere is drawn at all.',
  cloudsOn: 'Whether the clouds are drawn at all.',
  atmosphereDistanceToMaxSamplesKm:
    'Distance in kilometres at which the atmosphere march takes its most samples, from 0.0001.',
  atmosphereSampleLightShadowMap:
    "Whether the sky table's and the haze volume's marches read the shadow map of a light that asks for it (shadowsAir), for the shadows the air shows.",
  skyTableDistanceToMaxSamplesKm:
    'Distance in kilometres at which the march that fills the sky table takes its most samples, from 0.0001.',
  aerialDepthKm:
    'Length in kilometres of the haze volume, from 1; the last slice is used beyond it.',
  aerialWidth: 'Side in texels of the haze volume, a whole number from 4.',
  aerialDepthTest:
    'Whether a surface at or before where the haze starts skips the read of the haze volume, which saves time.',
  transmittanceTable:
    'Whether the transmittance table is built; off, the air answers as clear toward a light.',
  distantSkyLightTable:
    "Whether the table of the distant sky light, the fog's sky, is made every image; off, it is black.",

  multiScatterHighQuality:
    'Whether the multiple scattering is built from 8 directions over the sphere and not from two: more exact, dearer.',
  distantSkyLightAltitudeKm:
    'Altitude in kilometres at which the sky is sampled to integrate the distant sky light.',
  skyTablesFullPrecision:
    "Whether the haze volume's cells are kept in four 32-bit floats and not four half floats; the volume then holds half as many cells.",

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
    'Samples of the shadow of a lamp on the clouds, read from 0 to 128 (a value beyond is read as the nearer end); read only with cloudLocalLights.',
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
    "Whether the clouds' sky occlusion map is built, for a sky light that asks for it: the air's multiple scattering is dimmed by it under the clouds.",
  cloudSkyAOResolutionMax: "Largest side of the clouds' sky occlusion map, a whole number.",
  cloudSkyAOTraceSamples:
    'Samples taken to find the ground occlusion of the clouds sky occlusion, a whole number.',
  cloudSkyAOFiltering:
    'Whether the clouds sky occlusion map is dilated and smoothed: integrated over the hemisphere above each texel.',
  cloudShadowMapDebug:
    "Whether the clouds shadow map of the first light is drawn over the image: its frustum in orange, a quad for each texel holding cloud, and the map's sample count in text.",
  cloudSkyAODebug:
    'Whether the clouds sky occlusion map is drawn over the image: its frustum in blue and a quad for each texel holding cloud.',
  cloudSkyAOSnapKm:
    "Length in kilometres the clouds sky occlusion map's position is snapped to so it does not flicker; 0 or less breaks the map's position.",
  cloudEmptySpaceSkipping:
    'Whether a table of where the clouds start, built before the tracing, lets the rays begin their march there; the built-in material leaves the table input unconnected, which says clouds are everywhere, so the table holds only the start moved by the slice bias.',
  cloudEmptySpaceSkippingDepthKm:
    'Distance in kilometres the empty-space table covers, read from 1: a lower value is read as 1.',
  cloudEmptySpaceSkippingSliceBias:
    'Slices the start of the empty-space table is moved by; -1 moves it one slice toward the eye.',
  cloudEmptySpaceSkippingCorners:
    'Whether the corners of a cell of the empty-space table are read as well as its centre.',
  cloudRenderTarget:
    'Whether the clouds are traced into a target of their own, at the size cloudTraceSize says, and laid over the scene.',
  cloudUpsampling:
    "The way the traced clouds are laid over the scene: 'bilinear'; 'bilinearJitter'; 'nearestDepth', the nearest with a depth test; 'bilinearJitterClosest', with a jitter keeping the closest; 'bilateral'. A cloudTraceSize of 'quarterToFull' or 'full' reads 'nearestDepth' whatever is asked.",
  cloudRenderTargetScale:
    "Size of the clouds' target, read from 0.1 to 1 (a value beyond is read as the nearer end); read only with a cloudTraceSize of 'quarterToFull'.",
  cloudReprojectionBoxConstraint:
    'Whether the reprojected cloud image is held to the neighbourhood of the new one.',
  cloudReprojectionMinDistanceKm:
    "Distance in kilometres a cloud surface must be at for the last image to be reprojected, from 0; 4 hides the errors of reprojecting a layer's single front depth, at the price of a noisier near cloud.",
  cloudDisocclusionMaxDistanceKm:
    'Distance in kilometres past which the pixels uncovered by a moving cloud are no longer rebuilt, from 0.',
  cloudTraceSize:
    "Size the clouds are traced at: 'quarterToHalf' a quarter of the view rebuilt at half, then enlarged; 'half' half of the view, then enlarged; 'quarterToFull' a quarter rebuilt at the full size, where a cloud cannot hide behind an opaque mesh; 'full' the full size, with nothing rebuilt.",
  cloudFogLate:
    'Whether the fog is applied to the clouds late in the frame, after they are rebuilt and enlarged, so it does not lag with them; the enlarging pass costs about twice as much.',
  cloudFogLateOnTranslucent:
    "Whether the translucent surfaces whose material has cloudFog read the cloud image with the fog already laid on it (cloudFogLate on, a fog in the scene): the rebuild then writes one more image, which costs a pass over the rebuilt image and its memory. Off, they read the image without the fog, and a translucent surface behind a cloud can show it with another fog than the cloud's.",
  cloudSoftBlendingDistanceOnTranslucent:
    "Kilometres, from the cloud's front, over which the cloud fades in over a translucent surface whose material has cloudFog (read from 0.0001).",
  lightShafts: 'Whether the sun and the lamps that ask for them draw light shafts.',
  lightShaftDownsample:
    'Factor the light shafts are computed at under the view size, a whole number from 1 to 8.',
  lightShaftTemporalFilter: 'Whether the light shafts are filtered over the images.',
  lightShaftBlurPasses: 'Radial blur passes of the light shafts, a whole number from 0.',
  lightShaftFirstPassDistance:
    'Fraction of the distance to the light that the first radial blur pass blurs over.',
  skyLightRealTimeCapture: "Whether the platform allows the sky light's real-time capture at all.",
  skyLightTimeSlicing:
    "Whether the sky light's capture and convolutions are spread over several images to lower the cost of each.",
  skyLightFacesPerFrame:
    'Cube faces whose clouds are drawn per image when the capture is time sliced, a whole number from 1 to 6: more is less lag between faces when the sun moves fast.',
  skyLightCloudDivider:
    "Factor the clouds' size is divided by in the sky light's capture, a whole number from 1 to 8.",
  skyLightShadowFromOpaque:
    "Whether opaque meshes shadow the sky and the clouds from the sun in the sky light's capture.",
  skyLightAlwaysClear:
    "Whether the sky light's capture is cleared to black before the sky is drawn.",
  skyLightDepthBuffer:
    "Whether the sky meshes of the sky light's real-time capture are drawn with a depth buffer, so that they cover each other correctly and the height fog is laid at their distance; off, the fog is laid along an endless ray.",
  skyLightResolutionOverride:
    "Side in texels of the sky light's real-time capture, from 16, in place of the sky light's own; a lower value leaves its own. A captured scene and a specified cubemap keep the sky light's own side.",
  skyLightCubemapMaxResolution:
    "Largest side in texels of the sky light's cube when above 0; below that the sky light's own side is kept.",
  skyLightCaptureSupersample:
    "Factor the faces of the sky light's captured scene are drawn larger by than the cube's side and averaged down, a whole number from 1 to 8.",
  skyLightCaptureLodDistanceScale:
    "Factor the detail of the sky light's captured scene is asked at: above 1 draws finer geometry in its faces; zero or less is 1.",
  skyLightIntensityScale:
    "Factor on the sky light's intensity: it keeps the contrast of a level that draws less occlusion.",
}

/** The schema of each setting of a contract's rules by field (`SettingRule`): its kind, its
 *  default, its bounds and what it means. */
export function ruleProperties<F extends string>(
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
    if (rule.kind === 'text') {
      properties[field] = { type: 'string', default: rule.default, description }
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
const skyQualityProperties = () =>
  ruleProperties(SKY_QUALITY_RULES, { ...SKY_QUALITY_MEANINGS, ...SKY_TRANSLUCENT_MEANINGS })

/** The schema of the geometry streaming's nine settings, by field. */
export const streamingProperties = () => ruleProperties(STREAMING_RULES, streamingMeanings())

/** The schema of the cluster raster's two settings, by field. */
export const rasterProperties = () => ruleProperties(RASTER_RULES, rasterMeanings())

/** The schema of every other run-time setting declared by rule, by its field: the partition's
 *  streaming and the HLOD warm-up's, then the cut's, then the animation's, then the shading's, then
 *  the exposure's, then the temporal pass's, then the depth pyramid's, then the sun's shadows', then the motion blur's,
 *  then the sky's quality. */
export const settingRuleProperties = () => ({
  ...ruleProperties(WORLD_STREAMING_RULES, {
    ...WORLD_STREAMING_MEANINGS,
    ...WORLD_SOURCE_MEANINGS,
  }),
  ...ruleProperties(DYNAMIC_RESOLUTION_RULES, DYNAMIC_RESOLUTION_MEANINGS),
  ...ruleProperties(CUT_RULES, { ...CUT_MEANINGS, ...CUT_VIEW_MEANINGS, ...CUT_SCALE_MEANINGS }),
  ...ruleProperties(ANIMATION_RULES, ANIMATION_MEANINGS),
  ...ruleProperties(SHADING_RULES, SHADING_MEANINGS),
  ...ruleProperties(EXPOSURE_RULES, EXPOSURE_MEANINGS),
  exposureCurve: exposureCurveProperty(),
  localExposureHighlightContrastCurve: contrastCurveProperty('highlight'),
  localExposureShadowContrastCurve: contrastCurveProperty('shadow'),
  ...ruleProperties(TEMPORAL_RULES, TEMPORAL_MEANINGS),
  ...ruleProperties(HIZ_RULES, {
    ...HIZ_MEANINGS,
    ...HIZ_PRIME_MEANINGS,
    ...HZB_OCCLUSION_MEANINGS,
  }),
  ...ruleProperties(LIGHT_FUNCTION_RULES, LIGHT_FUNCTION_MEANINGS),
  ...ruleProperties(LIGHT_PROFILE_RULES, LIGHT_PROFILE_MEANINGS),
  ...ruleProperties(RECT_LIGHT_ATLAS_RULES, RECT_LIGHT_ATLAS_MEANINGS),
  ...ruleProperties(SIMPLE_LIGHT_RULES, SIMPLE_LIGHT_MEANINGS),
  ...ruleProperties(VOLUMETRIC_LIGHTMAP_RULES, VOLUMETRIC_LIGHTMAP_MEANINGS),
  ...ruleProperties(GLOBAL_DISTANCE_FIELD_RULES, GLOBAL_DISTANCE_FIELD_MEANINGS),
  ...ruleProperties(DISTANCE_FIELD_OCCLUSION_RULES, DISTANCE_FIELD_OCCLUSION_MEANINGS),
  ...ruleProperties(SHADOW_RULES, {
    ...SHADOW_SUN_MEANINGS,
    ...SHADOW_VIEW_MEANINGS,
    ...CONTACT_SHADOW_MEANINGS,
    ...CAPSULE_SHADOW_MEANINGS,
    ...RAY_TRACED_SHADOW_MEANINGS,
  }),
  ...ruleProperties(MOTION_BLUR_RULES, MOTION_BLUR_MEANINGS),
  ...ruleProperties(DEPTH_OF_FIELD_RULES, DEPTH_OF_FIELD_MEANINGS),
  ...ruleProperties(TESSELLATION_RULES, TESSELLATION_MEANINGS),
  ...ruleProperties(TEXTURE_FILTERING_RULES, TEXTURE_FILTERING_MEANINGS),
  ...ruleProperties(BLOOM_RULES, BLOOM_MEANINGS),
  ...ruleProperties(GAUSSIAN_BLUR_RULES, GAUSSIAN_BLUR_MEANINGS),
  ...ruleProperties(FILM_RULES, FILM_MEANINGS),
  ...ruleProperties(COLOR_GRADING_RULES, COLOR_GRADING_MEANINGS),
  ...ruleProperties(VOLUMETRIC_FOG_RULES, VOLUMETRIC_FOG_MEANINGS),
  ...ruleProperties(TRANSLUCENCY_VOLUME_RULES, TRANSLUCENCY_VOLUME_MEANINGS),
  ...ruleProperties(TRANSLUCENCY_GI_RULES, TRANSLUCENCY_GI_MEANINGS),
  ...ruleProperties(SUBSURFACE_SCATTERING_RULES, SUBSURFACE_SCATTERING_MEANINGS),
  ...ruleProperties(SINGLE_LAYER_WATER_RULES, SINGLE_LAYER_WATER_MEANINGS),
  ...ruleProperties(HAIR_STRANDS_RULES, HAIR_STRANDS_MEANINGS),
  ...ruleProperties(HETEROGENEOUS_VOLUME_RULES, HETEROGENEOUS_VOLUME_MEANINGS),
  ...ruleProperties(SAMPLED_LIGHTS_RULES, SAMPLED_LIGHTS_MEANINGS),
  ...ruleProperties(PATH_TRACING_RULES, PATH_TRACING_MEANINGS),
  ...ruleProperties(SCREEN_PROBE_RULES, SCREEN_PROBE_MEANINGS),
  ...ruleProperties(REFLECTION_RULES, REFLECTION_MEANINGS),
  ...ruleProperties(SCREEN_SPACE_TRACING_RULES, SCREEN_SPACE_TRACING_MEANINGS),
  ...ruleProperties(LIGHTING_DATA_FORMAT_RULES, LIGHTING_DATA_FORMAT_MEANINGS),
  ...ruleProperties(MESH_DISTANCE_FIELD_TRACE_RULES, MESH_DISTANCE_FIELD_TRACE_MEANINGS),
  ...ruleProperties(SURFACE_CACHE_RULES, SURFACE_CACHE_MEANINGS),
  ...ruleProperties(AMBIENT_OCCLUSION_RULES, AMBIENT_OCCLUSION_MEANINGS),
  ...ruleProperties(AMBIENT_CUBEMAP_RULES, AMBIENT_CUBEMAP_MEANINGS),
  ...ruleProperties(REFLECTION_CAPTURE_RULES, REFLECTION_CAPTURE_MEANINGS),
  ...skyQualityProperties(),
})
