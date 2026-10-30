# Metrics

The `shadow*` fields are documented on the contract
(`packages/sdk-core/src/contracts/shadowMetrics.ts`), filled by
`lighting/shadows/vsm/frame/vsmStats.ts`. Page counters need the page-counter readback on
(`countersOn`).

## Small objects stay out of the coarse pages, judged whole

An object covering fewer pixels of the
map's finest level than a threshold is drawn into the fine pages alone:
`shadowCoarsePagePixelThresholdStatic` (1) for the static layer,
`shadowCoarsePagePixelThresholdDynamicClusters` (4, UE value) for the dynamic layer. The test is the
object's (`vsm/render/renderCullWgsl.ts`): its ball (`inst` of the candidate) must overlap a page of
the right kind, then each cluster takes every page its rect overlaps. Invalidation of a moved
object reads the same rule.

## The footprint rule is a switch

`shadowCoarsePagesIncludeNonClusterCasters` (true, UE default)
leaves the rule to the two thresholds; every caster is cluster geometry, so `false` puts every
caster in the coarse pages and no threshold is read.

```js
world.shadows = { shadowCoarsePagesIncludeNonClusterCasters: false } // every caster in the coarse pages, small ones too
world.shadows = { shadowCoarsePagesIncludeNonClusterCasters: null } // back to the default
```

## Moving objects

The box diff (`lighting/shadows/casters/castDiff.ts`) stales the pages of a
placement's old and new box (`UpdatedTransform`; `rt.rootBoxes.written`).

## UE settings now options

UE defaults; meanings in `sdk-core/src/llm/shadowViewMeanings.ts`, rows
in `sdk-core/src/contracts/shadowMapOptions.ts`:

- page marking: `shadowPageDilationBorderSizeDirectional` and `shadowPageDilationBorderSizeLocal`
  (0.05), `shadowCullBackfacingPixels` (true), `shadowPageMarkingPixelStrideX` / `...Y` (2);
- receiver: `shadowNormalBias` (0.5, thousandths of its distance to the eye); screen ray:
  `shadowScreenRayLength` (0.015);
- cache: `shadowCacheFramesStaticThreshold` (100), `shadowCacheMaxPageAgeSinceLastRequest` (1000),
  `shadowCacheMaxLightAgeSinceLastRequest` (10);
- dynamic resolution: `shadowDynamicResolutionMaxResolutionLodBias` (2),
  `shadowDynamicResolutionMaxPagePoolLoadFactor` (0.85).

## The compute throttle

Dynamic resolution lowers the maps' resolution when the
shadow raster costs too much, all on the GPU: next frame's marking kernels add each map's share of
the clusters it drew to its bias. Off while `shadowDynamicResolutionTimeBudgetMs` and
`shadowDynamicResolutionLoadBudget` are both 0 (default).

- `shadowDynamicResolutionLoadBudget`: load past which the bias rises (lower is more aggressive).
- `shadowDynamicResolutionTimeBudgetMs`: fits the raster's GPU time to a budget (needs render scale
  `'auto'` and a GPU timer); wins when both are named.
- `shadowDynamicResolutionPerVsmBiasHistoryWeight`: eases each map over frames (0.9).
- the two `...MaxComputeResolutionLodBias...` options: cap a sun's and a local light's bias, within
  `shadowDynamicResolutionMaxResolutionLodBias` less the pool's bias.

```js
world.shadows = { shadowDynamicResolutionLoadBudget: 1 } // throttle the maps when the raster's load passes 1
world.shadows = { shadowDynamicResolutionTimeBudgetMs: 3 } // fit the raster to 3 ms (render scale 'auto')
world.shadows = { shadowDynamicResolutionMaxComputeResolutionLodBiasLocal: 1 } // local lights lose one level at most
world.shadows = { shadowDynamicResolutionPerVsmBiasHistoryWeight: 0.5 } // ease faster
world.shadows = { shadowDynamicResolutionLoadBudget: null } // back to the default: off
```

Trace options: `shadowSmrtAdaptiveRayCount` (1; 0 turns the vote off),
`shadowSmrtMaxRayAngleFromLight` (0.03), `shadowSmrtExtrapolateMaxSlopeLocal` (0.05) and
`...Directional` (5), `shadowSmrtTexelDitherScaleLocal` (2) and `...Directional` (2),
`shadowSmrtMaxSlopeBiasLocal` (50), `shadowSmrtRayLengthScaleDirectional` (1.5),
`shadowMarkPixelPagesMipModeLocal` (0: every mip; 1 even; 2 odd). Sun ray start dither: a UV step
`0.5 / 16384 * scale * distance to the eye / 2^(level - bias)` added to the projected start UV,
plane bias `2 * max(0, dot(slope, step))` (slope held to 0.05) less the offset's gain
(`vsmSunDitherUv`, `vsmSunDitherBias`, `vsmRayLine`, `vsm/trace/traceRayWgsl.ts`).

## The shadow mask denoise (`shadowDenoise`, false by default)

A deliberate addition beyond the reference. After the projection wrote the masks, an edge-aware a-trous
filter (5x5 taps, `shadowDenoiseIterations` passes, 2 by default, 0 to 4) smooths the per-pixel grain and the
8x4 blocks of the adaptive ray stop in the penumbra, before the lighting reads them. Weights: distance to the
receiver's plane (depth with the normal), the normal, the shadow value. Pixels whose 3x3 neighbourhood is wholly
0 or wholly 1 are skipped. Pass `vsm.denoise`. Measured: about 2 ms a pass on a 4112x2294 display, the grain removed; it stays off by default until a penumbra tile list cuts it under 0.4 ms. `false` (or 0 passes) leaves the masks as written.

## The prefiltered distant shadow

With `shadowPrefilteredDistant` (false) each
sun's regular clipmap (not the first-person one) keeps a soft filtered shadow of its far levels,
read by the projection instead of a trace. Toggling makes the shadow set again (`heldVsm`,
`VsmAsked.prefilteredDistant`, `VsmLayout.prefilteredDistant`). A frame:

1. _The clipmap._ No page; depth cut at each level's end (`shadowForceInvalidateDirectional` and
   `shadowClipmapCullDynamicTightly` taken as on, `vsmClipmapConfig`). Level records carry
   `VSM_MAP_PREFILTERED_DISTANT`, the clipmap index (flags bits 8 to 15, `vsmClipmapLevelIndex`)
   and, in `dynamicDepthCullRange`, the band's clip depths (`buildLevel`).
2. _The requests._ A requested page carries `VSM_PAGE_PRIMARY`. `PropagateFilterableRequests`
   (`filterablePropagateWgsl.ts`, `encodeVsmPageMapping`) asks the covering coarser pages
   `VSM_PAGE_SECONDARY` and fine.
3. _The cull._ A caster is drawn where its box reaches in front of the band's outer end; one wholly
   inside the inner end asks the primary request, one crossing it the others too
   (`vsmCasterInDepthRange`, `vsmCasterMarkMask`, `vsmMarksMatch`).
4. _The pages._ A page whose request bits (fine, primary, secondary) changed is redrawn whole
   (`keepPages`); a secondary-granted page has bit 29 of its page-table entry (`vsmEntrySecondary`).
5. _The filters._ After the raster, held, seen, secondary pages of a prefiltered level are listed
   (`selectMerges`, `filterableArgs`, `filterablePages`) and filtered (`filterableWgsl.ts`) on byte
   pools of 130 x 130 texels a pool page (`VsmFilterable`: two `separate` pools by frame parity,
   history blend `shadowPrefilteredDistantHistoryBlendFactor`, 0.87, 0 turning reprojection off;
   the `merged` pool). The frame end copies the suns' projection records, level-0 page-table rows
   and receiver cover into the `history` buffer (`keepFilterableHistory`,
   `uploadFilterableHistory`).

Texels are bytes (`round(v * 255) / 255`). Set memory rises by three pools of 16 900 bytes a pool
page, plus history and indirect arguments (`vsmResourceBytes`).

```ts
world.shadows = { shadowPrefilteredDistant: true } // soft, filtered far shadow on every sun's clipmap
world.shadows = { shadowPrefilteredDistantHistoryBlendFactor: 0.5 } // follow the light faster, alias more over time
world.shadows = { shadowPrefilteredDistant: null } // back to the default: off
```

## The first-person pixels' own shadow

`shadowFirstPersonSelfShadow` (false) gives first-person
pixels a screen-traced shadow (`lighting/shadows/firstPerson/selfShadow.ts`) after the suns' masks
are projected. Four kernels:

- *downsample*: per half-resolution pixel, keeps the first-person pixel of its four with the
  closest or farthest depth
  (`shadowFirstPersonSelfShadowDownsampleCheckerboardMode`: 0 closest, 1 farthest, 2 alternately);
- *trace*: marches the depth pyramid toward the sun up to
  `shadowFirstPersonSelfShadowMaxTraceDistance` metres (1) in at most
  `shadowFirstPersonSelfShadowMaxHzbTraceIterations` steps (512); a hit less far behind a tile than
  `shadowFirstPersonSelfShadowRelativeDepthThickness` (0.2) of its depth counts; gives up when
  `shadowFirstPersonSelfShadowMinimumHzbTraceOccupancy` lanes or fewer still walk (0, never);
- *blur*: 3 x 3, depth weights (`shadowFirstPersonSelfShadowBilateralFilterDepthThreshold`, 1),
  contact hardening by the neighbours' mean distance to the hit;
- *upsample*: four grid pixels around each first-person pixel; minimum of the sun's mask and the
  shadow.

`shadowFirstPersonSelfShadowRawFullResolution` (false): every pixel, unfiltered.
`shadowFirstPersonSelfShadowLightTypes` (0 suns, 1 local lights, 2 all) names the lights; shadows
join the light's mask by minimum. Needs the screen reflection's trace layers.

```ts
world.shadows = { shadowFirstPersonSelfShadow: true } // the hands and the weapon shadow one another
world.shadows = { shadowFirstPersonSelfShadowRawFullResolution: true } // pixel-perfect, the ground truth of the default
world.shadows = { shadowFirstPersonSelfShadow: null } // back to the default: off
```

## The counters over frames

`shadowAccumulateStats` (0, none) collects the page counters over
frames (`statsAccumulate.ts`). While not 0, each frame with shadow maps appends one row (pages
requested, kept static and dynamic, cleared, newly granted, empty, left to the offset's cull,
overflow flags; `vsmAccumulateStats`). Above 0 it stops after that many frames; negative goes on
until set back to 0; a new value restarts. Rows (at most 524 288) are reported as a CSV in the
engine diagnostic `shadow-stats`. (UE: one frame short.)

```ts
world.shadows = { shadowAccumulateStats: 600 } // ten seconds at 60 images a second, then the CSV
world.shadows = { shadowAccumulateStats: -1 } // until set back to 0
world.shadows = { shadowAccumulateStats: null } // back to the default: none
```

## The instance's cache state, per view

A placement has one word in the placements' buffer
(`rootWords`, second section; bits 0-15 views it is cached as dynamic in, bits 16-31 views it turned
in this frame), a view's slot from `VsmCacheManager.viewSlotOf` (16 slots, record field `viewSlot`).
`castInstanceState` (`casters/castDiffWgsl.ts`): a placement that began to deform
(`MOBILITY_DEFORMS`) stales its dynamic layer, static kept, in the maps of the views it turned in
(record `views` word); its stop stales nothing; a first sighting is no transition.
`vsmRenderCullView` draws a dynamic-cached caster as moving, and one that turned this frame into
every page it overlaps (UE: `GetCacheTransitioned`).

## Oriented bounds, and the pyramid

An instance is invalidated by its oriented local bounds: the
roots pass writes the box's three half axes (`ROOT_BOX_DOUBLES`, doubles 11-15 of a root's record,
`placement/compose/gpuComposeDerivedWgsl.ts`); the diff remembers them (`CAST_STATE_WORDS`); a
change record is a centre, a sign, three half axes and the views it stales (`CAST_RECORD_WORDS`,
`casters/castChanges.ts`); the stale is `vsmStaleBoxPages` (`vsm/invalidationWgsl.ts`). A page the
box lies behind in the previous frame's depth pyramid is not staled (`shadowCacheInvalidateUseHzb`,
true; rect nudged `1e-8` nearer); a one-page map has its static layer staled only. `castBoxes.ts`
writes the CPU's boxes in the same format.

## Six marks a physical page

The raster marks a drawn page in six slices: dynamic drawn, static
drawn, dynamic invalidated, static invalidated, an offset allowed, a level of detail behind
(`VSM_DIRTY_SLICES`, `vsmRasterMarkBits` in `render/renderBinWgsl.ts`). The cull decides the last
four:

- A surface wearing an offset its placement evaluates (`MOBILITY_OFFSET_SILENT` off, or always
  evaluating) invalidates the pages it draws when the map allows it (always, else when its level is
  not past the object's stop distance: `wpoThreshold` against the placement's square distance,
  third section of `rootWords`) and the object lets it (`shadowCacheInvalidation` not
  `rigid` or `static`). It is then cached as dynamic (`MOBILITY_OFFSET_INVALIDATES`,
  `MOBILITY_OFFSET_ALWAYS`).
- An offset allowed where the main view's distance has stopped it marks the page for the next frame
  (`FORCE_CACHED`: data kept, dynamic layer stale, never drawn).
- A placement wearing such an offset, or a displacement (`MOBILITY_OFTEN_MOVING`,
  `casters/rootWords.ts`), arrives cached as dynamic. `shadowCacheWpoPrimitives` (false, UE
  `r.Shadow.CacheWPOPrimitives`) has them arrive cached as still ones, their offset invalidating as
  before; `shadowCacheInvalidation` `static` keeps a placement out of the dynamic layer either way.
  Turning the option makes every placement arrive anew, with no cache state in any view.
- `shadowInvalidateOnLodDelta` (false) marks the pages of a cluster drawn behind the level the view
  asks (finer one not resident); invalidation waits for the page's turn,
  `shadowDeferredInvalidationBudget` a frame (-1 all, 0 none; `vsmKeepPages`). A one-page map
  ignores both, as do coarse pages keeping their dynamic layer. This is the one streaming channel:
  no box is declared for a cluster entering or leaving residency or a colour tile arriving. Off
  (default): a cached page keeps its old data (maybe darker patches along page edges) until redrawn.

## Depth of field lowers the maps' resolution

Under depth of field, marking and the sun's level add `shadowMaxDofResolutionBias` (1) levels in proportion to the circle of confusion's
radius over eight pixels (`vsmDofResolutionBias`, `vsm/uniforms.ts`, `vsm/frame/vsmDof.ts`).
`shadowDynamicHzb` (false; needs occlusion and the cache) adds a depth-pyramid layer for dynamic
casters (static and dynamic merged).

## Marking off

With `shadowMarkPixelPages` (true) off, the view marks nothing past the coarse
pages: no pixel or froxel marking (`encodeMarking`, `viewMarking`), no water depth or transparents'
front pass ahead of it (`vsmFrontLayer.ts`). A profiling and debugging switch.

## Marking from froxels

With `shadowMarkPagesUseFroxels` (false) pages are marked from the depth's
froxels, not pixel by pixel (`vsm/froxel/`): 8-pixel screen tiles, depth slices as deep as wide
(perspective: constant factor; orthographic: constant step, `froxelGrid.ts`).

- One workgroup a tile takes the slices its pixels fall in (`vsmBuildFroxels`, unique ones appended
  to a list; first two buffer words are the count and the count held to the room).
- `vsmFroxelArgs` sizes the indirect dispatch.
- A thread a froxel marks (`vsmMarkPagesFromFroxels`): in each sun's clipmap the level its centre
  asks (depth of field's bias added), every page its box overlaps; in each local light of the light
  grid cell at its centre that it reaches, the face its centre lies in, at the mip it asks.

Froxel marking leaves one-page-map lights to the coarse marking, culls no pixel facing away from a
light, takes no page dilation and marks no translucent front layer page. With
`singleLayerWaterDepthPrepass`, a second pass over the water's pixels (`vsmBuildFroxels` over the
water's depth, own grid and list) marks the suns' pages alone: the water takes no local-light
shadow. A list takes at most a froxel per view pixel, held to the device's binding. Difference from
UE: list froxel order.

## The projection is two passes

The suns' pass traces every sun (`vsmProjectSuns`, adaptive ray
count voted by the group, first-person clipmap and subsurface transmission merged in) into a layer
of the suns' mask a sun (`r32float`). The local lights' pass (`vsmProjectLocals`): each pixel traces
the shadowed lights of its light-grid cell, up to `shadowOnePassProjectionMaxLightsPerPixel` (16; 8,
16 or 32 lights make the mask 32, 64 or 128 bits a pixel, `maskFormat.ts`), packing each share in
four bits (`VirtualShadowMapMaskBitsCommon.ush`, `LightGridCommon.ush:PackShadowMask`). Order is the
cell's list: shadowed lights with a multi-page map first, then single-page ones; lighting finds a
lane by walking the same list (`vsmMaskLaneOf`; UE uses the map id). A light whose lane is past the
mask's capacity is not traced: lighting reads one sample of its map by map id (`vsmSampleMapLocal`,
`vsm/sampleMapWgsl.ts`), lifted 200 cm toward the light (`SampleVirtualShadowMapLocal`); the local
lit pass binds the shadow data for it (`DEFERRED_BINDINGS.vsmUniforms` to `vsmView`). A shadowed
light's slice carries its record's rank in the projection's view (up to 1024 lights) and two flags,
sun and single page (`shadowSliceOf`, `direct/shadowSlice.ts`).

## The clustered deferred shading (`clusteredDeferredShading`, false by default)

Shadowed local
lights are lit alone, one draw each over their range's pixels, after the batched lights and the
suns, reading their lane of the packed mask. `true` lights them in the one pass over the light grid
(UE clustered pass). Unshadowed lights stay in the one pass either way.

## The per-light path (`shadowOnePassProjection: false`)

The one-pass projection is the default.
With the option false, shadowed local lights leave the batched loop and each is lit alone, in
projection-record order, after the batched lights and the suns: its shadow is projected over its
range's pixels (`vsmProjectLight`, `perLightProjectionWgsl.ts`) into its layer of the screen mask
(`rgba8unorm`, up to four layers, square root of the share); nothing is cleared
(`shadowForcePerLightMaskClear` true clears the layer to 0 first, no image change); the light is
drawn with shadow = layer squared through the batched light term (`declaredLight`). A frame of at most as many lights as layers keeps its masks
(`vsmProjectionHold.ts`). Cost: a projection and a draw per light; no cap on lights a pixel keeps
(`shadowOnePassProjectionMaxLightsPerPixel` is the default path's). While its pipelines compile,
shadowed lights are lit by nothing; the lit view (`lightView` 2) reads the packed mask, which this
path does not make.

```js
world.shadows = { shadowOnePassProjection: false } // light each shadowed local light by a draw of its own
world.shadows = { clusteredDeferredShading: true } // the reference's UseClusteredDeferredShading on: the shadowed local lights in the grid's one pass
world.shadows = { clusteredDeferredShading: null } // back to the default: a draw of its own for each shadowed local light, reading the packed mask
world.shadows = { shadowOnePassProjection: false, shadowForcePerLightMaskClear: true } // debugging: no image change
world.shadows = { shadowOnePassProjection: null } // back to the one pass
```

## Subsurface surfaces let light through their shadow

The trace returns the mean distance its
hitting rays were stopped at (`occluderDistance`, `vsmMarch`, `vsmRayOccluderDistance`). For a
thin-sheet receiver (flag `SUBSURFACE_FLAG`, opacity = alpha of the thin transmission target,
`subsurfaceOpacityAt`, held to 0.99), where the trace was shadowed, the light left is
`e^(-distance * density)`, density `-0.05 * ln(1 - opacity)` per centimetre, added to the share the
rays missed and squared (`vsmSubsurfaceShadow`). A sun's disk grows toward
`shadowSubsurfaceMinSourceAngle` (5 degrees) as opacity falls. Receivers: thin sheet and two-sided
foliage (`vsmTransmitsShadow`); preintegrated skin keeps its shadow whole. Every subsurface model
(`vsmSubsurfaceModel`: thin sheet, foliage, profile, hair, eye) is not back-face culled. A
subsurface profile lets no light through the shadow maps (`docs/ENGINE.md`, the subsurface profile).

## The first-person clipmap

With `shadowFirstPersonClipmap` (true) each sun gets a second
clipmap, levels `shadowFirstPersonClipmapFirstLevel` (8) to `shadowFirstPersonClipmapLastLevel`
(18), no coarse level, redrawn every frame (`createVsmClipmap` with `firstPerson`; maps carry
`VSM_MAP_FIRST_PERSON`) while the scene holds an object standing for a first-person one
(`Object3D.firstPersonWorldSpaceRepresentation`, the player's body). Only those objects are drawn
into it (`vsmRenderCullCandidate`). The sun's trace reads it beside its own for every pixel not a
first-person object's (`Object3D.firstPerson`, mark `FIRST_PERSON_SURFACE_FLAG`), the more
shadowed taken (`vsmFirstPersonTrace`). First-person pixels ask the regular clipmap
`shadowFirstPersonPixelRequestBias` (2) levels coarser, never finer than level
`shadowFirstPersonRequestMinLevelClamp` (8), and nothing where the bias is negative; a first-person
object casts no dynamic shadow of its own. The main camera's view does not draw the
body (`hiddenFromViews`, `geometry/selection/viewFilter.ts`); shadow maps do. An object casting
while hidden (`castHiddenShadow`) is likewise taken from every view's cut; cuts with no view filter
(reflections', indirect light) know neither.

## Volumetric translucent shadows

`bCastVolumetricTranslucentShadow` exists in UE only for lights
without virtual shadow maps (`SetupInteractionShadows`, `ShadowSetup.cpp:3346`,
`ShadowSetup.cpp:6504`; `LightSceneProxy.cpp:110`): no option here.

## The static layer is merged after the raster

A static caster writes the static slice alone
(hardware `vsmRenderJoin`, software `vsmRenderSoftwareStatic`, or, on a device with nine storage
buffers a stage, `vsmRenderSoftware` for both layers). Pages whose static layer was drawn or
cleared this frame, in a seen map of a cached view, are listed (`vsmSelectMerges`) and the deeper
layer becomes the dynamic one (`vsmMergePages`, `lighting/shadows/vsm/physicalPagesWgsl.ts`), the
layer every reader samples. Each raster list holds
`cutMaxVisibleClusters x shadowRasterIndirectionMultiplier` records (1.5).
