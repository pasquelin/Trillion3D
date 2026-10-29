import {
  choiceSetting as choice,
  contextReader,
  countSetting as count,
  flagSetting as flag,
  INT32_RANGE,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  rulesOf,
  type SettingOptions,
} from './settingRules.ts'

/** The views of the path tracer's payload `pathTracingVisualize` draws in place of the lit image, in the order the shader numbers them (the first, `none`, draws the lit image). */
export const PATH_TRACING_VISUALIZE_MODES = [
  'none',
  'Radiance',
  'WorldNormal',
  'WorldSmoothNormal',
  'WorldGeoNormal',
  'BaseColor',
  'DiffuseColor',
  'SpecularColor',
  'TransparencyColor',
  'Metallic',
  'Specular',
  'Roughness',
  'Anisotropy',
  'IOR',
  'ShadingModel',
  'LightingChannelMask',
  'WorldPosition',
  'PrimaryRays',
  'WorldTangent',
  'LightGridCount',
  'LightGridAxis',
  'LightGridListHash',
  'LightGridSingular',
  'VolumeLightCount',
  'HitKind',
  'TransparencyCount',
  'SSSColor',
  'SSSRadius',
  'SSSWeight',
  'SSSPhase',
  'FuzzColor',
  'FuzzRoughness',
  'FuzzAmount',
  'BSDFOpacity',
  'BackfacingNormal',
  'TriangleID',
  'InstanceID',
  'ClusterID',
] as const

/**
 * THE VIEW'S SETTINGS OF THE PATH TRACER AND ITS DENOISER: a render mode of its own that traces the scene's
 * triangles, bounce after bounce, and adds the samples of each image to those of the one before while the view stands
 * still, until the sample count is reached. Run-time settings, as `./settingRules.ts` says; the quality levels write none
 * of them.
 *
 * - `pathTracing` (off): whether the view is drawn by the path tracer; off, none of the others is read;
 * - `pathTracingExperimental` (off): whether the rarely used modes are on, which adaptive sampling is;
 * - `pathTracingSamplesPerPixel` (2048) and `pathTracingMaxBounces` (32): the samples each pixel gathers, and the bounces of a path;
 * - `pathTracingCompactionDepth` (6): the last bounce whose paths are compacted into a list of their own (a value
 *   under one, or past the last bounce, compacts every bounce); the bounces after it go on over the paths that list holds, the ones that ended left alone, without being packed again;
 * - `pathTracingIndirectDispatch` (off): whether each compacted bounce is dispatched over exactly the paths still alive (the count the bounce before wrote, read by the GPU), where off it is
 *   dispatched over every path of the tile and the surplus threads end at once; the image is the same;
 * - `pathTracingDispatchSize` (2048): the side of the tiles the image is traced in;
 * - `pathTracingAdaptiveSampling` (off), `pathTracingAdaptiveSamplingErrorThreshold` (0.001) and
 *   `pathTracingAdaptiveSamplingVisualize` (0, to 7): whether a pixel whose error is under the threshold is no more traced (it
 *   needs `pathTracingExperimental`), and the view that shows which pixels are, their sample counts or a level of the
 *   error's mip chain;
 * - `pathTracingProgressDisplay` (on): the bar that shows the samples gathered, until the count is reached;
 * - `pathTracingWiperMode` (off): the path tracer draws only the right of the cursor, the frame under it left to show;
 * - `pathTracingDenoiser` (on), `pathTracingDenoiserNormalSpace` (0) and `pathTracingSpatialDenoiser` (on): the denoiser
 *   of the last sample, the space the normals it reads are in (0 the world's, 1 the camera's) and its spatial stage;
 * - `pathTracingTemporalDenoiser` (off) and `pathTracingTemporalDenoiserMode` (1): its temporal stage, and when the
 *   denoiser runs (0 and 1 at the last sample, 2 at every image);
 * - `pathTracingMISMode` (2), `pathTracingMISCompensation` (on) and `pathTracingMaxPathIntensity` (24): how the lights are integrated
 *   (0 the material's samples alone, 1 the lights' alone, 2 both, weighed against each other), whether the sky's importance sampling is
 *   compensated for what the material's samples already find (only in mode 2), and the brightest a path off the camera's ray adds;
 * - `pathTracingApproximateCaustics` (on), `pathTracingEnableEmissive` (on) and `pathTracingBackgroundAlpha` (0): whether the paths
 *   that would turn a smooth surface's light into a caustic are roughened, whether emissive surfaces light the scene, and the alpha of
 *   a pixel that meets nothing;
 * - `pathTracingSamplerType` (0), `pathTracingFrameIndependentTemporalSeed` (on) and `pathTracingSkylightCaching` (on): the random
 *   numbers (0 a sequence of its own for each pixel, 1 one shared across the pixels so that the error spreads out at the last sample),
 *   whether the sequence goes on from one restart to the next, and whether the sky's importance tables are kept between images;
 * - `pathTracingFilterWidth` (3): the width of the anti-aliasing filter the camera's rays are drawn through, a Gaussian whose width covers plus or minus three standard
 *   deviations (3 is a standard deviation of half a pixel);
 * - `pathTracingVisibleLights` (0): which lights the camera's rays see (0 none, 1 all, 2 the sky alone);
 * - `pathTracingLightGridResolution` (256), `pathTracingLightGridMaxCount` (128) and `pathTracingLightGridAxis` (-1): the grid that
 *   culls the lights a point need not look at, its side, the most lights a cell keeps, and the axis it is projected along (-1 the best).
 *
 * The visualization (`pathTracingVisualize`, `none`): one of `PATH_TRACING_VISUALIZE_MODES`, a field of the first hit drawn in place of the lit image, one sample, no denoiser; `pathTracingVisualizeMaxCount` (16) the lights (or the cells' lights) the
 * views that turn a count into a colour take as the red end of their ramp (a cell past it is pink); `pathTracingVisualizeAmbientOcclusionMaxDistance` (2, metres: the reference's 200 centimetres) how far the occlusion ray of the views that need a little shading goes, a negative value
 * shading by the facing ratio instead; `pathTracingVisualizeIncludeTranslucent` (on) whether the views see the meshes that are translucent whole (off, the rays go through them and only the opaque surfaces show), and
 * `pathTracingVisualizeSamplesPerPixel` (1) the samples the `PrimaryRays` view gathers (the other views take one). The views see every layer a ray goes through, the colours of the layers added in proportion to
 * what they cover, and `PrimaryRays` is the path tracer itself with no air or cloud, no denoiser and no adaptive sampling.
 *
 * The traced atmosphere: `pathTracingEnableReferenceAtmosphere` (-1) whether the air is a volume the paths scatter in (1), is left to the sky light (0), or follows the view's post process setting (-1, which is off
 * where the post process sets none); `pathTracingAtmosphereOpticalDepthLUTResolution` (512) and `pathTracingAtmosphereOpticalDepthLUTNumSamples` (16384) the side of the table of the air's optical depth and the
 * samples integrated for each of its texels; `pathTracingEnableAtmosphereGround` (off) whether the camera's rays see the planet's ground (the paths that scattered in the air always do);
 * `pathTracingUseAnalyticTransmittance` (on) whether the transmittance through the air is read from that table (off, it is estimated by null tracking) and `pathTracingMaxRaymarchSteps` (768) the most steps a ray takes in a volume;
 * `pathTracingVolumeMISMode` (1) how the local lights light a volume (the air and the clouds): 0 by the scattering events the density gives, 1 by a point chosen on the ray's stretch of the volume in proportion to the light's reach (equi-angular sampling), the events then
 * lighting by the lights at infinity alone.
 *
 * The traced clouds (they need the traced air and a sky with a clouds part): `pathTracingEnableReferenceClouds` (on) whether the paths march the cloud layer's material as a volume; `pathTracingCloudAccelerationMapResolution` (512)
 * and `pathTracingCloudAccelerationMapNumSamples` (64) the side of the map of the densest cloud and the cloud's heights each column of the layer holds, which bounds the march, and the samples of the material each image adds to
 * each of its texels; `pathTracingCloudAccelerationMapVisualize` (off) draws the map in place of the clouds; `pathTracingCloudMultipleScatterMode` (1) how the light scattered more than once in a cloud is made (0 none: the material's
 * approximation is ignored and the roughness cutoff applies, 1 the material's approximation, the cutoff applying, 2 by the paths alone, the cutoff lifted); `pathTracingCloudRoughnessCutoff` (0.05) the roughness of the path beyond which
 * the clouds are not marched.
 *
 * Each default is the reference's (the cvar, or the post process volume's value where the cvar defers to it).
 *
 * Current limits: a hit's material is read back from the lit image where the surface shows, else from the surface cache's cards (no per-hit
 * material evaluation yet); no glass, subsurface, cloth or hair lobes; no capsule lights, light profiles, light functions or rectangle light textures;
 * the clouds are traced only where the device binds the sampled textures their material and map take beside the finish's own.
 *
 * The denoiser: a prepass keeps each pixel's running mean and variance (`pathTracingDenoiserVarianceType` 0 a variance per colour channel, 1 one
 * for the luminance, the albedo and the normals' length; `pathTracingDenoiserRankedLuminanceVariance` ranks the channels first;
 * `pathTracingDenoiserOutputVarianceTexture` always writes the variance image); the spatial stage filters the radiance guided by the albedo,
 * the normals and that variance; the temporal stage estimates the motion between the last denoised image and this one on a pyramid of 7 levels
 * (`...TemporalDenoiserDistanceMetrics` 0 luminance, 1 colour, 2 CIE 2000 difference; `...SubPixelOffset`, `...SubPixelOffsetStartMip`,
 * `...MotionOperation`, `...TotalVariation`, `...PatchCount`), then blends the warped history in (`...Kappa`, `...Eta`, `...DeltaE`,
 * `...DeltaEHighFrequency`, `...Alpha`; Kappa and Eta at -1 are derived from DeltaE); `...Source` picks what the motion is estimated on
 * (0 the denoised radiance, 1 normals, 2 albedo, 3 raw radiance, else a fusion of the variances); `...VisualizeMotionVector` and
 * `...VisualizeWarp` (1 the warped history, 2 the weights and the warp) draw the motion on the image.
 */
export const PATH_TRACING_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('pathTracing', false),
    flag('pathTracingExperimental', false),
    count('pathTracingSamplesPerPixel', 2048, 1),
    count('pathTracingMaxBounces', 32, 0),
    integer('pathTracingCompactionDepth', 6, INT32_RANGE),
    flag('pathTracingIndirectDispatch', false),
    count('pathTracingDispatchSize', 2048, 1),
    flag('pathTracingAdaptiveSampling', false),
    nonNegative('pathTracingAdaptiveSamplingErrorThreshold', 0.001),
    integer('pathTracingAdaptiveSamplingVisualize', 0, [0, 7]),
    flag('pathTracingProgressDisplay', true),
    flag('pathTracingWiperMode', false),
    flag('pathTracingDenoiser', true),
    integer('pathTracingDenoiserNormalSpace', 0, [0, 1]),
    flag('pathTracingSpatialDenoiser', true),
    flag('pathTracingTemporalDenoiser', false),
    integer('pathTracingTemporalDenoiserMode', 1, [0, 2]),
    integer('pathTracingDenoiserVarianceType', 1, [0, 1]),
    flag('pathTracingDenoiserOutputVarianceTexture', false),
    flag('pathTracingDenoiserRankedLuminanceVariance', false),
    flag('pathTracingTemporalDenoiserVisualizeMotionVector', false),
    flag('pathTracingTemporalDenoiserSubPixelOffset', true),
    number('pathTracingTemporalDenoiserKappa', -1, [-1, 1e6]),
    number('pathTracingTemporalDenoiserEta', 1, [-1, 1e6]),
    number('pathTracingTemporalDenoiserDeltaE', 5, [0, 1e6]),
    number('pathTracingTemporalDenoiserDeltaEHighFrequency', 2.1, [0, 1e6]),
    number('pathTracingTemporalDenoiserAlpha', 1, [0, 1e6]),
    integer('pathTracingTemporalDenoiserSource', 0, INT32_RANGE),
    integer('pathTracingTemporalDenoiserSubPixelOffsetStartMip', 8, [0, 64]),
    integer('pathTracingTemporalDenoiserMotionOperation', 1, [0, 1]),
    integer('pathTracingTemporalDenoiserVisualizeWarp', 0, [0, 2]),
    integer('pathTracingTemporalDenoiserDistanceMetrics', 2, [0, 2]),
    flag('pathTracingTemporalDenoiserTotalVariation', true),
    integer('pathTracingTemporalDenoiserPatchCount', 1, [1, 16]),
    choice('pathTracingVisualize', 'none', PATH_TRACING_VISUALIZE_MODES),
    flag('pathTracingVisualizeIncludeTranslucent', true),
    count('pathTracingVisualizeSamplesPerPixel', 1, 1),
    count('pathTracingVisualizeMaxCount', 16, 1),
    number('pathTracingVisualizeAmbientOcclusionMaxDistance', 2, [-1e6, 1e6]),
    integer('pathTracingMISMode', 2, [0, 2]),
    flag('pathTracingMISCompensation', true),
    number('pathTracingMaxPathIntensity', 24, [1, 65504]),
    flag('pathTracingApproximateCaustics', true),
    flag('pathTracingEnableEmissive', true),
    number('pathTracingBackgroundAlpha', 0, [0, 1]),
    integer('pathTracingSamplerType', 0, [0, 1]),
    flag('pathTracingFrameIndependentTemporalSeed', true),
    flag('pathTracingSkylightCaching', true),
    number('pathTracingFilterWidth', 3, [0, 64]),
    integer('pathTracingVisibleLights', 0, [0, 2]),
    count('pathTracingLightGridResolution', 256, 1),
    integer('pathTracingLightGridMaxCount', 128, [1, 256]),
    integer('pathTracingLightGridAxis', -1, [-1, 2]),
    integer('pathTracingEnableReferenceAtmosphere', -1, [-1, 1]),
    count('pathTracingAtmosphereOpticalDepthLUTResolution', 512, 1),
    count('pathTracingAtmosphereOpticalDepthLUTNumSamples', 16384, 1),
    flag('pathTracingEnableAtmosphereGround', false),
    flag('pathTracingUseAnalyticTransmittance', true),
    count('pathTracingMaxRaymarchSteps', 768, 1),
    integer('pathTracingVolumeMISMode', 1, [0, 1]),
    flag('pathTracingEnableReferenceClouds', true),
    integer('pathTracingCloudAccelerationMapResolution', 512, [1, 4096]),
    integer('pathTracingCloudAccelerationMapNumSamples', 64, [1, 65536]),
    flag('pathTracingCloudAccelerationMapVisualize', false),
    integer('pathTracingCloudMultipleScatterMode', 1, [0, 2]),
    number('pathTracingCloudRoughnessCutoff', 0.05, [0, 1]),
  ] as const))()

export type PathTracingField = keyof typeof PATH_TRACING_RULES

/** The path tracer setting `field` of a runtime's context (`contextReader`): its default where the context holds none. */
export const readPathTracingSetting = /* @__PURE__ */ contextReader(PATH_TRACING_RULES)
/** The path tracer settings as a host writes them, by their fields. */
export type PathTracingOptions = SettingOptions<typeof PATH_TRACING_RULES>
