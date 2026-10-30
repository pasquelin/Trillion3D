# One frame

Encoded in the direct-lighting step, after the visibility and material passes and before the
lighting pass (`lighting/shadows/vsm/frame/engineVsm.ts`, `vsmEncode.ts`), in this order:

1. Invalidation: one stale over the previous frame's maps, dispatch sized on the GPU. A moved,
   added or removed instance stales the pages of its previous and new bounds. A diff over the
   placements (`shadows/casters/castDiffWgsl.ts`, `castDiff.ts`; a thread a placement, run when
   the scene's revision moved or a placement's word was written) compares each placement's world
   box and mobility word (`placement/roots/rootBoxes.ts`) with the last seen and appends boxes to
   the changes' list (`shadows/casters/castChanges.ts`).
   - Leaves or arrives: names its box. Static, first move: box left in the static layer, box
     entered in the dynamic.
   - Moving: both ends in the dynamic layer; a map using the receiver cover leaves them out.
   - Settled (`shadowCacheFramesStaticThreshold` frames unchanged): box once, static.
   - Deforming: cached as dynamic. Arrives often moving (`mobility` `movable`, skin, morph, or an
     offset that invalidates its shadows): starts moving, first box in the dynamic layer alone.
   - Boxes carry offset facts: dynamic layer of maps allowing the offset, static layer of others.
   - Pins its shadows (`shadowCacheInvalidation` `static`): names nothing for a move.

   CPU boxes of what no placement says (a cell's objects and HLOD actor, a surface whose alpha
   changed, a deforming geometry) are same-format records in their own buffer
   (`invalidation/castBoxes.ts`, `invalidation/castInvalidation.ts`, `invalidation/castStale.ts`).
2. The plan: clipmaps, local lights, map ids, projection data (`vsm/frameSetup.ts`,
   `vsm/clipmap.ts`, `vsm/localLight.ts`, `vsm/cacheManager.ts`). A local light takes maps only
   if it passes the gates of [Local lights' shadow gates](local-lights-shadow-gates-and-distant-lights.md#local-lights-shadow-gates-and-distant-lights).
   Map ids: one-page maps (a distant light's) from id 0, range of 8192; full maps from id 8192,
   suns' clipmaps first; ids between hold no map (`vsm/mapIds.ts`).

   `shadowQuality` 0 stops at the plan: no map; the held set keeps with its cache dropped, or is
   freed with `shadowDynamicDeallocationMode` 1; change boxes dropped; every light gets "no
   shadow"; lit programs lose their shadow code.

3. Page address update, carrying last frame's pages to this frame's ids
   (`vsm/pageManagementPass.ts:encodeVsmPageCarry`).
4. Page marking (`vsm/markingPass.ts`, `vsm/markingWgsl.ts`). With `shadowTranslucentQuality` 1
   and a front layer of translucent surfaces in the image before, it also marks, in every sun's
   clipmap, the page of the nearest translucent surface of that layer in front of each pixel
   (`lighting/shadows/vsm/frame/vsmFrontLayer.ts`; page dilated as the pixel's own, no bias).
5. Page allocation (`vsm/pageManagementPass.ts:encodeVsmPageMapping`, `vsm/physicalPagesWgsl.ts`).
6. The shadow raster: one cull over every caster and map view, each view selecting its own level
   of detail, then one raster (`render/renderPass.ts`).
   - Descent (`traversal/`, `geometry/dag/shader/descentShape.ts`, the camera's kernels): nodes
     carry their view (a map and a mip with a page to draw). Queue 0 holds every view's roots (or
     the placement tree's top nodes); each level tests children against the view: map frustum
     (node's oriented box; dynamic depth range in the dynamic layer; a local light's range on its
     sphere doubled; pages to draw under the cube about it, over a receiver of the map's cover
     where kept and the layer is not static), the subtree's error at the view's mip, and the
     map's pyramid (below) while kept.
   - A kept leaf requests its pages per view (`requestPage`, `traversal/requests.ts`, below the
     camera's category) and lists resident ones. Node room `cutMaxNodes`, fixed.
   - Candidates (`render/renderCandidatesWgsl.ts`) keep what may cast: cut tables, the HLOD
     switch (`geometry/dag/shader/worldGateWgsl.ts`, `worldDraws`: an HLOD actor or cell objects
     the view does not draw cast nothing), the main view's filter, draw distances. The decode
     makes their pages (`casters/casterFeed.ts`, `visibility/decode/`).
   - Cull (`render/renderCullWgsl.ts`, a thread a caster and a light), per map and mip view: cut
     rule on the cluster's errors projected by that view (`vsmRenderLodAt`, threshold times two to
     `shadowGeometryLodBias`, 1 by default); frustum (cluster's oriented box in the map's shifted
     space); page rect clipped to the stale rect; windows of four pages a side (eight for
     software), a record a window holding a page of the caster's stale layer. Pages joining a
     window are marked drawn; the rect is clipped to pages to draw (`vsmCullMarks`: a device
     granting ten storage buffers a stage binds page table and raster marks in the cull; with
     fewer, the bin marks them and the raster leaves out pages not to draw).
   - Bin (`render/renderBinWgsl.ts`) sorts records by raster pipeline; raster
     (`render/renderRasterWgsl.ts`) draws each window over four pages. A sun's far casters are left out
     ([Far casters](far-casters.md#far-casters)).
   - Limits: records `cutMaxVisibleClusters`; candidates `cutMaxCandidateClusters` (within the
     device's binding and memory budget); past a room the frame draws what fits.

   **Software raster of the small clusters** (`softwareRaster`, `hardwareRasterEdgePixels`;
   `render/renderSoftwareWgsl.ts`). A cluster whose longest edge (`GpuSelection.edges` times its
   placement's greatest scale) spans at most `hardwareRasterEdgePixels` pixels at the nearest
   point of its level of detail's sphere (whole sphere where vertices move) is software, unless
   its box crosses the map's near or far plane, it is tessellated, or it is a voxel row or a line
   (`vsmRenderSoftware`). Its records hold a window of up to eight pages a side, page table words
   laid by the bin in the sorted list's end (four to a line; short of room the window is lost and
   the overflow flag is raised), and come first. After the bin, in the same compute pass, the
   camera's cluster raster (`visibility/raster/clusterWgsl.ts`, `clusterRasterKernels`)
   draws them: 64 threads a record, a thread a triangle, 8×8 page cache, atomic max into the
   pool where a masked row's cutout keeps it. Two entry points bind one pool slice each: every
   record into slice 0, then the static layer's into the static slice. Without the page rows'
   compute group every cluster is hardware.

   **Occlusion culling** (`shadowOcclusionCulling`, on by default; `vsm/occlusion/`). The set
   holds a depth pyramid of the physical pool (r32float, one layer, half the pool's power-of-two
   extent at level 0, seven levels: 64 to 1 texels a page, farthest depth) and the frame's page
   table, pages' marks and stale rects, copied once pages are granted and read by the next frame
   (`occlusionResources.ts`). With a previous frame kept, nodes and clusters are judged twice.
   - Descent (`traversal/traversalWgsl.ts`, `boxSight`): a node's doubled sphere is tested in its
     view as the previous image drew it (`vsmRenderPrevShift`) against the previous pyramid, in
     both layers. Hidden in both: not walked; it waits for the post pass (`postNode`).
   - First cull (`vsmRenderCullFirst`): tests each mip view of a caster against the previous
     pyramid (previous id, table and clip matrix in the map's record, `occlusionView.ts`); a
     hidden caster draws and marks nothing and is held back from the records' list end.
   - Pyramid build (`occlusionWgsl.ts`): over pages whose static layer was drawn, or dynamic layer
     where the map is redrawn whole; every held page with `shadowOcclusionFullUpdate`; between a
     view pass's halves and after the last pass.
   - Post pass: `dagPostNodes` (view-pass views only) tests held nodes against this frame's
     pyramid; a node seen enters queue 0 and every level reruns. Their casters are made and
     decoded (`vsmRenderCandidatesPostDone`); `vsmRenderCullPost` takes them through the level of
     detail and this frame's pyramid; the second cull tests what the first held back and draws
     what is visible.
   - Tests (`occlusionTestWgsl.ts`): pyramid level where the rect spans four texels, per page; a
     page unmapped at that mip hides it.
   - Without a previous frame each view pass culls once, no test. Toggling the setting redraws.
   - Memory (`occlusionPyramidBytes`, `vsmTableBytes`): pyramid a third of a pool slice; kept
     tables two copies of page table, marks, stale rects.

7. Post render (`vsm/pageManagementPass.ts:encodeVsmAfterRaster`), then projection into the suns'
   and local lights' masks (`projection/projectionPass.ts`, `projection/projectionWgsl.ts`,
   `trace/traceWgsl.ts`).
8. The lighting pass reads the masks; the frame end copies counters back a few frames late
   (`lighting/shadows/vsm/frame/vsmFrameEnd.ts`).

Across passes: every allocated valid page is drawn this frame (or next after a short list); a still scene draws nothing after its first frames; a static caster that moves redraws
only the pages its previous and new box cover, into the dynamic slice
(`shadowCacheFramesStaticThreshold`); a cell switching between its objects and its HLOD actor
redraws the pages both cover in the same image
(`frame/prepare/lightResources.ts:shadowsFollowCells`).
