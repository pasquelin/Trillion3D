import { SURFACE_CACHE_RULES, type SurfaceCacheField } from '../contracts/surfaceCacheOptions.ts'

const R = SURFACE_CACHE_RULES

/** What the settings of the cards the atlas keeps and the resolutions they are kept at mean. */
const ATLAS_MEANINGS = /* @__PURE__ */ (() => ({
  surfaceCacheAtlasSize: `The side in texels of the atlas that holds the captured surface of the meshes' cards (${R.surfaceCacheAtlasSize.default} by default), cut into pages of 128; times surfaceCacheResolution, the pages along a side are held between 1 and 64. A change empties the atlas.`,
  surfaceCacheResolution: `A factor from 0.5 to 1 on the atlas's pages along a side, and on the resolutions of the cards (${R.surfaceCacheResolution.default} by default): a smaller one keeps the surface at lower detail in less memory. A change of the atlas's pages empties it.`,
  surfaceCacheSceneDetail: `Divides the least resolution a card is kept at, from 0.125 to 8 (${R.surfaceCacheSceneDetail.default} by default): a higher detail keeps smaller cards, a lower one fewer.`,
  surfaceCacheCardTexelDensityScale: `A card's resolution along its longer side, before its limits, is this number (${R.surfaceCacheCardTexelDensityScale.default} by default) times its larger half side over the eye's distance from it, a metre at least.`,
  surfaceCacheCardMinResolution: `The least resolution, in texels along the longer side, at which a card is kept (${R.surfaceCacheCardMinResolution.default} by default; resolutions are powers of two, so a card is kept when its resolution reaches it). The scene's detail and the atlas's factor scale it, and it is held between 1 and 1024.`,
  surfaceCacheOrthographicCardMinResolution: `The least resolution an orthographic view keeps a card at, in place of surfaceCacheCardMinResolution, where it is above 0 (${R.surfaceCacheOrthographicCardMinResolution.default} by default); 0 takes the plain one.`,
  surfaceCacheCardMaxResolution: `The greatest resolution, in texels along the longer side, of a card, from 1 to 2048 (${R.surfaceCacheCardMaxResolution.default} by default); halved for a fast camera and scaled by the atlas's factor.`,
  surfaceCacheCardMaxTexelDensity: `The most texels per unit of a card's larger half side its resolution reaches, whatever the distance (${R.surfaceCacheCardMaxTexelDensity.default} by default).`,
  surfaceCacheMeshCardsMinSize: `Centimetres: the area a mesh's largest face must exceed to get cards is this squared, a fifth of that for an emissive mesh (${R.surfaceCacheMeshCardsMinSize.default} by default); a card whose face is under it is left out too.`,
  surfaceCacheMeshCardsCullFaces: `Whether a card whose face is under that area is left out of its mesh (on by default); off, a mesh keeps all its cards, 32 at most.`,
}))()

/** What the settings of how the cards' surface is captured into the atlas, kept and given up mean. */
const CAPTURE_MEANINGS = /* @__PURE__ */ (() => ({
  surfaceCacheCardCaptureMargin: `Centimetres added to the distance past which a card is not kept, that of the outermost clipmap of the global distance field (${R.surfaceCacheCardCaptureMargin.default} by default).`,
  surfaceCacheNumFramesToKeepUnusedPages: `The images after which a finer page that no ray read leaves the atlas (${R.surfaceCacheNumFramesToKeepUnusedPages.default} by default); the coarsest level of a wanted card never leaves.`,
  surfaceCacheCompress: `Whether the atlas keeps its albedo, normal and emission in block-compressed textures (BC7, BC5, BC6H), a quarter of the memory of those layers (${R.surfaceCacheCompress.default} by default): 0 never; 1 by writing the atlas through a view of another format, which WebGPU cannot do, so it compresses nothing there; 2 by writing the blocks to a buffer and copying them in, where the device has texture-compression-bc. A change empties the atlas.`,
  surfaceCacheCardCapturesPerFrame: `The cards an image captures at most, the nearest first (${R.surfaceCacheCardCapturesPerFrame.default} by default); the cards of twice as many meshes are added in an image. 0 stops every capture and every change of the cards. Doubled for a fast camera.`,
  surfaceCacheCardCaptureFactor: `The atlas's texels over the texels of the atlas the captured pages are drawn in (${R.surfaceCacheCardCaptureFactor.default} by default, from 1 to 1024), which is never smaller than one card of the greatest resolution.`,
  surfaceCacheRemovesPerFrame: `The meshes whose cards an image removes at most (${R.surfaceCacheRemovesPerFrame.default} by default).`,
  surfaceCacheCardCaptureRefreshFraction: `The share of an image's captures spent capturing pages again, the oldest first, to follow changes of the materials, from 0 to 1 (${R.surfaceCacheCardCaptureRefreshFraction.default} by default); 0 never captures a page again.`,
  surfaceCacheCardCaptureEnableInvalidation: `Whether a change of a mesh's surface can ask for its pages to be captured again at once (on by default).`,
  surfaceCacheAllowCardSharing: `Whether cards of one mesh with the same materials, facing the same way and of the same proportions copy the capture of one another (on by default). A change empties the atlas.`,
  surfaceCacheAllowCardDownsampleFromSelf: `Whether a card that lowers its resolution takes its texels from its own finer ones rather than capturing again (on by default). A change empties the atlas.`,
  surfaceCacheCaptureLodScaleFactor: `Divides the pixel error the cards' pages are drawn at: above 1 they are drawn from finer clusters, under 1 from coarser ones (${R.surfaceCacheCaptureLodScaleFactor.default} by default).`,
  surfaceCacheResampleLighting: `Whether the light a card held is carried into its pages when they are captured again or made anew, which the radiosity's accumulation over images needs (on by default).`,
  surfaceCacheDilationMode: `Whether a captured page widens its data by a texel, for a better coverage at the price of data that may be inexact: 0 never (default), 1 only the two-sided meshes (foliage), 2 all.`,
  surfaceCacheDiffuseColorBoost: `Raises the luminance of the albedo a read of the cards returns to the power of one over this number, never to one, from 1 to 4 (${R.surfaceCacheDiffuseColorBoost.default} by default, none): a dark surface then bounces more light.`,
  surfaceCacheFastCameraMode: `Whether the cards follow a camera that moves fast, at lower quality (off by default): the density of the cards falls to a fifth, their greatest resolution is halved and the captures an image may make are doubled.`,
}))()

/** What the settings of the feedback with which the rays ask for finer pages mean. */
const FEEDBACK_MEANINGS = /* @__PURE__ */ (() => ({
  surfaceCacheFeedback: `Whether the rays that read the cards tell which finer pages they would have read, so that those are captured (on by default); off, only the coarsest level of each card is in the atlas.`,
  surfaceCacheFeedbackTileSize: `The rays tell one page in each tile of this many pixels a side (${R.surfaceCacheFeedbackTileSize.default} by default, from 1 to 256, raised to a power of two); a finer page is not given up for room until no ray read it for as many images as a tile has pixels.`,
  surfaceCacheFeedbackMinPageHits: `The reports a page must exceed in an image to be requested (${R.surfaceCacheFeedbackMinPageHits.default} by default).`,
  surfaceCacheFeedbackUniqueElements: `The pages the rays tell at most in an image (${R.surfaceCacheFeedbackUniqueElements.default} by default, from 1 to 16384, raised to a power of two).`,
  surfaceCacheFeedbackResLevelBias: `Levels added to the one a ray's cone calls for when it tells which finer page it would have read (${R.surfaceCacheFeedbackResLevelBias.default} by default: half a level coarser); lower asks coarser pages, higher finer ones.`,
}))()

/** What the settings of how much of the cache's light an image updates mean. */
const UPDATE_MEANINGS = /* @__PURE__ */ (() => ({
  surfaceCacheDirectLightingUpdateFactor: `The atlas's texels over the texels of it an image lights directly (${R.surfaceCacheDirectLightingUpdateFactor.default} by default, from 1 to 1024), the pages left longest unlit first; divided by surfaceCacheLightingUpdateSpeed.`,
  surfaceCacheRadiosityUpdateFactor: `The atlas's texels over the texels of it an image gives indirect light (${R.surfaceCacheRadiosityUpdateFactor.default} by default, from 1 to 1024); divided by surfaceCacheLightingUpdateSpeed.`,
  surfaceCacheLightingUpdateSpeed: `A multiplier of how many texels an image lights, from 0.5 to 16 (${R.surfaceCacheLightingUpdateSpeed.default} by default): the update factors are divided by it.`,
  surfaceCacheLightingQuality: `The quality of the surface cache's lighting, from 0.5 to 6 (${R.surfaceCacheLightingQuality.default} by default): the side of a radiosity probe's hemisphere is multiplied by its square root, held to 16, and from 6 on the probes lie twice as close.`,
  surfaceCacheLightingForceFullUpdate: `Whether every image lights every texel of the surface cache, for debugging (off by default).`,
  surfaceCacheFreezeUpdateFrame: `Whether the update clock stops and the pages keep no record of being lit, so that every image updates the same subset of the surface cache, for debugging and profiling (${R.surfaceCacheFreezeUpdateFrame.default} by default: any other number freezes).`,
  surfaceCacheLightingMaxDistanceFromFrustumToPrioritize: `Centimetres: a page within this of the view's frustum is lit twice as soon (${R.surfaceCacheLightingMaxDistanceFromFrustumToPrioritize.default} by default); -1 never.`,
  surfaceCacheLightingFeedback: `Whether a page the rays read at its finest level in the last two images is lit at the greatest update speed, 4, whatever its distance and place in the view (on by default); it applies only where the scene has acceleration structures and surfaceCacheDirectLightingHardwareRayTracing is on.`,
}))()

/** What the settings of the direct light of the cache and its shadows mean. */
const DIRECT_LIGHT_MEANINGS = /* @__PURE__ */ (() => ({
  surfaceCacheDirectLighting: `Whether the lights light the surface cache directly (on by default); off, its direct light stays at nothing.`,
  surfaceCacheDirectLightingMaxLightsPerTile: `The most lights that light a tile of 8 × 8 texels, those of the most luminance at the tile's depth range (${R.surfaceCacheDirectLightingMaxLightsPerTile.default} by default, from 1 to 32, raised to a power of two).`,
  surfaceCacheDirectLightingGlobalSdfShadowRayBias: `Voxels of the global distance field the shadow ray of a light starts off a texel by (${R.surfaceCacheDirectLightingGlobalSdfShadowRayBias.default} by default), three times that where the surface grazes the light, and a lamp's ray stops short of it by the same.`,
  surfaceCacheDirectLightingCloudTransmittance: `Whether the lights wear the clouds' shade in the surface cache (on by default).`,
  surfaceCacheDirectLightingHardwareRayTracing: `Whether the shadows of the lights on the surface cache are traced through the scene's triangles (on by default), once for each texel whose light-function and cloud mask does not settle it; off, or where the scene has no acceleration structures, each light's shadow is one ray through the global distance field.`,
  surfaceCacheDirectLightingHardwareRayTracingShadowRayBias: `Centimetres a shadow ray of the traced direct light starts off its texel (${R.surfaceCacheDirectLightingHardwareRayTracingShadowRayBias.default} by default), three times that where the surface grazes the light.`,
  surfaceCacheDirectLightingHardwareRayTracingEndBias: `Centimetres a shadow ray of the traced direct light stops short of the lamp it goes to (${R.surfaceCacheDirectLightingHardwareRayTracingEndBias.default} by default), so that the proxy of the lamp's own mesh does not shadow it.`,
  surfaceCacheDirectLightingHardwareRayTracingAdaptiveShadowTracing: `Whether a tile that every texel saw a light at, or none did, at its last update traces one texel of each quad of four, a different one at each update, and gives the quad its answer (on by default); off, every texel traces.`,
  surfaceCacheDirectLightingHardwareRayTracingForceTwoSided: `Whether the shadow rays of the traced direct light take every primitive as two-sided, so that none of its front faces is culled (off by default: the front faces of a primitive that is not two-sided are culled); on is faster and may differ from the cards.`,
  surfaceCacheHardwareRayTracingMaxIterations: `The triangles a ray through the scene's triangles may test before it stops (${R.surfaceCacheHardwareRayTracingMaxIterations.default} by default, at least 1); a shadow ray that stopped counts as blocked, a radiosity ray that stopped with no hit is a black hit.`,
  surfaceCacheHardwareRayTracingAvoidSelfIntersections: `How a ray through the scene's triangles avoids the geometry it starts on (${R.surfaceCacheHardwareRayTracingAvoidSelfIntersections.default} by default, from 0 to 3): 0 culls the back faces of the primitives that are not two-sided, the fastest and with more leaking; 1 traces again from past a first hit that is such a back face nearer than surfaceCacheHardwareRayTracingSkipBackFaceHitDistance or a two-sided hit nearer than surfaceCacheHardwareRayTracingSkipTwoSidedHitDistance; 2 passes those hits as the ray travels; 3 takes 2, the traversal being inline. It applies to the radiosity's rays.`,
  surfaceCacheHardwareRayTracingSkipBackFaceHitDistance: `Centimetres under which a ray that avoids self-intersections passes the back face of a primitive that is not two-sided (${R.surfaceCacheHardwareRayTracingSkipBackFaceHitDistance.default} by default), for triangles that do not match the cards' surface.`,
  surfaceCacheHardwareRayTracingSkipTwoSidedHitDistance: `Centimetres under which a ray that avoids self-intersections passes a hit on a two-sided primitive (${R.surfaceCacheHardwareRayTracingSkipTwoSidedHitDistance.default} by default), which the back-face rule cannot, as for foliage.`,
  surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache: `Centimetres of a ray's hit distance from which the cards are read at the hit (${R.surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache.default} by default); nearer, the hit brings no light, so that a texel does not light itself.`,
  surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias: `Centimetres a texel of a card may lie from the point a ray hit and still be read for it (${R.surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias.default} by default): more mends triangles that differ from the cards' surface, and leaks more.`,
}))()

/** What the settings of the indirect light mean. */
const RADIOSITY_MEANINGS = /* @__PURE__ */ (() => ({
  surfaceCacheRadiosity: `Whether the surface cache gathers its own light from itself, the multiple bounces of diffuse light (on by default).`,
  surfaceCacheRadiosityProbeSpacing: `Texels between two radiosity probes (${R.surfaceCacheRadiosityProbeSpacing.default} by default, from 1 to 8, raised to a power of two).`,
  surfaceCacheRadiosityHemisphereProbeResolution: `Rays along a side of a radiosity probe's hemisphere (${R.surfaceCacheRadiosityHemisphereProbeResolution.default} by default, from 1 to 16); a probe traces its square.`,
  surfaceCacheRadiositySpatialFilterProbes: `Whether a radiosity probe's rays are filtered with its neighbours' (on by default): less noise, more leaking.`,
  surfaceCacheRadiositySpatialFilterProbesKernelSize: `The neighbours that filter a probe: 0 none, 1 four, 2 thirteen (${R.surfaceCacheRadiositySpatialFilterProbesKernelSize.default} by default); larger kernels leak more.`,
  surfaceCacheRadiosityProbePlaneWeighting: `Whether a probe off the texel's plane is left out when probes are filtered and interpolated, which stops leaking (on by default).`,
  surfaceCacheRadiosityProbePlaneWeightingDepthScale: `How far off its plane a probe may lie and still count (${R.surfaceCacheRadiosityProbePlaneWeightingDepthScale.default} by default); a higher value leaks more.`,
  surfaceCacheRadiosityMaxRayIntensity: `The most a radiosity ray brings, in times the exposure (${R.surfaceCacheRadiosityMaxRayIntensity.default} by default): it spares the surface cache small bright lights, at the price of some energy.`,
  surfaceCacheRadiosityDistanceFieldSurfaceBias: `Centimetres along a radiosity ray before it can hit anything (${R.surfaceCacheRadiosityDistanceFieldSurfaceBias.default} by default, from 0 to 1000).`,
  surfaceCacheRadiosityDistanceFieldSurfaceSlopeBias: `Centimetres a radiosity ray is moved off its texel along the normal and along the ray (${R.surfaceCacheRadiosityDistanceFieldSurfaceSlopeBias.default} by default, from 0 to 1000).`,
  surfaceCacheRadiosityHardwareRayTracing: `Whether the radiosity's rays go through the scene's triangles (on by default); off, or where the scene has no acceleration structures, they are marched through the global distance field.`,
  surfaceCacheRadiosityHardwareRayTracingBias: `Centimetres along a radiosity ray before it can hit a triangle (${R.surfaceCacheRadiosityHardwareRayTracingBias.default} by default), for triangles that differ from the cards' surface.`,
  surfaceCacheRadiosityHardwareRayTracingNormalBias: `Centimetres a radiosity ray through the scene's triangles is moved off its texel along the normal (${R.surfaceCacheRadiosityHardwareRayTracingNormalBias.default} by default).`,
  surfaceCacheRadiosityTemporal: `Whether radiosity is blended over the images (on by default): more quality, and the light follows a change later.`,
  surfaceCacheRadiosityTemporalMaxFramesAccumulated: `The images radiosity blends, and the length of the probes' jitter pattern (${R.surfaceCacheRadiosityTemporalMaxFramesAccumulated.default} by default, from 1 to 255): fewer follow a change of light faster, and flicker more.`,
  surfaceCacheRadiosityTemporalFixedJitterIndex: `From 0 on, the probes' jitter is this index held, for debugging (${R.surfaceCacheRadiosityTemporalFixedJitterIndex.default} by default: it moves).`,
}))()

/** What each setting of the surface cache means (`../contracts/surfaceCacheOptions.ts`); they apply
 *  where the scene has meshes with cards. The defaults and the ranges are the schema's own. */
// A spread at the top level is not pure to a bundler: marked so, a bundle that never reads the meanings drops them.
export const SURFACE_CACHE_MEANINGS: Readonly<Record<SurfaceCacheField, string>> =
  /* @__PURE__ */ (() => ({
    ...ATLAS_MEANINGS,
    ...CAPTURE_MEANINGS,
    ...FEEDBACK_MEANINGS,
    ...UPDATE_MEANINGS,
    ...DIRECT_LIGHT_MEANINGS,
    ...RADIOSITY_MEANINGS,
  }))()
