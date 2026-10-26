import {
  atLeast,
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
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
 * cache it reads is the world's probes' (the reference's `ShareRadianceCacheWithOpaque` path, its clipmap bias the setting
 * `translucencyGiRadianceCacheClipmapBias`): the cells mark the probes they read, in a cascade the bias coarser than the one that
 * covers them.
 */

/** The volume's settings by field, each with the reference's default:
 *  `translucencyGi`, on — the volume is made at all; off, a surface reads the sky light's irradiance alone;
 *  `translucencyGiTraceFromVolume`, on — the cells march the global distance field before they read the radiance cache; off, they read the
 *  cache alone;
 *  `translucencyGiRadianceCache`, on — the cells read the world's radiance cache for what the march leaves (the screen probes' cache);
 *  `translucencyGiRadianceCacheClipmapBias`, 3 — the cascades the cells' reads and marks go coarser than the cascade that covers them,
 *  so that the cells that fill the view do not take the probes the surfaces need;
 *  `translucencyGiGridPixelSize`, 32 — pixels, the side of a cell across the image (the largest power of two within it is used);
 *  `translucencyGiGridDistributionLogZScale`, 1 — per metre (0.01 per centimetre in the reference), the depth slices' logarithm's scale;
 *  `translucencyGiGridDistributionLogZOffset`, 1 — the logarithm's offset;
 *  `translucencyGiGridDistributionZScale`, 4 — the slices a doubling of the depth holds;
 *  `translucencyGiEndDistance`, 80 — metres, the depth of the last slice;
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
    count('translucencyGiRadianceCacheClipmapBias', 3, 0),
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
/** The field of one setting of the volume. */
export type TranslucencyGiField = keyof typeof TRANSLUCENCY_GI_RULES
/** The volume's settings as a host writes them, by their fields: each its value, or nothing for its default. */
export type TranslucencyGiOptions = SettingOptions<typeof TRANSLUCENCY_GI_RULES>
/** The volume's settings with every field set. */
export type TranslucencyGiValues = SettingValues<typeof TRANSLUCENCY_GI_RULES>
