# Shadows

How the WebGPU engine draws cast shadows: virtual shadow maps, whose pages exist in memory only
where the image reads them. A map: each mechanism's rule is stated where it lives, and this page
names the file and the rules that span files. Paths are under `packages/sdk-browser/src/`: `vsm/`
holds the passes and their shaders, `lighting/shadows/vsm/frame/` the frame's plan, grant and
encoding. Lights, tiles and the lit image's passes are [ENGINE.md](ENGINE.md#direct-lighting); the
options a page sets (`castShadow`, a primitive's `castsShadowMaps`, and a material's `translucentLocalLightShadow`,
`translucentLocalLightShadowQuality` and `translucentDirectionalLightShadowQuality`) are
[SDK.md](SDK.md#lights).

## Pages and the pool

Every map is virtual: a page table over a fixed physical page pool in two slices, dynamic and
static. The sizes are tuning values the engine declares, each with its reason, in
`vsm/constants.ts` (`VSM_PAGE_TEXELS`, `VSM_LEVEL0_PAGES`, `VSM_MIPS`, `VSM_POOL_PAGES`); the
buffers are `vsm/resources.ts`. A light takes no page of its own: the pixels mark the pages they
read, only those are allocated and drawn, and a page nobody marks is evicted when a new one needs
room, in the order of the pool rank every GPU pool evicts by (`vsm/freePagesWgsl.ts`). The set is made at the first lit frame with a casting light, sized for the lights that cast
(`lighting/shadows/vsm/frame/engineVsm.ts:fullMapsFor`), and grows with its cache kept
(`lighting/shadows/vsm/frame/vsmGrant.ts:growEngineVsm`).

## Memory

The set, the mask and the raster's lists are granted within the room
the GPU budget leaves the shadows (`lighting/shadows/vsm/frame/vsmGrant.ts:grantEngineVsm`); their
total is `shadowPoolBytes` (`lighting/shadows/vsm/frame/vsmStats.ts`). Rules a contributor keeps:

- **Fixed size.** The physical pool is the setting's (`shadowMaxPhysicalPages`, rounded up to whole
  rows of 128 pages, as the reference rounds it), held to what one binding of the device holds
  (`vsmAsked`, `lighting/shadows/vsm/frame/vsmLightMaps.ts`). It follows neither the view's size nor
  its fill: a full pool raises the global resolution bias instead (below).

- **Never a crash, never an allocation the budget refuses.** Past the room, the pool is made with
  half the pages, down to an eighth: coarser shadows, said once (`gpu-out-of-memory`). When not
  even an eighth fits, the lights read no shadow, by name, until the room holds it or the lights
  change. A set the device refuses is undone whole and asked again only for other lights.
- **Coarser, then finer again.** A pool the GPU budget drew short of the setting (no part of the reference) grows back to it once the room holds it, at most
  every `VSM_PRESSURE_CALM_FRAMES` (`shadow-pool-regrown`). A full pool raises a global resolution
  bias (`VsmCacheManager.readPoolFeedback`, `vsm/cacheManager.ts`).
- **Said, never hidden.** `shadowResolutionBias` is the pool's halvings from the one asked plus that bias, which reads
  `0` once its fall has stalled under `VSM_PRESSURE_BIAS_NONE` (a bias no level feels); above `0` the reference mode
  refuses its capture (`REFERENCE_SHADOWS_REDUCED`).

## One frame

Encoded in the direct-lighting step, after the visibility and material passes and before the
lighting pass (`lighting/shadows/vsm/frame/engineVsm.ts`, `vsmEncode.ts`), in this order:

1. Invalidation: one stale over the previous frame's maps, its dispatch sized on the GPU. A moved,
   added or removed instance stales the pages of its previous and of its new bounds, as the reference
   invalidates a primitive from the bounds it had and the ones it has: a diff over the placements
   (`shadows/casters/castDiffWgsl.ts`, `castDiff.ts`; one thread a placement, run when the scene's
   revision moved or a placement's word was written) compares each placement's world box and
   mobility word (`placement/roots/rootBoxes.ts`) with the ones it was seen with, and appends the
   boxes to name to the shadow changes' list (`shadows/casters/castChanges.ts`), never read by the
   CPU. A placement that leaves or arrives names its box; a static one's first move names the box it
   leaves in the static layer and the box it enters in the dynamic one; a moving one names both ends
   in the dynamic layer, which a map that uses the receiver cover leaves out (it draws its dynamic
   layer again each frame); one that settles (`shadowCacheFramesStaticThreshold`, the frames without an
   invalidation) names its box once in the static layer; one that deforms is cached as dynamic as one that moves is, and a
   placement that arrives often moving (`mobility` `movable`, a skin or a morph, or an offset that invalidates its shadows)
   starts as a moving one, its first box in the dynamic layer alone; each box carries the placement's offset facts, with
   which the stale puts it in the dynamic layer of the maps that allow the offset and in the static layer of the others;
   a placement that pins its shadows
   (`shadowCacheInvalidation` `static`) names nothing for a move. Then the CPU's boxes of what no
   placement says — a cell's objects and HLOD actor, a surface whose alpha changed, a deforming
   geometry — records of the same format in their
   own buffer (`invalidation/castBoxes.ts`, `invalidation/castInvalidation.ts`,
   `invalidation/castStale.ts`).
2. The plan: clipmaps, local lights, map ids, projection data (`vsm/frameSetup.ts`,
   `vsm/clipmap.ts`, `vsm/localLight.ts`, `vsm/cacheManager.ts`). A local light takes its maps only
   if it passes the gates of [Local lights' shadow gates](#local-lights-shadow-gates-and-distant-lights).
   The map ids lie in two ranges, as the reference lays them: the maps of one page (a distant light's) from id 0, in a
   range of 8192 ids, and the full maps from id 8192, the suns' clipmaps first. A full map's id does not move when a
   distant light comes or goes; the ids between the ranges hold no map: the marking's kernels walk the maps the frame claimed and the throttle's
   fit skips the gap (`vsm/mapIds.ts`).

   A frame with `shadowQuality` at 0 stops at the plan's door: it plans no map, keeps the set held with
   its cache dropped, or frees it with `shadowDynamicDeallocationMode` 1 (a later frame that shadows again
   draws every light uncached, or starts a cache of its own, so no page of a stale cache is read),
   drops the world's change boxes with the cache they would stale and
   gives every light the answer "no shadow". The lit programs are asked without their shadow code;
   the shadow rows, the pipelines and the mask are not made or funded while the setting holds.

3. Page address update, carrying last frame's pages to this frame's ids
   (`vsm/pageManagementPass.ts:encodeVsmPageCarry`).
4. Page marking (`vsm/markingPass.ts`, `vsm/markingWgsl.ts`). Where the project asks the full
   trace of the translucent surfaces (`shadowTranslucentQuality` 1) and the image before drew a
   front layer of them, the same pass also marks, in every sun's clipmap, the page of the nearest
   translucent surface that layer holds in front of each pixel — its depth read where the pixel
   stood in that image (`lighting/shadows/vsm/frame/vsmFrontLayer.ts`), the page dilated as the
   pixel's own, no bias —, in a program of its own that binds the layer; without it the program has
   neither the binding nor the code. A translucent fragment otherwise reads the pages the opaque
   pixels marked.
5. Page allocation (`vsm/pageManagementPass.ts:encodeVsmPageMapping`, `vsm/physicalPagesWgsl.ts`).
6. The shadow raster, as the reference renders its shadow views: one cull over every caster and
   every map view of the frame, each view selecting its own level of detail, then one raster
   (`render/renderPass.ts`). The shadow views first descend the cut's hierarchy with the camera's
   own descent kernels (`traversal/`, `geometry/dag/shader/descentShape.ts`), as the reference's
   persistent hierarchy culling runs over every view of a pass, each candidate node carrying its
   view: a view is a map of a light and a mip of it that has a page to draw (the reference's packed
   views, one a map and mip), queue 0 holds every view's roots (or the placement tree's top nodes),
   and each level tests an entry's children against its view — in the map's frustum (the node's
   own oriented box, which holds the boxes of the clusters below it, and, in the dynamic layer, the
   map's dynamic depth range on that box; a local light's range on its sphere doubled; the pages to
   draw under the cube about that sphere, over a receiver of the map's cover where the map keeps one
   and the layer is not the static one, as the cull asks a cluster's), the error its subtree replaces
   seen at the view's mip, projected as the cull projects a cluster's — and, while the previous
   frame's pyramid and tables are kept, against the map's pyramid (below). A kept leaf asks for its
   pages in each view that keeps it, through the camera's one request path (`requestPage`, read back
   and handed to the streaming beside the views' readbacks, `traversal/requests.ts`, at the category
   the reference gives shadow views, below the camera's), and lists its resident pages once. The
   descent's node room is the cut's own cap (`cutMaxNodes`), fixed; a frame past it draws
   what fits. The candidates kernel
   (`render/renderCandidatesWgsl.ts`, one thread a page the descent listed) keeps those that may
   cast — the cut's tables, the
   HLOD switch (`geometry/dag/shader/worldGateWgsl.ts`, `worldDraws`: an HLOD actor the view does not
   draw, or a cell's objects it does not draw, casts nothing), the main view's filter and the draw
   distances —, and the decode makes their pages (`casters/casterFeed.ts`, `visibility/decode/`). The
   cull (`render/renderCullWgsl.ts`, a thread a caster and a light) takes each map and each mip it
   draws as a view of its own: the engine's cut rule on the cluster's errors projected by that view
   (`vsmRenderLodAt`, at the cut's threshold times two to `shadowGeometryLodBias`, 1 by default, the
   reference's own, over the streaming's quality scale), the frustum (the cluster's own oriented box
   in the map's shifted space, its centre and three half axes, not a cube about its sphere; the sphere
   keeps the light's range, the level of detail and the raster choice), the
   page rect clipped to the stale rect, its overlap with a page to draw, then the rect walked by
   windows of four pages a side (eight for the software raster), a record a window that holds a page of
   the caster's stale layer. Each page that joins a window is marked drawn by the cull, as the reference's cull marks a page it keeps, and
   the window's rect is clipped to the pages that are ones to draw at their level (`vsmCullMarks`: a device that grants ten
   storage buffers a stage binds the page table and the raster marks in the cull; one with fewer has the bin mark the pages of
   the record's rect that the cull matched by the caster's layer — those it keeps, no other —, and the raster leave out the pages
   that are not ones to draw). The bin (`render/renderBinWgsl.ts`) sorts the records by raster pipeline; the raster (`render/renderRasterWgsl.ts`) draws each window over a viewport of four pages, each
   fragment translated through the page table. A sun's far casters are left out ([Far
   casters](#far-casters)). The records' list holds `cutMaxVisibleClusters` records, fixed (within the device's
   binding and the memory budget's share); the candidates hold the clusters that may cast, within
   `cutMaxCandidateClusters`; a frame past a room draws what fits.

   **Software raster of the small clusters** (`softwareRaster`, `hardwareRasterEdgePixels`;
   `render/renderSoftwareWgsl.ts`). The cull picks each caster's raster in each map's mip view by the
   camera's rule: a cluster whose longest edge (the cut's measure, `GpuSelection.edges`, times its
   placement's greatest scale) spans no more than `hardwareRasterEdgePixels` pixels at the nearest
   point of its level of detail's sphere — its whole sphere where its vertices move — is the software
   raster's, unless its box crosses the map's near or far plane, it is tessellated, a voxel row or a
   line (`vsmRenderSoftware`). Its records hold a window of up to eight pages a side, the page table
   words of the window laid by the bin in the sorted list's end (four to a line, a counter taking the
   lines; short of room the window is lost and the records' overflow flag is raised), and come first in
   the sorted list. In the same compute pass, after the
   bin, the camera's one cluster raster (`visibility/raster/clusterWgsl.ts`, `clusterRasterKernels`)
   draws them: a group of 64 threads a record, the corners transformed once into the group's memory,
   a thread a triangle, the camera's subpixel setup and fill rule on a frame of the window, each pixel
   translated through the 8×8 cache of the window's pages the group keeps in its memory (the
   reference's late translation) and joined to the pool by an atomic max where a masked row's cutout
   keeps it, as the hardware fragment does. Two entry points bind one pool slice each — the eight storage
   buffers a stage holds, so the page table is not a ninth: its words come in the sorted list — : every
   record into slice 0, then the static layer's into the static slice. Without the page rows'
   compute group, every cluster is the hardware raster's.

   **Occlusion culling** (`shadowOcclusionCulling`, on by default; `vsm/occlusion/`). The set holds a
   depth pyramid of the physical pool — r32float, one layer, half the pool's power-of-two extent at
   level 0, seven levels: 64 to 1 texels a page, each the farthest depth of the texels under it — and
   the tables it is read through: the frame's page table, its pages' marks and its stale rects,
   copied once the pages are granted into its frame set's textures, read by the next frame as the
   previous one's (`occlusionResources.ts`). With a previous frame kept, the nodes and the clusters
   are judged twice. In the descent (`traversal/traversalWgsl.ts`, `boxSight`), each node's sphere,
   doubled, is tested in its view — the map's mip — where the previous image drew it (the
   placement's previous pose, `vsmRenderPrevShift`) against the previous frame's pyramid, in both
   layers of the map: a node hidden in both is not walked and its pages are not listed, it waits for
   the post pass (`postNode`, with its view). In the cull, the first (`vsmRenderCullFirst`) tests
   each mip view of a caster that overlaps a page to draw, as the map's previous view saw it (its
   previous id, table and clip matrix, which the plan writes into the map's record,
   `occlusionView.ts`), against the previous frame's pyramid; a hidden caster draws and marks nothing
   and is held back from the end of the records' list. The pyramid is built over the pages drawn
   (`occlusionWgsl.ts`: the pages whose static layer was drawn, or their dynamic layer where the map
   is redrawn whole, are selected as the raster marks are folded; every held page with
   `shadowOcclusionFullUpdate`). Then, in a compute pass of the view pass, the descent's post pass
   tests the nodes it held back against this frame's pyramid (`dagPostNodes`, the views of the view
   pass alone): a node seen enters queue 0 and every level runs again on it, its leaves asking for
   their pages and listing the resident ones behind the main pass's; the casters of those pages
   are made and decoded (`vsmRenderCandidatesPostDone`, the decode of the post pass), then the post
   cull (`vsmRenderCullPost`) takes them through the level of detail and this frame's pyramid, and
   the second cull tests what the first held back against it — this frame's tables, the caster's
   stale layer — and draws what is visible. The tests (`occlusionTestWgsl.ts`) read the pyramid at
   the level where the rect spans four texels, page by page at each page's physical place; a page the
   table does not map at that mip hides it. A node's sphere doubled hides only where every cluster
   under it is hidden, so the descent drops no cluster the cull would draw.
   The pyramid is built between a view pass's first and second halves, over what its first raster
   drew, and once more after the last pass, over what the frame drew. Without a previous frame — a
   set's first, after a frame that drew no map — each view pass culls once with no test and the
   descent holds nothing. Turning the setting on or off makes the set again, its pages drawn again.
   The pyramid takes a third of a pool slice (more where the pool's height is no power of two), the
   kept tables two copies of the page table, its marks and the stale rects (`occlusionPyramidBytes`,
   `vsmTableBytes`).

7. Post render (`vsm/pageManagementPass.ts:encodeVsmAfterRaster`), then the projection into the
   suns' and the local lights' masks (`projection/projectionPass.ts`, `projection/projectionWgsl.ts`,
   `trace/traceWgsl.ts`).
8. The lighting pass reads the masks; the frame end copies the counters back a few frames late
   (`lighting/shadows/vsm/frame/vsmFrameEnd.ts`).

Rules across passes: every page allocated and valid this frame is drawn this frame, or drawn again
by the frame after a list held short; a still scene draws nothing after its first frames, every page
keeping its static depth, and a static caster that moves redraws only the pages its previous and its
new box cover, into the dynamic slice (`shadowCacheFramesStaticThreshold`); a cell that switches between its objects and
its HLOD actor redraws, in the same image, the pages the clusters of both cover
(`frame/prepare/lightResources.ts:shadowsFollowCells`).

## Local lights' shadow gates and distant lights

Before a point, spot or rectangle light is given maps, the plan asks four gates, in this order, of
each light that casts and whose reach the view sees (`lighting/shadows/vsm/localGate.ts`,
`lighting/shadows/vsm/frame/vsmPlan.ts`): a light that casts no shadow is asked for none of them. A
light that fails one takes no map, no page and no projection that frame, and its cache waits
unreferenced:

1. `shadowPointLightShadows` (`true`): a point or rectangle light takes a shadow at all. A spot is not concerned.
2. `shadowResolutionScaleZeroDisables` (`true`): a light whose `shadowResolutionScale` is 0 takes none.
3. `shadowPointLightCubemaps` (`true`): a point or rectangle light takes its shadow as a cube of faces; off, it takes none.
4. The fade. The light's radius in pixels (a spot's: that of the sphere inscribed in the end of its cone; the distance from
   the eye never under 1 cm) times its kind's texels per pixel (`shadowTexelsPerPixelPoint` 1.27324,
   `shadowTexelsPerPixelSpot` 2.54648, `shadowTexelsPerPixelRect` 1.27324) is its resolution; its own scale and the most
   (`shadowMaxResolution`, 2048, less the 4-texel border of a spot's map each side, never under 0: a cap
   smaller than the borders leaves a spot no shadow, it does not lift the cap) hold it. The shadow is whole
   above `shadowFadeResolution` (64), gone at and below `shadowMinResolution` (32), and between them fades by
   `shadowFadeExponent` (0.25); a fade of 1/256 or less takes no shadow. `shadowFadeUsesResolutionScale` (`true`) says whether
   the fade reads the resolution after the light's own scale.

The quality levels write `shadowMaxResolution` (512, 1024, 1024 below `max`, 2048). The gates read the view the plan is made for: its projection, its eye and its size in pixels.

```js
const world = createWorld('viewer', { shadowMinResolution: 16, shadowFadeResolution: 32 }) // keep small far lamps longer
world.shadows = { shadowPointLightCubemaps: false } // point and rectangle lights take no shadow; spots keep theirs
world.shadows = { shadowPointLightCubemaps: null } // back to the default
```

A rectangle light takes the six faces of a point light's cube, as deep as its `range`: its source is
its panel, so its penumbra is traced toward its centre through a cone whose radius is half its width, and a
surface behind its plane is outside its shadow region (a surface exactly in the plane is in front: the
rectangle lights it).

### Distant lights

A local light whose finest needed mip is the last one — its map fits in one page — is distant
(`shadowDistantLightMode`, `1`; `2` makes every local light distant, `0` none; `vsm/distantLights.ts`). A
distant light takes the last mip alone, its page always marked (whatever `shadowMarkCoarsePagesLocal` says). It is
drawn once, then kept whatever moves: the invalidations of the casters leave it alone, and it is drawn again
only on its turn, or where its own key changes: it moves, is turned, is resized or stops being distant. Each
frame `shadowMaxDistantUpdatePerFrame` (`1`) of the distant lights whose cache is whole — the ones left longest
first — have their turn (`-1` every one, `0` none: then a distant light is drawn again only where its key
changes). At or under that count every distant light has its turn at every frame — a lone far lamp is drawn
each frame, as with the mode off —; only above it do they take turns, so that a scene of many far lamps pays
for a few a frame. The turns go once a scene frame, however many views draw it: the first view's setup takes
them, the others' none (the distant lights' maps are shared by every view). A distant light's first two frames are drawn, as any light's: the second turns its maps from
uncached to cached.

```js
world.shadows = { shadowDistantLightMode: 0 } // no light is distant: every local light follows its casters
world.shadows = { shadowMaxDistantUpdatePerFrame: 4 } // up to four distant lights a frame
```

## Classic shadow maps

`shadowVirtualEnable` (`true`) keeps the virtual shadow maps. Set to `false`, every light takes a classic shadow map instead: a map of fixed
resolution whose pages are all resident, asked for by the lights and not by the pixels of the view (no marking), and drawn by the same raster in the same pool.

- A sun is drawn in cascades. Its distance (400 m by default) times `shadowDistanceScale` (0 to 2) is divided in `min(4, shadowCsmMaxCascades)`
  cascades, each three times as long as the one before; a cascade fades into the next over a tenth of its length times `shadowCsmTransitionScale`
  (0 to 2). A cascade is drawn in the clipmap level whose texels are the nearest at or above those `shadowMaxCsmResolution` (2048) texels
  over its bounding sphere give, over the pages that sphere covers. An orthographic view draws no cascade.
- A local light is drawn in one mip of its map, whose texels are the nearest at or under its resolution (the gate's, above), over every page.
- The biases are `shadowCsmDepthBias` (10), `shadowCsmSlopeScaleDepthBias` (3), `shadowCsmReceiverBias` (0.9), `shadowCsmSplitPenumbraScale` (0.5), `shadowTransitionScale` (60), `shadowPointLightDepthBias` (0.02), `shadowPointLightSlopeScaleDepthBias` (3), `shadowSpotLightDepthBias` (3), `shadowSpotLightSlopeScaleDepthBias` (3), `shadowSpotLightTransitionScale` (60) and `shadowSpotLightReceiverBias` (0.5).

```js
const world = createWorld('viewer', { shadowVirtualEnable: false, shadowCsmMaxCascades: 3 }) // classic maps, three cascades
```

## Far casters

A sun's shadow maps follow the eye, and the reference's far-shadow test (`TestPrimitiveFarCascadeConditions`) leaves a
subject far past the distance they are asked to reach out of them — but only the subjects its CPU gathers, which are
no cluster geometry; no shader of its cluster or virtual-shadow-map culling carries the test. Every caster the engine
draws is made of clusters (`lighting/shadows/casters/casterFeed.ts`), so the maps take each of them at any distance, whether
its object casts far shadows or not, and nothing is left out by the test: the candidate kernel
(`vsmRenderCandidates`, `vsm/render/renderCandidatesWgsl.ts`) and the cull (`vsmRenderCull`) read no far-shadow
distance. No distance-field shadow takes the far geometry in their place on the view: the maps draw the clusters at
any distance, and every mesh the engine draws is made of clusters (see "The distance-field cascade" below).
`farShadowCulling` decides whether a sun has a near edge and the distance-field cascade that follows it; the
reference's test would act on a caster that is no cluster geometry, of which the engine has none, so it has no switch
for the test.

**The edge.** `sunCascades` (`packages/sdk-core/src/contracts/sunCascades.ts`) lays the sun's levels from its own
settings and the view's: the near levels (the light's `shadowCascades`, 4 by default, at most the view's
`shadowNearLevels`), each `shadowCascadeExponent` (3) times the span of the one before, an overlap of
`shadowCascadeTransition` (a tenth) of the last one's span times the view's `shadowOverlapScale`; the edge is the far
end of the last near level with that overlap (427 m at the defaults, the distance itself from 512 m on). Each map's projection record carries it
(`farShadowEdge`, 0 for none; a local light's is 0).

**The cache.** A sun's own shadow settings — the eight of the `LIGHT_SHADOW_FIELDS`: the distance, the cascades and the distance-field cascade's — are part of its clipmap's cache key (`lighting/shadows/vsm/lightCache.ts`): a sun
changed by one has no cached page of the old one, they are drawn again. The edge is not: what the view's
`shadowDistanceScale`, near levels, overlap and switches make of it each frame reaches the next frame's test, and
the cached pages are kept.

A cache entry is keyed by the light's id, the view it is drawn for and its shadow type (0 the regular maps, 1 a sun's
first-person clipmap), as one structural key (`vsmCacheKey`), so that a light named with a `#` and a view with any name
never share an entry. The first-person clipmap keeps its sun's own id and lives as long as the sun does (a removed light
takes all its entries). A placement that is parked or taken away goes back to static in the mobility state (`park`, called
by `flipWorld`): not moving, never moved, its pose kept (shown again where it stands, it is no move), its word written again by
`flipWorld`; a placement that takes its row later starts as a new one.

**A level's depth range and its moving casters.** A level that keeps pages draws its dynamic layer again each frame, so a
moving caster is culled past the end of what the level shows: with `shadowClipmapCullDynamicTightly` (true) the level's
projection record carries `dynamicDepthCullRange`, whose near-side limit is the clip depth of the point `cullingEnd` along
the light, `cullingEnd` being the level's radius at its level less the clipmap's resolution bias (the pool pressure bias
is not in it), and whose far-side limit is the largest float; the cull (`vsmRenderCullView`) reads both for the casters
not in the static layer, and a map that is not a clipmap level keeps `0` and the largest float. A clipmap that keeps no
page (`shadowForceInvalidateDirectional`, false; the first-person clipmap always) is drawn uncached, and with
`shadowClipmapCullDynamicTightly` its depth range itself is cut, from `depthRadius` on the near side to `cullingEnd` on
the far side, with no shift for the eye's depth.

**The width a sun's clipmap is sized for.** A sun's clipmap sizes its texels for the width the frame is drawn at, so a
render resolution lowered by the dynamic resolution or a quality level coarsens its shadows too.
`shadowClipmapMinCameraViewportWidth` (0, from 0 to 16384 pixels) floors that width (`VsmViewport.minScreenWidth`,
`planMaps`): a frame drawn narrower keeps the shadow resolution of that width; 0 floors nothing. Local lights read the
drawn size alone.

```ts
world.shadows = { shadowClipmapMinCameraViewportWidth: 1920 } // a lowered render resolution keeps 1920-pixel sun shadows
```

**The lights a perspective view draws.** A point, spot or rectangle light too small on the screen or past its own distance is
left out of the view, its shadow maps and its lighting both. The rule (`lightDrawn`, `lighting/lightDrawRange.ts`, reading the light's
record: `SceneLightStore.draw`) is decided once for each light and each view, on the CPU, on the squared distances;
the decision rides in one bit of the light's own record, which the light grid's lists and the walk of every light read, and the shadow
plan's `vsmLightSeen` asks the rule itself. A light is measured by its bounding sphere (`coneSphereAlong`, `coneSphereRadius` for a spot): the
ball of its range around its position for a point or a rectangle; for a spot, the sphere that holds its cone, centred along its
axis — `range * cos(outer)` along with the radius `range * sin(outer)` for a cone wider than 45 degrees, else the radius
`range / (2 * cos(outer))`, centred that far. A light of bounding radius `W` metres whose sphere's centre is at the distance `d`
is drawn while `min(0.02, lightMinScreenRadius / W) * factor * d < 1` — `lightMinScreenRadius` 0.03, `factor` the view's horizontal
field of view in degrees over 90, or 1 where `lightDrawRangeFollowsFieldOfView` is `false` (default `true`): a light of 1.5 m or less,
or of no range, is left out past 50 m, a larger one past `W / 0.03` — and, when it names a
`maxDrawDistance` above 0 (`SceneLight.maxDrawDistance`, metres), while `d < maxDrawDistance * lightMaxDrawDistanceScale`
(`lightMaxDrawDistanceScale` 1; a scale of 0 leaves out every light that names a distance). A `maxDrawDistance` of 0 is no limit; a directional light and an orthographic view always
draw. `lightMinScreenRadius` 0 leaves no light out by its size.

```ts
world.shadows = { lightMinScreenRadius: 0.06 } // small lights are left out twice as near
```

**An orthographic view's clipmaps.** A perspective view centres a sun's clipmap on its eye. An orthographic camera can
stand far from what it shows, so four settings, at their defaults, centre and size the clipmap on what it frames.
`shadowOrthoEstimateClipmapLevels` (true) starts the first level from the width of the view's box (the level of half
that width, never under `shadowClipmapFirstLevel`) and `shadowOrthoClipmapLodBias` (0, from -30 to 30) adds that many
whole levels to it, never below level 0; with the estimate off the first level is `shadowClipmapFirstLevel`.

`shadowOrthoProjectViewOrigin` (true) moves the clipmap's origin from the eye onto the camera's `viewTarget`: the offset
from the eye to the framed point, in the camera's own frame, so it follows a rig that moves the camera (read while the
view works its planes out, `cutViewOrthoAutoPlanes`, below). Write it with
`camera.setViewTarget(point)` (a point of the frame the camera's `position` is in; `null` frames none) or `camera.set(pose)`
(the pose's world target); the orbit, trackball and pan-zoom controls write their pivot, and the fly, first-person and
character controls frame none.

Where the camera frames none, `shadowOrthoRayCastViewOrigin` (true) centres the clipmap on the first body the camera's
line of sight meets in the physics: from the eye along the view, as far as the projection's depth spans, against every
object type, complex collision, through the body of the camera the view is drawn from, if it has one. It needs a casting
sun and the physics on (`world.physics.enabled`), and meets only what the physics streams; a line that meets nothing
leaves the clipmap on the eye. The physics answers from its worker, so the clipmap uses the previous answer; the view
asks again when its ray or the physics' world changes.

```ts
world.camera.setViewTarget(city.position) // an orthographic view frames the city
world.shadows = {
  shadowOrthoProjectViewOrigin: true, // the clipmaps centre on the city, not on the camera (the default)
  shadowOrthoRayCastViewOrigin: false, // a camera with no target stays on the camera
  shadowOrthoEstimateClipmapLevels: true, // the first level follows the box's width (the default)
  shadowOrthoClipmapLodBias: 1, // one level coarser, for fewer pages
}
```

**An orthographic view's origin and range.** An orthographic camera can stand far behind what it shows, with its
near plane behind it. Before any pass reads the view, its near and far plane are worked out and its origin is moved
onto the near plane, so light resolved at the origin (the clipmaps among it) is resolved where the picture begins and
nothing in the foreground is clipped. The planes come first, then the move. `cutViewOrthoAutoPlanes` (true) works the
planes out from the box's width, the view's angle to the ground, the distance to the point the camera frames and the
picture's size in pixels; false keeps the near and far the camera declares, and the point it frames is not carried
(`camera.viewTarget` stays as the camera's own and is not read by the clipmaps). A perspective camera is never worked
out. In metres, with the settings at their defaults:

- the box's width and height are `width / aspect`; the view's angle gives a cosine, 1 looking straight down, 0 level;
- the far plane scales with the size of a pixel in the world when `cutViewOrthoAutoPlanesHalfFloat` (true) is on, so a
  pass that downsizes depth in half floats keeps it: the height over the picture's rows, rounded down (in centimetres),
  its logarithm with `cutViewOrthoAutoPlanesScaleUnits` (true), times 655.04 m, held between 655.04 m and the world's
  reach; `cutViewOrthoAutoPlanesDepthScale` (-1) above 0 replaces 655.04 m by a shorter depth. With the half-float scale
  off, or no picture size, the far plane is the height over the cosine, a level view reaching the world's;
- the near plane is behind the origin by up to half the box's larger side, less the distance to the framed point times
  the cosine;
- `cutViewOrthoAutoPlanesShift` (0 m) moves both planes along the view.

`cutViewOrthoNearPlaneCorrection` (true) then turns the move on; false leaves the origin as the camera has it. A camera
with a `viewTarget` puts its origin on the target, moved along the view by `near`; the target keeps its place, so its
offset from the origin shrinks to `near`. A camera with none moves its origin along the view by `near`, and, with
`cutViewOrthoCameraHeightAsViewTarget` (true), by one more length: its height above the ground, or the box's half width
as drawn if that is smaller, times the view's slope against the vertical (the more it looks straight down, the more it
moves). The range then starts at `cutViewOrthoNearPlane` (0 m) and keeps its length `far - near`. The physics sends an
orthographic camera's view from that origin and to that far plane, from the last image drawn.

```ts
world.camera.setViewTarget(city.position) // the origin goes onto the city, `near` back along the view
world.cut = {
  cutViewOrthoAutoPlanes: true, // the planes are worked out from the box and the picture (the default)
  cutViewOrthoAutoPlanesHalfFloat: true, // the far plane scales with the size of a pixel (the default)
  cutViewOrthoAutoPlanesScaleUnits: true, // by its logarithm (the default)
  cutViewOrthoAutoPlanesDepthScale: -1, // from the half float's largest depth, 655.04 m (the default)
  cutViewOrthoAutoPlanesShift: 0, // both planes stay where they are worked out (the default)
  cutViewOrthoNearPlaneCorrection: true, // the origin and the range are corrected (the default)
  cutViewOrthoCameraHeightAsViewTarget: true, // a camera with no target uses its height (the default)
  cutViewOrthoNearPlane: 0, // the corrected range starts at 0 m (the default)
}
```

**The cache's and the receiver masks' switches.** Each is a view setting at the reference's default.
`shadowCache` (true) keeps the pages from one frame to the next: off, every light is drawn uncached each frame, the
distant lights are never kept, and the set is made without a static layer in its pool (`VsmLayout.cacheEnabled`), so
a change makes the set again (`heldVsm`) and drops its pages. `shadowForceInvalidateLocal` (0) draws the local lights
uncached each frame: 1 those that are not distant, 2 all of them (`addVsmLocalLightShadow`).
`shadowCacheAllocateViaLru` (true) keeps the pool sort's order (empty pages first, then the page wanted longest ago,
frame by frame, with no level order; pages of one age in pool order); off, `poolSlotRank` ranks every page not wanted this frame alike,
so the empty pages go first, then the highest pool index (`poolPage`, `VsmPmParams.lruAllocation`). `shadowForceFullPageClears` (false) clears a stale page's
layers whatever the cleared bits say (`VsmPmParams.fullClears`, `vsmListClears`).
A placement that a skin or a morph deforms is cached as dynamic while it deforms.
`shadowUseReceiverMaskDirectional` (true) and `shadowUseReceiverMaskLocal` (false) give a light's maps the receiver cover
(`VSM_MAP_COVERAGE`, `VsmLightCache.useCover`): a page of a map with it is drawn only for the receivers its mask holds and
its dynamic layer is drawn again each frame; a change of the setting draws the light's pages again, and the sun's
dynamic depth range is cut by `shadowClipmapCullDynamicTightly` only while its cover is on. The cover is sized for the
suns' maps alone; with the local setting on it is sized for every map (`VsmLayout.coverMode` `all`) and the set is made again.
`shadowDynamicDeallocationMode` (0, from 0 to 2) is what a frame at `shadowQuality` 0 does with the set held (`planNoShadows`):
1 frees it (`releaseEngineVsm`: the pool, the tables, the cache), 0 and 2 keep it and drop its cache (`dropEngineVsmCache`: the
previous frame forgotten, every light's entry invalidated, so the first frame that shadows again draws each light uncached; no
page is read that the casters, changing unseen, could have left stale; the plan and the reads it left pending are forgotten, and the
set counts no light and no map, so the panel shows 0 and the inspection no map, and each such frame settles it at once, `noteVsmIdleFrame`). Mode 0 frees only where a many-light shading mode is in
use, which this engine does not have, so it behaves as 2: the pool's memory is held while the shadows are off, and a toggle of
`shadowQuality` makes no set again. `shadowCacheDebugSkipDynamicPageInvalidation` (false) is a debugging switch: the page
management applies none of the invalidations a cached page carries (the static and dynamic ones of the moved casters, the
deferred ones, which keep their mark, and the receiver cover's redraw; `VsmPmParams.skipDynamicInvalidation`, `vsmKeepPages`), so a
moved object leaves its old shadow in the pages. It skips no more: a page cached whole under an offset the map allows keeps the
dynamic-stale mark that has the casters' cull consider it (nothing is cleared or drawn in it; it is no invalidation, and the
reference leaves it on too: `VirtualShadowMapPhysicalPageManagement.usf` 443, where the switch only clears `bDynamicPageInvalidation`,
`VirtualShadowMapArray.cpp` 3294, and so the block of 328).

**The distance-field cascade.** The same levels shape the cascade after them, from the near levels' end to
`distanceFieldShadowDistance` (`sunCascades`): it moves the far-shadow test's edge, and nothing is traced on the view
with it. The sun's shadow maps draw every cluster at any distance (`vsmFarShadow.ts`), and every placement the engine
draws is made of clusters, so a distance-field shadow of the view would shadow nothing: the reference leaves the
Nanite geometry out of the cascade of a sun that has virtual shadow maps (`DistanceFieldShadowing.cpp` 654-655) and
the engine has no mesh that is no cluster geometry, so the view has no such pass, mask or setting. The distance fields
of the meshes shade one thing of the sun: the cards of the surface cache, which the shadow maps do not reach. For each
sun with shadows, the meshes that cast are listed by tile of a shadow space across the sun over the cube the cards are
kept in (`lighting/surfaceCache/lighting/meshShadow.ts`), every mesh, the ones made of clusters too, and the cards'
direct light traces its rays through the tile's meshes. The meshes are tracked beside the cut's
roots (`lighting/distanceField/objectTracker.ts`): the placements of compiled meshes that have a field, and the
fields of the world DAG's HLOD cells (`lighting/distanceField/hlodObjects.ts`: a stand-in for each cell and each
instance of the world DAG, placed only while the cut draws the cell's actor, so the shadow of a merged shell is
drawn exactly where the shell is; the layer's `allowDistanceField` asks the compiler for them). No far level
is drawn: the levels a light's `farShadowCascades` ask for are counted — a light with some ends its near levels
with the overlap and lets the cascade fade out by it —, never drawn. The count of near levels, the scale on
the overlap and the far field are settings (`shadowNearLevels`, `shadowOverlapScale`, `shadowFarField`,
`packages/sdk-core/src/contracts/shadowOptions.ts`, `sunShadowOptions.ts`); the growth, the overlap's tenth and the
512 m are the light's own settings (`packages/sdk-core/src/contracts/lightShadowOptions.ts`).

The cards' lists, in the reference's order (`lighting/distanceField/shadow/frame.ts`), run before the surface cache's
lighting. Per sun: the meshes culled to the volume's hull (the hull of the cube and of the silhouette edges extruded
along the light, at most 12 planes); then their boxes drawn onto the grid of tiles across the light once to count the
meshes of each tile, the tiles' start offsets summed, and drawn again to write the lists — the count and the offsets
only where the lists are compacted (`distanceFieldShadowCompactTiles`, on; off, each tile has a place of its own, the
room over the tiles, and a tile past its place loses meshes).

**The shadow space.** The cards' cube is held in a sphere; the space the tiles are cut across is
the sphere's: the light's right and up over the sphere's radius rounded up to a centimetre, the depth toward the
light over twice the greater of that radius and 5000 centimetres, so a small volume still sees the meshes 50 metres either side. The tile grid (a radius over the tile's size and one, at most 256
tiles across, a multiple of 64) and the growth of the boxes read the sphere's own radius, not the rounded one. The
space's origin is snapped across the light to a grid fixed in the world, 4 texels of a map of
`distanceFieldShadowSnapResolution` texels (2048, less 4 each side) a step, so the grid moves in steps with the
camera, not with it.

A caster whose object names draw distances it lies outside of (`drawDistance`,
[ENGINE.md](ENGINE.md#webgpu-page-raster)) is left out by the same kernel, before the far test, from
the main view's eye in every pass of the light: the object's centre against its distances, scaled
by the cut's view distance scale alone (no field of view scale); an instance's share follows
`cutDrawDistanceCulling`.

## Reading the shadow

One estimator shades every surface: the receiver's trace (`trace/receiverTraceWgsl.ts`) — the
normal bias, a screen ray for the contact, then rays across the light's disk or sphere marched
through the stored depths. Opaque surfaces read it from the mask, where the projection pass traced
it 64 pixels a workgroup, its 32-pixel halves voting their ray count. A blended surface reads its
own fragment on the same view and maps, as two project switches say (`shadowTranslucentQuality`,
`shadowTranslucentLocalLights`, read once when the session opens, `frame/prepare/setup.ts`): by default
one sample of the sun's map (`lighting/direct/shadowTraceWgsl.ts:vsmSampleFactor`, the local lights
lit whole), at quality 1 the trace itself on the same view, noise, maps and depth pyramid
(`vsmTraceFactor`), lone: no vote, so a fragment stops early only on its own narrow contact and never
traces fewer rays than a voting pixel. A
material asks more of its own: `translucentDirectionalLightShadowQuality` above 0 takes the trace for
the sun on its surfaces whatever the project switch says, `translucentLocalLightShadow` shadows the
local lights on them, and `translucentLocalLightShadowQuality` above 0 takes the trace for those
lights; the marks ride the item's flags (`materials/surface/surfaceModelWord.ts:TRANSLUCENT_SHADOW_MARK`,
`lighting/direct/shadowWgsl.ts:translucentMarksFrom`), and the programs of a scene whose surfaces ask
nothing hold none of that code. A rectangle light lights a translucent surface as a point light at its
centre unless the project switch `translucentRectLights` is on (`blend/shader.ts:translucentLitKey`),
and the translucent programs then hold none of the rectangle shading. The receiver's normal is the
surface's shading normal — the G-buffer's for an opaque pixel, the fragment's for a blended one —:
nothing is stored per pixel for the shadow. Every pass reads the pool
through the same buffers, one a slice, bound whole (`vsm/resources.ts`): 128 MiB at 2048 pages, 256 MiB
at 4096, 512 MiB at 8192. The device's binding is WebGPU's limit on that size (§ 3.6.2,
`maxStorageBufferBindingSize`, `maxBufferSize`), the session asks the adapter's
(`session/engine/common.ts`), and a device that holds less than the level asks draws the largest pool
that fits (`vsm/layoutBytes.ts:vsmPoolPagesBound`). A page not drawn hands its point to the next coarser level mapped; where none
holds it, it is lit.

## Contact shadows

Beside the receiver's screen ray, the lit passes cast a **contact shadow** of their own, per light, in the light's
term (`lighting/contactShadow/contactShadowWgsl.ts`): eight steps through the scene's depth from the pixel toward the
light, its length the light's `contactShadowLength` (a share of the screen's height, or metres with
`contactShadowLengthInWorldSpace`; 0 casts none) and only for a light that casts a shadow while the shadow quality is
above 0. It multiplies the light's
surface and transmission terms by `1 − intensity`, the light's casting intensity where the ray meets a surface that
casts contact shadows and its non-casting intensity where it meets an eye or a pixel of an object that sets
`castContactShadow = false` (the per-object bit, on by default). The eye model casts half a centimetre
toward any light, the hair model a fifth of the half height of the screen under a light with no shadow, whatever the
switch says. The view's `contactShadows` takes the lights' rays away, and the four `contactShadowOverride…` settings
replace the lights' own ([SDK.md](SDK.md#contact-shadows)). A see-through surface whose material sets
`contactShadows` and is lit with `translucencyLighting: 'forward'` (or is transmissive) is shaded by a ray of a fifth of
the half height of the screen, toward every light, through the opaque depth (level 0 of the depth pyramid), whatever the
light and the view's switch say:

```js
const lamp = light.spot({ position: [0, 3, 0], castShadow: true, contactShadowLength: 0.03 })
const world = createWorld('viewer', { contactShadowOverrideCastingIntensity: 0.5 })
statue.castContactShadow = false // its pixels stop no ray
const pane = material.meshStandard({
  transparent: true,
  opacity: 0.3,
  translucencyLighting: 'forward',
  contactShadows: true,
})
```

## Metrics

The `shadow*` fields are documented on the contract
(`packages/sdk-core/src/contracts/shadowMetrics.ts`) and filled by
`lighting/shadows/vsm/frame/vsmStats.ts`. The page counters need the page-counter readback on
(`countersOn`).

**Small objects stay out of the coarse pages, judged whole.** An object whose bounds cover fewer pixels of
the map's finest level than a threshold is drawn into the fine pages alone: `shadowCoarsePagePixelThresholdStatic`
(1) for an object cached in the static layer, `shadowCoarsePagePixelThresholdDynamicClusters` (4, the reference's value for
cluster geometry; every caster is cluster geometry, so the threshold it has for other geometry, 16, has no use) for one cached in the dynamic layer. The test is
the object's, never a cluster's (`vsm/render/renderCullWgsl.ts`): the object's own ball (`inst` of the candidate) must
overlap a page of the right kind, then each of its clusters takes every page its own rect overlaps, as the reference's
instance cull then its cluster cull. The invalidation of a moved object reads the same rule on the object's box.

**The footprint rule is a switch.** `shadowCoarsePagesIncludeNonClusterCasters` (true, the reference's default) leaves the rule
above to the two thresholds. Every caster here is cluster geometry (it reaches the maps through the candidates of the cut's
clusters: tessellated, voxel, sprite, line, skinned, instanced and first-person rows alike), so `false`, which keeps the casters that
are not clusters out of the coarse pages, puts every caster of ours in them, whatever its footprint, and the thresholds are read by
none; the invalidation of a moved object and the raster's cull read the one switch.

```js
world.shadows = { shadowCoarsePagesIncludeNonClusterCasters: false } // every caster in the coarse pages, small ones too
world.shadows = { shadowCoarsePagesIncludeNonClusterCasters: null } // back to the default
```

**Moving objects are invalidated by what they leave and enter.** Each frame the roots pass wrote boxes, the diff of the
instances' boxes (`lighting/shadows/casters/castDiff.ts`) compares every placement's box with the one it was seen with
and stales the pages of both, a composed child's included (`rt.rootBoxes.written` is what it follows beside the scene's
revision): the reference's `UpdatedTransform` with the old then the new instance data
.

**The reference's settings now options.** The page marking takes `shadowPageDilationBorderSizeDirectional` and
`shadowPageDilationBorderSizeLocal` (0.05), `shadowCullBackfacingPixels` (true) and `shadowPageMarkingPixelStrideX` /
`...Y` (2); the receiver reads `shadowNormalBias` (0.5, thousandths of its distance to the eye) and the screen ray
`shadowScreenRayLength` (0.015); the cache `shadowCacheFramesStaticThreshold` (100), `shadowCacheMaxPageAgeSinceLastRequest`
(1000) and `shadowCacheMaxLightAgeSinceLastRequest` (10); the dynamic resolution
`shadowDynamicResolutionMaxResolutionLodBias` (2) and `shadowDynamicResolutionMaxPagePoolLoadFactor` (0.85). Each has
the reference's default, its meaning in `sdk-core/src/llm/shadowViewMeanings.ts` and its row in
`sdk-core/src/contracts/shadowMapOptions.ts`.

**The compute throttle (off by default).** Beside the pool's bias, the dynamic resolution can lower the maps'
resolution when the shadow raster costs too much, wholly on the GPU as the reference does: the raster counts the
clusters it draws in each map, and the next frame's kernels, run inside its marking between the page rects' initialisation and the clear of the page
tables, zero the throttle buffer, carry the counts to its maps, add to each map's bias in its projection record the share of the cost it takes, then zero the feedback the raster counts in. Nothing is read back. It is off
while `shadowDynamicResolutionTimeBudgetMs` and `shadowDynamicResolutionLoadBudget` are both 0, the default: nothing is
made, counted, written or run, and the marking and the raster are the programs without it; the sampling always reads
the bias of the clipmap map its level falls in, as the reference's does, which is the base map's while unthrottled. A
budget turned on or off makes no set again: the pool and the cache stay. `shadowDynamicResolutionLoadBudget` is the estimated load past which
the bias rises (lower is more aggressive); `shadowDynamicResolutionTimeBudgetMs` fits the shadow raster's GPU time to
a budget through the render scale's heuristic (it needs the render scale on `'auto'` and a GPU timer) and wins when
both are named; `shadowDynamicResolutionPerVsmBiasHistoryWeight` eases each map over the frames (any number, 0.9; the reference names 0 to 1 and clamps nothing); the two
`...MaxComputeResolutionLodBias...` options cap what a sun's maps and a local light's may take, within
`shadowDynamicResolutionMaxResolutionLodBias` less the pool's bias. Their meanings are in
`sdk-core/src/llm/shadowViewMeanings.ts`; the marking and the sampling of a sun's clipmap read the bias of the map
their level falls in.

```js
world.shadows = { shadowDynamicResolutionLoadBudget: 1 } // throttle the maps when the raster's load passes 1
world.shadows = { shadowDynamicResolutionTimeBudgetMs: 3 } // fit the raster to 3 ms (render scale 'auto')
world.shadows = { shadowDynamicResolutionMaxComputeResolutionLodBiasLocal: 1 } // local lights lose one level at most
world.shadows = { shadowDynamicResolutionPerVsmBiasHistoryWeight: 0.5 } // ease faster
world.shadows = { shadowDynamicResolutionLoadBudget: null } // back to the default: off
```

The trace's settings are options too, the reference's defaults: `shadowSmrtAdaptiveRayCount` (1; 0 turns the vote
off), `shadowSmrtMaxRayAngleFromLight` (0.03), `shadowSmrtExtrapolateMaxSlopeLocal` (0.05) and `...Directional` (5),
`shadowSmrtTexelDitherScaleLocal` (2) and `...Directional` (2), `shadowSmrtMaxSlopeBiasLocal` (50),
`shadowSmrtRayLengthScaleDirectional` (1.5), and `shadowMarkPixelPagesMipModeLocal` (0: every mip; 1 the even ones;
2 the odd ones). The sun ray's start dither is sized as the reference sizes it:
a step in the clipmap level's UV, `0.5 / 16384 * scale * distance to the eye / 2^(level - bias)`, added to the ray's start UV
once projected, with the plane bias `2 * max(0, dot(slope, step))` (the slope held to 0.05) less what the start offset
gained (`vsmSunDitherUv`, `vsmSunDitherBias`, `vsmRayLine`, `vsm/trace/traceRayWgsl.ts`); no page is read for it. A local ray's stays the receiver's pixel size at the
map's bias.

**The prefiltered distant shadow (off by default).** With `shadowPrefilteredDistant` (false) each sun's regular clipmap
(the first-person clipmap holds none) keeps a soft, filtered shadow of its far levels beside its pages, read by the
projection in place of a trace where it holds one. Turned on or off, the shadow set is made again (`heldVsm`,
`VsmAsked.prefilteredDistant`, `VsmLayout.prefilteredDistant`); with it off nothing is made, written or run, and every
program is the text it was. In order, a frame:

1. _The clipmap._ It keeps no page and cuts its depth at each level's end (`shadowForceInvalidateDirectional` and
   `shadowClipmapCullDynamicTightly` taken as on for it, `vsmClipmapConfig`), and each level's record carries
   `VSM_MAP_PREFILTERED_DISTANT`, its index in the clipmap (flags bits 8 to 15, `vsmClipmapLevelIndex`) and, in
   `dynamicDepthCullRange`, the clip depths of the band it draws into the filtered pages: from where the level before
   ends its band (0 for the first) to the level's own radius less the resolution bias, toward the light (`buildLevel`).
2. _The requests._ A page the view asks (a pixel, a froxel, a coarse page) carries `VSM_PAGE_PRIMARY` beside its
   wanted and fine bits. `PropagateFilterableRequests` (`filterablePropagateWgsl.ts`, the first dispatch of
   `encodeVsmPageMapping`, over the suns' per-page bins alone) walks every page of a level that holds a request through
   the coarser levels of its clipmap,
   asking the page that covers it in each `VSM_PAGE_SECONDARY` and fine, with the receiver cover's quarter folded down a
   mip a hop; a hop that changed nothing ends the walk.
3. _The cull._ A caster of a level is drawn where its box reaches in front of the band's outer end; one wholly inside
   the band's inner end asks the primary request of the pages it draws into, one that crosses it draws into the others
   too (`vsmCasterInDepthRange`, `vsmCasterMarkMask`), and a page matches the mask when it holds one of its stale bits and
   all of its request bits (`vsmMarksMatch`). The shadow views' descent asks the same of a node's box.
4. _The pages._ A page whose request bits (fine, primary, secondary) differ from those it holds is drawn again whole
   (`keepPages`); a page granted for a secondary request has bit 29 of its page-table entry (`vsmEntrySecondary`).
5. _The filters._ After the raster, the pages that are held, seen, secondary and of a prefiltered level are listed
   (`selectMerges`: the separable passes' list, the merge down's, the borders' count, in `filterableArgs` and
   `filterablePages`), and the filter passes run over them (`filterableWgsl.ts`) on byte pools of 130 x 130 texels a pool
   page (`VsmFilterable`: two `separate` pools by the frame's parity, the previous frame's history of the blend
   `shadowPrefilteredDistantHistoryBlendFactor`, 0.87, 0 turning the reprojection off; the `merged` pool, which the
   separable passes also use as their temporary pool, cleared again between them and the merge down). A separable pass
   holds the line it filters in workgroup memory, as the merge down holds the pages of the coarser levels. The frame end
   copies the suns' projection records, the level-0 rows of their page-table blocks and their receiver cover into the
   `history` buffer (`keepFilterableHistory`), when the blend asks it, with the map ids of the frame before
   (`uploadFilterableHistory`).

The pools, the arguments' reset and the filters are made, run and cleared in a frame with a map that holds the feature
alone. The pool's pages are as many as without it: a texel is a byte, stored `round(v * 255) / 255` as an 8-bit pool
stores it, by one atomic or into a pool the frame cleared (a byte is written once), and read with a bilinear sample of
byte loads, a word shared by the two texels of a row loaded once, the one path whatever the device. The set's memory
rises by three pools of 16 900 bytes a pool page, the history and the indirect arguments (`vsmResourceBytes`).

```ts
world.shadows = { shadowPrefilteredDistant: true } // soft, filtered far shadow on every sun's clipmap
world.shadows = { shadowPrefilteredDistantHistoryBlendFactor: 0.5 } // follow the light faster, alias more over time
world.shadows = { shadowPrefilteredDistant: null } // back to the default: off
```

**The counters over frames.** `shadowAccumulateStats` (0, none) collects the page counters of the shadow maps over
several frames (`statsAccumulate.ts`). While it is not 0, each frame that holds shadow maps copies the stats buffer
(pages requested, kept static and dynamic, cleared, newly granted, empty, left to the offset's cull, overflow flags) into
the next row of a buffer that lives across frames, by one thread (`vsmAccumulateStats`); above 0 it takes that many
frames then stops, a negative value goes on until it is set back to 0, and a new value restarts the count. At the end
the rows (at most 524 288) are copied to one readback and reported as a CSV, a header of the counters' names then a
line a frame, in the engine diagnostic `shadow-stats`. (The reference's count stops one frame short of its value;
here N frames give N rows.)

```ts
world.shadows = { shadowAccumulateStats: 600 } // ten seconds at 60 images a second, then the CSV
world.shadows = { shadowAccumulateStats: -1 } // until set back to 0
world.shadows = { shadowAccumulateStats: null } // back to the default: none
```

**The instance's cache state, per view.** The reference keeps, for each primitive view, two bit arrays: cached as dynamic, and
transitioned this frame. Here a placement has one word of them in the placements' buffer (`rootWords`, second section;
bits 0-15 the views it is cached as dynamic in, bits 16-31 the views it turned in this frame), a view's slot taken from
the cache (`VsmCacheManager.viewSlotOf`, 16 slots, the map's record carries it as `viewSlot`). `castInstanceState`
(`casters/castDiffWgsl.ts`) runs every frame: a tracked placement that began to deform (`MOBILITY_DEFORMS`) stales its dynamic layer
where it stands, the static one kept, in the maps of the views it turned in (the record's `views` word); its stop stales
nothing; a placement seen for the first time is no transition. The raster's cull (`vsmRenderCullView`) draws a caster cached
as dynamic in the map's view as a moving one, and one that turned this frame into every page it overlaps whatever the
page's stale layers say, the reference's `GetCacheTransitioned`.

**Oriented bounds, and the pyramid.** An instance is invalidated by its local bounds carried by its transform, not by the
world box that holds them: the roots pass writes, beside the world box and the ball, the three half axes of the oriented box
(`ROOT_BOX_DOUBLES`, doubles 11-15 of a root's record, `placement/compose/gpuComposeDerivedWgsl.ts`); the diff remembers
them (`CAST_STATE_WORDS`) and a record of the shadow changes is a centre, a sign, three half axes and the views it stales
(`CAST_RECORD_WORDS`, `casters/castChanges.ts`). The stale carries the unit box to the oriented one by the matrix of the
axes (`vsmStaleBoxPages`, `vsm/invalidationWgsl.ts`) and measures the instance by the length of its half axes. A page the
box lies behind, in the previous frame's depth pyramid (the kept tables the first cull reads), is not staled
(`shadowCacheInvalidateUseHzb`, true; the rect nudged a hair nearer, `1e-8`, and the layer the static casters read), as
the reference's invalidation tests each page against the HZB; a map of one page (a distant light's) has that page's static
layer staled and nothing else. `castBoxes.ts` writes the CPU's boxes in the same format, the axes along the world's.

**Six marks a physical page.** The raster marks a page it draws in six slices, as the reference's dirty flags: dynamic drawn,
static drawn, dynamic invalidated, static invalidated, an offset allowed, a level of detail behind
(`VSM_DIRTY_SLICES`, `vsmRasterMarkBits` in `render/renderBinWgsl.ts`). The cull decides the last four per cluster and map:
a surface that wears an offset its placement evaluates (`MOBILITY_OFFSET_SILENT` off, or the surface always evaluating)
invalidates the pages it draws when the map allows it — always, else the map's level is not past the distance the object stops
at (`wpoThreshold` against the placement's square distance, the third section of `rootWords`) — and the object lets it
(`shadowCacheInvalidation` not `rigid` or `static`), and is cached as dynamic then — all the clusters of its placement are, the
layer being decided for the placement (`MOBILITY_OFFSET_INVALIDATES`, `MOBILITY_OFFSET_ALWAYS`) and the map; an offset allowed where the main view's
distance has stopped it marks the page for the next frame (the physical page's `FORCE_CACHED`: the page keeps its data, its
dynamic layer marked stale so that the cull considers it, never drawn). A placement that wears such an offset arrives cached as
dynamic, as does a placement whose surface wears a displacement (the mesh shape is often moving: `MOBILITY_OFTEN_MOVING`, decided where the words
are written, `casters/rootWords.ts`); `shadowCacheWpoPrimitives` (false, the reference's `r.Shadow.CacheWPOPrimitives`) has them arrive cached as still ones
instead, their offset invalidating the pages it draws as before; `shadowCacheInvalidation` `static` keeps a placement out of the
dynamic layer either way. Turning the option makes every placement arrive anew, as the reference recreates its primitives' render state.
An arrival, new or returned from a parked row, starts with no cache state in any view (the CPU zeroes it, `casters/rootWords.ts`). `shadowInvalidateOnLodDelta` (false) marks the pages of a
cluster drawn behind the level the view asks, for want of the finer one resident; the invalidation waits for the page's turn,
`shadowDeferredInvalidationBudget` a frame (-1 all, 0 none; the count lives after the slices, `vsmKeepPages`). A map of one
page ignores both; so do the coarse pages that keep their dynamic layer. This is the one channel of streaming: the CPU
declares no box for a cluster entering or leaving residency, nor for a colour tile arriving, and what it declares of a
cell or a surface is a primitive or material update (a cell's switch between its placements and its HLOD actor, a
surface whose alpha mode or cutoff moved). With the switch off, the default, the cost is a cached page drawn before a
finer form arrived: it keeps what it was drawn with, and may show as darker patches along page edges, until the page
is drawn again for another reason.

**Depth of field lowers the maps' resolution.** Where the view draws a depth of field, the page marking and the sun's level
choice add `shadowMaxDofResolutionBias` (1) levels in proportion to the circle of confusion's radius over eight pixels
(`vsmDofResolutionBias`, `vsm/uniforms.ts`; the model of the lens as the pass compiles it, `vsm/frame/vsmDof.ts`). A second
layer for the dynamic casters in the depth pyramid is `shadowDynamicHzb` (false; it needs the occlusion and the cache): the
first layer holds the static slice alone, which static casters and the invalidation test against, the second the static and the
dynamic slice merged for the dynamic casters.

**Marking off.** With `shadowMarkPixelPages` (true) off, the marking of the view marks nothing past the coarse pages: neither the
pixel marking (the translucent front layer's and the water surface's marks included) nor the froxel marking runs
(`encodeMarking`, `viewMarking`), and the water's depth and the transparents' front pass are not drawn ahead of it
(`vsmFrontLayer.ts`); the pages of the view are never asked, so the shadows show where the coarse
pages and the cache hold them. It is a profiling and debugging switch.

**Marking from froxels.** With `shadowMarkPagesUseFroxels` (false) the pages are marked from the froxels of the depth, in place of
pixel by pixel (`vsm/froxel/`): the screen is cut into tiles of 8 pixels and the depth into slices as deep as they are wide
(a perspective view's by a constant factor, an orthographic view's by a constant step, `froxelGrid.ts`); one workgroup a tile takes
the slices its pixels fall in (`vsmBuildFroxels`, the unique ones appended to a list counted by one atomic, in a buffer of words
whose first two words are the count and the count held to the room), a one-thread kernel sizes the marking's indirect
dispatch from the count (`vsmFroxelArgs`) and a thread a froxel marks (`vsmMarkPagesFromFroxels`): in each sun's clipmap the level
the froxel's centre asks (the depth of field's bias added), every page its box overlaps there — the box carried to the map's clip
space and its rect of pixels taken to pages, the receiver cover's cells marked for a map that has one —, and in each local
light of the light grid's cell at its centre that it reaches, the face its centre lies in, at the mip its centre asks. A light with
a map of one page is left to the coarse marking (the pixel marking leaves it out as well). The froxel marking culls no pixel
that faces away from a light, takes no page dilation and marks no page for the translucent front layer. Where the scene's
single-layer water drew its depth before the marking (the water is drawn with `singleLayerWaterDepthPrepass`), a second pass of
the same kernels follows the scene's over the froxels of the pixels the water drew over (`vsmBuildFroxels` over the water's
depth, keeping the pixels whose depth differs from the scene's), with a grid and a list of their own, and marks the suns' pages
alone: the water takes no shadow from a local light. Its list takes a
froxel a pixel of the view at most, as the reference's room, held to the device's binding. The froxels are the reference's;
their order in the list is not (the reference reduces the depth pyramid's first level through a hash).

**The projection is two passes, as the reference's is.** The suns' pass traces every sun of the frame (`vsmProjectSuns`,
the adaptive ray count voted by the group, a sun's first-person clipmap and a subsurface receiver's transmission merged in) into a
layer of the suns' mask a sun (`r32float`, the share of its shadow at each pixel). The local lights' pass (`vsmProjectLocals`)
is one pass in which each pixel walks the lights of its own cell of the light grid — the cell the lighting walks — and, for the
shadowed ones, up to `shadowOnePassProjectionMaxLightsPerPixel` (16; 8, 16 or 32 lights make the mask 32, 64 or 128 bits a
pixel, `maskFormat.ts`), traces each and packs its share in four bits, sixteenths, in the pixel's mask
(`VirtualShadowMapMaskBitsCommon.ush`, `LightGridCommon.ush:PackShadowMask`). The order is the cell's list: the shadowed local
lights whose map is more than a page first, then those of a single page; the lighting finds a light's lane by walking the same
list the same way (`vsmMaskLaneOf`), as the reference finds it by the light's map id. A light whose lane is past the number the
mask keeps is not traced: the lighting reads one sample of its own map by the map's id alone (`vsmSampleMapLocal`,
`vsm/sampleMapWgsl.ts`; the cube face the receiver lies in, found in the map's own frame), lifted by 200 cm along the ray towards
the light, as the reference's lookup is (`SampleVirtualShadowMapLocal`). The local lit pass binds the shadow data for it
(`DEFERRED_BINDINGS.vsmUniforms` to `vsmView`); a shadowed light's slice carries the rank of its record in the projection's view
(a uniform of up to 1024 lights) and two flags, a sun and a single page (`shadowSliceOf`, `direct/shadowSlice.ts`).

**The per-light path (`shadowOnePassProjection: false`).** The one-pass projection above is the default. With the option
false the shadowed local lights leave the batched light loop and each is lit alone, one after the other, in the order of the
frame's projection records, after the batched (unshadowed) lights and the suns: the light's shadow is projected over the pixels
its range covers (`vsmProjectLight`, `perLightProjectionWgsl.ts`) straight into its layer of the screen mask (`rgba8unorm`, an
array of up to four layers, the square root of the share in every channel). The projection writes every pixel of the
rectangle, so nothing is cleared before it, as the reference's projection pass writes all the pixels it needs
(`shadowForcePerLightMaskClear` true clears the layer to 0 first, changing no image); then the light is drawn over the lit surfaces, its
shadow its layer squared, through the same light term as every batched light (`declaredLight`), the screen's occlusion read as the
batched passes read it. The indirect light is drawn first, before every light, in the pass of the batched ones. A frame of at most as many lights as layers keeps
its masks: where the projection is held (`vsmProjectionHold.ts`) and the layers stand, no light is traced again, as the one-pass
path reuses its mask. The cost is a projection and a draw per light, with no cap on the lights a pixel keeps
(`shadowOnePassProjectionMaxLightsPerPixel` applies to the default path alone), and the one-pass local lights' mask is not made
at all on this path (nor the layers on the other). The suns' pass and the light grid the marking prunes are the same in both paths; the
lights the batch lights are those of the grid no shadow slot names. While the path's pipelines compile, the shadowed lights are lit by
nothing and the frame is drawn again once they are compiled; the lit view of the share the shadows let through (`lightView` 2) reads the packed
mask, which this path does not make.

```js
world.shadows = { shadowOnePassProjection: false } // light each shadowed local light by a draw of its own
world.shadows = { clusteredDeferredShading: false } // the reference's UseClusteredDeferredShading off: the same per-light draws
world.shadows = { shadowOnePassProjection: false, shadowForcePerLightMaskClear: true } // debugging: no image change
world.shadows = { shadowOnePassProjection: null } // back to the one pass
```

**Subsurface surfaces let light through their shadow.** The trace returns the mean distance its rays that hit were stopped
at (`occluderDistance`, from the hit depth the march keeps: `vsmMarch`, `vsmRayOccluderDistance`); for a receiver that is a thin
sheet (the surface flag `SUBSURFACE_FLAG`, whose opacity is the alpha of the thin transmission target, `subsurfaceOpacityAt`,
held to 0.99), where the trace was shadowed, the light left is `e^(-distance * density)` of `-0.05 * ln(1 - opacity)` per
centimetre, added to the share the rays missed and squared (`vsmSubsurfaceShadow`). A sun's
disk grows toward `shadowSubsurfaceMinSourceAngle` (5 degrees) as the opacity falls, for those receivers.
The receivers of this are the thin sheet and the two-sided foliage (`vsmTransmitsShadow`); the preintegrated skin keeps its
shadow whole and its back faces culled, as a lit surface; every
subsurface model (the thin sheet, the foliage, the subsurface profile, the hair and the eye: `vsmSubsurfaceModel`) is read from any side of its surface and is
not back-face culled. A subsurface profile lets none of its light through the shadow maps: its transmission reads the shadow
itself as its thickness, in the lighting (`docs/ENGINE.md`, the subsurface profile), from a light that transmits.

**The first-person clipmap.** With `shadowFirstPersonClipmap` (true) each sun gets a second clipmap, from level
`shadowFirstPersonClipmapFirstLevel` (8) to `shadowFirstPersonClipmapLastLevel` (18), no coarse level, redrawn every frame
(`createVsmClipmap` with `firstPerson`; its maps carry `VSM_MAP_FIRST_PERSON`) while the scene holds an object that stands for a
first-person one (`Object3D.firstPersonWorldSpaceRepresentation`, the body of the player). Only those objects are drawn into
it and the regular maps leave them out (`vsmRenderCullCandidate`); the sun's trace reads it beside its own for every pixel that is
not a first-person object's (`Object3D.firstPerson`, the mark `FIRST_PERSON_SURFACE_FLAG`) and not fully shadowed already,
the more shadowed taken with its occluder distance (`vsmFirstPersonTrace`). The pixels of first-person objects ask the regular
clipmap `shadowFirstPersonPixelRequestBias` (2) levels coarser, never finer than level `shadowFirstPersonRequestMinLevelClamp`
(8), and ask nothing where the bias is negative; a first-person object casts no dynamic shadow of its own. The main camera's view does not draw the body
(its filter takes it, `hiddenFromViews`, `geometry/selection/viewFilter.ts`), and the shadow maps draw it all the same; an object
that casts while hidden (`castHiddenShadow`) is taken from every view's cut the same way and stays out of the parked roots. The
cuts that carry no view filter (the reflections' and the indirect light's rays) do not know either of them.

**Volumetric translucent shadows are not a virtual-shadow-map thing.** The reference makes the per-object translucency shadow
(`bCastVolumetricTranslucentShadow`) for the lights that do not use virtual shadow maps alone (`SetupInteractionShadows`, which
asserts the opposite, `ShadowSetup.cpp:3346`, and is called for the lights without them, `ShadowSetup.cpp:6504`); every light of a
project that has virtual shadow maps uses them (`LightSceneProxy.cpp:110`), so there is none to port: the option does not exist.

**The static layer is merged after the raster.** A static caster writes the static slice alone (hardware
raster `vsmRenderJoin`, software raster entry `vsmRenderSoftwareStatic`, or, on a device that grants nine storage buffers a stage, the one software
kernel `vsmRenderSoftware`, which rasters both layers' records in one dispatch after the hardware raster and writes each record into its layer's slice); after the raster the pages whose static layer
was drawn or cleared this frame, in a seen map of a cached view, are listed (`vsmSelectMerges`) and the deeper of the two
layers becomes the dynamic one (`vsmMergePages`, `lighting/shadows/vsm/physicalPagesWgsl.ts`), the layer every reader samples.
Each raster list holds `cutMaxVisibleClusters x shadowRasterIndirectionMultiplier` records (1.5), whatever the frames asked.
