# The cut

`webgpuPagesEngine` (`frame/backend/pages.ts`) draws from the page cache of `pages/pool/pages.ts`. A
compute pass selects the camera's resident cut and draws it by indirect commands into a visibility
buffer (`src/frame/render/gpuCut.ts`); occlusion is two passes (`visibility/passes/passes.ts`). Passes
with frame-repeating commands (raster slot draws, material surfaces) are render bundles replayed while
their keying identities and revisions hold (`gpu/core/renderBundles.ts`). Page load/leave:
[RESIDENCY.md](../../RESIDENCY.md).

The cut (`geometry/dag/`) descends placement-tree cells, then each placement's culling tree, level by
level in one descent array, to its leaves' clusters; a node's children queue only once it is kept. The
culling tree ([FORMAT.md](../../format/clustersjson.md#cluster-dag)): one tree per level, four children
a node, leaves = group parts, level roots under one root; each node carries box, LOD ball, largest
replacement error, least own error below.

Keep rules:
- Cell, node, cluster: box grown by deformation reach meets the frustum (`cutFrustumCulling`).
- Node: the error its subtree replaces shows at the threshold at its LOD ball.
- Leaf: least own error does not show even at its ball's nearest, unless a cluster's finer group is
  not resident (`cutMinLodCulling`).
- Cluster: the cut rule draws it.

A deformed placement is cut at its rest pose's balls and errors; deformation grows boxes only. Errors
compare as half floats: cluster own/replacement error, group and node largest replacement error the
nearest half, node least own error the greatest half at or below (`geometry/selection/helpers.ts`).

Error projection: placement's smallest axis scale, view's LOD scale: half the projection's vertical
scale × render height, over the threshold `pixelError` pixels (1 default), divided by the streaming
pool's quality scale ([RESIDENCY.md](../../RESIDENCY.md)) and, while TAA upscales, by
`min(displayWidth / renderWidth · 2^-cutLodBiasOffset, 2^-cutLodBiasMin)` (`cutLodBiasFollowsUpscale`;
`src/frame/render/gpuCut.ts`, `lodBiasFactor`).

A leaf kept and seen requests its pages in one request (first page, following count, priority;
`geometry/dag/request/request.ts`), whatever it holds resident. Its clusters are candidates only when
one is resident, else the cut draws its parent. The descent dispatches only levels a resident page needs
(`geometry/dag/encode.ts`, `PackedDag.residentLevels`). No node of a world actor whose cell does not
draw it opens (`geometry/dag/shader/worldGateWgsl.ts`).

Occlusion (`cutTwoPassOcclusion`, `cutOcclusionCulling`; `geometry/dag/shader/occlusionWgsl.ts`):
- Main pass: tests every frustum-passing cell, node, cluster against the previous image's depth
  pyramid, at the pose that image drew it at, with that image's matrices. Hidden: held on post lists.
  Shown: drawn, descends.
- A hidden node's children are held by their parent (one entry + mask) within the post pass's node
  budget; a placement root and a placement-tree cell are held alone. A leaf below a hidden placement
  root is held only with a resident page; else dropped, neither retested nor requested.
- Raster draws main-pass clusters, the pyramid is built from that depth, the post pass
  (`GpuSelection.encodePost`, `geometry/dag/shader/postPassWgsl.ts`) tests held items against it at
  current poses: shown descends, drawn by the raster's second pass; still hidden neither drawn nor
  requested.
- The pyramid from the whole depth, read via the levels uniform it was built with, is what the view's
  next main pass reads (`src/frame/render/cutPyramid.ts`), at any size.
- A drawn frame's poses are kept on GPU for the next (`geometry/dag/previousPoses.ts`): only moved
  ones, copied as the next frame's main view opens, never after a frame with no view drawn. Velocity:
  `previous · current⁻¹` of the two worlds at the eye, per texel of a placement with differing pose
  words (`post/taa/nearestSurfaceWgsl.ts`, `placementMotion`). A view drawn less often than its frame
  measures from the same kept poses and keeps its temporal history: one previous pose a placement.
- A box covering no pixel centre is culled in every pass; a box across the near plane is always seen;
  a placement no camera culls (constant-size sprite) is never judged.
- Every view runs both passes, main and each aside view (`geometry/dag/aside.ts`), against its own last
  pyramid. A view's first image, a pyramid remade by target resize, and the switches off: one-pass cut,
  nothing occluded.
- Readback counts main-held (`occluded`) and post-rehidden (`postHidden`).

Frame words: 10 words a placement (root and records words, mark, pages' and structure's bases, named
draw distances, one word naming the node holding the group above its root), 11 with stretch: 44 bytes a
placement, 4 more than a scene without assemblies. That node sits among the primitives' nodes in the
node table, one per distinct group (error ceiling + LOD ball only); no descent reaches it.

A placement naming a group is tested once at its root, after its draw distance, only where its mark
word says so (`ROOT_PARENT_MARK`, 256): while the group's error shows at its ball the placement opens;
else nothing of it is visited and the group's own clusters, in the assembly's primitive, draw.

A placement-tree group holds a ball about its instances' balls (render-frame world) and the greatest of
their errors, world-scaled, tested like a placement's own before the tree descends. Balls are kept in
tree leaves only where packing names a group above some root: a cut naming none keeps the box's six
numbers per leaf (48 bytes a placement, not 72) and tests no group; a first group named after such a
cut asks the session for another cut that keeps them, as a group the table has no node for does.

The test reads no page residency: while the assembly's own pages stream in, the merged cluster stands
in and open placements draw beside it. A group the cut cannot take names none for now: its placement
opens whatever the group says until the session makes a cut that can.

Fixed list caps, laid out once in the cut's flags (`geometry/dag/flagSections.ts`), never grown on
demand:
- nodes one pass opens: `cutMaxNodes`, rounded down to a multiple of 16;
- candidate clusters of both passes plus those the previous pyramid hid, one list shared from both
  ends: `cutMaxCandidateClusters`, rounded down to a multiple of 64.

Defaults: 2 Mi nodes of 8 bytes a pass and 12 held, 16 Mi candidates of 8, 20 bytes per root slot and
placement-tree cell. Each section is held to what packing can ever ask (entries, twice pages).

A cut past a cap drops the excess (node with subtree; cluster neither tested nor drawn) and draws what
fits (`geometry/dag/shader/listsWgsl.ts`). Readback returns each pass's peak ask per list; each list
keeps a high-water mark. A cut past a cap that raises the mark warns once, `gpu-cut-lists`, naming the
list, peak over cap, mark, and the setting raising the cap (`geometry/dag/lists/listFeedback.ts`). Caps
changed at run time re-lay the flags between frames; caps the device or the cut's share refuses keep
the lists, said once. Drawn clusters are a list of their own (below), cap `cutMaxVisibleClusters`.

The readout the host adopts the cut from follows the cut's ask (`geometry/dag/lists/requestSize.ts`): a
request per leaf, from `streamingMinRequests` (65 536) to `streamingMaxRequests` (1 048 576), remade
between frames when the size moves; a cut listing more is adopted by its head, drawn clusters taken
whole from the visible-cluster list.

**The visible clusters.** Each frame the cut writes one list of drawn clusters
(`geometry/dag/visible/layout.ts`, written by the cluster cull, `geometry/dag/shader/visibleWgsl.ts`):
a sixteen-word header (clusters asked of software and hardware raster, both passes', counted past the
room, and where the post pass opened in each), then three words a cluster: page, placement, tag (view,
depth bucket, flags of clusters the rasters leave to others: blended, tessellated).

The cull appends by one atomic add on a counter: software raster's from the records' bottom,
hardware's from the top. A cluster past the room is neither drawn nor counted; the counter still counts
it, and readback returns that as the peak. The list starts at 65 536 records and grows between frames
to a quarter past the reported peak, rounded up to a power of two, within `cutMaxVisibleClusters`
(`geometry/dag/visible/visibleGrowth.ts`); decoded records, bins and raster lists are sized by it.

A cluster's list index is the number its pixels carry: visibility identifier
`((index + 1) << 8) | triangle` (`visibility/visWords.ts`). 12 B per visible cluster + 64 B header.

The cluster cull judges a cluster by its cluster record (`geometry/dag/info/clusterInfoLayout.ts`:
flags, slot, geometry, surface; host-written once, when its page is in its pool slot, moves, or its
surface changes, `geometry/clusters/infoWrite.ts`), its placement's, and its triangles' longest edge,
GPU-measured once (`geometry/dag/info/measureWgsl.ts`; zero until measured). The cut's view block is
one uniform in the kernels (`cutView`, `geometry/dag/shader/viewsWgsl.ts`); shadow and card views are
not wired to the cut.

```ts
const world = createWorld(canvas, { streamingMinRequests: 262144 }) // the readout starts larger
explorer.setStreaming('streamingMaxRequests', 524288) // and stops growing there, from the next readback
```

```ts
const world = createWorld(canvas, { cutMaxVisibleClusters: 8 * 1048576 })
world.cut = { cutMaxNodes: 4 * 1048576 } // its lists laid out again before the next cut
```
