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
  surfaceCacheCardFixedDebugResolution: `From 1 on, every card is given this many texels along its longer side, before the greatest resolution holds it, whatever its size and its distance, for debugging (${R.surfaceCacheCardFixedDebugResolution.default} by default: the resolution follows the distance).`,
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
  surfaceCacheDilationMode: `Whether a captured page widens its data by a texel, for a better coverage at the price of data that may be inexact: 0 never (default), 1 only the cards made from the bounds of a skinned mesh of which a quarter of the triangles at least are two-sided (the scene has no such cards, so 1 widens no page), 2 all.`,
  surfaceCacheDiffuseColorBoost: `Raises the luminance of the albedo a read of the cards returns to the power of one over this number, never to one, from 1 to 4 (${R.surfaceCacheDiffuseColorBoost.default} by default, none): a dark surface then bounces more light.`,
  surfaceCacheFastCameraMode: `Whether the cards follow a camera that moves fast, at lower quality (off by default): the density of the cards falls to a fifth, their greatest resolution is halved and the captures an image may make are doubled.`,
  surfaceCacheRecaptureEveryFrame: `Whether the whole surface cache is emptied every image and the cap on the captures of an image lifted, so that every card is captured again each image, for debugging (off by default; it is slow).`,
  surfaceCacheReset: `Whether the atlas and every captured card are emptied, once each time this is turned on, for debugging (off by default).`,
  surfaceCacheResetEveryNthFrame: `Empties the atlas and every captured card every this many images, for debugging (${R.surfaceCacheResetEveryNthFrame.default} by default: never).`,
  surfaceCacheForceEvictHiResPages: `Whether every optional page, those the feedback asked for, leaves the atlas, once each time this is turned on, for debugging (off by default); the coarsest level of each card stays.`,
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
  surfaceCacheViewOriginDistanceThreshold: `Centimetres: a view drawn beside the main one that has drawn is a streaming view, whose eye the cards are kept for too (the nearest eye first) when it lies this far (${R.surfaceCacheViewOriginDistanceThreshold.default} by default, a metre) or more from the eyes already held; at most two eyes are held.`,
  surfaceCacheUpdateViewOrigin: `Whether the eye the cards are kept for follows the camera (on by default); off, it stays where the camera was when it turned off, for debugging.`,
  surfaceCacheFreeze: `Whether the surface cache is frozen, for debugging (off by default): no card is captured, no old page leaves the atlas, neither update lights a tile, the rays tell no feedback, and the update clock stops (as surfaceCacheFreezeUpdateFrame does); what the cache held is kept as it is.`,
  surfaceCacheFreezeUpdateFrame: `Whether the update clock stops and the pages keep no record of being lit, so that every image updates the same subset of the surface cache, for debugging and profiling (${R.surfaceCacheFreezeUpdateFrame.default} by default: any other number freezes).`,
  surfaceCacheLightingMaxDistanceFromFrustumToPrioritize: `Centimetres: a page within this of the view's frustum is lit twice as soon (${R.surfaceCacheLightingMaxDistanceFromFrustumToPrioritize.default} by default); -1 never.`,
  surfaceCacheLightingFeedback: `Whether a page the rays read at its finest level in the last two images is lit at the greatest update speed, 4, whatever its distance and place in the view (on by default); it applies only where the scene has acceleration structures.`,
  surfaceCachePropagateGlobalLightingChange: `Whether a big change of the lighting is detected and followed at once (on by default): where the colour of the first directional light that lights the indirect light, or of the sky light, grows or shrinks by more than four times from one image to the next, every world probe is given back and the cells the image reads take new ones, all traced in that image at no budget, and the screen probes drop their history for that image; off, the probes and the screen probes follow it at their budget alone.`,
}))()

/** What the settings of the direct light of the cache and its shadows mean. */
const DIRECT_LIGHT_MEANINGS = /* @__PURE__ */ (() => ({
  surfaceCacheDirectLighting: `Whether the lights light the surface cache directly (on by default); off, its direct light stays at nothing.`,
  surfaceCacheDirectLightingMaxLightsPerTile: `The most lights that light a tile of 8 × 8 texels, those of the most luminance at the tile's depth range (${R.surfaceCacheDirectLightingMaxLightsPerTile.default} by default, from 1 to 32, raised to a power of two).`,
  surfaceCacheDirectLightingCullToTileDepthRange: `Whether a tile of 8 × 8 texels bounds its box by the depths of the texels that hold a surface when the lights that reach it are culled (on by default); off, the box spans the card's whole depth, so more lights reach it and the most luminous are kept among them.`,
  surfaceCacheDirectLightingBatchShadows: `How the light tiles — a tile of 8 × 8 texels and a light that reaches it — are gathered before the shadow masks are made over them, from 0 to 2 (${R.surfaceCacheDirectLightingBatchShadows.default} by default): at 2 the point lights', the spots' and the rectangles' tiles are each gathered by their type, one run for all the lights of a type; at 0 and 1 each light's tiles are a run of their own. A sun's tiles and those of a light whose light function the atlas holds no slot of are a run of their own whatever it is. The image is the same.`,
  surfaceCacheDirectLightingGlobalSdfShadowRayBias: `Voxels of the global distance field the shadow ray of a light starts off a texel by (${R.surfaceCacheDirectLightingGlobalSdfShadowRayBias.default} by default), three times that where the surface grazes the light, and a lamp's ray stops short of it by the same.`,
  surfaceCacheDirectLightingOffscreenShadowingTraceMeshSdfs: `Whether the shadow of a sun on the cards, where the scene has no acceleration structures, is traced through the distance fields of the meshes the cards' volume reaches rather than through the lower resolution global field (on by default).`,
  surfaceCacheDirectLightingMeshSdfShadowRayBias: `Centimetres the shadow ray of a sun traced through the meshes' fields starts off a texel by (${R.surfaceCacheDirectLightingMeshSdfShadowRayBias.default} by default), three times that where the surface grazes the light.`,
  surfaceCacheDirectLightingCloudTransmittance: `Whether the lights wear the clouds' shade in the surface cache (on by default).`,
  surfaceCacheDirectLightingHardwareRayTracing: `Whether the shadows of the lights on the surface cache are traced through the scene's triangles (on by default), once for each texel whose light-function and cloud mask does not settle it; off, or where the scene has no acceleration structures, each light's shadow is one ray through the global distance field.`,
  surfaceCacheDirectLightingHardwareRayTracingShadowRayBias: `Centimetres a shadow ray of the traced direct light starts off its texel (${R.surfaceCacheDirectLightingHardwareRayTracingShadowRayBias.default} by default), three times that where the surface grazes the light.`,
  surfaceCacheDirectLightingHardwareRayTracingEndBias: `Centimetres a shadow ray of the traced direct light stops short of the lamp it goes to (${R.surfaceCacheDirectLightingHardwareRayTracingEndBias.default} by default), so that the proxy of the lamp's own mesh does not shadow it.`,
  surfaceCacheDirectLightingHardwareRayTracingAdaptiveShadowTracing: `Whether a tile that every texel saw a light at, or none did, at its last update traces one texel of each quad of four, a different one at each update, and gives the quad its answer (on by default); off, every texel traces.`,
  surfaceCacheDirectLightingHardwareRayTracingForceTwoSided: `Whether the shadow rays of the traced direct light take every primitive as two-sided, so that none of its front faces is culled (off by default: the front faces of a primitive that is not two-sided are culled); on is faster and may differ from the cards.`,
  surfaceCacheDirectLightingStochastic: `Whether, where the shadows of the cache's direct light are traced through the scene's triangles, each texel is lit by a few lights picked at random among those of its tile and only those are traced, the result blended over the images (off by default; experimental).`,
  surfaceCacheDirectLightingStochasticTemporal: `Whether the stochastic direct light is blended over the images (on by default).`,
  surfaceCacheDirectLightingStochasticTemporalMaxFramesAccumulated: `The images the stochastic direct light is blended over at most (${R.surfaceCacheDirectLightingStochasticTemporalMaxFramesAccumulated.default} by default): fewer ghost less and are noisier.`,
  surfaceCacheDirectLightingStochasticTemporalNeighborhoodClampScale: `How many standard deviations of the 5 × 5 neighbours of a texel its history may be from their mean (${R.surfaceCacheDirectLightingStochasticTemporalNeighborhoodClampScale.default} by default): more ghosts more and blends more smoothly.`,
  surfaceCacheDirectLightingStochasticSamplePerTexel: `The lights picked for each texel by the stochastic direct light (${R.surfaceCacheDirectLightingStochasticSamplePerTexel.default} by default, from 1 to 4; 3 is taken as 4).`,
  surfaceCacheDirectLightingStochasticMinWeight: `The weight under which the stochastic direct light never picks a light for a texel (${R.surfaceCacheDirectLightingStochasticMinWeight.default} by default), the logarithm of one plus the luminance the light gives it.`,
  surfaceCacheHardwareRayTracingMaxIterations: `The triangles a ray through the scene's triangles may test before it stops (${R.surfaceCacheHardwareRayTracingMaxIterations.default} by default, at least 1); a shadow ray that stopped counts as blocked, a radiosity ray that stopped is a black hit where it had met nothing, and a hit that brings no light where it had met a surface.`,
  surfaceCacheHardwareRayTracingAvoidSelfIntersections: `How a ray through the scene's triangles avoids the geometry it starts on (${R.surfaceCacheHardwareRayTracingAvoidSelfIntersections.default} by default, from 0 to 3): 0 culls the back faces of the primitives that are not two-sided, the fastest and with more leaking; 1 traces again from past a first hit that is such a back face nearer than surfaceCacheHardwareRayTracingSkipBackFaceHitDistance or a two-sided hit nearer than surfaceCacheHardwareRayTracingSkipTwoSidedHitDistance; 2 passes those hits as the ray travels; 3 takes 2, the traversal being inline. It applies to the radiosity's rays.`,
  surfaceCacheHardwareRayTracingSkipBackFaceHitDistance: `Centimetres under which a ray that avoids self-intersections passes the back face of a primitive that is not two-sided (${R.surfaceCacheHardwareRayTracingSkipBackFaceHitDistance.default} by default), for triangles that do not match the cards' surface.`,
  surfaceCacheHardwareRayTracingMeshSectionVisibilityTest: `Whether the rays through the scene's triangles test the visibility of the mesh sections (${R.surfaceCacheHardwareRayTracingMeshSectionVisibilityTest.default} by default): on, the translucent primitives are left out of every such ray — the screen probes', the radiance cache's, the reflections', the shadows' and the radiosity's — whatever else their mesh holds, at the cost of an extra test at each intersection; off, only a mesh all of whose primitives are translucent is left out, and the translucent primitives of a mesh that has an opaque one are met as opaque ones. A mesh all of whose primitives are translucent is left out of these rays whatever this option is.`,
  surfaceCacheHardwareRayTracingSkipTwoSidedHitDistance: `Centimetres under which a ray that avoids self-intersections passes a hit on a two-sided primitive (${R.surfaceCacheHardwareRayTracingSkipTwoSidedHitDistance.default} by default), which the back-face rule cannot, as for foliage.`,
  surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache: `Centimetres of a ray's hit distance from which the cards are read at the hit (${R.surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache.default} by default); nearer, the hit brings no light, so that a texel does not light itself.`,
  surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias: `Centimetres a texel of a card may lie from the point a ray hit and still be read for it (${R.surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias.default} by default): more mends triangles that differ from the cards' surface, and leaks more.`,
}))()

/** What the settings of the placements the rays through the scene's triangles can meet mean. */
const RAY_CULLING_MEANINGS = /* @__PURE__ */ (() => ({
  rayTracingCulling: `Which placements of the scene an image leaves out of the rays that go through the scene's triangles (${R.rayTracingCulling.default} by default, from 0 to 3): 0 none; 1 the objects behind the camera that are both far (rayTracingCullingRadius) and small (rayTracingCullingAngle); 2 all objects that are both far and small; 3 all objects that are far or small. It also sets where the screen's far trace of a reflection begins: at rayTracingCullingRadius, nowhere at 0.`,
  rayTracingCullingRadius: `Centimetres from the eye past which an object is far for the culling (${R.rayTracingCullingRadius.default} by default), the distance taken to its box or its sphere (rayTracingCullingUseDistanceToBox); it is also where the screen's far trace of a reflection begins; used only with rayTracingCulling above 0.`,
  rayTracingCullingAngle: `Degrees (${R.rayTracingCullingAngle.default} by default, held under 89.99) under which the sphere around an object subtends an angle small enough to cull it, with rayTracingCulling above 0.`,
  rayTracingCullingUseMinDrawDistance: `Whether an object nearer to the eye than its least draw distance is culled (on by default); used only with rayTracingCulling above 0.`,
  rayTracingCullingUseDistanceToBox: `Whether the distance to an object is taken to its box (on by default) rather than to its bounding sphere; used only with rayTracingCulling above 0.`,
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
  surfaceCacheRadiosityProbeOcclusion: `Whether a radiosity probe is left out, when probes are filtered and interpolated, where the surface its own rays met along the line to the texel lies nearer than the texel, which reduces leaking (off by default; it needs the radiosity's rays cast through the scene's triangles, and the scene without acceleration structures has none).`,
  surfaceCacheRadiosityProbeOcclusionStrength: `How hard the probe occlusion cuts a probe off (${R.surfaceCacheRadiosityProbeOcclusionStrength.default} by default), held from 0 to 1: 0 none, 1 attempts to stop all leaking but darkens a texel with its own surface, in between a trade-off; used only with surfaceCacheRadiosityProbeOcclusion.`,
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
    ...RAY_CULLING_MEANINGS,
    ...RADIOSITY_MEANINGS,
  }))()
