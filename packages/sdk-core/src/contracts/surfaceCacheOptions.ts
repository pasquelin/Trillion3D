import {
  ANY_NUMBER as ANY,
  countSetting as count,
  INT32_RANGE,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
  rulesOf,
  type SettingOptions,
  type SettingValues,
} from './settingRules.ts'
import { MAX_LIGHTS_PER_TILE } from '../lighting/surfaceCache/lightingMath.ts'

/** The cards the atlas keeps and the resolutions they are kept at. */
const ATLAS_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    count('surfaceCacheAtlasSize', 4096, 1),
    number('surfaceCacheResolution', 1, [0.5, 1]),
    number('surfaceCacheSceneDetail', 1, [0.125, 8]),
    nonNegative('surfaceCacheCardTexelDensityScale', 100),
    count('surfaceCacheCardMinResolution', 2, 0),
    count('surfaceCacheOrthographicCardMinResolution', 1, 0),
    integer('surfaceCacheCardMaxResolution', 512, [1, 2048]),
    nonNegative('surfaceCacheCardMaxTexelDensity', 0.2),
    nonNegative('surfaceCacheMeshCardsMinSize', 10),
    flag('surfaceCacheMeshCardsCullFaces', true),
  ] as const))()

/** How the cards' surface is captured into the atlas, kept and given up. */
const CAPTURE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    number('surfaceCacheCardCaptureMargin', 0, ANY),
    positive('surfaceCacheCaptureLodScaleFactor', 1),
    count('surfaceCacheNumFramesToKeepUnusedPages', 256, 0),
    integer('surfaceCacheCompress', 1, [0, 2]),
    count('surfaceCacheCardCapturesPerFrame', 300, 0),
    integer('surfaceCacheCardCaptureFactor', 64, [1, 1024]),
    count('surfaceCacheRemovesPerFrame', 512, 0),
    number('surfaceCacheCardCaptureRefreshFraction', 0.125, [0, 1]),
    flag('surfaceCacheCardCaptureEnableInvalidation', true),
    flag('surfaceCacheAllowCardSharing', true),
    flag('surfaceCacheAllowCardDownsampleFromSelf', true),
    flag('surfaceCacheResampleLighting', true),
    integer('surfaceCacheDilationMode', 0, [0, 2]),
    number('surfaceCacheDiffuseColorBoost', 1, [1, 4]),
    flag('surfaceCacheFastCameraMode', false),
  ] as const))()

/** The feedback with which the rays that read the cards ask for finer pages. */
const FEEDBACK_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('surfaceCacheFeedback', true),
    integer('surfaceCacheFeedbackTileSize', 16, [1, 256]),
    nonNegative('surfaceCacheFeedbackMinPageHits', 16),
    integer('surfaceCacheFeedbackUniqueElements', 1024, [1, 16384]),
    number('surfaceCacheFeedbackResLevelBias', -0.5, ANY),
  ] as const))()

/** How much of the cache's light an image updates, and which part of it first. */
const UPDATE_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    integer('surfaceCacheDirectLightingUpdateFactor', 32, [1, 1024]),
    integer('surfaceCacheRadiosityUpdateFactor', 64, [1, 1024]),
    number('surfaceCacheLightingUpdateSpeed', 1, [0.5, 16]),
    number('surfaceCacheLightingQuality', 1, [0.5, 6]),
    flag('surfaceCacheLightingForceFullUpdate', false),
    integer('surfaceCacheFreezeUpdateFrame', 0, INT32_RANGE),
    number('surfaceCacheLightingMaxDistanceFromFrustumToPrioritize', 500, ANY),
    flag('surfaceCacheLightingFeedback', true),
  ] as const))()

/** The direct light of the cache's texels, its shadows traced through the global field or the scene's triangles. */
const DIRECT_LIGHT_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('surfaceCacheDirectLighting', true),
    integer('surfaceCacheDirectLightingMaxLightsPerTile', 8, [1, MAX_LIGHTS_PER_TILE]),
    nonNegative('surfaceCacheDirectLightingGlobalSdfShadowRayBias', 1),
    flag('surfaceCacheDirectLightingCloudTransmittance', true),
    flag('surfaceCacheDirectLightingHardwareRayTracing', true),
    nonNegative('surfaceCacheDirectLightingHardwareRayTracingShadowRayBias', 1),
    nonNegative('surfaceCacheDirectLightingHardwareRayTracingEndBias', 1),
    flag('surfaceCacheDirectLightingHardwareRayTracingAdaptiveShadowTracing', true),
    flag('surfaceCacheDirectLightingHardwareRayTracingForceTwoSided', false),
    count('surfaceCacheHardwareRayTracingMaxIterations', 8192, 1),
  ] as const))()

/** The indirect light: the probes, their filter and their blend over the images. */
const RADIOSITY_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flag('surfaceCacheRadiosity', true),
    integer('surfaceCacheRadiosityProbeSpacing', 4, [1, 8]),
    integer('surfaceCacheRadiosityHemisphereProbeResolution', 4, [1, 16]),
    flag('surfaceCacheRadiositySpatialFilterProbes', true),
    integer('surfaceCacheRadiositySpatialFilterProbesKernelSize', 1, [0, 2]),
    flag('surfaceCacheRadiosityProbePlaneWeighting', true),
    number('surfaceCacheRadiosityProbePlaneWeightingDepthScale', -100, ANY),
    number('surfaceCacheRadiosityMaxRayIntensity', 40, [0, 1000000]),
    number('surfaceCacheRadiosityDistanceFieldSurfaceBias', 10, [0, 1000]),
    number('surfaceCacheRadiosityDistanceFieldSurfaceSlopeBias', 5, [0, 1000]),
    flag('surfaceCacheRadiosityTemporal', true),
    integer('surfaceCacheRadiosityTemporalMaxFramesAccumulated', 4, [1, 255]),
    integer('surfaceCacheRadiosityTemporalFixedJitterIndex', -1, [-1, INT32_RANGE[1]]),
  ] as const))()

/**
 * The surface cache: the cards each mesh carries (flat boxes along its faces, built by the compiler),
 * the atlas their captured surface — albedo, normal, emission, depth — is kept in, and the
 * light of that surface (`packages/sdk-core/src/lighting/surfaceCache/`), which the rays that
 * leave the screen read where they hit a mesh. Run-time settings, as `./settingRules.ts` says: no
 * compiler job names them, so no manifest carries them; each is read again at each image, and each
 * default is the reference's at its highest levels of scalability — the level `'ultra'` of the global illumination
 * (`../bounce/screenProbeLevels.ts`), whose row the defaults are; the lower levels hold another row of some of them
 * (`SURFACE_CACHE_LEVEL_ROWS`), which a setting a host names overrides. Lengths are in the reference's unit, the centimetre, as the global
 * distance field's (`./globalDistanceFieldOptions.ts`).
 *
 * THE ATLAS. `surfaceCacheAtlasSize` (4096) is its side in texels, cut into pages of 128 × 128, and
 * `surfaceCacheResolution` (1, from 0.5) a factor on the pages along a side, held between 1 and 64
 * in all; it scales the cards' resolutions too. A card is kept at a resolution — a power of two from
 * 8 to 2048 texels along its longer side; one of the lower levels is a part of a page — that follows
 * its size on the screen: its larger half side times `surfaceCacheCardTexelDensityScale` (100) over
 * the eye's distance from it, a metre at least, held to `surfaceCacheCardMaxTexelDensity` (0.2)
 * texels per unit of that half side and to `surfaceCacheCardMaxResolution` (512) texels. It is kept
 * at all while that reaches `surfaceCacheCardMinResolution` (2) texels and the eye is within the
 * outermost clipmap of the global distance field plus `surfaceCacheCardCaptureMargin` (0). An
 * orthographic view takes `surfaceCacheOrthographicCardMinResolution` (1) for the least, where it is
 * above 0. `surfaceCacheSceneDetail` (1, from 0.125 to 8) divides that least resolution: a higher
 * detail keeps smaller cards. The coarsest level of a card is kept in the atlas as long as the card is
 * wanted; the finer pages are kept while the rays read them (the feedback) and leave the atlas
 * `surfaceCacheNumFramesToKeepUnusedPages` (256) images after the last read. `surfaceCacheCompress` (1)
 * keeps the atlas's albedo, normal and emission in block-compressed textures (BC7, BC5, BC6H: a
 * quarter of the bytes of those layers, at the price of the formats' loss): 0 never, 1 by writing the
 * atlas through a view of another format and 2 by writing blocks to a buffer and copying them in. The
 * first is not possible on WebGPU, which has no such view: as on a platform that lacks it, 1 compresses
 * nothing; 2 needs the device's `texture-compression-bc`, and without it compresses nothing either.
 * A change empties the atlas.
 *
 * THE CARDS. A mesh gets cards when its largest face, scaled by its placement, exceeds
 * `surfaceCacheMeshCardsMinSize` (10) squared, a fifth of that for an emissive mesh; of its cards, one
 * whose area is under that is left out (`surfaceCacheMeshCardsCullFaces`, on). Cards of placements
 * of one mesh, with the same materials, facing the same way and of the same proportions, copy
 * the capture of one another (`surfaceCacheAllowCardSharing`, on), and a card that lowers its
 * resolution takes it from its own finer one (`surfaceCacheAllowCardDownsampleFromSelf`, on).
 *
 * THE UPDATE. Each image captures at most `surfaceCacheCardCapturesPerFrame` (300) cards, the
 * nearest first, adds the cards of twice as many meshes, and removes those of at most
 * `surfaceCacheRemovesPerFrame` (512); the capture atlas is the atlas's side over the square root of
 * `surfaceCacheCardCaptureFactor` (64). A share `surfaceCacheCardCaptureRefreshFraction` (0.125) of
 * that budget captures pages again, the oldest first, to follow changes of the materials, and
 * `surfaceCacheCardCaptureEnableInvalidation` (on) lets a change of a mesh ask for the same at once.
 * The pages are drawn at the detail the view's pixel error asks, divided by
 * `surfaceCacheCaptureLodScaleFactor` (1): above 1, finer clusters; under 1, coarser.
 * `surfaceCacheResampleLighting` (on) carries the light a card held into its pages when they are captured
 * again or made anew, which the radiosity's accumulation over images needs, and `surfaceCacheDilationMode` (0) widens the captured data of a page by a texel: 0 never, 1 for
 * the two-sided meshes, 2 for all. `surfaceCacheFastCameraMode` (off), for a camera that moves
 * fast, lowers the density to a fifth, halves the greatest resolution and doubles the captures.
 * `surfaceCacheDiffuseColorBoost` (1, up to 4) raises the luminance of the albedo a read of the cards returns
 * to the power of its inverse, never to one: a dark surface bounces more light; 1 leaves the albedo as it is.
 *
 * THE LIGHTING. Each image lights the texels of a share of the cards' pages, the pages left longest unlit
 * first (`surfaceCacheDirectLightingUpdateFactor` 32 and `surfaceCacheRadiosityUpdateFactor` 64 divide the atlas's
 * texels by the factor, over `surfaceCacheLightingUpdateSpeed` 1; `surfaceCacheLightingForceFullUpdate` lights all of
 * them every image): a page's age counts four times faster than its distance from the eye slows it (the first
 * clipmap's half side, 1 over 1 + the distance over it), twice as fast within
 * `surfaceCacheLightingMaxDistanceFromFrustumToPrioritize` (500) centimetres of the view's frustum, -1 never, and at
 * the greatest speed, 4, for a page the rays read at its finest level in the last two images
 * (`surfaceCacheLightingFeedback`, on, where the scene has acceleration structures and
 * `surfaceCacheDirectLightingHardwareRayTracing` is on).
 * The direct light (`surfaceCacheDirectLighting`, on) goes to each tile of 8 × 8 texels from at most
 * `surfaceCacheDirectLightingMaxLightsPerTile` (8, raised to a power of two) lights, those of the most
 * luminance at the tile's depth range. Where the scene has acceleration structures
 * (`surfaceCacheDirectLightingHardwareRayTracing`, on) the shadow of a texel is a mask a light keeps for the
 * tile (a factor of 7 bits and whether it is settled), its light function and clouds' shade first, then one ray
 * through the scene's triangles for each texel whose mask is not settled: started off the texel by
 * `surfaceCacheDirectLightingHardwareRayTracingShadowRayBias` (1) centimetres, three times that where the
 * surface grazes the light, a lamp's ray ending `surfaceCacheDirectLightingHardwareRayTracingEndBias` (1) short of it,
 * culling the front faces of the primitives that are not two-sided unless
 * `surfaceCacheDirectLightingHardwareRayTracingForceTwoSided` (off) makes all so, and stopping after
 * `surfaceCacheHardwareRayTracingMaxIterations` (8192) triangles, a trace that stopped counting as a hit. A tile
 * whose texels all saw a light, or all lay in its shadow, at its last update (adaptive tracing,
 * `surfaceCacheDirectLightingHardwareRayTracingAdaptiveShadowTracing`, on) traces one texel in each quad of
 * four, a different one each update, and gives the quad its answer. Without acceleration structures, or with that
 * option off, the shadow is one ray through the global distance field, started
 * off the texel by `surfaceCacheDirectLightingGlobalSdfShadowRayBias` (1) voxels, more where the surface grazes
 * the light; the lights wear the clouds' shade unless `surfaceCacheDirectLightingCloudTransmittance` is off. The
 * indirect light (`surfaceCacheRadiosity`, on) is a probe every `surfaceCacheRadiosityProbeSpacing` (4, a power
 * of two to 8) texels tracing a hemisphere of `surfaceCacheRadiosityHemisphereProbeResolution` (4) rays along a
 * side — `surfaceCacheLightingQuality` (1, to 6) multiplies it by its square root to 4 and, from 6, halves the
 * spacing — through the global field from `surfaceCacheRadiosityDistanceFieldSurfaceBias` (10) centimetres, the
 * surface that hit read at its final light, the sky where nothing was met, no ray brighter than
 * `surfaceCacheRadiosityMaxRayIntensity` (40) times the exposure; a probe's rays are filtered with those of its
 * neighbours' probes (`surfaceCacheRadiositySpatialFilterProbes`, on, a kernel of
 * `surfaceCacheRadiositySpatialFilterProbesKernelSize` 1: 0 none, 1 four neighbours, 2 thirteen) unless they lie
 * off the texel's plane (`surfaceCacheRadiosityProbePlaneWeighting`, on, at
 * `surfaceCacheRadiosityProbePlaneWeightingDepthScale` -100), and a texel is the four nearest probes' harmonics
 * (a probe jitters over the images), blended into the last images' (`surfaceCacheRadiosityTemporal`, on, the
 * last `surfaceCacheRadiosityTemporalMaxFramesAccumulated` 4; `surfaceCacheRadiosityTemporalFixedJitterIndex` -1
 * jitters, else the jitter is held). A texel's final light is its albedo over π times the direct and indirect
 * light, plus its emission.
 *
 * THE FEEDBACK. A ray that hits a card reads its finest page that is in the atlas; with
 * `surfaceCacheFeedback` (on) it also tells which finer page it would have read: one report in each
 * tile of `surfaceCacheFeedbackTileSize` (16) pixels a side, for the level the ray's cone would fill.
 * A page is requested when more than
 * `surfaceCacheFeedbackMinPageHits` (16) reports named it in an image, and at most
 * `surfaceCacheFeedbackUniqueElements` (1024) pages are told in an image. The level a ray tells is the one its cone
 * calls for plus `surfaceCacheFeedbackResLevelBias` (-0.5, half a level coarser).
 */
// A spread at the top level is not pure to a bundler: marked so, a bundle that never reads the table drops it.
export const SURFACE_CACHE_RULES = /* @__PURE__ */ (() => ({
  ...ATLAS_RULES,
  ...CAPTURE_RULES,
  ...FEEDBACK_RULES,
  ...UPDATE_RULES,
  ...DIRECT_LIGHT_RULES,
  ...RADIOSITY_RULES,
}))()

/** The field of one setting of the surface cache. */
export type SurfaceCacheField = keyof typeof SURFACE_CACHE_RULES

/** What a host writes for the surface cache: any of its fields. */
export type SurfaceCacheOptions = SettingOptions<typeof SURFACE_CACHE_RULES>

/** The surface cache's settings as resolved. */
export type SurfaceCacheSettings = SettingValues<typeof SURFACE_CACHE_RULES>
