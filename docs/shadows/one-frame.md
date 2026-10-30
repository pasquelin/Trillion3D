# One frame

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
   if it passes the gates of [Local lights' shadow gates](local-lights-shadow-gates-and-distant-lights.md#local-lights-shadow-gates-and-distant-lights).
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
   casters](far-casters.md#far-casters)). The records' list holds `cutMaxVisibleClusters` records, fixed (within the device's
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
