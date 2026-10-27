import {
  ANY_NUMBER,
  INT32_RANGE,
  countSetting as count,
  flagSetting as flag,
  integerSetting as integer,
  nonNegativeSetting as nonNegative,
  numberSetting as number,
  positiveSetting as positive,
} from './settingRules.ts'

/** The most rays a light traces. */
export const SHADOW_RAY_COUNT_MAX = 16

/** The clipmaps, the coarse pages, the marking of pages and the first person clipmap. */
const CLIPMAP_AND_MARKING_RULES = /* @__PURE__ */ (() =>
  [
    integer('shadowClipmapFirstLevel', 6, [0, 30]),
    integer('shadowClipmapLastLevel', 22, [0, 30]),
    flag('shadowFirstPersonClipmap', true),
    integer('shadowFirstPersonClipmapFirstLevel', 8, [0, 30]),
    integer('shadowFirstPersonClipmapLastLevel', 18, [0, 30]),
    number('shadowFirstPersonPixelRequestBias', 2, [-16, 16]),
    integer('shadowFirstPersonRequestMinLevelClamp', 8, [0, 30]),
    integer('shadowClipmapFirstCoarseLevel', 15, [0, 30]),
    integer('shadowClipmapLastCoarseLevel', 18, [0, 30]),
    integer('shadowClipmapMinCameraViewportWidth', 0, [0, 16384]),
    positive('shadowClipmapZRangeScale', 1000),
    flag('shadowClipmapWpoDisableDistance', true),
    integer('shadowClipmapWpoDisableDistanceLodBias', 3, [0, 30]),
    flag('shadowClipmapWpoDisableDistanceInvalidateOnScaleChange', false),
    flag('shadowClipmapCullDynamicTightly', true),
    flag('shadowForceInvalidateDirectional', false),
    flag('shadowUseReceiverMaskDirectional', true),
    flag('shadowUseReceiverMaskLocal', false),
    integer('shadowMarkCoarsePagesDirectional', 2, [0, 2]),
    integer('shadowMarkCoarsePagesLocal', 1, [0, 2]),
    nonNegative('shadowCoarsePagePixelThresholdStatic', 1),
    nonNegative('shadowCoarsePagePixelThresholdDynamic', 4),
    integer('shadowMarkPixelPagesMipModeLocal', 0, [0, 2]),
    nonNegative('shadowPageDilationBorderSizeDirectional', 0.05),
    nonNegative('shadowPageDilationBorderSizeLocal', 0.05),
    flag('shadowMarkPixelPages', true),
    flag('shadowMarkPagesUseFroxels', false),
    flag('shadowCullBackfacingPixels', true),
    integer('shadowPageMarkingPixelStrideX', 2, [1, 128]),
    integer('shadowPageMarkingPixelStrideY', 2, [1, 128]),
  ] as const)()

/** The biases, the screen rays, the cache of the pages and the dynamic resolution. */
const BIAS_AND_CACHE_RULES = /* @__PURE__ */ (() =>
  [
    nonNegative('shadowRasterIndirectionMultiplier', 1.5),
    nonNegative('shadowNormalBias', 0.5),
    nonNegative('shadowMaxDofResolutionBias', 1),
    nonNegative('shadowScreenRayLength', 0.015),
    nonNegative('shadowSubsurfaceMinSourceAngle', 5),
    integer('shadowOnePassProjectionMaxLightsPerPixel', 16, [1, 32]),
    flag('shadowAllowScreenOverflowMessages', true),
    flag('shadowCache', true),
    flag('shadowCacheAllocateViaLru', true),
    flag('shadowCacheDeformableMeshesInvalidate', true),
    integer('shadowForceInvalidateLocal', 0, [0, 2]),
    flag('shadowForceFullPageClears', false),
    flag('shadowCacheDebugSkipDynamicPageInvalidation', false),
    integer('shadowDynamicDeallocationMode', 0, [0, 2]),
    flag('shadowCacheInvalidateUseHzb', true),
    integer('shadowDeferredInvalidationBudget', -1, [-1, INT32_RANGE[1]]),
    flag('shadowInvalidateOnLodDelta', false),
    count('shadowCacheFramesStaticThreshold', 100, 0),
    count('shadowCacheMaxPageAgeSinceLastRequest', 1000, 0),
    count('shadowCacheMaxLightAgeSinceLastRequest', 10, 0),
    nonNegative('shadowDynamicResolutionMaxResolutionLodBias', 2),
    nonNegative('shadowDynamicResolutionMaxPagePoolLoadFactor', 0.85),
    nonNegative('shadowDynamicResolutionTimeBudgetMs', 0),
    nonNegative('shadowDynamicResolutionLoadBudget', 0),
    number('shadowDynamicResolutionPerVsmBiasHistoryWeight', 0.9, [0, 1]),
    nonNegative('shadowDynamicResolutionMaxComputeResolutionLodBiasDirectional', 99999),
    nonNegative('shadowDynamicResolutionMaxComputeResolutionLodBiasLocal', 99999),
  ] as const)()

/** The soft shadow rays, and the resolution biases. */
const FILTERING_AND_LOD_RULES = /* @__PURE__ */ (() =>
  [
    integer('shadowSmrtAdaptiveRayCount', 1, [0, SHADOW_RAY_COUNT_MAX]),
    positive('shadowSmrtMaxRayAngleFromLight', 0.03),
    nonNegative('shadowSmrtExtrapolateMaxSlopeLocal', 0.05),
    nonNegative('shadowSmrtExtrapolateMaxSlopeDirectional', 5),
    nonNegative('shadowSmrtTexelDitherScaleLocal', 2),
    nonNegative('shadowSmrtTexelDitherScaleDirectional', 2),
    nonNegative('shadowSmrtMaxSlopeBiasLocal', 50),
    positive('shadowSmrtRayLengthScaleDirectional', 1.5),
    number('shadowResolutionLodBiasDirectional', -1.5, [-16, 16]),
    number('shadowResolutionLodBiasDirectionalMoving', -1.5, [-16, 16]),
    number('shadowResolutionLodBiasLocal', 0, [-16, 16]),
    number('shadowResolutionLodBiasLocalMoving', 1, [-16, 16]),
    count('shadowLightActiveFrameCount', 10, 1),
  ] as const)()

/** The rays of the soft shadows, the page pool, the distant lights, the resolutions and the translucent surfaces. */
const RAY_AND_RESOLUTION_RULES = /* @__PURE__ */ (() =>
  [
    integer('shadowRayCountDirectional', 8, [0, SHADOW_RAY_COUNT_MAX]),
    integer('shadowSamplesPerRayDirectional', 4, [0, 64]),
    integer('shadowRayCountLocal', 8, [0, SHADOW_RAY_COUNT_MAX]),
    integer('shadowSamplesPerRayLocal', 4, [0, 64]),
    count('shadowMaxPhysicalPages', 4096, 1),
    integer('shadowDistantLightMode', 1, [0, 2]),
    integer('shadowMaxDistantUpdatePerFrame', 1, [-1, INT32_RANGE[1]]),
    flag('shadowPointLightShadows', true),
    flag('shadowPointLightCubemaps', true),
    flag('shadowResolutionScaleZeroDisables', true),
    integer('shadowMaxResolution', 2048, [1, 8192]),
    count('shadowFadeResolution', 64, 0),
    count('shadowMinResolution', 32, 0),
    number('shadowFadeExponent', 0.25, ANY_NUMBER),
    flag('shadowFadeUsesResolutionScale', true),
    nonNegative('shadowTexelsPerPixelPoint', 1.27324),
    nonNegative('shadowTexelsPerPixelSpot', 2.54648),
    nonNegative('shadowTexelsPerPixelRect', 1.27324),
    integer('shadowQuality', 5, [0, 5]),
    integer('shadowTranslucentQuality', 0, [0, 1]),
    flag('shadowTranslucentLocalLights', false),
    flag('translucentRectLights', false),
  ] as const)()

/**
 * THE SHADOW MAPS' OWN SETTINGS (`shadowOptions.ts` lists them with the sun's): each a setting with
 * the reference's number and the rows of its quality levels — `smooth` the first scalability level,
 * `balanced` the second, `fine` the third, `max` the fourth, which writes nothing (so `max` reads
 * every setting at its default), `cinematic` the fifth. Where the
 * reference's own default is another number than the fourth row's, the setting's default is the row's.
 *
 * | setting | default | smooth balanced fine cinematic |
 * |---|---|---|
 * | `shadowClipmapFirstLevel` | 6 | |
 * | `shadowClipmapLastLevel` | 22 | |
 * | `shadowClipmapFirstCoarseLevel` | 15 | |
 * | `shadowClipmapLastCoarseLevel` | 18 | |
 * | `shadowClipmapMinCameraViewportWidth` | 0 | |
 * | `shadowClipmapZRangeScale` | 1000 | |
 * | `shadowClipmapWpoDisableDistance` | true | |
 * | `shadowClipmapWpoDisableDistanceLodBias` | 3 | |
 * | `shadowClipmapWpoDisableDistanceInvalidateOnScaleChange` | false | |
 * | `shadowClipmapCullDynamicTightly` | true | |
 * | `shadowForceInvalidateDirectional` | false | |
 * | `shadowUseReceiverMaskDirectional` | true | |
 * | `shadowUseReceiverMaskLocal` | false | |
 * | `shadowFirstPersonClipmap` | true | |
 * | `shadowFirstPersonClipmapFirstLevel` | 8 | |
 * | `shadowFirstPersonClipmapLastLevel` | 18 | |
 * | `shadowFirstPersonPixelRequestBias` | 2 | |
 * | `shadowFirstPersonRequestMinLevelClamp` | 8 | |
 * | `shadowMarkCoarsePagesDirectional` | 2 | |
 * | `shadowMarkCoarsePagesLocal` | 1 | 2 2 2 1 |
 * | `shadowCoarsePagePixelThresholdStatic` | 1 | |
 * | `shadowCoarsePagePixelThresholdDynamic` | 4 | |
 * | `shadowMarkPixelPagesMipModeLocal` | 0 | |
 * | `shadowPageDilationBorderSizeDirectional` | 0.05 | |
 * | `shadowPageDilationBorderSizeLocal` | 0.05 | |
 * | `shadowMarkPixelPages` | true | |
 * | `shadowMarkPagesUseFroxels` | false | |
 * | `shadowCullBackfacingPixels` | true | |
 * | `shadowPageMarkingPixelStrideX` | 2 | |
 * | `shadowPageMarkingPixelStrideY` | 2 | |
 * | `shadowRasterIndirectionMultiplier` | 1.5 | |
 * | `shadowNormalBias` | 0.5 | |
 * | `shadowMaxDofResolutionBias` | 1 | |
 * | `shadowScreenRayLength` | 0.015 | |
 * | `shadowSubsurfaceMinSourceAngle` | 5 | |
 * | `shadowOnePassProjectionMaxLightsPerPixel` | 16 | |
 * | `shadowAllowScreenOverflowMessages` | true | |
 * | `shadowCache` | true | |
 * | `shadowCacheAllocateViaLru` | true | |
 * | `shadowCacheDeformableMeshesInvalidate` | true | |
 * | `shadowForceInvalidateLocal` | 0 | |
 * | `shadowForceFullPageClears` | false | |
 * | `shadowCacheDebugSkipDynamicPageInvalidation` | false | |
 * | `shadowDynamicDeallocationMode` | 0 | |
 * | `shadowCacheInvalidateUseHzb` | true | |
 * | `shadowDeferredInvalidationBudget` | -1 | |
 * | `shadowInvalidateOnLodDelta` | false | |
 * | `shadowCacheFramesStaticThreshold` | 100 | |
 * | `shadowCacheMaxPageAgeSinceLastRequest` | 1000 | |
 * | `shadowCacheMaxLightAgeSinceLastRequest` | 10 | |
 * | `shadowDynamicResolutionMaxResolutionLodBias` | 2 | |
 * | `shadowDynamicResolutionMaxPagePoolLoadFactor` | 0.85 | |
 * | `shadowDynamicResolutionTimeBudgetMs` | 0 | |
 * | `shadowDynamicResolutionLoadBudget` | 0 | |
 * | `shadowDynamicResolutionPerVsmBiasHistoryWeight` | 0.9 | |
 * | `shadowDynamicResolutionMaxComputeResolutionLodBiasDirectional` | 99999 | |
 * | `shadowDynamicResolutionMaxComputeResolutionLodBiasLocal` | 99999 | |
 * | `shadowSmrtAdaptiveRayCount` | 1 | |
 * | `shadowSmrtMaxRayAngleFromLight` | 0.03 | |
 * | `shadowSmrtExtrapolateMaxSlopeLocal` | 0.05 | |
 * | `shadowSmrtExtrapolateMaxSlopeDirectional` | 5 | |
 * | `shadowSmrtTexelDitherScaleLocal` | 2 | |
 * | `shadowSmrtTexelDitherScaleDirectional` | 2 | |
 * | `shadowSmrtMaxSlopeBiasLocal` | 50 | |
 * | `shadowSmrtRayLengthScaleDirectional` | 1.5 | |
 * | `shadowResolutionLodBiasDirectional` | -1.5 | 0 0 0 -1.5 |
 * | `shadowResolutionLodBiasDirectionalMoving` | -1.5 | 0 0 0 -1.5 |
 * | `shadowResolutionLodBiasLocal` | 0 | 1 1 0 0 |
 * | `shadowResolutionLodBiasLocalMoving` | 1 | 2 2 1 0 |
 * | `shadowLightActiveFrameCount` | 10 | |
 * | `shadowRayCountDirectional` | 8 | 0 4 8 16 |
 * | `shadowSamplesPerRayDirectional` | 4 | 2 2 4 8 |
 * | `shadowRayCountLocal` | 8 | 0 4 4 16 |
 * | `shadowSamplesPerRayLocal` | 4 | 2 2 4 8 |
 * | `shadowMaxPhysicalPages` | 4096 | 512 512 2048 8192 |
 * | `shadowDistantLightMode` | 1 | |
 * | `shadowMaxDistantUpdatePerFrame` | 1 | |
 * | `shadowPointLightShadows` | true | |
 * | `shadowPointLightCubemaps` | true | |
 * | `shadowResolutionScaleZeroDisables` | true | |
 * | `shadowMaxResolution` | 2048 | 512 1024 1024 4096 |
 * | `shadowFadeResolution` | 64 | |
 * | `shadowMinResolution` | 32 | |
 * | `shadowFadeExponent` | 0.25 | |
 * | `shadowFadeUsesResolutionScale` | true | |
 * | `shadowTexelsPerPixelPoint` | 1.27324 | |
 * | `shadowTexelsPerPixelSpot` | 2.54648 | |
 * | `shadowTexelsPerPixelRect` | 1.27324 | |
 * | `shadowQuality` | 5 | 0 3 5 5 |
 * | `shadowTranslucentQuality` | 0 | |
 * | `shadowTranslucentLocalLights` | false | |
 * | `translucentRectLights` | false | |
 *
 * `shadowCoarsePagePixelThresholdStatic` and `shadowCoarsePagePixelThresholdDynamic` are the pixel
 * footprints, in the map's finest level, under which an object is drawn into the fine pages alone
 * and not into the coarse ones, the object judged whole (its placement's bounds), by the layer it
 * is cached in: static (1) or dynamic (4, the reference's value for cluster geometry).
 *
 * `shadowClipmapMinCameraViewportWidth` is the narrowest view width, in pixels, the sun's clipmap resolution is
 * judged at: 0, the default, reads the width the view is drawn at alone; raise it so that a lowered render
 * resolution does not coarsen the sun's shadows.
 *
 * `shadowMarkPixelPagesMipModeLocal` limits the mips a local light's pixels mark: 0 all eight, 1 the even ones, 2 the
 * odd ones (fewer duplicated instances, a harsher fall-off between mips).
 *
 * `shadowMarkPixelPages` marks the pages the view's pixels ask; off, only the coarse pages are marked, the pixels' and
 * the froxels' marks (the translucent front layer's and the water's surface included) all skipped, for finding what the
 * marking costs or whether it is the cause of an artefact.
 *
 * `shadowMarkPagesUseFroxels` marks the pages from the froxels of the depth (screen tiles of 8 pixels by depth
 * slices as deep as they are wide, one per slice a tile holds) in place of pixel by pixel: fewer marks for the
 * same pages, no per-pixel back-face cull and no translucent front-layer marks.
 *
 * `shadowPageDilationBorderSizeDirectional` and `...Local` are the share of a page, from its border, within
 * which a marked point also marks the neighbouring page; `shadowCullBackfacingPixels` leaves the pixels that face
 * away from a light unmarked (subsurface surfaces excepted); `shadowPageMarkingPixelStrideX` and `...Y` are the
 * pixels the marking steps over on each axis; `shadowNormalBias` is the receiver's offset along its normal,
 * in thousandths of its distance to the eye; `shadowScreenRayLength` the length of the screen-space ray before
 * the map's, as a share of the view's height at the pixel's depth.
 *
 * `shadowFirstPersonClipmap` gives each sun a second clipmap that only the objects standing for a first-person one
 * (`Object3D.firstPersonWorldSpaceRepresentation`) are drawn into, from level `shadowFirstPersonClipmapFirstLevel`
 * to `shadowFirstPersonClipmapLastLevel`, redrawn every frame; a pixel of a first-person object (`Object3D.firstPerson`)
 * is not shadowed by it, every other pixel is, by the shadow of the world-space body. The pixels of first-person
 * objects ask the regular clipmap for a resolution `shadowFirstPersonPixelRequestBias` levels coarser, and never finer
 * than level `shadowFirstPersonRequestMinLevelClamp` (a negative bias asks no page for them at all).
 * `shadowOnePassProjectionMaxLightsPerPixel` is the most local lights a pixel keeps the shadow of in its mask, 4 bits a
 * light, from 1 to 32 (a mask of 32 bits a pixel up to 8 lights, 64 up to 16, 128 up to 32); a light of the pixel's cell
 * past them is read from one sample of its own map by the lighting.
 * `shadowAllowScreenOverflowMessages` lets the shadow stats (`shadowVsmOverflowFlags`) report the overflows seen in the
 * last 10 seconds, for a host to show: the one-pass projection's lights past the mask, the page pool, the casters'
 * list and the marking's job queue; false reports none. Each kind is logged once either way, and an overflow can show
 * as missing shadow.
 * `shadowSubsurfaceMinSourceAngle` is the smallest angle, in degrees, a sun's disk takes on a subsurface surface, which
 * grows toward it as the surface's opacity falls (emulating the light's diffusion in the material); the light a
 * subsurface surface lets through is the share its shadow-casters' distance leaves (see `subsurfaceOpacity`).
 * `shadowMaxDofResolutionBias` lowers, by up to that many levels, the resolution the shadow maps are asked at
 * in the areas a depth of field blurs (the circle of confusion is 8 pixels wide and more: the full bias; 0 turns the
 * feature off, and with no depth of field there is none).
 * `shadowCacheInvalidateUseHzb` tests the pages a changed placement overlaps against the previous frame's depth pyramid
 * (the occlusion's, `shadowOcclusionCulling`): a page whose rect the placement is fully hidden behind is not invalidated.
 * `shadowInvalidateOnLodDelta` invalidates the pages a cluster is drawn into when it is drawn coarser than the view
 * asks because the finer level is not resident yet, so that they are drawn again once it is; the pages so marked are
 * invalidated at most `shadowDeferredInvalidationBudget` a frame (-1 unbounded, 0 none; the rest keep their mark and
 * retry the next frame). It is the one channel of streaming: with it off (the default) a cluster
 * that enters or leaves residency, or a colour tile that arrives, invalidates no page, and the pages show what they were
 * drawn with until a placement, a surface or a cell changes them (a node moved, a surface whose alpha moved, a cell that
 * switched between its placements and its HLOD actor).
 * `shadowCacheFramesStaticThreshold` is the frames a placement that moved waits, without a move, to be cached as
 * static again; `shadowCacheMaxPageAgeSinceLastRequest` and `shadowCacheMaxLightAgeSinceLastRequest` the frames a
 * page, a light, unrequested is kept; `shadowDynamicResolutionMaxResolutionLodBias` the most the global resolution
 * bias rises, in levels, as the page pool fills, and `shadowDynamicResolutionMaxPagePoolLoadFactor` the share of the
 * pool it fills to before that bias starts (0 turns the rise off).
 *
 * `shadowDynamicResolutionTimeBudgetMs` and `shadowDynamicResolutionLoadBudget` throttle the maps' compute:
 * with either above 0 each map's resolution bias is raised by the share of the cost it adds, as the clusters
 * the raster counts in each map say, on the GPU (`shadowDynamicResolutionLoadBudget`: the estimate of the whole raster's
 * load past which the bias rises), or by the dynamic resolution's fit of the shadow raster's GPU time to the
 * milliseconds named (`shadowDynamicResolutionTimeBudgetMs`, which needs the render scale on `auto` and a GPU
 * timer; it wins when both are named); with both at 0 nothing is counted, made or run.
 * `shadowDynamicResolutionPerVsmBiasHistoryWeight` (0 to 1) is the share of a map's bias the frame before keeps
 * when it is eased; `shadowDynamicResolutionMaxComputeResolutionLodBiasDirectional` and `...Local` cap, for the
 * suns' maps and the local lights', the levels this throttle adds, beyond the pool's bias, within
 * `shadowDynamicResolutionMaxResolutionLodBias`.
 *
 * `shadowCache` keeps the pages of one frame for the next: off, every light is drawn uncached each frame, no distant
 * light is kept, and the pool holds no separate static layer (a change makes the shadows' set again, its pages
 * dropped). `shadowCacheAllocateViaLru` takes a free page by the age of its last request, the finer level first
 * within an age step; off, a page not wanted this frame is taken in the order of the pool alone, after the empty
 * ones. `shadowCacheDeformableMeshesInvalidate` has the pages drawn by an object that a skin or a morph deforms
 * invalidated as it draws them; off, such an object is cached as dynamic while it moves and settles to static
 * after `shadowCacheFramesStaticThreshold` frames without a move, its animation no longer redrawing its pages.
 * `shadowForceInvalidateLocal` draws the local lights uncached each frame: 0 none, 1 those that are not distant,
 * 2 all of them. `shadowForceFullPageClears` clears a page whose layers are stale whole, though what it holds was
 * cleared already. `shadowCacheDebugSkipDynamicPageInvalidation` applies none of the invalidations a cached page
 * carries (the moved casters' static and dynamic ones, the deferred ones, the receiver cover's): the shadows keep
 * the pages as they were drawn, so they show a moved object's old shadow; for finding whether an invalidation is
 * the cause of an artefact. It skips no more: a page cached whole under an offset the map allows is still handed
 * to the casters' cull, nothing drawn in it, as the reference leaves it. `shadowDynamicDeallocationMode` is what a frame that shadows no light
 * (`shadowQuality` 0) does with the set it holds: 1 frees its pool and tables; 0 and 2 keep them, their cache
 * dropped so that the pages are drawn again when the shadows come back (0 frees only where a many-light shading
 * mode is in use, which this engine does not have, so it keeps them as 2 does). Keeping costs the pool's memory
 * while the shadows are off; freeing costs the set made again when they come back.
 * `shadowUseReceiverMaskDirectional` and `shadowUseReceiverMaskLocal` draw a light's pages into the receivers' cover
 * alone (the pixels that ask the page): a sun's clipmap by default, a local light's when set (the cover then holds
 * every map, not the suns' alone; a change makes the shadows' set again). A light that changes it is drawn again.
 *
 * The `shadowSmrt...` settings shape the shadow trace of a ray: `shadowSmrtAdaptiveRayCount` is the ray after which
 * a group whose lanes all hit stops (and after whose first ray a group that all missed stops; 0 turns both off),
 * `shadowSmrtMaxRayAngleFromLight` the widest angle, in radians, a local light's ray may span from its light,
 * `shadowSmrtExtrapolateMaxSlope...` the steepest slope the march extends an occluder with (0 turns the
 * extrapolation off), `shadowSmrtTexelDitherScale...` the dither of a ray's start in the shadow map's texels,
 * `shadowSmrtMaxSlopeBiasLocal` the largest receiver-plane bias of a local ray and
 * `shadowSmrtRayLengthScaleDirectional` the length of a directional light's ray, in units of the receiver's distance
 * to the eye.
 *
 * `shadowRasterIndirectionMultiplier` is the factor, never read under 1, of the cut's cap of visible clusters
 * (`cutMaxVisibleClusters`) that sizes each of the raster's record lists.
 *
 * `shadowMaxPhysicalPages` is the most pages the pool takes, rounded up to whole rows of 128 pages
 * (the reference's rule): the rows' 512, 512, 2048, 4096 and 8192. A pool slice is one buffer bound whole, 64 KiB a
 * page, so a device whose binding (`maxStorageBufferBindingSize`, `maxBufferSize`) holds fewer pages
 * draws the largest pool that fits, 4096 pages needing a 256 MiB binding and 8192 a 512 MiB one
 * (`vsm/layoutBytes.ts:vsmPoolPagesBound`). A light traces at most `SHADOW_RAY_COUNT_MAX` (16) rays.
 *
 * The last eleven are the gates a local light's shadow passes (`vsm/localGate.ts`) and its distant
 * mode (`vsm/distantLights.ts`). A point or rectangle light takes a shadow only where
 * `shadowPointLightShadows` and `shadowPointLightCubemaps` are on; a light takes one while its
 * resolution — its radius on the screen, times its kind's texels per pixel, times its own
 * `shadowResolutionScale` (held to `shadowMaxResolution` less the map's border) — is past
 * `shadowMinResolution`, fading in up to `shadowFadeResolution` by the exponent `shadowFadeExponent`
 * (`shadowFadeUsesResolutionScale` off, the fade reads the resolution before the light's scale),
 * and a scale of 0 takes none where `shadowResolutionScaleZeroDisables` is on. A light of a pixel
 * footprint small enough that one page holds its map (`shadowDistantLightMode` 1; 2 all of them, 0
 * none) is distant: its map is the last mip alone, drawn once and kept, updated
 * `shadowMaxDistantUpdatePerFrame` lights a frame, the oldest first (-1 all of them, 0 none).
 *
 * `shadowQuality` is the one gate every light passes, the sun's included (`vsm/frame/vsmFarShadow.ts`,
 * `shadowsOn`): at 0 no light takes a shadow — no map, no page, no trace, no pool made, the lit
 * programs without their shadow code —, at 1 to 5 every light takes the same one, these maps having
 * a single method. The first quality level writes 0, the second 3, the third and the fifth 5.
 *
 * The last three are the project switches of how a translucent surface is lit, read once when the
 * session opens (they change the translucent programs, as a switch compiled into a shader does;
 * changing them later changes nothing) and written by no quality level.
 * `shadowTranslucentQuality` is 0, a single sample of the light's map at the surface's point, or 1,
 * the receiver's full trace the opaque projection runs and a dither on the share in a penumbra, and
 * the sun's pages marked as well for the nearest translucent surface the image before drew in front of
 * each pixel (the pages the opaque pixels ask do not hold a translucent surface's place); any value
 * past 1 is refused.
 * `shadowTranslucentLocalLights` says whether a point, spot or rectangle light's shadow reaches a
 * translucent surface at all: off, a shadowed local light lights it unshadowed and the programs hold
 * none of the local lights' shadow code; the sun's shadow always reaches it.
 * `translucentRectLights` says whether a rectangle light lights a translucent surface as a
 * rectangle: off, it lights it as a point light at its centre and the translucent programs hold none
 * of the rectangle shading.
 */
export const SHADOW_MAP_RULES = /* @__PURE__ */ (() =>
  [
    ...CLIPMAP_AND_MARKING_RULES,
    ...BIAS_AND_CACHE_RULES,
    ...FILTERING_AND_LOD_RULES,
    ...RAY_AND_RESOLUTION_RULES,
  ] as const)()

/** The fields `SHADOW_MAP_RULES` names. */
export type ShadowMapField = (typeof SHADOW_MAP_RULES)[number]['field']

/** What the smooth level writes of the shadow settings. */
const SMOOTH_SHADOWS = {
  shadowMarkCoarsePagesLocal: 2,
  shadowResolutionLodBiasDirectional: 0,
  shadowResolutionLodBiasDirectionalMoving: 0,
  shadowResolutionLodBiasLocal: 1,
  shadowResolutionLodBiasLocalMoving: 2,
  shadowRayCountDirectional: 0,
  shadowSamplesPerRayDirectional: 2,
  shadowRayCountLocal: 0,
  shadowSamplesPerRayLocal: 2,
  shadowMaxPhysicalPages: 512,
  shadowMaxResolution: 512,
  shadowQuality: 0,
} as const

/** What the balanced level writes of the shadow settings. */
const BALANCED_SHADOWS = {
  shadowMarkCoarsePagesLocal: 2,
  shadowResolutionLodBiasDirectional: 0,
  shadowResolutionLodBiasDirectionalMoving: 0,
  shadowResolutionLodBiasLocal: 1,
  shadowResolutionLodBiasLocalMoving: 2,
  shadowRayCountDirectional: 4,
  shadowSamplesPerRayDirectional: 2,
  shadowRayCountLocal: 4,
  shadowSamplesPerRayLocal: 2,
  shadowMaxPhysicalPages: 512,
  shadowMaxResolution: 1024,
  shadowQuality: 3,
} as const

/** What the fine level writes of the shadow settings. */
const FINE_SHADOWS = {
  shadowMarkCoarsePagesLocal: 2,
  shadowResolutionLodBiasDirectional: 0,
  shadowResolutionLodBiasDirectionalMoving: 0,
  shadowResolutionLodBiasLocal: 0,
  shadowResolutionLodBiasLocalMoving: 1,
  shadowRayCountDirectional: 8,
  shadowSamplesPerRayDirectional: 4,
  shadowRayCountLocal: 4,
  shadowSamplesPerRayLocal: 4,
  shadowMaxPhysicalPages: 2048,
  shadowMaxResolution: 1024,
  shadowQuality: 5,
} as const

/** What the cinematic level writes of the shadow settings. */
const CINEMATIC_SHADOWS = {
  shadowMarkCoarsePagesLocal: 1,
  shadowResolutionLodBiasDirectional: -1.5,
  shadowResolutionLodBiasDirectionalMoving: -1.5,
  shadowResolutionLodBiasLocal: 0,
  shadowResolutionLodBiasLocalMoving: 0,
  shadowRayCountDirectional: 16,
  shadowSamplesPerRayDirectional: 8,
  shadowRayCountLocal: 16,
  shadowSamplesPerRayLocal: 8,
  shadowMaxPhysicalPages: 8192,
  shadowMaxResolution: 4096,
  shadowQuality: 5,
} as const

/** What the quality levels below the top one write of those settings: the rows of the reference's
 *  first three scalability levels; `max` writes nothing (`runtime/qualityLevels.ts`); `cinematic`
 *  writes its fifth row. */
export const SHADOW_MAP_PRESET_LEVELS = /* @__PURE__ */ (() =>
  ({
    smooth: SMOOTH_SHADOWS,
    balanced: BALANCED_SHADOWS,
    fine: FINE_SHADOWS,
    cinematic: CINEMATIC_SHADOWS,
  }) as const)()
