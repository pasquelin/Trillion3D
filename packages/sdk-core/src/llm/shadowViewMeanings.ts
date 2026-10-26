import type { ShadowMapField } from '../contracts/shadowMapOptions.ts'
import type { ShadowField } from '../contracts/shadowOptions.ts'

/** The settings of the shadows that govern how the raster groups the lights' views, and those of
 *  the shadow maps themselves (`../contracts/shadowOptions.ts`, `../contracts/shadowMapOptions.ts`). */
export type ShadowViewField =
  | Extract<
      ShadowField,
      | 'shadowMultipassViews'
      | 'shadowGeometryLodBias'
      | 'shadowOcclusionCulling'
      | 'shadowOcclusionFullUpdate'
      | 'shadowDynamicHzb'
    >
  | ShadowMapField

/** What each means. */
export const SHADOW_VIEW_MEANINGS: Readonly<Record<ShadowViewField, string>> = {
  shadowMultipassViews:
    'Whether the shadow raster draws the lights in several passes when their maps would pass what one pass takes: the cull runs one row of its dispatch a listed light, so a pass takes at most the rows a dispatch has, 65 535 on any device, counted in the maps of its lights, far more than a frame holds — the raster takes one pass for every frame of a device that grants it; each light whole in one pass; false, every light in one pass however many maps there are. The pages drawn are the same either way.',
  shadowGeometryLodBias:
    "The level of detail the shadow maps take of the geometry: each map's view selects its own clusters, those whose error spans at most the scene's pixel error times two to this bias in the map's own pixels (1, the default: twice the error). 0 draws the shadows at the error the scene allows, higher coarser and faster.",
  shadowOcclusionCulling:
    "Whether the shadow raster leaves out the casters hidden, in a map, behind what its pages already hold (true, the default): each map keeps a depth pyramid of its pages; a node of the hierarchy or a caster hidden in the previous frame's pyramid waits, the visible ones are drawn, the pyramid is built again over the pages they drew, and the nodes and casters that waited are tested against it and drawn where visible. Fewer casters are drawn into the same pages; the image is the acceptance bench's to prove. Turned on or off, the shadow pool is made again and its pages drawn again.",
  shadowDynamicHzb:
    "Whether the shadow maps' depth pyramid holds a second layer for the dynamic casters (false, the default): the first layer is then the static layer's alone, which static casters are tested against, and the second the static and the dynamic slice merged, which dynamic casters are tested against. It helps a cached scene with much dynamic overdraw (a forest under a still sun) and doubles the pyramid's memory. Read where shadowOcclusionCulling is on and the cache is; turned on or off, the shadow pool is made again and its pages drawn again.",
  shadowOcclusionFullUpdate:
    "Whether the shadow maps' depth pyramid is built again over every page each frame (false, the default: only over the pages drawn this frame). Read where shadowOcclusionCulling is on; true costs more, and the image it gives is the acceptance bench's to prove.",
  shadowClipmapFirstLevel:
    "The finest level of a directional light's clipmap, a power of two of centimetres: level L covers a radius of 2^(L+1) cm (6, the default: 1.28 m). Lower sharpens the shadows nearest the eye for more pages; the levels run from here to shadowClipmapLastLevel, and a change redraws the light's pages.",
  shadowClipmapLastLevel:
    "The coarsest level of a directional light's clipmap, which fixes how far its shadows reach (22, the default: about 84 km); each level more doubles the reach at one map more. Never below the first level.",
  shadowClipmapFirstCoarseLevel:
    'The first clipmap level whose coarse page is marked, so that a low-resolution shadow lies everywhere around the eye (15, the default: a radius of 655 m); from here to shadowClipmapLastCoarseLevel, and the last level of the clipmap always. None while shadowMarkCoarsePagesDirectional is 0.',
  shadowClipmapLastCoarseLevel:
    'The last clipmap level whose coarse page is marked (18, the default: a radius of 5.2 km): higher gives dense coarse shadow over a longer radius for more pages.',
  shadowClipmapZRangeScale:
    "Scale of each clipmap level's depth range on its radius (1000, the default): casters that far above a level still cast. Larger, the depth precision of a texel falls in proportion; a change redraws the light's pages.",
  shadowClipmapWpoDisableDistance:
    "Whether a directional light's clipmap leaves out, in the levels too coarse for it, the world position offset of an object that names a worldPositionOffsetDisableDistance (true, the default): a level whose radius is past that distance, less shadowClipmapWpoDisableDistanceLodBias levels, draws the object where its offset leaves it at rest, so that the far, coarse pages are not drawn again each frame for a motion they cannot show. false, every level draws every object's offset.",
  shadowClipmapWpoDisableDistanceLodBias:
    "How many clipmap levels past the distance an object evaluates its offset at still draw that offset in a directional light's shadow (3, the default; 2 to 4 suits most scenes): each level more doubles the radius of the shadow that is animated, at the cost of more pages drawn again each frame. Read where shadowClipmapWpoDisableDistance is on.",
  shadowMarkCoarsePagesDirectional:
    "Coarse pages of a directional light's clipmap: 0 none, 1 marks them, 2 (the default) marks them and keeps the dynamic layer of those very large pages cached while casters move, so that a moving object does not redraw them.",
  shadowMarkCoarsePagesLocal:
    "Coarse pages of a point, spot or rectangle light's maps, the page of the last mip, which every far receiver then finds: 0 none, 1 (the default) marks it, 2 marks it and keeps its dynamic layer cached while casters move. The quality levels write 2 below the top one and 1 at 'cinematic'.",
  shadowCoarsePagePixelThresholdStatic:
    "Pixels (1, the default) under which an object cached in the static layer is drawn into the fine pages of a shadow map alone, not into its coarse pages: the object's whole bounds are measured in the map's finest level; higher leaves more small objects out of the coarse pages.",
  shadowCoarsePagePixelThresholdDynamic:
    "Pixels (4, the default) under which an object cached in the dynamic layer is drawn into the fine pages of a shadow map alone, not into its coarse pages: the object's whole bounds are measured in the map's finest level; higher leaves more small objects out of the coarse pages.",
  shadowMarkPixelPagesMipModeLocal:
    "Which mips of a point, spot or rectangle light's maps the pixels of the view mark: 0 (the default) all eight, 1 the four even ones (16k, 4k, 1k, 256), 2 the four odd ones (8k, 2k, 512, 128); fewer mips duplicate fewer instances in the maps and make a harsher fall-off between mips.",
  shadowPageDilationBorderSizeDirectional:
    "Share of a page (0.05, the default) from its border within which a pixel of the view also maps the neighbouring page of a directional light's clipmap: higher values reduce page misses at screen edges and disocclusions, and raise the page count; 0 maps the pixel's page alone.",
  shadowPageDilationBorderSizeLocal:
    "Share of a page (0.05, the default) from its border within which a pixel of the view also maps the neighbouring page of a point, spot or rectangle light's maps: higher values reduce page misses at screen edges and disocclusions, and raise the page count; 0 maps the pixel's page alone.",
  shadowMarkPagesUseFroxels:
    "Whether the shadow pages are marked from froxels (false, the default): the depth is cut into screen tiles of 8 pixels and depth slices as deep as they are wide, and each froxel the depth fills marks the pages its box overlaps in every light's maps, in place of each pixel marking its own. It marks the same pages for fewer threads on a view with large flat areas; it does not cull the pixels that face away from a light, and it marks no page for the translucent front layer.",
  shadowCullBackfacingPixels:
    'Whether the pixels that face away from a light request no page of its shadow maps (true, the default); subsurface surfaces always request theirs.',
  shadowPageMarkingPixelStrideX:
    "Pixels the page marking steps over along the screen's horizontal axis, from 1 to 128 (2, the default): it tests every Nth pixel; higher costs less and may miss a page that few pixels see.",
  shadowPageMarkingPixelStrideY:
    "Pixels the page marking steps over along the screen's vertical axis, from 1 to 128 (2, the default): it tests every Nth pixel; higher costs less and may miss a page that few pixels see.",
  shadowRasterIndirectionMultiplier:
    'Factor (1.5, the default; read as 1 below it) of cutMaxVisibleClusters that sizes each list of records the shadow raster draws from: a pass past it draws what fits.',
  shadowNormalBias:
    "The receiver's offset along its surface normal before it reads a shadow map, in thousandths of its distance to the eye (0.5, the default): higher values avoid artifacts on surfaces nearly parallel to the light, offset the shadows' visibility and raise the chance of reaching unmapped pages.",
  shadowScreenRayLength:
    "Length of the screen-space ray that goes away from the receiver before the shadow map's lookup, as a share of the view's height at the pixel's depth (0.015, the default): it catches contact shadows finer than a texel.",
  shadowFirstPersonClipmap:
    'Whether each sun gets a second clipmap for the objects that stand for a first-person one in the world, such as the body of the player (true, the default): only they are drawn into it, every frame, and every pixel but those of the first-person objects themselves is shadowed by it as well as by the regular clipmap. Off, those objects cast no shadow.',
  shadowFirstPersonClipmapFirstLevel:
    'First level of the first-person clipmap (8, the default, from 0 to 30): lower values allow a higher resolution close to the camera, at the price of more pages.',
  shadowFirstPersonClipmapLastLevel:
    'Last level of the first-person clipmap (18, the default, from 0 to 30): it sets the radius the clipmap covers, doubling with each level.',
  shadowFirstPersonPixelRequestBias:
    'Levels (2, the default, from -16 to 16) coarser than usual at which the pixels of first-person objects ask the regular clipmap for pages, as they are not self-shadowing and very near the camera; a negative value asks no page at all for them.',
  shadowFirstPersonRequestMinLevelClamp:
    'Finest clipmap level (8, the default, from 0 to 30) the pixels of first-person objects ask for, so that geometry close to the camera requests no very high resolution while a distant one still can.',
  shadowOnePassProjectionMaxLightsPerPixel:
    "Most local lights per pixel (16, the default, from 1 to 32) whose shadow the projection keeps in its mask, 4 bits a light (a mask of 32 bits a pixel up to 8 lights, 64 up to 16, 128 up to 32); a light of the pixel's cell past them is read from one sample of its own map by the lighting. Lower costs less memory.",
  shadowAllowScreenOverflowMessages:
    "Whether the shadow stats report the overflows seen in the last 10 seconds (true, the default): the one-pass projection's lights past the mask, the page pool, the casters' list and the marking's job queue. Each kind is logged once either way; an overflow can show as missing shadow.",
  shadowSubsurfaceMinSourceAngle:
    "Smallest angle in degrees (5, the default) a sun's disk takes on a subsurface surface: the disk grows toward it as the surface's opacity falls, which softens the shadow the way the light diffuses in the material.",
  shadowMaxDofResolutionBias:
    "Most levels (1, the default) by which the shadow maps' resolution is lowered where the depth of field blurs the image: the bias grows with the circle of confusion's radius and is full from 8 pixels; 0 turns it off. Nothing happens without a depth of field.",
  shadowCacheInvalidateUseHzb:
    "Whether a changed placement invalidates only the shadow pages it is not hidden from (true, the default): its bounds are tested page by page against the previous frame's depth pyramid, and a page it is fully occluded on keeps its cache. Needs the occlusion culling (shadowOcclusionCulling); without it every page its bounds touch is invalidated.",
  shadowDeferredInvalidationBudget:
    'Most shadow pages a frame whose deferred invalidation (see shadowInvalidateOnLodDelta) is carried out: -1 (the default) all of them, 0 none; the pages over the budget keep their mark and are invalidated in the frames after.',
  shadowInvalidateOnLodDelta:
    'Whether the shadow pages a cluster is drawn into are invalidated when it is drawn at a coarser level than the shadow view asks because the finer level is not resident yet (false, the default), so that they are drawn again when it is; pairs with shadowDeferredInvalidationBudget, which spreads the invalidations over frames.',
  shadowCacheFramesStaticThreshold:
    'Frames (100, the default) a placement that moved must go without moving or being invalidated before its shadows are cached as static again, in the layer a still object is drawn into.',
  shadowCacheMaxPageAgeSinceLastRequest:
    'Frames (1000, the default) a shadow page that no pixel asks for any more stays in the pool before it is emptied.',
  shadowCacheMaxLightAgeSinceLastRequest:
    'Frames (10, the default) a light that is not seen keeps its shadow maps before they are dropped.',
  shadowDynamicResolutionMaxResolutionLodBias:
    "Levels (2, the default) the global shadow resolution may drop, by biasing every map's level of detail up, as the page pool fills past shadowDynamicResolutionMaxPagePoolLoadFactor; 0 never lowers it.",
  shadowDynamicResolutionMaxPagePoolLoadFactor:
    'Share of the page pool (0.85, the default) that may be allocated before the shadow resolution is biased downwards; 0 turns the dynamic resolution off.',
  shadowSmrtAdaptiveRayCount:
    'The ray (1, the default) after which a group of pixels whose rays all hit stops tracing, an umbra; a group whose first ray missed everywhere stops after it; 0 turns the adaptive ray count off and every pixel traces them all.',
  shadowSmrtMaxRayAngleFromLight:
    "The widest angle, in radians (0.03, the default), a point, spot or rectangle light's ray may span from the light: smaller limits the penumbra's size on the screen, larger adds noise.",
  shadowSmrtExtrapolateMaxSlopeLocal:
    "The steepest depth slope (0.05, the default) the trace extends an occluder's surface with behind a sample, for point, spot and rectangle lights: higher softens penumbra edges and can leak light behind a second occluder; 0 turns the extrapolation off.",
  shadowSmrtExtrapolateMaxSlopeDirectional:
    "The steepest depth slope (5, the default) the trace extends an occluder's surface with behind a sample, for directional lights: higher softens penumbra edges and can leak light behind a second occluder; 0 turns the extrapolation off.",
  shadowSmrtTexelDitherScaleLocal:
    'The dither (2, the default) of the start of a ray of a point, spot or rectangle light, in shadow map texels, which hides aliasing from too little resolution; too high leaks light near occluders; 0 shows the texels.',
  shadowSmrtTexelDitherScaleDirectional:
    "The dither (2, the default) of the start of a ray of a directional light, in texels of the clipmap level at the receiver's distance, which hides aliasing from too little resolution; too high leaks light near occluders; 0 shows the texels.",
  shadowSmrtMaxSlopeBiasLocal:
    'The largest receiver-plane depth slope bias (50, the default) of a ray of a point, spot or rectangle light: low values show artifacts where the shadow resolution is short, high ones worsen light leaks near occluders and sparkles in shadow.',
  shadowSmrtRayLengthScaleDirectional:
    "The length of a directional light's ray (1.5, the default), in units of the receiver's distance to the eye: shorter limits the penumbra's size on the screen, longer needs more samples to keep the shadow attached to its contact.",
  shadowResolutionLodBiasDirectional:
    "Resolution bias of a directional light's maps while it rests: each unit below 0 doubles the resolution, each above halves it (-1.5, the default and the value of 'cinematic'; 0 at the three lower quality levels). The clipmap never goes below the screen's own level.",
  shadowResolutionLodBiasDirectionalMoving:
    "Resolution bias of a directional light while it moves — its direction changed — (-1.5, the default and the value of 'cinematic'; 0 at the three lower levels); it falls back to shadowResolutionLodBiasDirectional over shadowLightActiveFrameCount frames, and is never finer than that.",
  shadowResolutionLodBiasLocal:
    "Resolution bias of a point, spot or rectangle light's maps while it rests (0, the default): each unit below 0 doubles the resolution, each above halves it. The quality levels write 1, 1 and 0 below the top one and 0 at 'cinematic'.",
  shadowResolutionLodBiasLocalMoving:
    "Resolution bias of a point, spot or rectangle light while it moves or was just made (1, the default: half the resolution); it falls back to shadowResolutionLodBiasLocal over shadowLightActiveFrameCount frames, and is never finer than that. The quality levels write 2, 2 and 1 below the top one and 0 at 'cinematic'.",
  shadowLightActiveFrameCount:
    'The frames a light that was just made or moved counts as moving (10, the default): its moving bias falls back to its resting one in equal steps over them, and every light counts as able to move.',
  shadowRadiusThreshold:
    "The least radius of an object over its distance from the eye (0.01, the default: one hundredth) for it to be drawn into a shadow map redrawn whole — that of a light just made or moved: a smaller object is left out of such a map, and stays out of its pages until they are redrawn. 0 draws every caster; the quality levels write 0.06, 0.05 and 0.04 below the top one and 0 at 'cinematic'.",
  shadowRadiusThresholdUncached:
    'Whether shadowRadiusThreshold applies to the maps redrawn whole; false draws every caster into them.',
  shadowRayCountDirectional:
    "Rays a pixel's shadow trace takes across a directional light's disk, from 0 to 16 (8, the default): more smooth the penumbra, in proportion to the cost; 0 reads the shadow map once along the light's axis, a hard edge. The quality levels write 0, 4 and 8 below the top one and 16 at 'cinematic' (the most a lane holds).",
  shadowSamplesPerRayDirectional:
    "Steps each ray of a directional light's trace takes, from 0 to 64 (4, the default): more catch thinner occluders, in proportion to the cost; 0, one sample. The quality levels write 2, 2 and 4 below the top one and 8 at 'cinematic'.",
  shadowRayCountLocal:
    "Rays a pixel's shadow trace takes across a point, spot or rectangle light's source, from 0 to 16 (8, the default): more smooth the penumbra, in proportion to the cost; 0 reads the shadow map once along the light's axis, a hard edge. The quality levels write 0, 4 and 4 below the top one and 16 at 'cinematic' (the most a lane holds).",
  shadowSamplesPerRayLocal:
    "Steps each ray of a point, spot or rectangle light's trace takes, from 0 to 64 (4, the default): more catch thinner occluders, in proportion to the cost; 0, one sample. The quality levels write 2, 2 and 4 below the top one and 8 at 'cinematic'.",
  shadowMaxPhysicalPages:
    "The most pages the shadow pool takes (4096, the default; a value reads as the power of two at or below it, and a device whose binding holds fewer pages draws the largest pool that fits — 4096 pages need a 256 MiB binding, 8192 a 512 MiB one): more space means finer shadows for more memory. The quality levels write 512, 512 and 2048 below the top one and 8192 at 'cinematic'.",
  shadowDistantLightMode:
    'Distant point, spot and rectangle lights: 1 (the default) takes a light whose shadow map fits in one page — its pixel footprint is below the finest threshold — as distant: its map is its last mip alone, always marked, drawn once and then kept, whatever moves, until its turn to be updated (shadowMaxDistantUpdatePerFrame); 2 makes every local light distant; 0 none. A light that moves or changes its shape is drawn again at once.',
  shadowMaxDistantUpdatePerFrame:
    'How many distant lights are drawn again each frame, the ones left longest first (1, the default); a light that was missed is drawn in a later frame. -1 draws all of them every frame; 0 never draws them again once drawn, until they move.',
  shadowPointLightShadows:
    'Whether point and rectangle lights take a shadow at all (true, the default); off, only spot and directional lights do.',
  shadowPointLightCubemaps:
    'Whether point and rectangle lights take their shadow as a cube of six faces (true, the default); off, they take none, as on a device that cannot draw cube shadows. Spot lights are not concerned.',
  shadowResolutionScaleZeroDisables:
    "Whether a local light whose shadowResolutionScale is 0 takes no shadow at all (true, the default). Off, the scale is read like any other: it brings the light's resolution to 0, which the fade turns into no shadow too unless shadowFadeUsesResolutionScale is off as well.",
  shadowMaxResolution:
    "The most texels a side a local light's shadow resolution is held to when the gate reads it (2048, the default; 512, 1024 and 1024 at the three lower quality levels, 4096 at 'cinematic'), less the border of a spot's map (4 texels each side) — the gate's resolution, since the virtual map is the same size whatever the light. Only a light with a shadowResolutionScale other than 1 can reach it.",
  shadowFadeResolution:
    "The resolution, in texels, above which a local light's shadow is whole (64, the default); below it the shadow fades to nothing at shadowMinResolution, and a light whose fade is 1/256 or less takes no shadow.",
  shadowMinResolution:
    'The resolution, in texels, at and below which a local light takes no shadow (32, the default).',
  shadowFadeExponent:
    'The exponent of the fade between shadowMinResolution and shadowFadeResolution (0.25, the default): a lower one keeps the shadow whole longer.',
  shadowFadeUsesResolutionScale:
    "Whether the fade reads the resolution after the light's own shadowResolutionScale (true, the default), so that a scale moves the fade out of its range as well; off, the fade reads the resolution before it.",
  shadowTexelsPerPixelPoint:
    "The texels of a point light's shadow resolution for each pixel its radius spans on the screen (1.27324, the default): the resolution the gate fades by, never the map's.",
  shadowTexelsPerPixelSpot:
    'The same for a spot light, whose radius is that of the sphere inscribed in the end of its cone (2.54648, the default).',
  shadowTexelsPerPixelRect: 'The same for a rectangle light (1.27324, the default).',
  shadowQuality:
    "The one gate every light passes, the sun's included, from 0 to 5 (5, the default): 0 turns every shadow off — no shadow map, page, trace or pool is made, the lit passes read none and drop their shadow code, and the maps held are freed —, 1 to 5 shadow every light the same way, these maps having a single method. The quality levels write 0, 3 and 5 below the top one and 5 at 'cinematic': the first draws no shadow at all.",
  shadowTranslucentQuality:
    "How a translucent surface reads the shadow of a light, 0 or 1 (0, the default; read once when the session opens, no quality level writes it): 0 takes one sample of the light's shadow map at the surface's point, cheap enough for every layer of a blend; 1 runs the full trace the opaque surfaces get — rays across the light's disk, a screen ray for contact — for every translucent pixel, at a high cost, and also asks the sun's shadow pages for the nearest translucent surface the image before drew in front of each pixel, which the opaque pixels' pages do not cover.",
  shadowTranslucentLocalLights:
    "Whether the shadow of a point, spot or rectangle light reaches a translucent surface (false, the default; read once when the session opens, no quality level writes it): off, a shadowed local light lights a translucent surface unshadowed and the translucent programs hold none of the local lights' shadow code; on, it reads the shadow as shadowTranslucentQuality says. The sun's shadow always reaches a translucent surface.",
  translucentRectLights:
    'Whether a rectangle light lights a translucent surface as a rectangle (false, the default; read once when the session opens, no quality level writes it): off, the surface takes it as a point light at its centre and the translucent programs hold none of the rectangle shading; opaque surfaces always take the rectangle.',
}
