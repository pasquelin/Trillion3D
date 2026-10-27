import {
  atLeast,
  choiceSetting as choice,
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'

/**
 * The run-time settings of the translucency global illumination volume (`packages/sdk-browser/src/lighting/translucencyGi/`): the
 * indirect light of the see-through surfaces (blend, water, transmission), held in a grid fitted to the view — a cell of
 * `translucencyGiGridPixelSize` pixels a side across the image, its depth slices spaced on a logarithm of the distance from the camera
 * out to `translucencyGiEndDistance` — and read by a surface with one filtered fetch of the cell its point falls in, in place of the gather of the world's probes
 * each of its fragments would make. Each image the cells' light is traced (a cell casts `translucencyGiTracingResolution`² cones: the
 * global distance field marched, the surface cache read at the hit, the radiance cache read for what the march leaves), filtered
 * in space along the three axes, projected on the two-band harmonics and blended with the volume of the image before. Run-time
 * settings, as `./settingRules.ts` says. Distances are metres, where the reference's are centimetres.
 *
 * The grid is the reference's: a cell's depth slice is `log2(depth · translucencyGiGridDistributionLogZScale +
 * translucencyGiGridDistributionLogZOffset) · translucencyGiGridDistributionZScale`, the slices counting up to the end distance. The radiance
 * cache it reads is its own, by default: levels of probes shaped by the `translucencyGiRadianceCache*` settings (the first level's reach,
 * the growth of the next, the cells a side, the map of a probe, its levels of detail, the probes traced an image, the pool of probes, the
 * radius the probes' maps are read through), as many levels as cover `translucencyGiEndDistance`, marked by the cells alone at their own
 * points. With `translucencyGiShareRadianceCacheWithOpaque` the cells read the world's probes' cache instead and mark the probes they read
 * in it, in a cascade `translucencyGiRadianceCacheClipmapBias` coarser than the one that covers them. The quality presets write the cells'
 * side, the march, the filter and the cache (`TRANSLUCENCY_GI_PRESET_LEVELS`).
 */

/** The formats of the cones' light and of the ambient volume, the reference's lighting data format (0 1 2):
 *  `r11g11b10` the 11-11-10 floats (the reference's default), `rgba16` half floats (ours: more precision, on purpose), `rgba32` single floats. */
const TRANSLUCENCY_GI_LIGHTING_DATA_FORMATS = ['r11g11b10', 'rgba16', 'rgba32'] as const

/** The volume's settings by field, each with the reference's default:
 *  `translucencyGi`, on — the volume is made at all; off, a surface reads the sky light's irradiance alone;
 *  `translucencyGiTraceFromVolume`, on — the cells march the global distance field before they read the radiance cache; off, they read the
 *  cache alone;
 *  `translucencyGiRadianceCache`, on — the cells read a radiance cache for what the march leaves;
 *  `translucencyGiShareRadianceCacheWithOpaque`, off — that cache is the world's probes' (the screen probes') instead of one of the volume's own,
 *  which costs less and gives less control over the probes' spacing;
 *  `translucencyGiRadianceCacheClipmapBias`, 3 — shared, the cascades the cells' reads and marks go coarser than the cascade that covers them,
 *  so that the cells that fill the view do not take the probes the surfaces need; the volume's own cache has none;
 *  `translucencyGiRadianceCacheClipmapWorldExtent`, 25 — metres (2500 cm in the reference), the reach of the volume's own cache from the eye: half the side of its first level;
 *  `translucencyGiRadianceCacheClipmapDistributionBase`, 2 — the growth of a level's cells over the level before it;
 *  `translucencyGiRadianceCacheGridResolution`, 24 — the cells a side of a level, 1 to 256;
 *  `translucencyGiRadianceCacheProbeResolution`, 8 — the texels a side of a probe's map, 8 to 64;
 *  `translucencyGiRadianceCacheNumMipmaps`, 3 — the levels of detail of the maps, 1 to 3;
 *  `translucencyGiRadianceCacheNumProbesToTraceBudget`, 100 — the probes traced an image, in the cost of a whole map each;
 *  `translucencyGiRadianceCacheProbeAtlasResolutionInProbes`, 128 — the probes along a side of the atlas of the maps, 1 to 1024, which sets the pool;
 *  `translucencyGiRadianceCacheReprojectionRadiusScale`, 10 — the multiple of a probe's nearest ray start that the sphere its map is read through is as wide as;
 *  `translucencyGiLightingDataFormat`, `rgba16` — the format of the cones' light and of the ambient volume the surfaces read
 *  (`TRANSLUCENCY_GI_LIGHTING_DATA_FORMATS`; the directional volume is always half floats): the half floats keep more precision than the reference's
 *  11-11-10 floats (`r11g11b10`, the reference's default), on purpose; a device without the storage textures of the 11-11-10 format keeps half floats;
 *  `translucencyGiGridPixelSize`, 32 — pixels, the side of a cell across the image (the largest power of two within it is used);
 *  `translucencyGiGridDistributionLogZScale`, 1 — per metre (0.01 per centimetre in the reference), the depth slices' logarithm's scale;
 *  `translucencyGiGridDistributionLogZOffset`, 1 — the logarithm's offset;
 *  `translucencyGiGridDistributionZScale`, 4 — the slices a doubling of the depth holds;
 *  `translucencyGiEndDistance`, 80 — metres, the depth of the last slice, scaled by the scene's view distance (`globalDistanceFieldTraceViewDistance`) over
 *  20000 centimetres, the scale held to 0.1 to 100;
 *  `translucencyGiTracingResolution`, 3 — the cones a cell traces along a side of its octahedron;
 *  `translucencyGiMaxRayIntensity`, 20 — the most a cone brings back, in the units of the image's exposure;
 *  `translucencyGiGridCenterOffsetFromDepthBuffer`, 0.5 — cells, how far in front of the depth a cell's trace point is held, negative none;
 *  `translucencyGiOffsetThresholdToAcceptDepthBufferOffset`, 1 — cells, the nearest the point may lie behind the depth to be moved forward;
 *  `translucencyGiSpatialFilter`, on — the cones' light is filtered along the three axes;
 *  `translucencyGiSpatialFilterSampleCount`, 3 — cells either side of the filter's centre;
 *  `translucencyGiSpatialFilterStandardDeviation`, 5 — cells, the filter's Gaussian;
 *  `translucencyGiTemporalReprojection`, on — the volume is blended with the image before's, reprojected;
 *  `translucencyGiTemporalJitter`, on — the point of a cell the light is traced from, and the cone directions, turn from one image to the next;
 *  `translucencyGiTemporalHistoryWeight`, 0.9 — the share of the history kept;
 *  `translucencyGiTemporalMaxRayDirections`, 8 — the turns the cone directions take before they come round. */
export const TRANSLUCENCY_GI_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('translucencyGi', true),
    flag('translucencyGiTraceFromVolume', true),
    flag('translucencyGiRadianceCache', true),
    flag('translucencyGiShareRadianceCacheWithOpaque', false),
    count('translucencyGiRadianceCacheClipmapBias', 3, 0),
    positive('translucencyGiRadianceCacheClipmapWorldExtent', 25),
    number('translucencyGiRadianceCacheClipmapDistributionBase', 2, atLeast(1)),
    integer('translucencyGiRadianceCacheGridResolution', 24, [1, 256]),
    integer('translucencyGiRadianceCacheProbeResolution', 8, [8, 64]),
    integer('translucencyGiRadianceCacheNumMipmaps', 3, [1, 3]),
    count('translucencyGiRadianceCacheNumProbesToTraceBudget', 100, 1),
    integer('translucencyGiRadianceCacheProbeAtlasResolutionInProbes', 128, [1, 1024]),
    nonNegative('translucencyGiRadianceCacheReprojectionRadiusScale', 10),
    choice('translucencyGiLightingDataFormat', 'rgba16', TRANSLUCENCY_GI_LIGHTING_DATA_FORMATS),
    integer('translucencyGiGridPixelSize', 32, [1, 1024]),
    number('translucencyGiGridDistributionLogZScale', 1, atLeast(1e-6)),
    nonNegative('translucencyGiGridDistributionLogZOffset', 1),
    number('translucencyGiGridDistributionZScale', 4, atLeast(0.01)),
    number('translucencyGiEndDistance', 80, [0.01, 1000]),
    integer('translucencyGiTracingResolution', 3, [1, 16]),
    nonNegative('translucencyGiMaxRayIntensity', 20),
    number('translucencyGiGridCenterOffsetFromDepthBuffer', 0.5, atLeast(-1)),
    nonNegative('translucencyGiOffsetThresholdToAcceptDepthBufferOffset', 1),
    flag('translucencyGiSpatialFilter', true),
    count('translucencyGiSpatialFilterSampleCount', 3, 1),
    number('translucencyGiSpatialFilterStandardDeviation', 5, atLeast(0.1)),
    flag('translucencyGiTemporalReprojection', true),
    flag('translucencyGiTemporalJitter', true),
    number('translucencyGiTemporalHistoryWeight', 0.9, [0, 1]),
    count('translucencyGiTemporalMaxRayDirections', 8, 1),
  ] as const))()
/** What each quality preset writes over the defaults, the reference's own scalability rows of this volume: the second level (`balanced`) makes
 *  cells of 128 pixels, marches no distance field from them, filters nothing and shares the world's probes' cache; the third (`fine`) cells of
 *  64 pixels, no march, and a cache of its own of 70 probes traced an image; the fourth (`max`) is the defaults, cells of 32 pixels with the
 *  march and the filter; the cinematic one adds a fourth cone a side, maps of 16 texels a probe and 350 probes traced an image. The coarsest
 *  preset makes no volume (its screen probes are off), so it writes nothing (`runtime/qualityLevels.ts`). */
export const TRANSLUCENCY_GI_PRESET_LEVELS = {
  smooth: {},
  balanced: {
    translucencyGiGridPixelSize: 128,
    translucencyGiTraceFromVolume: false,
    translucencyGiShareRadianceCacheWithOpaque: true,
    translucencyGiSpatialFilter: false,
    translucencyGiRadianceCacheGridResolution: 12,
    translucencyGiRadianceCacheNumProbesToTraceBudget: 30,
  },
  fine: {
    translucencyGiGridPixelSize: 64,
    translucencyGiTraceFromVolume: false,
    translucencyGiRadianceCacheNumProbesToTraceBudget: 70,
  },
  cinematic: {
    translucencyGiTracingResolution: 4,
    translucencyGiRadianceCacheProbeResolution: 16,
    translucencyGiRadianceCacheNumProbesToTraceBudget: 350,
  },
} as const satisfies Record<string, Partial<TranslucencyGiValues>>
/** The field of one setting of the volume. */
export type TranslucencyGiField = keyof typeof TRANSLUCENCY_GI_RULES
/** The volume's settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type TranslucencyGiOptions = SettingOptions<typeof TRANSLUCENCY_GI_RULES>
/** The volume's settings with every field set. */
export type TranslucencyGiValues = SettingValues<typeof TRANSLUCENCY_GI_RULES>
