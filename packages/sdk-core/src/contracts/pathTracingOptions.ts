import {
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
 * Each default is the reference's (the cvar, or the post process volume's value where the cvar defers to it).
 *
 * Current limits: a hit's material is read back from the lit image where the surface shows, else from the surface cache's cards (no per-hit
 * material evaluation yet); no glass, subsurface, cloth or hair lobes; no capsule lights, light profiles, light functions or rectangle light textures;
 * the denoiser settings (`pathTracingDenoiser`, `pathTracingSpatialDenoiser`, `pathTracingTemporalDenoiser`, `pathTracingTemporalDenoiserMode`,
 * `pathTracingDenoiserNormalSpace`) are read but the denoiser is not built, so the image shown is the raw accumulation; the atmosphere and
 * the clouds are not traced.
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
  ] as const))()

export type PathTracingField = keyof typeof PATH_TRACING_RULES

/** The path tracer setting `field` of a runtime's context (`contextReader`): its default where the context holds none. */
export const readPathTracingSetting = /* @__PURE__ */ contextReader(PATH_TRACING_RULES)
/** The path tracer settings as a host writes them, by their fields. */
export type PathTracingOptions = SettingOptions<typeof PATH_TRACING_RULES>
