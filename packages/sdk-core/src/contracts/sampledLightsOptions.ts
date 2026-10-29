import {
  choiceSetting,
  countSetting,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/**
 * THE VIEW'S SETTINGS OF THE SAMPLED LIGHTING: the lighting that gives every pixel a few stochastic
 * samples among the many lights that reach it, traces one shadow ray per sample and denoises the
 * result over time and space, so that the cost of many shadow casting lights stays fixed. Run-time
 * settings, as `./settingRules.ts` says; the quality levels write none of them.
 *
 * - `sampledLights` (off): whether the view lights with it; off, the other settings are not read;
 * - `sampledLightsDirectional` (off): whether directional lights join it;
 * - `sampledLightsShadowMethod` (`rayTracing`): how a light that names none is shadowed, by traced
 *   rays or by the virtual shadow maps;
 * - `sampledLightsDownsample` (2): the pixels of one sampled pixel: 0 one, 1 two (a checkerboard),
 *   2 four; `sampledLightsHairDownsample` (0): the same for the hair strands;
 * - `sampledLightsSamplesPerPixel` (4): the samples of one sampled pixel (1, 2 and 4 are the
 *   layouts; a larger count takes the layout of 4); `sampledLightsHairSamplesPerPixel` (4): the same
 *   for the hair strands;
 * - `sampledLightsMinSampleWeight` (0.001): the weight under which a sample is skipped;
 * - `sampledLightsAttenuationFalloff` (0.18): the base colour luminance the early light culling
 *   assumes; 0 culls nothing early;
 * - `sampledLightsGuideByHistory` (on): whether a light hidden last image is drawn less often;
 * - `sampledLightsHiddenWeight` (0.1) and `sampledLightsHiddenWeightOnHistoryMiss` (0.4): the share of its weight a light
 *   hidden last image keeps in the draw, and where the pixel has no history;
 * - `sampledLightsDirectionalFraction` (0.5) and `sampledLightsDirectionalMinClampWeight` (0.01): the most of the samples
 *   the directional lights may take, and the weight under which they are not held to it;
 * - `sampledLightsMergeRays` (on): whether a ray that repeats another's is skipped;
 * - `sampledLightsVsmMarkPages` (on): whether the virtual shadow maps' pages are marked from the samples alone; off, every page the lights of a
 *   pixel's cell might need is marked, as for any shadowed light;
 * - `sampledLightsShadingConfidence` (on), `sampledLightsMaxShadingWeight` (20) and `sampledLightsMaxShadingWeightHidden` (5): whether the filters spare the
 *   pixels the draw sampled well, and the most a sample weighs, where its light was seen and where it was hidden last image (fireflies);
 * - `sampledLightsScreenTraces` (on), `sampledLightsScreenTraceIterations` (50), `sampledLightsScreenTraceDistance` (1 m),
 *   `sampledLightsScreenTraceThickness` (0.005 of the depth) and `sampledLightsScreenTraceNormalBias` (0.0005 m): whether the shadow
 *   rays march the image's depth first, the iterations of that march, how far it goes, the thickness of what it hits and how far its
 *   start is moved along the surface's normal; `sampledLightsScreenTraceHair` (on) and `…HairBias` (1 cm) whether a hair pixel's rays march too and how far
 *   its start moves along itself; `sampledLightsHairUnshadowedDistance` (20 cm) the longest ray a hair pixel casts toward a light that casts no shadow;
 * - `sampledLightsFirstPersonMinimumHit` (4 cm): the least distance, in metres, a ray the screen missed is handed on at when it meets the sphere that
 *   holds the first-person objects' stand-ins;
 * - `sampledLightsTransmission` (on) and `sampledLightsTransmissionSampleWeight` (0.1, 0 to 1): the
 *   subsurface transmission and the value assumed for it when a sample is weighed;
 * - `sampledLightsLightingChannels` (on): whether the lighting channels block the shadowing;
 * - `sampledLightsHairVoxelTraces` (on): whether the surfaces' rays the distance field traces are also marched through the hair strands' voxels, where the view holds hair (the shadow the hair casts on the surfaces);
 * - `sampledLightsHairStrands` (on): whether the hair strands' samples are lit by the sampled lighting (R `HairStrands`);
 * - `sampledLightsFastClear` (off), `sampledLightsHairFastClear` (on), `sampledLightsFrontLayerFastClear` (on):
 *   whether a pass skips its empty tiles and clears only the borders its filters read, for the
 *   surfaces, the hair strands and the nearest translucent layer;
 * - `sampledLightsFrontLayer` (off): whether the nearest translucent layer is lit by the same sampled pass as its own pixels (the pass reads the layer's colour, normal and depth the transparents'
 *   front pass writes) and no more by the lights loop; `sampledLightsFrontLayerSpecularOnly` (off) only its specular light, the diffuse left to the translucency volume;
 *   `sampledLightsFrontLayerSoftShadows` (on) whether an area light's penumbra is sampled for it; `sampledLightsFrontLayerScreenTraces` (off) whether its rays march the depth;
 *   `sampledLightsFrontLayerTemporal` (on) and `sampledLightsFrontLayerSpatial` (on) its two filters;
 * - `sampledLightsTemporal` (on), `sampledLightsTemporalHistoryDistance` (0.03): the accumulation
 *   over time and the relative distance past which an earlier image is discarded;
 * - `sampledLightsTemporalMinFrames` (4), `sampledLightsTemporalMaxFrames` (12) and `sampledLightsTemporalClampScale` (1): the history's least length after a miss,
 *   its longest, and how permissive the neighbourhood clamp is (higher: more ghosting, less noise);
 * - `sampledLightsGuideByHistoryFilter` (on): whether the sets of the lights each tile saw and did not see are joined with the four neighbouring tiles' before they guide the next image;
 * - `sampledLightsPowerDelta` (on) and `sampledLightsPowerDeltaLightFunctions` (off): whether the change of each light's power since the image before drives the draw, so that a light just
 *   turned on counts as visible at once, and whether the light function is in that power (evaluated once, at the light's place);
 * - `sampledLightsSpatial` (on), `sampledLightsSpatialDepthWeight` (10000), `sampledLightsSpatialRadius` (8 px), `sampledLightsSpatialSamples` (4),
 *   `sampledLightsSpatialDisocclusionFrames` (2), `sampledLightsSpatialDisocclusionDiffuseVariance` (2) and `…SpecularVariance` (1),
 *   `sampledLightsSpatialHistoryVariance` (on) and `sampledLightsSpatialHistoryDeviation` (0.15): the filter over the neighbours of a pixel that the history leaves noisy;
 * - `sampledLightsVolumeDownsample` (2, 0 or 2), `sampledLightsVolumeWorldSpaceTraces` (on) and `sampledLightsVolumeGuideByHistory` (on): the cells one drawn cell covers along each axis (the
 *   2 by 2 by 2 cells of a block share their draw), whether the kept lights are shadowed by the global distance field too, and whether a light hidden in the image before is drawn less;
 * - `sampledLightsVolumeGridPixelSize` (8 px), `sampledLightsVolumeGridSizeZ` (128), `sampledLightsVolumeDepthDistributionScale` (32) and `sampledLightsVolumeHzbOcclusionTest` (on): the froxel grid of the volume
 *   (the pixels of a voxel across, its depth slices, how they spread over the depth) and whether the voxels hidden behind the surfaces are skipped;
 * - `sampledLightsVolumeUnified` (on) and `sampledLightsTranslucencyVolume` (on): whether the translucency lighting volume lights its local lights from the samples the fog's volume drew
 *   (the voxels' samples are shared, a light weighing by the larger of its two lights and traced for both), and whether it is lit by the sampled lighting at all;
 * - `sampledLightsTranslucencyVolumeDownsample` (2, 1 or 2), `…SamplesPerVoxel` (2), `…MinSampleWeight` (0.1) and `…GuideByHistory` (on): where the translucency volume does not share the fog's samples, the cells
 *   one drawn cell covers along each axis, the samples of a cell, the least a sample weighs and whether a light hidden in the image before is drawn less;
 * - THE DEBUG VIEWS (diagnostic modes `sampled-lights-…`): `sampledLightsVisualize` (0, 1 to 16) the numbered view shown in place of a named mode — 1 the overview of the
 *   shadow casters, 2 the shadow casters, 3 their quality, 4 and 5 the denoiser's overviews, 6 to 16 the denoiser's own images, each view named in `docs/SDK.md` —;
 *   `sampledLightsVisualizeShadowCasterMissingDistance` (0.5 m) and `…PoorDistance` (0.25 m) how far a traced surface may lie from the drawn one before the quality view calls it missing or mismatching;
 *   `sampledLightsVisualizeTileClassification` (0, 1 to 6) the tiles of the classification drawn over the image — 1 the surfaces' tiles, 2 the downsampled tiles, 3 and 4 the hair strands', 5 and 6 the nearest
 *   translucent layer's —;
 *   `sampledLightsDebug` (0, 1 to 5: the surfaces, the volume, the translucency volume, the hair strands, the nearest layer) which input the debug prints speak of, `sampledLightsDebugTraceStats` (off) the
 *   count of rays each trace method got, and `sampledLightsDebugCursorX` / `…Y` (-1, the middle of the image) the pixel the light list and the prints inspect;
 * - `sampledLightsVolume` (on), `sampledLightsVolumeSamplesPerVoxel` (2) and `sampledLightsVolumeMinSampleWeight` (0.1): whether the local lights lit the volumetric fog's
 *   cells by samples, the samples of a cell (4 or more take 4, less 2) and the least a sample weighs in a cell's light for the lights to be drawn at all. The fog's grid is the volume's
 *   (it has its own cell size, depth law, history and hidden-cell skip).
 */
const SAMPLED_LIGHTS_SHADOW_METHODS = ['rayTracing', 'virtualShadowMap'] as const

export const SAMPLED_LIGHTS_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('sampledLights', false),
    flag('sampledLightsHairStrands', true),
    flag('sampledLightsHairVoxelTraces', true),
    flag('sampledLightsDirectional', false),
    choiceSetting('sampledLightsShadowMethod', 'rayTracing', SAMPLED_LIGHTS_SHADOW_METHODS),
    integer('sampledLightsDownsample', 2, [0, 2]),
    integer('sampledLightsHairDownsample', 0, [0, 2]),
    countSetting('sampledLightsSamplesPerPixel', 4, 1),
    countSetting('sampledLightsHairSamplesPerPixel', 4, 1),
    nonNegativeSetting('sampledLightsMinSampleWeight', 0.001),
    nonNegativeSetting('sampledLightsAttenuationFalloff', 0.18),
    flag('sampledLightsGuideByHistory', true),
    flag('sampledLightsGuideByHistoryFilter', true),
    number('sampledLightsHiddenWeight', 0.1, [0, 1]),
    number('sampledLightsHiddenWeightOnHistoryMiss', 0.4, [0, 1]),
    number('sampledLightsDirectionalFraction', 0.5, [0, 1]),
    nonNegativeSetting('sampledLightsDirectionalMinClampWeight', 0.01),
    flag('sampledLightsMergeRays', true),
    flag('sampledLightsVsmMarkPages', true),
    flag('sampledLightsShadingConfidence', true),
    nonNegativeSetting('sampledLightsMaxShadingWeight', 20),
    nonNegativeSetting('sampledLightsMaxShadingWeightHidden', 5),
    flag('sampledLightsScreenTraces', true),
    countSetting('sampledLightsScreenTraceIterations', 50, 1),
    nonNegativeSetting('sampledLightsScreenTraceDistance', 1),
    nonNegativeSetting('sampledLightsScreenTraceThickness', 0.005),
    nonNegativeSetting('sampledLightsScreenTraceNormalBias', 0.0005),
    flag('sampledLightsScreenTraceHair', true),
    nonNegativeSetting('sampledLightsScreenTraceHairBias', 0.01),
    nonNegativeSetting('sampledLightsHairUnshadowedDistance', 0.2),
    nonNegativeSetting('sampledLightsFirstPersonMinimumHit', 0.04),
    flag('sampledLightsTransmission', true),
    number('sampledLightsTransmissionSampleWeight', 0.1, [0, 1]),
    flag('sampledLightsLightingChannels', true),
    flag('sampledLightsFastClear', false),
    flag('sampledLightsHairFastClear', true),
    flag('sampledLightsFrontLayerFastClear', true),
    flag('sampledLightsFrontLayer', false),
    flag('sampledLightsFrontLayerSpecularOnly', false),
    flag('sampledLightsFrontLayerSoftShadows', true),
    flag('sampledLightsFrontLayerScreenTraces', false),
    flag('sampledLightsFrontLayerTemporal', true),
    flag('sampledLightsFrontLayerSpatial', true),
    flag('sampledLightsTemporal', true),
    nonNegativeSetting('sampledLightsTemporalHistoryDistance', 0.03),
    countSetting('sampledLightsTemporalMinFrames', 4, 1),
    countSetting('sampledLightsTemporalMaxFrames', 12, 1),
    nonNegativeSetting('sampledLightsTemporalClampScale', 1),
    flag('sampledLightsPowerDelta', true),
    flag('sampledLightsPowerDeltaLightFunctions', false),
    flag('sampledLightsSpatial', true),
    nonNegativeSetting('sampledLightsSpatialDepthWeight', 10000),
    nonNegativeSetting('sampledLightsSpatialRadius', 8),
    countSetting('sampledLightsSpatialSamples', 4, 1),
    nonNegativeSetting('sampledLightsSpatialDisocclusionFrames', 2),
    nonNegativeSetting('sampledLightsSpatialDisocclusionDiffuseVariance', 2),
    nonNegativeSetting('sampledLightsSpatialDisocclusionSpecularVariance', 1),
    flag('sampledLightsSpatialHistoryVariance', true),
    number('sampledLightsSpatialHistoryDeviation', 0.15, [0, 1]),
    integer('sampledLightsVolumeDownsample', 2, [0, 2]),
    flag('sampledLightsVolumeWorldSpaceTraces', true),
    flag('sampledLightsVolumeGuideByHistory', true),
    countSetting('sampledLightsVolumeGridPixelSize', 8, 1),
    countSetting('sampledLightsVolumeGridSizeZ', 128, 1),
    nonNegativeSetting('sampledLightsVolumeDepthDistributionScale', 32),
    flag('sampledLightsVolumeHzbOcclusionTest', true),
    flag('sampledLightsVolumeUnified', true),
    flag('sampledLightsTranslucencyVolume', true),
    integer('sampledLightsTranslucencyVolumeDownsample', 2, [1, 2]),
    countSetting('sampledLightsTranslucencyVolumeSamplesPerVoxel', 2, 1),
    nonNegativeSetting('sampledLightsTranslucencyVolumeMinSampleWeight', 0.1),
    flag('sampledLightsTranslucencyVolumeGuideByHistory', true),
    flag('sampledLightsVolume', true),
    countSetting('sampledLightsVolumeSamplesPerVoxel', 2, 1),
    nonNegativeSetting('sampledLightsVolumeMinSampleWeight', 0.1),
    integer('sampledLightsVisualize', 0, [0, 16]),
    nonNegativeSetting('sampledLightsVisualizeShadowCasterMissingDistance', 0.5),
    nonNegativeSetting('sampledLightsVisualizeShadowCasterPoorDistance', 0.25),
    integer('sampledLightsVisualizeTileClassification', 0, [0, 6]),
    integer('sampledLightsDebug', 0, [0, 5]),
    flag('sampledLightsDebugTraceStats', false),
    integer('sampledLightsDebugCursorX', -1, [-1, 65535]),
    integer('sampledLightsDebugCursorY', -1, [-1, 65535]),
  ] as const))()

/** The field of one sampled lighting setting of the view. */
export type SampledLightsField = keyof typeof SAMPLED_LIGHTS_RULES
/** The sampled lighting's settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type SampledLightsOptions = SettingOptions<typeof SAMPLED_LIGHTS_RULES>
