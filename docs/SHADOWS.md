# Shadows

How the WebGPU engine draws cast shadows: virtual shadow maps, whose pages exist in memory only
where the image reads them. A map: each mechanism's rule is stated where it lives, and this page
names the file and the rules that span files. Paths are under `packages/sdk-browser/src/`: `vsm/`
holds the passes and their shaders, `lighting/shadows/vsm/frame/` the frame's plan, grant and
encoding. Lights, tiles and the lit image's passes are [ENGINE.md](ENGINE.md#direct-lighting); the
options a page sets (`castShadow`, and a material's `translucentLocalLightShadow`,
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
- **Said, never hidden.** `shadowResolutionBias` is the pool's halvings from the one asked plus that bias; above `0`
  the reference mode refuses its capture (`REFERENCE_SHADOWS_REDUCED`).

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
   windows of four pages a side, a record a window that holds a page of the caster's stale layer. The
   bin (`render/renderBinWgsl.ts`) sorts the records by raster pipeline and marks their pages drawn;
   the raster (`render/renderRasterWgsl.ts`) draws each window over a viewport of four pages, each
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
   line (`vsmRenderSoftware`). Its records hold one page each, the page's table word written by the
   bin in place of the mask, and come first in the sorted list. In the same compute pass, after the
   bin, the camera's one cluster raster (`visibility/raster/clusterWgsl.ts`, `clusterRasterKernels`)
   draws them: a group of 64 threads a record, the corners transformed once into the group's memory,
   a thread a triangle, the camera's subpixel setup and fill rule on a frame of one page, each pixel
   joined to the pool by an atomic max where a masked row's cutout keeps it,
   as the hardware fragment does. Two entry points bind one pool slice each — the eight storage
   buffers a stage holds — : every record into slice 0, then the static layer's into the static
   slice. The reference translates the page of each pixel through an 8×8 cache of the window
   (its late translation); a one-page window is its other path, kept here so the kernel binds no
   page table: the work is split into more records, the same pages drawn (the image is the acceptance
   bench's to prove). Without the page rows'
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
for a few a frame. A distant light's first two frames are drawn, as any light's: the second turns its maps from
uncached to cached.

```js
world.shadows = { shadowDistantLightMode: 0 } // no light is distant: every local light follows its casters
world.shadows = { shadowMaxDistantUpdatePerFrame: 4 } // up to four distant lights a frame
```

## Far casters

A sun's shadow maps follow the eye, and a caster far past the distance they are asked to reach would
cost a raster pass for a shadow nobody reads, so the caster list leaves it out of the maps and the
sun's distance-field cascade shadows it in their place ([SDK.md](SDK.md#a-suns-shadow-distance-and-its-far-casters)
tells the settings).

**The test.** The caster kernel (`vsmRenderCandidates`, `vsm/render/renderCandidatesWgsl.ts`) gives each
candidate the depth along the main view of the nearest point of its object's sphere (`farDepth`: the ball of
the placement's world box, grown by its reach, from the roots' boxes (`placement/roots/rootBoxes.ts`); a page
of the world DAG, whose merged shells have no bounds of their own, takes its cluster's own ball) and two flags:
the test reaches its placement, and its object casts far shadows (`MOBILITY_FAR_SHADOW`, a bit of the
placement's mobility word; a flip of the flag stales the placement's pages, the diff's memory holding the bit). Reached is one rule, `farTestedOf` (`visibility/shader/castingMark.ts`): the object says
it is (`farShadowTest` true), or the row is a placement of the world DAG (the merged shells of the coarser
levels), or the view says every mesh is (`farShadowCullsAllMeshes`) — unless the object says it never is
(`farShadowTest` false, which wins). The raster's flags (`casters/castFlags.ts`, `vsmRenderFarFlags`) and the
distance-field cascade's object flags (`lighting/distanceField/objectCasting.ts`, `dfshCasts`) are both built
from it, and `lighting/shadows/farTestRules.test.ts` runs every combination of a root's casting marks through
both shaders: past the edge a mesh is drawn by the maps or traced by the cascade, never both and never neither.

**The edge.** `sunCascades` (`packages/sdk-core/src/contracts/sunCascades.ts`) lays the sun's levels from its own
settings and the view's: the near levels (the light's `shadowCascades`, 4 by default, at most the view's
`shadowNearLevels`), each `shadowCascadeExponent` (3) times the span of the one before, an overlap of
`shadowCascadeTransition` (a tenth) of the last one's span times the view's `shadowOverlapScale`; the edge is the far
end of the last near level with that overlap (427 m at the defaults, the distance itself from 512 m on). Each map's projection record carries it
(`farShadowEdge`, 0 for none; a local light's is 0). When every map view of the frame is a sun that has an edge,
the candidate pass itself leaves out a caster past the greatest of them (`farDrop`, a parameter of the frame,
`lighting/shadows/vsm/frame/vsmFarShadow.ts`); the cull (`vsmRenderCull`) drops a candidate from every level of
one sun's clipmap when its row is tested, does not cast far, and its `farDepth` is past that sun's edge.

**The cache.** A sun's own shadow settings — the ten of the `LIGHT_SHADOW_FIELDS` but `shadowAmount`, which only fades the
distance-field cascade's shadow: the distance, the cascades and the distance-field cascade's — are part of its clipmap's cache key (`lighting/shadows/vsm/lightCache.ts`): a sun
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

**The cache's and the receiver masks' switches.** Each is a view setting at the reference's default.
`shadowCache` (true) keeps the pages from one frame to the next: off, every light is drawn uncached each frame, the
distant lights are never kept, and the set is made without a static layer in its pool (`VsmLayout.cacheEnabled`), so
a change makes the set again (`heldVsm`) and drops its pages. `shadowForceInvalidateLocal` (0) draws the local lights
uncached each frame: 1 those that are not distant, 2 all of them (`addVsmLocalLightShadow`).
`shadowCacheAllocateViaLru` (true) keeps the pool sort's order (empty pages first, then by the age step of the last
request, the finer level first); off, `poolSlotAge` and `poolSlotTier` rank every page not wanted this frame alike,
so the empty pages go first, then the highest pool index (`poolPage`, `VsmPmParams.lruAllocation`). `shadowForceFullPageClears` (false) clears a stale page's
layers whatever the cleared bits say (`VsmPmParams.fullClears`, `vsmListClears`).
`shadowCacheDeformableMeshesInvalidate` (true): off, a placement that a skin or a morph deforms keeps
`MOBILITY_OFTEN_MOVING` but not `MOBILITY_DEFORMS` in its word, so the raster no longer invalidates the pages its casters
draw as it draws them, and the placement settles to static after `shadowCacheFramesStaticThreshold` frames; a change
writes every word again (`uploadRootWords`).
`shadowUseReceiverMaskDirectional` (true) and `shadowUseReceiverMaskLocal` (false) give a light's maps the receiver cover
(`VSM_MAP_COVERAGE`, `VsmLightCache.useCover`): a page of a map with it is drawn only for the receivers its mask holds and
its dynamic layer is drawn again each frame; a change of the setting draws the light's pages again, and the sun's
dynamic depth range is cut by `shadowClipmapCullDynamicTightly` only while its cover is on. The cover is sized for the
suns' maps alone; with the local setting on it is sized for every map (`VsmLayout.coverLocal`) and the set is made again.
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

**The distance-field cascade.** The same levels shape the cascade after them: `encodeSunFieldShadow`
(`frame/render/encodeSunFieldShadow.ts`) traces the sun's shadow against the distance fields of the meshes the
test leaves out of the maps, from the near levels' end to `distanceFieldShadowDistance`, into a mask the lighting
multiplies the sun's shadow by (`lighting/distanceField/shadow/`). A sun with `angularRadius: 0` is traced hard
there too (the angle is held between 0.001 and 5 degrees). The meshes it traces are tracked beside the cut's
roots (`lighting/distanceField/objectTracker.ts`): the placements of compiled meshes that have a field, and the
fields of the world DAG's HLOD cells (`lighting/distanceField/hlodObjects.ts`: a stand-in for each cell and each
instance of the world DAG, placed only while the cut draws the cell's actor, so the shadow of a merged shell is
drawn exactly where the shell is; the layer's `allowDistanceField` asks the compiler for them). No far level
is drawn: the levels a light's `farShadowCascades` ask for are counted — a light with some ends its near levels
with the overlap and lets the cascade fade out by it —, never drawn. The count of near levels, the scale on
the overlap and the far field are settings (`shadowNearLevels`, `shadowOverlapScale`, `shadowFarField`,
`packages/sdk-core/src/contracts/shadowOptions.ts`, `sunShadowOptions.ts`); the growth, the overlap's tenth and the
512 m are the light's own settings (`packages/sdk-core/src/contracts/lightShadowOptions.ts`).

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
`contactShadowLengthInWorldSpace`; 0 casts none) and only for a light that casts a shadow. It multiplies the light's
surface and transmission terms by `1 − intensity`, the light's casting intensity where the ray meets a surface that
casts contact shadows and its non-casting intensity where it meets an eye. The eye model casts half a centimetre
toward any light, the hair model a fifth of the half height of the screen under a light with no shadow, whatever the
switch says. The view's `contactShadows` takes the lights' rays away, and the four `contactShadowOverride…` settings
replace the lights' own ([SDK.md](SDK.md#contact-shadows)):

```js
const lamp = light.spot({ position: [0, 3, 0], castShadow: true, contactShadowLength: 0.03 })
const world = createWorld('viewer', { contactShadowOverrideCastingIntensity: 0.5 })
```

## Metrics

The `shadow*` fields are documented on the contract
(`packages/sdk-core/src/contracts/shadowMetrics.ts`) and filled by
`lighting/shadows/vsm/frame/vsmStats.ts`. The page counters need the page-counter readback on
(`countersOn`).

**Small objects stay out of the coarse pages, judged whole.** An object whose bounds cover fewer pixels of
the map's finest level than a threshold is drawn into the fine pages alone: `shadowCoarsePagePixelThresholdStatic`
(1) for an object cached in the static layer, `shadowCoarsePagePixelThresholdDynamic` (4, the reference's value for
cluster geometry) for one cached in the dynamic layer. The test is
the object's, never a cluster's (`vsm/render/renderCullWgsl.ts`): the object's own ball (`inst` of the candidate) must
overlap a page of the right kind, then each of its clusters takes every page its own rect overlaps, as the reference's
instance cull then its cluster cull. The invalidation of a moved object reads the same rule on the object's box.

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
clusters it draws in each map, and the next frame's two kernels, run before its marking, carry the counts to its maps
and add to each map's bias in its projection record the share of the cost it takes. Nothing is read back. It is off
while `shadowDynamicResolutionTimeBudgetMs` and `shadowDynamicResolutionLoadBudget` are both 0, the default: nothing is
made, counted, written or run, and the marking and the raster are the programs without it; the sampling always reads
the bias of the clipmap map its level falls in, as the reference's does, which is the base map's while unthrottled. A
budget turned on or off makes no set again: the pool and the cache stay. `shadowDynamicResolutionLoadBudget` is the estimated load past which
the bias rises (lower is more aggressive); `shadowDynamicResolutionTimeBudgetMs` fits the shadow raster's GPU time to
a budget through the render scale's heuristic (it needs the render scale on `'auto'` and a GPU timer) and wins when
both are named; `shadowDynamicResolutionPerVsmBiasHistoryWeight` eases each map over the frames; the two
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
once projected, and lifted by the receiver plane's climb `2 * max(0, dot(slope, step))` to the centre of the texel the
dithered start falls in, as a local ray and a sun's one tap are, less what the start offset gained: the receiver's own
surface stored there is never in front of the ray's first sample. The reference lifts it over the dither step alone and
leaves the half texel to its centre to the screen segment; where that segment stops at once, its start sample hits its own
surface, acne in streaks on a lit face, still under a converged temporal pass (`vsmSunDitherUv`, `vsmSunDitherBias`,
`vsmRayLine`, `vsm/trace/traceRayWgsl.ts`); a local ray's stays the receiver's pixel size at the
map's bias.

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
dynamic layer marked stale so that the cull considers it, never drawn). `shadowInvalidateOnLodDelta` (false) marks the pages of a
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

**The sun's `shadowAmount`** (a light option, 1) fades the shadow of the distance-field cascade toward 1; it is no part of the
clipmap's cache key.

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

**Subsurface surfaces let light through their shadow.** The trace returns the mean distance its rays that hit were stopped
at (`occluderDistance`, from the hit depth the march keeps: `vsmMarch`, `vsmRayOccluderDistance`); for a receiver that is a thin
sheet (the surface flag `SUBSURFACE_FLAG`, whose opacity is the alpha of the thin transmission target, `subsurfaceOpacityAt`,
held to 0.99), where the trace was shadowed, the light left is `e^(-distance * density)` of `-0.05 * ln(1 - opacity)` per
centimetre, added to the share the rays missed and squared (`vsmSubsurfaceShadow`). A sun's
disk grows toward `shadowSubsurfaceMinSourceAngle` (5 degrees) as the opacity falls, for those receivers.
The receivers of this are the thin sheet, the two-sided foliage and the preintegrated skin (`vsmTransmitsShadow`); every
subsurface model (those, the subsurface profile, the hair and the eye: `vsmSubsurfaceModel`) is read from any side of its surface and is
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
raster `vsmRenderJoin`, software raster entry `vsmRenderSoftwareStatic`); after the raster the pages whose static layer
was drawn or cleared this frame, in a seen map of a cached view, are listed (`vsmSelectMerges`) and the deeper of the two
layers becomes the dynamic one (`vsmMergePages`, `lighting/shadows/vsm/physicalPagesWgsl.ts`), the layer every reader samples.
Each raster list holds `cutMaxVisibleClusters x shadowRasterIndirectionMultiplier` records (1.5), whatever the frames asked.
