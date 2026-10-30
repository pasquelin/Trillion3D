# The cut

`webgpuPagesEngine` (`frame/backend/pages.ts`) draws from the bounded page cache of
`pages/pool/pages.ts`. A compute pass selects the camera's resident cut and draws it through indirect
commands into a visibility buffer (`src/frame/render/gpuCut.ts`); occlusion is the cut's own, in two
passes (below, `visibility/passes/passes.ts`). The render passes whose commands repeat from frame to
frame (the raster's slot draws, the material surfaces) are render bundles, recorded once and replayed
while the few identities and revisions they are keyed by hold (`gpu/core/renderBundles.ts`); their
passes keep the timestamps. Which pages load and leave is [RESIDENCY.md](../../RESIDENCY.md).

The cut (`geometry/dag/`) descends the placement tree's cells, then each placement's culling tree,
level by level in one descent array, down to the clusters of its leaves; a node's children are queued
only once it is kept. The culling tree is the compiler's
([FORMAT.md](../../format/clustersjson.md#cluster-dag)): one tree per level of four children a node,
whose leaves are the group parts (the clusters of one group one streaming page holds), the levels'
roots under one root, every node carrying its box, its LOD ball, the largest replacement error and the
least own error under it. A cell, node or cluster is kept when its box, grown by its deformation's
reach, meets the frustum (`cutFrustumCulling`); a node when the error its subtree replaces shows at
the threshold at its LOD ball; a leaf when its least own error does not show even at its ball's
nearest, unless one of its clusters' finer group is not resident (`cutMinLodCulling`); a cluster when
the cut rule draws it. A deformed placement is cut at its rest pose's balls and errors: its
deformation grows its boxes alone. Every error the cut compares is a half float: a cluster's own and
replacement error, a group's and a node's largest replacement error the nearest half, a node's least
own error the greatest half at or below it (`geometry/selection/helpers.ts`).
An error is projected at the placement's smallest axis scale, at the view's level-of-detail scale:
half the projection's vertical scale times the render height, over the threshold: `pixelError` pixels
(1 by default), divided by the streaming pool's quality scale ([RESIDENCY.md](../../RESIDENCY.md)) and,
while the temporal antialiasing upscales, by the bias
`min(displayWidth / renderWidth · 2^-cutLodBiasOffset, 2^-cutLodBiasMin)` (`cutLodBiasFollowsUpscale`;
`src/frame/render/gpuCut.ts`, `lodBiasFactor`). A leaf kept and seen asks for its pages in one
request (first page, how many follow, priority; the threshold over the leaf's projected error under
the view's category, `geometry/dag/request/request.ts`), whatever it holds resident; its clusters are
candidates only when one is resident, else the cut draws its parent. The descent dispatches only the
levels a resident page needs reached: its leaf's level and that of the finer clusters it brings within
reach (`geometry/dag/encode.ts`, `PackedDag.residentLevels`). It opens no node of a world actor whose
cell does not draw it (each actor its own subtree of the world's hierarchy), so none of its clusters
is drawn or asked for (`geometry/dag/shader/worldGateWgsl.ts`).

Occlusion runs in two passes (`cutTwoPassOcclusion`, `cutOcclusionCulling`;
`geometry/dag/shader/occlusionWgsl.ts`). The main pass tests every cell, node and cluster that passed
the frustum against the previous image's depth pyramid, at the pose that image drew it at, projected
by that image's matrices into that image's pixels: what it hides is held on the post lists, what it
shows is drawn and descends. The children of a node it hides are held by their parent (one entry and
the mask of them), within the post pass's node budget; a placement's root and a cell of the placement
tree are held alone. A leaf below a placement's root it hides is held only with a resident page, the
post pass asking for its pages as the main pass does once it shows it; one without is dropped, neither
tested again nor asked for. The raster draws the main pass's clusters, the pyramid is built from that
depth, and the post pass (`GpuSelection.encodePost`, `geometry/dag/shader/postPassWgsl.ts`) tests what
was held against it, at the current poses: what shows descends and is drawn by the raster's second
pass, what stays hidden is neither drawn nor asked for. The pyramid built from the whole depth, read
through the levels uniform it was built with, is what the view's next image's main pass reads
(`src/frame/render/cutPyramid.ts`), whatever size that image draws at: a render scale that moves keeps
it. The poses a drawn frame draws are kept for the next one on the GPU
(`geometry/dag/previousPoses.ts`): those that moved alone, copied as the next frame's main view opens
it, before it sends a pose, and never after a frame no view was drawn in. Every view of a frame tests
against the same, and the velocity measures a placement's motion from them: `previous · current⁻¹` of
the two worlds at the eye, per texel of a placement whose pose words differ
(`post/taa/nearestSurfaceWgsl.ts`, `placementMotion`), a GPU-composed placement as any. A view drawn
less often than its frame measures from the same kept poses and keeps its temporal history: the scene
holds one previous pose a placement. A box that covers no pixel centre is culled in every pass; a box
across the near plane is always seen; a placement no camera culls (a constant-size sprite) is never
judged. Every view runs both passes, the main one and each view drawn aside
(`geometry/dag/aside.ts`), against its own last pyramid; a view's first image (a capture's only one),
a pyramid made again by a resize of the targets and the switches off cut in one pass that occludes
nothing. The readback counts what the main pass held (`occluded`) and what the post pass hid again
(`postHidden`).

The cut's frame words hold 10 words a placement (the words of its root and records, its mark, its
pages' and structure's bases, the draw distances it names and, since assemblies, one word naming the
node that holds the group above its root), 11 with its stretch: 44 bytes a placement, 4 more than a
scene without assemblies. That node lies among the primitives' nodes of the node table, one for each
distinct group (its error ceiling and its LOD ball, nothing else), shared by every placement of the
assembly that reads it; no descent reaches it. A placement that names a group is tested once at its
root, after its draw distance, read only where its mark word says it names one (`ROOT_PARENT_MARK`,
256): while the group's error shows at its ball the placement opens, else nothing of it is visited and
the group's own clusters, in the assembly's primitive, draw. A group of the placement tree holds,
fitted with its box, a ball about its instances' balls (in the render frame's world) and the greatest
of their errors, scaled to the world. It is tested like a placement's own before the tree is
descended, so a far facade's windows cost nothing: a ball that holds theirs, at an error none exceeds,
shows no error that one of theirs would not; a group with one placement that names no group tests
none. The balls are kept in the leaves of the tree only where the packing of the cut names a group
above some root: a cut that names none keeps the six numbers of the box in each leaf (the 48 bytes a
placement, not 72) and tests no group; a first group named after such a cut was made asks the session
for another, that keeps them, as a group the table has no node for does. The test reads no page
residency: while the assembly's own pages stream in, the merged cluster stands in and the open
placements draw beside it, a transient the reference's streaming has too (its cluster is a stand-in
until every page of the group that made it is resident, and a slot is output as soon as it is visited
and its own page is loaded). A group the cut cannot take names none for a moment: its placement opens
whatever the group says until the session has made a cut that can (one more node per new group; a
growth's room keeps one for every placement it takes, so it is the first group of a cut that made
none, or a table past even that room, that asks for another).

The cut's lists hold fixed caps, laid out once in its flags (`geometry/dag/flagSections.ts`), never
grown on demand: the nodes one pass opens (`cutMaxNodes`, rounded down to a multiple of 16) and the
candidate clusters of both passes with those the previous pyramid hid, which share the one list from
its two ends (`cutMaxCandidateClusters`, rounded down to a multiple of 64). Every level of a pass lies
in one descent array, behind the level before it, beside as many items held for the post pass; at the
defaults those lists take 2 Mi nodes of 8 bytes a pass and 12 held, 16 Mi candidates of 8, and 20
bytes for each root slot and cell of the placement tree. Each section is held to what the packing can
ever ask of it (its entries, twice its pages), a saving that changes no cut. A cut past a cap drops
what is past it (a node with its subtree, a cluster neither tested nor drawn) and draws what fits
(`geometry/dag/shader/listsWgsl.ts`); its readback brings back the most each pass asked of each list,
and each list keeps its high-water mark: a cut past a cap that raises the mark is said once, as a
`gpu-cut-lists` warning naming the list, its peak over its cap, the mark and the setting that raises
the cap (`geometry/dag/lists/listFeedback.ts`). Caps changed at run time lay the flags out again
between two frames; caps the device or the cut's share refuses keep the lists as they are, said once.
The clusters drawn are a list of their own (below), `cutMaxVisibleClusters` its cap. The readout the
host adopts the cut from follows what the cut asks of it (`geometry/dag/lists/requestSize.ts`): a
request a leaf, drawn clusters and requests in lists of as many ranks, from `streamingMinRequests`
(65 536) to `streamingMaxRequests` (1 048 576), made again between two frames when the size moves; a
cut that lists more is adopted by its head, its drawn clusters taken whole from the list of visible
clusters.

**The visible clusters.** The cut writes, each frame, one list of the clusters it draws
(`geometry/dag/visible/layout.ts`, written by the cluster cull, `geometry/dag/shader/visibleWgsl.ts`):
a header of sixteen words (the clusters asked of the software raster and of the hardware raster, both
passes' and counted past the room, and where the post pass opened in each), then a record of three
words a cluster: its page, its placement and a tag (its view, its depth bucket, and the flags of a
cluster the rasters leave to others: blended, tessellated). A cluster is appended where the cull
decides it, by one atomic add on a counter, the software raster's from the bottom of the records and
the hardware raster's from the top, so the two share the room and neither needs the other's count
while the cull runs; a cluster past the room is neither drawn nor counted, the counter counting it
still, which the readback brings back as the peak. The list starts at 65 536 records and grows,
between two frames, to a quarter past the peak the readback reported, rounded up to a power of two,
within `cutMaxVisibleClusters` (`geometry/dag/visible/visibleGrowth.ts`): the decoded records, the
bins and the raster's lists are sized by it and made again with it. A cluster's index in the list is
the number its pixels carry: the visibility identifier is `((index + 1) << 8) | triangle`
(`visibility/visWords.ts`), the cluster's record at that index, no table of drawn clusters between. At
12 bytes a record the list takes 12 B per visible cluster and 64 B of header; the cut's other buffers
are laid out by the pages and placements the packing holds, none by the clusters a frame draws.

The cluster cull judges a cluster with what the cut holds of it and of its placement: its cluster
record (`geometry/dag/info/clusterInfoLayout.ts`: flags, slot, geometry, surface; written by the host
once, when the cluster's page is in its pool slot, moves or its surface changes,
`geometry/clusters/infoWrite.ts`) and the longest edge of its triangles, measured on the GPU once
after its record is written (`geometry/dag/info/measureWgsl.ts`; zero until measured). The cut's view
block is one uniform in the kernels (`cutView`, `geometry/dag/shader/viewsWgsl.ts`); a record's tag
carries its depth bucket and its raster flags alone, and the shadows' and the cards' views are not
wired to the cut.

```ts
const world = createWorld(canvas, { streamingMinRequests: 262144 }) // the readout starts larger
explorer.setStreaming('streamingMaxRequests', 524288) // and stops growing there, from the next readback
```

```ts
const world = createWorld(canvas, { cutMaxVisibleClusters: 8 * 1048576 })
world.cut = { cutMaxNodes: 4 * 1048576 } // its lists laid out again before the next cut
```
