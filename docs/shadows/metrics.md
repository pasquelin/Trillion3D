# Metrics

The `shadow*` fields are documented on the contract
(`packages/sdk-core/src/contracts/shadowMetrics.ts`) and filled by
`lighting/shadows/vsm/frame/vsmStats.ts`. The page counters need the page-counter readback on
(`countersOn`).

**Small objects stay out of the coarse pages, judged whole.** An object whose bounds cover fewer
pixels of the map's finest level than a threshold is drawn into the fine pages alone:
`shadowCoarsePagePixelThresholdStatic` (1) for an object cached in the static layer,
`shadowCoarsePagePixelThresholdDynamicClusters` (4, the reference's value for cluster geometry;
every caster is cluster geometry, so the threshold it has for other geometry, 16, has no use) for
one cached in the dynamic layer. The test is the object's, never a cluster's
(`vsm/render/renderCullWgsl.ts`): the object's own ball (`inst` of the candidate) must overlap a
page of the right kind, then each of its clusters takes every page its own rect overlaps, as the
reference's instance cull then its cluster cull. The invalidation of a moved object reads the same
rule on the object's box.

**The footprint rule is a switch.** `shadowCoarsePagesIncludeNonClusterCasters` (true, the
reference's default) leaves the rule above to the two thresholds. Every caster here is cluster
geometry (it reaches the maps through the candidates of the cut's clusters: tessellated, voxel,
sprite, line, skinned, instanced and first-person rows alike), so `false`, which keeps casters that
are not clusters out of the coarse pages, puts every caster of ours in them, whatever its footprint,
and the thresholds are read by none; the invalidation of a moved object and the raster's cull read
the one switch.

```js
world.shadows = { shadowCoarsePagesIncludeNonClusterCasters: false } // every caster in the coarse pages, small ones too
world.shadows = { shadowCoarsePagesIncludeNonClusterCasters: null } // back to the default
```

**Moving objects are invalidated by what they leave and enter.** Each frame the roots pass wrote
boxes, the diff of the instances' boxes (`lighting/shadows/casters/castDiff.ts`) compares every
placement's box with the one it was seen with and stales the pages of both, a composed child's
included (`rt.rootBoxes.written` is what it follows beside the scene's revision): the reference's
`UpdatedTransform` with the old then the new instance data .

**The reference's settings now options.** Each has the reference's default, its meaning in
`sdk-core/src/llm/shadowViewMeanings.ts` and its row in
`sdk-core/src/contracts/shadowMapOptions.ts`:

- page marking: `shadowPageDilationBorderSizeDirectional` and `shadowPageDilationBorderSizeLocal`
  (0.05), `shadowCullBackfacingPixels` (true), `shadowPageMarkingPixelStrideX` / `...Y` (2);
- receiver: `shadowNormalBias` (0.5, thousandths of its distance to the eye); screen ray:
  `shadowScreenRayLength` (0.015);
- cache: `shadowCacheFramesStaticThreshold` (100), `shadowCacheMaxPageAgeSinceLastRequest` (1000),
  `shadowCacheMaxLightAgeSinceLastRequest` (10);
- dynamic resolution: `shadowDynamicResolutionMaxResolutionLodBias` (2),
  `shadowDynamicResolutionMaxPagePoolLoadFactor` (0.85).

**The compute throttle (off by default).** Beside the pool's bias, the dynamic resolution can lower
the maps' resolution when the shadow raster costs too much, wholly on the GPU as the reference does:
the raster counts the clusters it draws in each map, and the next frame's kernels, run inside its
marking between the page rects' initialisation and the clear of the page tables, zero the throttle
buffer, carry the counts to its maps, add to each map's bias in its projection record the share of
the cost it takes, then zero the feedback the raster counts in. Nothing is read back. It is off
while `shadowDynamicResolutionTimeBudgetMs` and `shadowDynamicResolutionLoadBudget` are both 0, the
default: nothing is made, counted, written or run, and the marking and the raster are the programs
without it; the sampling always reads the bias of the clipmap map its level falls in, as the
reference's does, which is the base map's while unthrottled. A budget turned on or off makes no set
again: the pool and the cache stay.

- `shadowDynamicResolutionLoadBudget`: the estimated load past which the bias rises (lower is more
  aggressive).
- `shadowDynamicResolutionTimeBudgetMs`: fits the shadow raster's GPU time to a budget through the
  render scale's heuristic (it needs the render scale on `'auto'` and a GPU timer); wins when both
  are named.
- `shadowDynamicResolutionPerVsmBiasHistoryWeight`: eases each map over the frames (any number, 0.9;
  the reference names 0 to 1 and clamps nothing).
- the two `...MaxComputeResolutionLodBias...` options: cap what a sun's maps and a local light's may
  take, within `shadowDynamicResolutionMaxResolutionLodBias` less the pool's bias.

Their meanings are in `sdk-core/src/llm/shadowViewMeanings.ts`; the marking and the sampling of a
sun's clipmap read the bias of the map their level falls in.

```js
world.shadows = { shadowDynamicResolutionLoadBudget: 1 } // throttle the maps when the raster's load passes 1
world.shadows = { shadowDynamicResolutionTimeBudgetMs: 3 } // fit the raster to 3 ms (render scale 'auto')
world.shadows = { shadowDynamicResolutionMaxComputeResolutionLodBiasLocal: 1 } // local lights lose one level at most
world.shadows = { shadowDynamicResolutionPerVsmBiasHistoryWeight: 0.5 } // ease faster
world.shadows = { shadowDynamicResolutionLoadBudget: null } // back to the default: off
```

The trace's settings are options too, the reference's defaults: `shadowSmrtAdaptiveRayCount` (1; 0
turns the vote off), `shadowSmrtMaxRayAngleFromLight` (0.03), `shadowSmrtExtrapolateMaxSlopeLocal`
(0.05) and `...Directional` (5), `shadowSmrtTexelDitherScaleLocal` (2) and `...Directional` (2),
`shadowSmrtMaxSlopeBiasLocal` (50), `shadowSmrtRayLengthScaleDirectional` (1.5), and
`shadowMarkPixelPagesMipModeLocal` (0: every mip; 1 the even ones; 2 the odd ones). The sun ray's
start dither is sized as the reference sizes it: a step in the clipmap level's UV,
`0.5 / 16384 * scale * distance to the eye / 2^(level - bias)`, added to the ray's start UV once
projected, with the plane bias `2 * max(0, dot(slope, step))` (the slope held to 0.05) less what the
start offset gained (`vsmSunDitherUv`, `vsmSunDitherBias`, `vsmRayLine`,
`vsm/trace/traceRayWgsl.ts`); no page is read for it. A local ray's stays the receiver's pixel size
at the map's bias.

**The prefiltered distant shadow (off by default).** With `shadowPrefilteredDistant` (false) each
sun's regular clipmap (the first-person clipmap holds none) keeps a soft, filtered shadow of its far
levels beside its pages, read by the projection in place of a trace where it holds one. Turned on or
off, the shadow set is made again (`heldVsm`, `VsmAsked.prefilteredDistant`,
`VsmLayout.prefilteredDistant`); with it off nothing is made, written or run, and every program is
the text it was. In order, a frame:

1. _The clipmap._ It keeps no page and cuts its depth at each level's end
   (`shadowForceInvalidateDirectional` and `shadowClipmapCullDynamicTightly` taken as on for it,
   `vsmClipmapConfig`), and each level's record carries `VSM_MAP_PREFILTERED_DISTANT`, its index in
   the clipmap (flags bits 8 to 15, `vsmClipmapLevelIndex`) and, in `dynamicDepthCullRange`, the
   clip depths of the band it draws into the filtered pages: from where the level before ends its
   band (0 for the first) to the level's own radius less the resolution bias, toward the light
   (`buildLevel`).
2. _The requests._ A page the view asks (a pixel, a froxel, a coarse page) carries
   `VSM_PAGE_PRIMARY` beside its wanted and fine bits. `PropagateFilterableRequests`
   (`filterablePropagateWgsl.ts`, the first dispatch of `encodeVsmPageMapping`, over the suns'
   per-page bins alone) walks every page of a level that holds a request through the coarser levels
   of its clipmap, asking the page that covers it in each `VSM_PAGE_SECONDARY` and fine, with the
   receiver cover's quarter folded down a mip a hop; a hop that changed nothing ends the walk.
3. _The cull._ A caster of a level is drawn where its box reaches in front of the band's outer end;
   one wholly inside the band's inner end asks the primary request of the pages it draws into, one
   that crosses it draws into the others too (`vsmCasterInDepthRange`, `vsmCasterMarkMask`), and a
   page matches the mask when it holds one of its stale bits and all of its request bits
   (`vsmMarksMatch`). The shadow views' descent asks the same of a node's box.
4. _The pages._ A page whose request bits (fine, primary, secondary) differ from those it holds is
   drawn again whole (`keepPages`); a page granted for a secondary request has bit 29 of its
   page-table entry (`vsmEntrySecondary`).
5. _The filters._ After the raster, the pages that are held, seen, secondary and of a prefiltered
   level are listed (`selectMerges`: the separable passes' list, the merge down's, the borders'
   count, in `filterableArgs` and `filterablePages`), and the filter passes run over them
   (`filterableWgsl.ts`) on byte pools of 130 x 130 texels a pool page (`VsmFilterable`: two
   `separate` pools by the frame's parity, the previous frame's history of the blend
   `shadowPrefilteredDistantHistoryBlendFactor`, 0.87, 0 turning the reprojection off; the `merged`
   pool, which the separable passes also use as their temporary pool, cleared again between them and
   the merge down). A separable pass holds the line it filters in workgroup memory, as the merge
   down holds the pages of the coarser levels. The frame end copies the suns' projection records,
   the level-0 rows of their page-table blocks and their receiver cover into the `history` buffer
   (`keepFilterableHistory`), when the blend asks it, with the map ids of the frame before
   (`uploadFilterableHistory`).

The pools, the arguments' reset and the filters are made, run and cleared in a frame with a map that
holds the feature alone. The pool's pages are as many as without it: a texel is a byte, stored
`round(v * 255) / 255` as an 8-bit pool stores it, by one atomic or into a pool the frame cleared (a
byte is written once), and read with a bilinear sample of byte loads, a word shared by the two
texels of a row loaded once, the one path whatever the device. The set's memory rises by three pools
of 16 900 bytes a pool page, the history and the indirect arguments (`vsmResourceBytes`).

```ts
world.shadows = { shadowPrefilteredDistant: true } // soft, filtered far shadow on every sun's clipmap
world.shadows = { shadowPrefilteredDistantHistoryBlendFactor: 0.5 } // follow the light faster, alias more over time
world.shadows = { shadowPrefilteredDistant: null } // back to the default: off
```

**The first-person pixels' own shadow.** `shadowFirstPersonSelfShadow` (false) gives the pixels of
the first-person objects a shadow of their own, traced in the screen
(`lighting/shadows/firstPerson/selfShadow.ts`), after the suns' masks are projected. Four kernels
run over all the suns:

- the *downsample* keeps, for each pixel of the half-resolution grid, the first-person pixel of its
  four with the closest or the farthest depth
  (`shadowFirstPersonSelfShadowDownsampleCheckerboardMode`: 0 the closest, 1 the farthest, 2
  alternately) and its normal;
- the *trace* marches the depth pyramid from that pixel toward the sun, as far as
  `shadowFirstPersonSelfShadowMaxTraceDistance` metres (1) in at most
  `shadowFirstPersonSelfShadowMaxHzbTraceIterations` steps (512), a hit lying less far behind a tile
  than `shadowFirstPersonSelfShadowRelativeDepthThickness` (0.2) of its depth, the march giving up
  when `shadowFirstPersonSelfShadowMinimumHzbTraceOccupancy` lanes or fewer of its group still walk
  (0, never);
- the *blur* is 3 x 3, its samples weighed by the likeness of their depth
  (`shadowFirstPersonSelfShadowBilateralFilterDepthThreshold`, 1), the shadow lerped from the
  pixel's own to the filtered by the mean distance to the hit of its neighbours (contact hardening);
- the *upsample* reads the four grid pixels around each first-person pixel and takes the minimum of
  the sun's mask and the shadow.

`shadowFirstPersonSelfShadowRawFullResolution` (false) traces every pixel with no filter.
`shadowFirstPersonSelfShadowLightTypes` (0 the suns, 1 the local lights, 2 all) names the lights. A
sun's shadow is taken into its mask by the minimum; a local light's, traced only where the light
reaches the first-person objects (its range, a spot's cone), goes to its ray's end at the light and
is taken, as the square root the masks keep, into the light's capsule layer on the one-pass
projection or its mask on the per-light path, by the minimum. The march walks the full-resolution
depth as the lower of the pixel's and its bilinear filter, and meets no depth plane at its base
level. It needs the screen reflection's trace layers; the masks are projected again each image while
it is on, and its textures are let go when no light gives a self shadow.

```ts
world.shadows = { shadowFirstPersonSelfShadow: true } // the hands and the weapon shadow one another
world.shadows = { shadowFirstPersonSelfShadowRawFullResolution: true } // pixel-perfect, the ground truth of the default
world.shadows = { shadowFirstPersonSelfShadow: null } // back to the default: off
```

**The counters over frames.** `shadowAccumulateStats` (0, none) collects the page counters of the
shadow maps over several frames (`statsAccumulate.ts`). While it is not 0, each frame that holds
shadow maps copies the stats buffer (pages requested, kept static and dynamic, cleared, newly
granted, empty, left to the offset's cull, overflow flags) into the next row of a buffer that lives
across frames, by one thread (`vsmAccumulateStats`); above 0 it takes that many frames then stops, a
negative value goes on until it is set back to 0, and a new value restarts the count. At the end the
rows (at most 524 288) are copied to one readback and reported as a CSV, a header of the counters'
names then a line a frame, in the engine diagnostic `shadow-stats`. (The reference's count stops one
frame short of its value; here N frames give N rows.)

```ts
world.shadows = { shadowAccumulateStats: 600 } // ten seconds at 60 images a second, then the CSV
world.shadows = { shadowAccumulateStats: -1 } // until set back to 0
world.shadows = { shadowAccumulateStats: null } // back to the default: none
```

**The instance's cache state, per view.** The reference keeps, for each primitive view, two bit
arrays: cached as dynamic, and transitioned this frame. Here a placement has one word of them in the
placements' buffer (`rootWords`, second section; bits 0-15 the views it is cached as dynamic in,
bits 16-31 the views it turned in this frame), a view's slot taken from the cache
(`VsmCacheManager.viewSlotOf`, 16 slots, the map's record carries it as `viewSlot`).
`castInstanceState` (`casters/castDiffWgsl.ts`) runs every frame: a tracked placement that began to
deform (`MOBILITY_DEFORMS`) stales its dynamic layer where it stands, the static one kept, in the
maps of the views it turned in (the record's `views` word); its stop stales nothing; a placement
seen for the first time is no transition. The raster's cull (`vsmRenderCullView`) draws a caster
cached as dynamic in the map's view as a moving one, and one that turned this frame into every page
it overlaps whatever the page's stale layers say, the reference's `GetCacheTransitioned`.

**Oriented bounds, and the pyramid.** An instance is invalidated by its local bounds carried by its
transform, not by the world box that holds them: the roots pass writes, beside the world box and the
ball, the three half axes of the oriented box (`ROOT_BOX_DOUBLES`, doubles 11-15 of a root's record,
`placement/compose/gpuComposeDerivedWgsl.ts`); the diff remembers them (`CAST_STATE_WORDS`) and a
record of the shadow changes is a centre, a sign, three half axes and the views it stales
(`CAST_RECORD_WORDS`, `casters/castChanges.ts`). The stale carries the unit box to the oriented one
by the matrix of the axes (`vsmStaleBoxPages`, `vsm/invalidationWgsl.ts`) and measures the instance
by the length of its half axes. A page the box lies behind, in the previous frame's depth pyramid
(the kept tables the first cull reads), is not staled (`shadowCacheInvalidateUseHzb`, true; the rect
nudged a hair nearer, `1e-8`, and the layer the static casters read), as the reference's
invalidation tests each page against the HZB; a map of one page (a distant light's) has that page's
static layer staled and nothing else. `castBoxes.ts` writes the CPU's boxes in the same format, the
axes along the world's.

**Six marks a physical page.** The raster marks a page it draws in six slices, as the reference's
dirty flags: dynamic drawn, static drawn, dynamic invalidated, static invalidated, an offset
allowed, a level of detail behind (`VSM_DIRTY_SLICES`, `vsmRasterMarkBits` in
`render/renderBinWgsl.ts`). The cull decides the last four per cluster and map:

- A surface that wears an offset its placement evaluates (`MOBILITY_OFFSET_SILENT` off, or the
  surface always evaluating) invalidates the pages it draws when the map allows it and the object
  lets it. The map allows it always, else when the map's level is not past the distance the object
  stops at (`wpoThreshold` against the placement's square distance, the third section of
  `rootWords`); the object lets it when `shadowCacheInvalidation` is not `rigid` or `static`. It is
  cached as dynamic then: all the clusters of its placement are, the layer being decided for the
  placement (`MOBILITY_OFFSET_INVALIDATES`, `MOBILITY_OFFSET_ALWAYS`) and the map.
- An offset allowed where the main view's distance has stopped it marks the page for the next frame
  (the physical page's `FORCE_CACHED`: the page keeps its data, its dynamic layer marked stale so
  the cull considers it, never drawn).
- A placement that wears such an offset arrives cached as dynamic, as does a placement whose surface
  wears a displacement (the mesh shape is often moving: `MOBILITY_OFTEN_MOVING`, decided where the
  words are written, `casters/rootWords.ts`). `shadowCacheWpoPrimitives` (false, the reference's
  `r.Shadow.CacheWPOPrimitives`) has them arrive cached as still ones instead, their offset
  invalidating the pages it draws as before; `shadowCacheInvalidation` `static` keeps a placement
  out of the dynamic layer either way. Turning the option makes every placement arrive anew, as the
  reference recreates its primitives' render state. An arrival, new or returned from a parked row,
  starts with no cache state in any view (the CPU zeroes it, `casters/rootWords.ts`).
- `shadowInvalidateOnLodDelta` (false) marks the pages of a cluster drawn behind the level the view
  asks, for want of the finer one resident; the invalidation waits for the page's turn,
  `shadowDeferredInvalidationBudget` a frame (-1 all, 0 none; the count lives after the slices,
  `vsmKeepPages`). A map of one page ignores both; so do the coarse pages that keep their dynamic
  layer. This is the one channel of streaming: the CPU declares no box for a cluster entering or
  leaving residency, nor for a colour tile arriving, and what it declares of a cell or a surface is
  a primitive or material update (a cell's switch between its placements and its HLOD actor, a
  surface whose alpha mode or cutoff moved). With the switch off, the default, the cost is a cached
  page drawn before a finer form arrived: it keeps what it was drawn with, and may show as darker
  patches along page edges, until the page is drawn again for another reason.

**Depth of field lowers the maps' resolution.** Where the view draws a depth of field, the page
marking and the sun's level choice add `shadowMaxDofResolutionBias` (1) levels in proportion to the
circle of confusion's radius over eight pixels (`vsmDofResolutionBias`, `vsm/uniforms.ts`; the model
of the lens as the pass compiles it, `vsm/frame/vsmDof.ts`). A second layer for the dynamic casters
in the depth pyramid is `shadowDynamicHzb` (false; it needs the occlusion and the cache): the first
layer holds the static slice alone, which static casters and the invalidation test against, the
second the static and the dynamic slice merged for the dynamic casters.

**Marking off.** With `shadowMarkPixelPages` (true) off, the marking of the view marks nothing past
the coarse pages: neither the pixel marking (the translucent front layer's and the water surface's
marks included) nor the froxel marking runs (`encodeMarking`, `viewMarking`), and the water's depth
and the transparents' front pass are not drawn ahead of it (`vsmFrontLayer.ts`); the pages of the
view are never asked, so the shadows show where the coarse pages and the cache hold them. It is a
profiling and debugging switch.

**Marking from froxels.** With `shadowMarkPagesUseFroxels` (false) the pages are marked from the
froxels of the depth, in place of pixel by pixel (`vsm/froxel/`): the screen is cut into tiles of 8
pixels and the depth into slices as deep as they are wide (a perspective view's by a constant
factor, an orthographic view's by a constant step, `froxelGrid.ts`).

- One workgroup a tile takes the slices its pixels fall in (`vsmBuildFroxels`, the unique ones
  appended to a list counted by one atomic, in a buffer of words whose first two words are the count
  and the count held to the room).
- A one-thread kernel sizes the marking's indirect dispatch from the count (`vsmFroxelArgs`).
- A thread a froxel marks (`vsmMarkPagesFromFroxels`): in each sun's clipmap the level the froxel's
  centre asks (the depth of field's bias added), every page its box overlaps there (the box carried
  to the map's clip space and its rect of pixels taken to pages, the receiver cover's cells marked
  for a map that has one); and in each local light of the light grid's cell at its centre that it
  reaches, the face its centre lies in, at the mip its centre asks.

A light with a map of one page is left to the coarse marking (the pixel marking leaves it out as
well). The froxel marking culls no pixel that faces away from a light, takes no page dilation and
marks no page for the translucent front layer. Where the scene's single-layer water drew its depth
before the marking (the water is drawn with `singleLayerWaterDepthPrepass`), a second pass of the
same kernels follows the scene's over the froxels of the pixels the water drew over
(`vsmBuildFroxels` over the water's depth, keeping the pixels whose depth differs from the scene's),
with a grid and a list of their own, and marks the suns' pages alone: the water takes no shadow from
a local light. Its list takes a froxel a pixel of the view at most, as the reference's room, held to
the device's binding. The froxels are the reference's; their order in the list is not (the reference
reduces the depth pyramid's first level through a hash).

**The projection is two passes, as the reference's is.** The suns' pass traces every sun of the
frame (`vsmProjectSuns`, the adaptive ray count voted by the group, a sun's first-person clipmap and
a subsurface receiver's transmission merged in) into a layer of the suns' mask a sun (`r32float`,
the share of its shadow at each pixel). The local lights' pass (`vsmProjectLocals`) is one pass in
which each pixel walks the lights of its own cell of the light grid (the cell the lighting walks)
and, for the shadowed ones, up to `shadowOnePassProjectionMaxLightsPerPixel` (16; 8, 16 or 32 lights
make the mask 32, 64 or 128 bits a pixel, `maskFormat.ts`), traces each and packs its share in four
bits, sixteenths, in the pixel's mask (`VirtualShadowMapMaskBitsCommon.ush`,
`LightGridCommon.ush:PackShadowMask`). The order is the cell's list: the shadowed local lights whose
map is more than a page first, then those of a single page; the lighting finds a light's lane by
walking the same list the same way (`vsmMaskLaneOf`), as the reference finds it by the light's map
id. A light whose lane is past the number the mask keeps is not traced: the lighting reads one
sample of its own map by the map's id alone (`vsmSampleMapLocal`, `vsm/sampleMapWgsl.ts`; the cube
face the receiver lies in, found in the map's own frame), lifted by 200 cm along the ray towards the
light, as the reference's lookup is (`SampleVirtualShadowMapLocal`). The local lit pass binds the
shadow data for it (`DEFERRED_BINDINGS.vsmUniforms` to `vsmView`); a shadowed light's slice carries
the rank of its record in the projection's view (a uniform of up to 1024 lights) and two flags, a
sun and a single page (`shadowSliceOf`, `direct/shadowSlice.ts`).

**The clustered deferred shading (`clusteredDeferredShading`, false by default).** The shadowed
local lights are lit alone, one draw each over the pixels their range covers, after the batched
(unshadowed) lights and the suns, and each reads its lane of the one-pass projection's packed mask
(the lights found in the pixel's cell of the light grid, the pass of one light of the record the
draw binds): the same light term, the same shadow read and the same image as the grid's one pass, a
draw a light more. `clusteredDeferredShading: true` lights them in that one pass over the light grid
instead, every light of a pixel's cell at once, the reference's clustered pass. The unshadowed
lights stay in the one pass either way. The per-light path below projects the lights alone too.

**The per-light path (`shadowOnePassProjection: false`).** The one-pass projection above is the
default. With the option false the shadowed local lights leave the batched light loop and each is
lit alone, one after the other, in the order of the frame's projection records, after the batched
(unshadowed) lights and the suns: the light's shadow is projected over the pixels its range covers
(`vsmProjectLight`, `perLightProjectionWgsl.ts`) straight into its layer of the screen mask
(`rgba8unorm`, an array of up to four layers, the square root of the share in every channel). The
projection writes every pixel of the rectangle, so nothing is cleared before it, as the reference's
projection pass writes all the pixels it needs (`shadowForcePerLightMaskClear` true clears the layer
to 0 first, changing no image); then the light is drawn over the lit surfaces, its shadow its layer
squared, through the same light term as every batched light (`declaredLight`), the screen's
occlusion read as the batched passes read it. The indirect light is drawn first, before every light,
in the pass of the batched ones. A frame of at most as many lights as layers keeps its masks: where
the projection is held (`vsmProjectionHold.ts`) and the layers stand, no light is traced again, as
the one-pass path reuses its mask. The cost is a projection and a draw per light, with no cap on the
lights a pixel keeps (`shadowOnePassProjectionMaxLightsPerPixel` applies to the default path alone),
and the one-pass local lights' mask is not made at all on this path (nor the layers on the other).
The suns' pass and the light grid the marking prunes are the same in both paths; the lights the
batch lights are those of the grid no shadow slot names. While the path's pipelines compile, the
shadowed lights are lit by nothing and the frame is drawn again once they are compiled; the lit view
of the share the shadows let through (`lightView` 2) reads the packed mask, which this path does not
make.

```js
world.shadows = { shadowOnePassProjection: false } // light each shadowed local light by a draw of its own
world.shadows = { clusteredDeferredShading: true } // the reference's UseClusteredDeferredShading on: the shadowed local lights in the grid's one pass
world.shadows = { clusteredDeferredShading: null } // back to the default: a draw of its own for each shadowed local light, reading the packed mask
world.shadows = { shadowOnePassProjection: false, shadowForcePerLightMaskClear: true } // debugging: no image change
world.shadows = { shadowOnePassProjection: null } // back to the one pass
```

**Subsurface surfaces let light through their shadow.** The trace returns the mean distance its rays
that hit were stopped at (`occluderDistance`, from the hit depth the march keeps: `vsmMarch`,
`vsmRayOccluderDistance`). For a receiver that is a thin sheet (the surface flag `SUBSURFACE_FLAG`,
whose opacity is the alpha of the thin transmission target, `subsurfaceOpacityAt`, held to 0.99),
where the trace was shadowed, the light left is `e^(-distance * density)` of
`-0.05 * ln(1 - opacity)` per centimetre, added to the share the rays missed and squared
(`vsmSubsurfaceShadow`). A sun's disk grows toward `shadowSubsurfaceMinSourceAngle` (5 degrees) as
the opacity falls, for those receivers. The receivers of this are the thin sheet and the two-sided
foliage (`vsmTransmitsShadow`); the preintegrated skin keeps its shadow whole and its back faces
culled, as a lit surface. Every subsurface model (the thin sheet, the foliage, the subsurface
profile, the hair and the eye: `vsmSubsurfaceModel`) is read from any side of its surface and is not
back-face culled. A subsurface profile lets none of its light through the shadow maps: its
transmission reads the shadow itself as its thickness, in the lighting (`docs/ENGINE.md`, the
subsurface profile), from a light that transmits.

**The first-person clipmap.** With `shadowFirstPersonClipmap` (true) each sun gets a second clipmap,
from level `shadowFirstPersonClipmapFirstLevel` (8) to `shadowFirstPersonClipmapLastLevel` (18), no
coarse level, redrawn every frame (`createVsmClipmap` with `firstPerson`; its maps carry
`VSM_MAP_FIRST_PERSON`) while the scene holds an object that stands for a first-person one
(`Object3D.firstPersonWorldSpaceRepresentation`, the body of the player). Only those objects are
drawn into it and the regular maps leave them out (`vsmRenderCullCandidate`); the sun's trace reads
it beside its own for every pixel that is not a first-person object's (`Object3D.firstPerson`, the
mark `FIRST_PERSON_SURFACE_FLAG`) and not fully shadowed already, the more shadowed taken with its
occluder distance (`vsmFirstPersonTrace`). The pixels of first-person objects ask the regular
clipmap `shadowFirstPersonPixelRequestBias` (2) levels coarser, never finer than level
`shadowFirstPersonRequestMinLevelClamp` (8), and ask nothing where the bias is negative; a
first-person object casts no dynamic shadow of its own. The main camera's view does not draw the
body (its filter takes it, `hiddenFromViews`, `geometry/selection/viewFilter.ts`), and the shadow
maps draw it all the same; an object that casts while hidden (`castHiddenShadow`) is taken from
every view's cut the same way and stays out of the parked roots. The cuts that carry no view filter
(the reflections' and the indirect light's rays) do not know either of them.

**Volumetric translucent shadows are not a virtual-shadow-map thing.** The reference makes the
per-object translucency shadow (`bCastVolumetricTranslucentShadow`) for the lights that do not use
virtual shadow maps alone (`SetupInteractionShadows`, which asserts the opposite,
`ShadowSetup.cpp:3346`, and is called for the lights without them, `ShadowSetup.cpp:6504`); every
light of a project that has virtual shadow maps uses them (`LightSceneProxy.cpp:110`), so there is
none to port: the option does not exist.

**The static layer is merged after the raster.** A static caster writes the static slice alone
(hardware raster `vsmRenderJoin`, software raster entry `vsmRenderSoftwareStatic`, or, on a device
that grants nine storage buffers a stage, the one software kernel `vsmRenderSoftware`, which rasters
both layers' records in one dispatch after the hardware raster and writes each record into its
layer's slice). After the raster the pages whose static layer was drawn or cleared this frame, in a
seen map of a cached view, are listed (`vsmSelectMerges`) and the deeper of the two layers becomes
the dynamic one (`vsmMergePages`, `lighting/shadows/vsm/physicalPagesWgsl.ts`), the layer every
reader samples. Each raster list holds `cutMaxVisibleClusters x shadowRasterIndirectionMultiplier`
records (1.5), whatever the frames asked.
