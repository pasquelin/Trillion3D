# WebGPU page raster

`webgpuPagesEngine` (`frame/backend/pages.ts`) draws from the bounded page cache of
`pages/pool/pages.ts`. A compute pass selects the camera's resident cut and draws it through indirect
commands into a visibility buffer (`src/frame/render/gpuCut.ts`); occlusion is the cut's own, in two
passes (below, `visibility/passes/passes.ts`). The render
passes whose commands repeat from frame to frame — the raster's slot draws, the material surfaces —
are render bundles, recorded once and replayed while the few identities and revisions they are
keyed by hold (`gpu/core/renderBundles.ts`); their passes keep the timestamps. Which pages load and leave is
[RESIDENCY.md](../RESIDENCY.md).

The cut (`geometry/dag/`) descends the placement tree's cells, then each placement's culling tree,
level by level in one descent array, down to the clusters of its leaves; a node's children are
queued only once it is kept. The culling tree is the compiler's ([FORMAT.md](../format/clustersjson.md#cluster-dag)): one
tree per level of four children a node, whose leaves are the group parts — the clusters of one
group one streaming page holds —, the levels' roots under one root, every node carrying its box,
its LOD ball, the largest replacement error and the least own error under it. A cell, node or
cluster is kept when its box, grown by its deformation's reach, meets the frustum
(`cutFrustumCulling`); a node when the error its subtree replaces shows at the threshold at its LOD
ball, and, a leaf, when its least own error does not show even at its ball's nearest — unless one
of its clusters' finer group is not resident (`cutMinLodCulling`); a cluster when the cut rule
draws it. A deformed placement is cut at its rest pose's balls and errors: its deformation grows its
boxes alone. Every error the cut compares is a half float, as the reference stores it: a cluster's
own error and replacement error, a group's and a node's largest replacement error the nearest half,
a node's least own error the greatest half at or below it (`geometry/selection/helpers.ts`).
An error is projected at the placement's smallest axis scale, at the view's level-of-detail scale:
half the projection's vertical scale times the render height, over the threshold — `pixelError`
pixels (1 by default), divided by the streaming pool's quality scale
([RESIDENCY.md](../RESIDENCY.md)) and, while the temporal antialiasing upscales, by the bias
`min(displayWidth / renderWidth · 2^-cutLodBiasOffset, 2^-cutLodBiasMin)`
(`cutLodBiasFollowsUpscale`; `src/frame/render/gpuCut.ts`, `lodBiasFactor`). A leaf kept and seen
asks for its pages in one request — its first page, how many follow it and its priority, the
threshold over the leaf's projected error under the view's category
(`geometry/dag/request/request.ts`) —, whatever it holds resident; its clusters are candidates
only when one is resident, else the cut draws its parent. The descent dispatches only the levels a
resident page needs reached — its leaf's level and that of the finer clusters it brings within reach
(`geometry/dag/encode.ts`, `PackedDag.residentLevels`). It opens no node of a world actor whose
cell does not draw it — each actor its own subtree of the world's hierarchy —, so none of its
clusters is drawn or asked for (`geometry/dag/shader/worldGateWgsl.ts`).

Occlusion runs in two passes (`cutTwoPassOcclusion`, `cutOcclusionCulling`; `geometry/dag/shader/occlusionWgsl.ts`).
The main pass tests every cell, node and cluster that passed the frustum against the previous
image's depth pyramid, at the pose that image drew it at, projected by that image's matrices into
that image's pixels: what it hides is held on the post lists, what it shows is drawn and descends.
The children of a node it hides are held by their parent, one entry and the mask of them, within
the post pass's node budget; a placement's root and a cell of the placement tree are held alone.
A leaf below a placement's root it hides is held only with a resident page, the post pass asking
for its pages as the main pass does once it shows it; one without is dropped, neither tested again
nor asked for. The raster
draws the main pass's clusters, the pyramid is built from that depth, and the post pass
(`GpuSelection.encodePost`, `geometry/dag/shader/postPassWgsl.ts`) tests what was held against it,
at the current poses: what shows descends and is drawn by the raster's second pass, what stays
hidden is neither drawn nor asked for. The pyramid built from the whole depth, read through the
levels uniform it was built with, is what the view's next image's main pass reads
(`src/frame/render/cutPyramid.ts`), whatever size that image draws at: a render scale that moves
keeps it. The poses a drawn frame draws are kept for the next one on the GPU
(`geometry/dag/previousPoses.ts`), those that moved alone, copied as the next frame's main view
opens it, before it sends a pose, and never after a frame no view was drawn in: every view of a
frame tests against the same, and the velocity measures a placement's motion from them —
`previous · current⁻¹` of the two worlds at the eye, per texel of a placement whose pose words
differ (`post/taa/nearestSurfaceWgsl.ts`, `placementMotion`), a GPU-composed placement as any. A
view drawn less often than its frame measures from the same kept poses and keeps its temporal
history: the scene holds one previous pose a placement. A box that covers
no pixel centre is culled in every pass; a box across the near plane is always seen; a placement
no camera culls (a constant-size sprite) is never judged. Every view runs both passes, the main
one and each view drawn aside (`geometry/dag/aside.ts`), against its own last pyramid; a view's
first image — a capture's only one —, a pyramid made again by a resize of the targets and the
switches off cut in one pass that occludes nothing. The readback counts what the main pass held
(`occluded`) and what the post pass hid again (`postHidden`).

An object that names a draw distance (`objectSettings.drawDistance`,
[COMPILER.md](../compiler/the-partitions-grids.md#object-settings)) is tested first, before its frustum test, from the
main view's eye, on the sphere of its root's bounds: half the box's diagonal about its centre, at
the placement's pose, held to the half diagonal of the box the pose makes of the root's box (an
uneven scale never makes the sphere larger than the box itself). The object is culled while the
sphere lies wholly nearer than its `min` or wholly farther than its `max`; with
`cutDistanceCullToSphereEdge` off, while its centre does. One instance of an instanced mesh
(`perInstance`) is always tested at its centre. Two scales multiply the distances. An object of its
own takes `cutViewDistanceScale` (times `cutViewDistanceSecondaryScale` where
`cutViewDistanceApplySecondaryScale` is on) and the scale of the view's horizontal field of view:
`cutViewDistanceFovMinAngleScale` at `cutViewDistanceFovMinAngle` and under,
`cutViewDistanceFovMaxAngleScale` at `cutViewDistanceFovMaxAngle` and over, blended linearly
between, an orthographic view counting as 0 degrees (45 and 90 degrees, both scales 1: no change).
An instance takes the first scale alone. The switch `cutDrawDistanceCulling` turns the cull off
for instances alone; an object of its own is always culled by its distances, so a scene that
names none pays nothing for it. A group of 64 placements of the placement tree holds the nearest
and the farthest distance of its placements and is culled only where none of them can be drawn:
its box's centre distance, nearer or farther by twice the box's half diagonal (the half diagonal
for a point of the box, and again for the sphere of a placement about it), lies outside them, the
nearest taken at the smaller of the two scales and the farthest at the larger. A distant group
costs its placements nothing; a group with a placement that names no distance is never culled by
it, nor is any while `cutDrawDistanceCulling` is off (some of its placements may be instances),
and a cut in one pass (above) tests its placements alone. The post pass tests none again: what it
holds passed in the main pass, the eye unchanged.

The sun's shadows and the rays' scene take the distances from the same eye. An object out of its
distances casts no shadow in the virtual shadow maps, tested at the centre of its bounds with
`cutViewDistanceScale` alone (the casters read no field of view); the instances' share of the
test follows `cutDrawDistanceCulling`. The bounce and reflection rays do not meet it (their scene
is the objects' proxies): an object of its own is judged on its farthest distance alone, at the
sphere and by its own scale, an instance on both distances at its centre and by the instances'
scale, none while `cutDrawDistanceCulling` is off. No fade over a travel distance is provided: every
object drawn here is a cluster DAG, which has none. The reference's fifth field of view setting,
which scales the HLOD's own draw distances, has no counterpart: the HLOD levels stream as cells
chosen by their grids' loading ranges, never by a pair of distances.

The cut's frame words hold 10 words a placement (the words of its root and records, its mark, its
pages' and structure's bases, the draw distances it names and, since assemblies, one word naming the
node that holds the group above its root), 11 with its stretch: 44 bytes a placement, 4 more than a
scene without assemblies. That node lies among the primitives' nodes of the node table, one for each
distinct group (its error ceiling and its LOD ball, nothing else), shared by every placement of the
assembly that reads it; no descent reaches it. A placement that names a group is tested once at its
root, after its draw distance, read only where its mark word says it names one (`ROOT_PARENT_MARK`,
256): while the group's error shows at its ball the placement opens, else nothing of it is visited
and the group's own clusters, in the assembly's primitive, draw. A group of the placement tree
holds, fitted with its box, a ball about its instances' balls (in the render frame's world) and the
greatest of their errors, scaled to the world: it is tested like a placement's own before the tree
is descended, so a far facade's windows cost nothing; a ball that holds theirs, at an error none
exceeds, shows no error that one of theirs would not, and a group with one placement that names no
group tests none. The balls are kept in the leaves of the tree only where the packing of the cut
names a group above some root: a cut that names none keeps the six numbers of the box in each leaf
(the 48 bytes a placement, not 72) and tests no group; a first group named after such a cut was made
asks the session for another, that keeps them, as a group the table has no node for does. The test
reads no page residency: while the assembly's own pages stream in, the merged cluster stands in and
the open placements draw beside it, a transient the reference's streaming has too: its cluster is a
stand-in until every page of the group that made it is resident, and a slot is output as soon as it
is visited and its own page is loaded. A group the cut cannot take names none for a moment: its
placement opens whatever the group says until the session has made a cut that can (one more node per
new group; a growth's room keeps one for every placement it takes, so that it is the first group of
a cut that made none, or a table past even that room, that asks for another).

The cut's lists hold fixed caps, laid out once in its flags (`geometry/dag/flagSections.ts`), never
grown on demand: the nodes one pass opens (`cutMaxNodes`, rounded down to a multiple of 16) and the
candidate clusters of both passes with those the previous pyramid hid, which share the one list
from its two ends (`cutMaxCandidateClusters`, rounded down to a multiple of 64). Every level of a
pass lies in one descent array, behind the level before it, beside as many items held for the post
pass; at the defaults those lists take 2 Mi nodes of 8 bytes a pass and 12 held, 16 Mi candidates of
8, and 20 bytes for each root slot and cell of the placement tree. Each section is held to what the
packing can ever ask of it — its entries, twice its pages —, a saving that changes no cut. A cut past
a cap drops what is past it — a node with its subtree, a cluster neither tested nor drawn — and
draws what fits (`geometry/dag/shader/listsWgsl.ts`); its readback brings back the most each pass
asked of each list, and each list keeps its high-water mark: a cut past a cap that raises the mark
is said once, as a `gpu-cut-lists` warning naming the list, its peak over its cap, the mark and the
setting that raises the cap (`geometry/dag/lists/listFeedback.ts`). Caps changed at run time lay
the flags out again between two frames; caps the device or the cut's share refuses keep the lists
as they are, said once. The clusters drawn are a list of their own (below), `cutMaxVisibleClusters`
its cap. The readout the host adopts the cut from follows what the cut asks of it
(`geometry/dag/lists/requestSize.ts`): a request a leaf, drawn clusters and requests in lists of as
many ranks, from `streamingMinRequests` (65 536) to `streamingMaxRequests` (1 048 576), made again
between two frames when the size moves; a cut that lists more is adopted by its head, its drawn
clusters taken whole from the list of visible clusters.

**The visible clusters.** The cut writes, each frame, one list of the clusters it draws
(`geometry/dag/visible/layout.ts`, written by the cluster cull, `geometry/dag/shader/visibleWgsl.ts`):
a header of sixteen words — the clusters asked of the software raster and of the hardware raster,
both passes' and counted past the room, and where the post pass opened in each — then a record of
three words a cluster, its page, its placement and a tag (its view, its depth bucket, and the flags
of a cluster the rasters leave to others: blended, tessellated). A cluster is appended where the cull
decides it, by one atomic add on a counter, the software raster's from the bottom of the records and
the hardware raster's from the top, so the two share the room and neither needs the other's count
while the cull runs; a cluster past the room is neither drawn nor counted, the counter counting it
still, which the readback brings back as the peak. The list starts at 65 536 records and grows, between
two frames, to a quarter past the peak the readback reported, rounded up to a power of two, within
`cutMaxVisibleClusters` (`geometry/dag/visible/visibleGrowth.ts`): the decoded records, the bins and
the raster's lists are sized by it and made again with it. A cluster's index in the list is the number
its pixels carry: the visibility identifier is `((index + 1) << 8) | triangle`
(`visibility/visWords.ts`), the cluster's record at that index, no table of drawn clusters between.
At 12 bytes a record the list takes 12 B per visible cluster and 64 B of header; the cut's other
buffers are laid out by the pages and placements the packing holds, none by the clusters a frame draws.

The cluster cull judges a cluster with what the cut holds of it and of its placement: its cluster
record (`geometry/dag/info/clusterInfoLayout.ts`: its flags, its slot, its geometry, its surface,
written by the host once, when the cluster's page is in its pool slot, moves or its surface changes,
`geometry/clusters/infoWrite.ts`) and the longest edge of its triangles, measured on the GPU once
after its record is written (`geometry/dag/info/measureWgsl.ts`; zero until measured). The cut's
view block is one uniform in the kernels (`cutView`, `geometry/dag/shader/viewsWgsl.ts`); a record's
tag carries its depth bucket and its raster flags alone, and the shadows' and the cards' views are
not wired to the cut.

```ts
const world = createWorld(canvas, { streamingMinRequests: 262144 }) // the readout starts larger
explorer.setStreaming('streamingMaxRequests', 524288) // and stops growing there, from the next readback
```

```ts
const world = createWorld(canvas, { cutMaxVisibleClusters: 8 * 1048576 })
world.cut = { cutMaxNodes: 4 * 1048576 } // its lists laid out again before the next cut
```

Every setting is the reference's by default, a world option by its field, held over the quality
preset — only `cutViewDistanceScale` is written by a level, the view distance's —, changed later by
`world.cut` from the next frame
(`packages/sdk-core/src/contracts/cutOptions.ts`); a value a setting does not take is refused. The
cut's GPU time budget is off (0), its lowest scale 30 %, the secondary scale of the draw distances
off at 1, and the field of view's scales 1 from 45 to 90 degrees:

```ts
const world = createWorld(canvas, { cutTwoPassOcclusion: false })
world.cut = { cutLodBiasFollowsUpscale: false, cutLodBiasMin: -1 }
world.cut = { cutTwoPassOcclusion: null } // back to the preset's, here the default
```

The view distance's levels write `cutViewDistanceScale`: 0.4 at `smooth`, 0.6 at `balanced`, 0.8 at
`fine`; `max` writes nothing (1) and `cinematic` writes 10. `pixelError` and the cut's other settings stay at their defaults
at every level.

```ts
const world = createWorld(canvas, { quality: { preset: 'balanced' } })
// cutViewDistanceScale is 0.6: every draw distance is 60 % of what the scene names
world.cut = { cutViewDistanceScale: 1 } // the page's value holds over the preset
world.cut = { cutDrawDistanceCulling: false } // every instance drawn at every distance
world.cut = { cutViewDistanceFovMaxAngleScale: 0.5 } // an object of its own: halved at 90 degrees and over
```

**The draw distances' second scale.** An object's draw distance is scaled by `cutViewDistanceScale`
(default 1) and, when `cutViewDistanceApplySecondaryScale` is `true`, also by
`cutViewDistanceSecondaryScale` (default 1): the product is what the cut, the rays' scene and the
shadow casters read (`viewDistanceFactor`): an object the cut drops by its distance casts no shadow
either. The second scale is for a feature that opts in, without touching what the quality level
wrote: `world.cut = { cutViewDistanceApplySecondaryScale: true, cutViewDistanceSecondaryScale: 0.5 }`
halves every draw distance. The scale of the field of view multiplies the draw distances of the
objects of their own beside them, in the cut and in the rays' scene.

**A GPU time budget for the cut.** `cutEdgeScaleBudgetMs` gives the main view's cut and its raster
(the passes that build its visibility buffer: selection, the binning of its visible clusters, Hi-Z and raster) a time in
milliseconds. It is one more budget of the dynamic resolution's heuristic
([Dynamic resolution](temporal-antialiasing.md#dynamic-resolution), `frame/scale/dynamicResolution.ts`), so it works where
the render scale is `'auto'` (a number fixes the render scale and the budget does nothing): the same
history, the same change period, the same resets (a new display, another refresh, other bounds or a
GPU timer gone silent forget both budgets together), the cut's time read from the same sample the
render scale's is. The cut's threshold is `pixelError / fraction`, the fraction between
`cutEdgeScaleMinPercent` / 100 and 1 and the lesser of it and the streaming quality scale, for the
main view's cut only: the budget measures that view's time, so a view drawn beside it (a minimap, a
mirror, a probe) keeps the host's threshold. What differs from the render scale's fit is the model:
the cut's time scales with the fraction itself, not its square (each image suggests
`fraction · budget · 0.95 / time`), 5 % of the budget is left free, a change under 1 % is none, and a
history all over the budget moves the edge scale at the next change period, where the render scale
moves at once and takes the edge scale's change with it. Each time is paired with the edge fraction
in force when it is read; a time of 0 asks for the most a fraction may be, and a sample that holds
none of those passes is skipped. Off (0, the default), no time of those passes is summed and
nothing is kept.

```ts
const world = createWorld(canvas, { renderScale: 'auto', cutEdgeScaleBudgetMs: 6 })
// over 6 ms the main view's pixels per edge grow, up to 1 / 0.3 times pixelError, and come back under it
world.cut = { cutEdgeScaleMinPercent: 50 } // never coarser than 2 × pixelError
world.cut = { cutEdgeScaleBudgetMs: null } // no budget again: the threshold is the host's
```

| Field                                | Meaning                                                                                                                                                                    | Default    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `cutTwoPassOcclusion`                | Each view's cut runs its two passes; `false`, one pass that occludes nothing                                                                                               | `true`     |
| `cutOcclusionCulling`                | The cut tests its boxes against the depth pyramids at all                                                                                                                  | `true`     |
| `cutFrustumCulling`                  | The cut rejects the boxes outside the frustum                                                                                                                              | `true`     |
| `cutMinLodCulling`                   | The cut prunes a leaf whose least own error still shows at its nearest                                                                                                     | `true`     |
| `cutDrawDistanceCulling`             | The cut culls an instance of an instanced mesh (`perInstance`) outside the draw distances it names; `false`, none is culled; an object of its own is always culled by them | `true`     |
| `cutDistanceCullToSphereEdge`        | An object's draw distance is measured to the edge of the sphere of its bounds; `false`, to its centre                                                                      | `true`     |
| `cutViewDistanceScale`               | The scale every draw distance, min and max, is multiplied by, a finite number of at least 0                                                                                | `1`        |
| `cutViewDistanceApplySecondaryScale` | Whether `cutViewDistanceSecondaryScale` multiplies the draw distances                                                                                                      | `false`    |
| `cutViewDistanceSecondaryScale`      | A second scale of the draw distances, for a feature or a mode to opt in to: it multiplies `cutViewDistanceScale` once the switch above is on; 0 or more                    | `1`        |
| `cutViewDistanceFovMinAngle`         | The horizontal field of view, in degrees from 0 to 360, at and under which the draw distances of an object of its own take `cutViewDistanceFovMinAngleScale`               | `45`       |
| `cutViewDistanceFovMinAngleScale`    | The scale the draw distances of an object of its own take at that angle and under, 0 or more                                                                               | `1`        |
| `cutViewDistanceFovMaxAngle`         | The horizontal field of view, in degrees from 0 to 360, at and over which the draw distances of an object of its own take `cutViewDistanceFovMaxAngleScale`                | `90`       |
| `cutViewDistanceFovMaxAngleScale`    | The scale the draw distances of an object of its own take at that angle and over, 0 or more; blended linearly with the first between the two angles                        | `1`        |
| `cutLodBiasFollowsUpscale`           | An upscaled image's threshold follows the display over the render width                                                                                                    | `true`     |
| `cutLodBiasOffset`                   | The bias's offset, in powers of two, any finite number                                                                                                                     | `0`        |
| `cutLodBiasMin`                      | The bias's floor, in powers of two, any finite number                                                                                                                      | `-2`       |
| `cutEdgeScaleBudgetMs`               | GPU time, in ms, the main view's cut and its raster may take; over it that cut's screen error is coarsened; 0 or less, no budget                                           | `0`        |
| `cutEdgeScaleMinPercent`             | The lowest scale of the screen error the budget takes it to, in percent, from 1 to 100                                                                                     | `30`       |
| `cutMaxNodes`                        | Most nodes one pass opens, a whole number from 1 to 2³¹ − 1                                                                                                                | `2097152`  |
| `cutMaxCandidateClusters`            | Most candidate clusters one cut lists, a whole number from 1 to 2³¹ − 1                                                                                                    | `16777216` |
| `cutMaxVisibleClusters`              | Most clusters one cut draws, a whole number from 1 to 2³¹ − 1                                                                                                              | `4194304`  |

**Depth pyramid settings.** The depth pyramid keeps its culling layer (the opaque depth, f32, the
farthest of each 2 × 2, edges clamped) whatever the settings; it starts at half resolution, reduced
from the depth texture itself, which holds the full-resolution depth, and the final build writes its
trace layers in the same dispatches. Its trace layers are what the
reflections' screen march reads. By default (`hizTrace` `'reference'`) the nearest layer is the
closest opaque depth of each texel's centre and the march is the reference's walk
(`visibility/hiz/gpu/screenMarchReference.ts`): its level 1 is the half-resolution mip 0 and the walk
goes down to the full-resolution depth image, as the reflections' reference does, a hit the tile's
depth, flat. In that walk a ray hits a surface it lies less far behind than
`reflectionRelativeDepthThickness` (0.005, a reflection setting) of the surface's depth (at least 10⁻⁷ m), times the projection's
depth scale (1 under a perspective; `screenRelativeThickness` derives it under an orthographic one,
from its depth range in centimetres, the depth measured from the eye's plane); `'planes'` keeps its
thickness in pixels. With `'planes'` the nearest layer
holds each pixel's plane corner, a finished-depth farthest layer is built beside it, and the march is
the engine's own (`screenMarchPlanes.ts`), which a grazing surface cannot slip through. The
transparent front depth is folded into the trace layers only by `hizFoldTransparents` (off). A
transparent cluster is tested against the culling layer at a finer level by default (`'finer'`,
`visibility/hiz/gpu/rectWgsl.ts`, the half-resolution mip at the finest) or, by `hizTransparentTest` `'reference'`, over four texels a
side of the lowest level that holds it (`visibility/hiz/gpu/footprintWgsl.ts`, the cut's own test).
The screen probes' trace walks the same pyramid with `screenMarch(..., full)`: `hizFullResDepth`
(on) takes the walk down to the full-resolution depth as the reflections' does; off, it stops at the
half-resolution level, each tile's depth scaled by a factor rising from 0.99 to 1 over the first
tenth of the march, and a hit is the centre of the 2 × 2 pixels of the texel. The relative
thickness of its surfaces is its own setting, `screenProbeRelativeDepthThickness` (0.02), times the
projection's depth scale (`screenRelativeThickness`, on the CPU) and written into the probes'
uniform; a hit on a thin sheet that transmits light (`SUBSURFACE_FLAG`) is dropped by
`screenProbeSkipFoliageHits` (on): the surface buffer's mark `SUBSURFACE_FLAG` is its backface diffuse light, which the
reference tests as `bHasBackfaceDiffuse`. The thickness of the surfaces is scaled by the pixel's surface: 1 where it has
a distance field to resume a ray behind it (`hasDistanceFieldRepresentation`, the surface flag 8 the shade pass writes
for the rows of a mesh that has a field, casts a dynamic shadow and affects distance-field lighting:
`FLAG_DISTANCE_FIELD`), `screenProbeThicknessScaleWithoutField` (2) where it has none
(`screenTraceDepthThresholdScale`), read at the probe's own pixel. Where foliage hits are kept, a hit is followed by
`screenProbeThicknessCertaintySteps` (4) linear samples along the ray toward its end, over that many texels of the
half-resolution level, and dropped (the ray goes on to the next stage) if the ray is above the closest depth at any of
them: a thin feature in front of it (`spThinFeature`); while they are skipped the steps are 0.

The light grid (`lighting/tiles/`) reads the culling layer of the image's own pyramid, when
`lightGridHizCull` is on (the default): for each column of 64 pixels, widened by one fog cell where
the image builds a fog volume, `pyramidFarthest` (`visibility/hiz/gpu/footprintWgsl.ts`, the cut's
4 × 4 footprint read) gives the farthest depth; the cells whose nearest face lies behind it are left
empty and every light's run ends at the cell that holds it (`lighting/tiles/cullWgsl.ts`). A column
with a background pixel, or a pyramid that is not this image's, is not
cut.

A cell's list is made from chains of links when `lightGridLinkedLists` is on (the default): a column's lights
go through in batches, each light a cell takes asks the view's pool for the next link and chains it before
the cell's head, and once every batch is in, each chain is written as a contiguous list, in increasing
light order. The pool holds `lightGridMaxCulledLightsPerCell` links for each cell of the grid, as a whole:
when links run short, the lights asked last are dropped and each cell keeps the first lights of its list,
with one console warning. With the option off, each cell has its own `lightGridMaxCulledLightsPerCell` words
of the pool and keeps its first lights up to them. The settings are world options by their field, changed by `world.hiz` from the next frame
(`packages/sdk-core/src/contracts/hizOptions.ts`):

```ts
const world = createWorld(canvas, { hizTransparentTest: 'reference' })
world.hiz = { hizTrace: 'planes', hizFoldTransparents: true }
world.hiz = { hizTrace: null } // back to the default, the reference's walk
world.hiz = { hizFullResDepth: false } // the probes' walk stops at the half-resolution level
world.hiz = { lightGridHizCull: false } // every cell the lights reach is listed
world.hiz = { lightGridLinkedLists: false } // each cell keeps its own first lights, no shared links
world.hiz = { lightGridMaxCulledLightsPerCell: 64 } // 64 light entries a cell instead of 32
```

| Field                                 | Meaning                                                                                          | Default       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------- |
| `hizTrace`                            | How the reflections' trace reads the pyramid: `'reference'`, or `'planes'`                       | `'reference'` |
| `hizFoldTransparents`                 | The trace layers hold the nearest transparent surface beside the opaque one                      | `false`       |
| `hizTransparentTest`                  | How a transparent cluster is tested: `'finer'` (16 texels), or `'reference'`                     | `'finer'`     |
| `hizFullResDepth`                     | The screen probes' walk goes down to the full-resolution depth                                   | `true`        |
| `lightGridHizCull`                    | The light grid leaves empty the cells behind their column's farthest depth                       | `true`        |
| `lightGridLinkedLists`                | The cells' lists are chains of links from one shared pool; `false`: each cell has its own words  | `true`        |
| `lightGridMaxCulledLightsPerCell`     | Light entries the view's light grid holds per cell; past it the lights asked last are dropped    | `32`          |
| `hizPrime`                            | When a primed pyramid is built: `'off'`, `'whenMissing'` or `'always'`                           | `'off'`       |
| `hizPrimeSizeBias`                    | The primed draw is the image shifted right by `1 + this`, a whole number from 0 to 30            | `2`           |
| `hizPrimeDepthBias`                   | Metres the primed depth is pushed away from the eye by, any number                               | `1.5`         |
| `hizPrimeErrorScale`                  | Factor on the cut's pixel error for the primed draw, any number                                  | `32`          |
| `hizPrimeFarFieldOnly`                | The primed draw holds the objects that set `farField` alone                                      | `true`        |
| `hzbOcclusion`                        | The main view leaves out the objects the depth hides: `0` none, `1` the roots' boxes, `2` forced | `0`           |
| `hzbOcclusionNeverTestDistance`       | Metres from the eye within which no object is tested                                             | `0`           |
| `hzbOcclusionExpandAmount`            | Metres every tested box is grown by; `hzbOcclusionExpandNewlyAmount` for a newly tested one      | `0`           |
| `hzbOcclusionExpandScreenSpace`       | Pixels every tested box is grown by; `hzbOcclusionExpandNewlyScreenSpace` for a newly tested one | `0`           |
| `hzbOcclusionFramesNotTestedToExpand` | Images untested before an object counts as newly tested                                          | `5`           |
| `hzbOcclusionFramesToExpandNewly`     | Images a newly tested object is grown for                                                        | `2`           |

**The primed pyramid** (`frame/render/primeHiz.ts`). The cut's main pass tests a box against the
pyramid of the image before; a view with none (its first image, a resize, a cut of the camera) tests
nothing and draws everything its post pass would have judged. With `hizPrime` `'whenMissing'` such an
image first builds a pyramid of its own from a small draw, and `'always'` does for every image: the
previous image's pyramid is then left aside and the cut tests the primed one, where `'whenMissing'`
tests the previous image's when there is one. The primed view (`frame/render/primeState.ts`) holds a depth target and a visibility target at the main
view's allocated size shifted right by `1 + hizPrimeSizeBias`, a raster over them and a Hi-Z
pyramid. Its cut (`GpuSelection.aside(true)`) is the main view's frustum at the image's render matrix,
over the placements that set `farField` (the cut's view filter, `geometry/selection/viewFilter.ts`;
all of them without `hizPrimeFarFieldOnly`), at `hizPrimeErrorScale` times the pixel error, in one
pass: no page is asked and no readback copies it. The main pass of that cut is
rastered, hardware slots then software clusters, into the small depth (`frame/render/primeStage.ts`,
no identifier is resolved), and the pyramid is built from it with a push of its level 0
(`visibility/hiz/gpu/primedWgsl.ts`): the depth is turned to the distance it stands for,
`hizPrimeDepthBias` is added and the sum turned back, clamped to [0, 1], the far plane's zero staying
zero. It is built in a command buffer of its own, submitted before the image's: the cut's tables and
the raster's buffers are written by the queue, and an image encoded behind it would read the last
write. The image's cut then runs two passes against it, with this image's matrix, depth map and the
primed size in place of the previous image's; it is never kept for the next image. A scene where no
object sets `farField` allocates nothing, encodes nothing and sends nothing. The tessellation's
patches test the same pyramid as the cut, and only a view that runs the cut's occlusion primes. A
compiled scene's node carries `farField` (the job's `objectSettings.farField`: the core node and the
cells' rows). The reference has a sixth setting, which lets the pass sample the depth of the
non-cluster geometry an early depth pass wrote; it has no counterpart here, which writes no depth
before the cut. Limits: the deformation is that of the image before and a tessellated cluster is left
out of the primed draw.

```ts
const world = createWorld(canvas, { hizPrime: 'whenMissing' })
mountains.farField = true // drawn into the primed pyramid
world.hiz = { hizPrime: 'always', hizPrimeSizeBias: 3, hizPrimeErrorScale: 16 }
world.hiz = { hizPrimeFarFieldOnly: false } // the whole cut is primed, not the flagged objects
world.hiz = { hizPrime: null } // back to 'off'
```

Two rasterizers write the one visibility buffer, chosen cluster by cluster (`visibility/raster/`).
The cluster cull makes the choice where it decides the cluster (`rasteredInHardware`,
`geometry/dag/shader/visibleWgsl.ts`), from its cluster record and its placement: a cluster whose box
crosses the near or the far plane or reaches behind the view's clip plane, or whose longest edge
projects at `hardwareRasterEdgePixels` (32 by default) or more at the nearest point of its
level-of-detail sphere, goes to the hardware rasterizer, which cuts it; every other one to the
software raster. The sphere is the cluster's own; a cluster whose vertices move — a dynamic geometry,
a deformation, an offset — is judged at the sphere around its box grown by its reach, with its rest
edge. The edge is measured once, on the GPU, from the cluster's triangles after its record is written
(`geometry/dag/info/measure.ts`) and kept in a buffer of its own, one f32 a record, zero until then:
a cluster of an unmeasured edge, or with no box, goes to the hardware raster, which draws any. Lines,
sprites and voxels always go to the hardware; `softwareRaster: false` hands it every cluster. A
cluster whose surface is displaced, where the frame tessellates, goes to neither: it is listed for the
tessellation (`VIS_TAG_TESSELLATED`), which seeds its patches from the list. The cull appends the
software clusters from the bottom of the list of visible clusters and the hardware ones from the top.

Between the cull and the rasters the visibility passes decode, order and list the clusters
(`visibility/passes/binning.ts`, one compute pass a pass of the cut, `RASTER_BINNING_PASS`), nothing
read from the host:

- **The decode** (`visibility/decode/decodeWgsl.ts`) writes, for each listed cluster, its record
  (`PageInfo`, 160 bytes, `visibility/pageInfo.ts`) at its index in the list of visible clusters, one
  thread a cluster, from three sources: the cluster's own record, its placement's world — held in
  doubles on the GPU, taken in single precision — and its placement's record
  (`geometry/dag/info/placementInfoLayout.ts`: its deformation, the switches of its object's offset,
  the HLOD level it is drawn as, the results of its deformed pages), which the host writes when a
  placement is made or what it holds changes (`geometry/clusters/placementInfo.ts`). A blended
  cluster has no record here. A plan kernel before it reads the list's header and writes the pass's
  ranges and the dispatch of the decode; the clusters whose vertices a deformation moves are listed
  for the deformation, which runs between the decode and the bins (`deformation/computeWgsl.ts`,
  `deformListed`), the deformed bank tracks and float-pool blocks having run at the frame's start.
- **The bins** (`visibility/bins/binsWgsl.ts`) place each cluster in a group — a hardware slot, the
  software raster's opaque or cutout clusters, or the tessellation's —, in four kernels: a count, a
  reservation of each group's place, a scatter and the lists' headers. A hardware slot is a kind
  (opaque, cutout, voxel, or the software clusters the x-ray view walks in the hardware slots too),
  a face mode (the surface's side, swapped by a mirrored world), a coplanar layer and a half
  (main, post pass); it draws by one indirect command whose instances are the clusters, each
  instance a batch of at most 96 corners of its cluster, so the vertex stage reads the cluster's
  record by the index the instance carries. The software and the tessellation's lists are the
  raster's (`visibility/raster/contract.ts`), the post pass's after the main pass's; a cutout or voxel
  group is ordered by depth bucket.

The software raster (`visibility/raster/clusterWgsl.ts`) is a compute pass whose unit of work is the
cluster: one group of 64 threads rasters one listed cluster. The group transforms the cluster's
vertices — at most 256 — onto an 8-bit sub-pixel grid once, into its memory, each thread some of
them; then each thread takes a triangle at a time (128 at most in an encoded cluster, two turns of
the group), sets it up (`visibility/raster/triWgsl.ts`: the top-left fill rule, the depth plane, a
box of at most 64 pixels a side) and rasters it itself, by its box row by row or, when a triangle of
the lanes that run together spans more than 4 pixels — a subgroup vote where the device has
subgroups, each lane's own triangle where it has none — or the cluster is masked, by the span each
row's edges cover. A cluster that cannot be held there, an older cache's, transforms the corners of
each triangle as it sets it up. Its list is one a pass of the cut and holds each cluster once, as
many as the list of visible clusters holds room for: the bins append a cluster with one atomic, not a
triangle, and the dispatch that launches the raster is read from the list's own header.

Five settings of the raster are run-time ones, one contract and one resolver each
(`packages/sdk-core/src/contracts/rasterOptions.ts`): `softwareRaster`, `hardwareRasterEdgePixels`
and the depth bucketing's (`depthBucketing`, `depthBucketsMinZ`, `depthBucketsMaxZ`); world options
and render settings of the world's registry (`session/world/settings.ts`, the page over the preset —
no preset level writes them), session options, and the frame reads them from the engine context.
The depth bucketing is the reference's (on by default): the software
raster's cutout clusters are rastered nearest first — each under the bucket of its box's view depth,
256 buckets spread by the logarithm of the depth between `depthBucketsMinZ` (10 m) and
`depthBucketsMaxZ` (1000 m), the reference's centimetres in metres — after the clusters that read
no texture, by a counting sort in the bins' reservation, so that a hidden cutout fragment leaves
(`visPasses`, before `maskKeep`) before its texture is read. The bucket of a cluster is written by the
cull into its record's tag. As in the reference, whose visible-cluster record holds the bucket only
where its project supports assemblies or voxels, the order is made only where the scene holds voxel
clusters; the order never changes a pixel. The hardware slots' cutout and voxel groups are ordered
by the same buckets, nearest first: the reference orders its hardware dispatches too.

The reference has four more raster switches that this engine has no option for, each for a reason
of its own. The visibility buffer's clear is one native `clearBuffer` of a linear storage buffer
(the reference's compute and tiled clears replace a platform clear that WebGPU does not have to
replace). The raster's lists are sized by the list of visible clusters, which holds every cluster
the cut draws once (`cutMaxVisibleClusters` is its cap), so no multiple of it sizes a list that
could overflow. The hardware slots are walked opaque, cutout, then voxel, the order the reference
sorts its dispatches into. Node and cluster culling run one level per indirect dispatch: the
one-kernel form waits on other workgroups, which WebGPU does not guarantee to run.

Both rasterizers write a pixel by the one rule of `visWriteWgsl`
(`visibility/raster/pixelWgsl.ts`): the 64-bit maximum of `(depth, identifier)` — a depth key, the
reversed depth's bits raised by the cluster's coplanar layer units, over the identifier
`(index + 1) << 8 | triangle`, `index` the cluster's place in the list of visible clusters — whatever the order of threads, passes and rasters: the nearest wins, a
tie goes to the greater identifier. A device with the optional WebGPU feature `atomic-vec2u-min-max`
(`gpu/core/wideAtomics.ts`, requested at the device's creation; WGSL `atomic<vec2<u32>>` and
`atomicStoreMax`) holds a pixel as one 64-bit word, the identifier in its low half and the depth in
its high one, and every fragment is written once, by that maximum: the software raster's threads,
the tessellation's micro-triangles and the hardware slots' fragments, each triangle drawn once. The
word cannot be read, so no fragment leaves early. A device without it keeps the same result by
other means: the hardware raster draws each triangle once, with the hardware depth test, into the
scene's depth attachment — the fragment's depth is the key — and an identifiers target of its own;
the software raster writes two 32-bit planes, a depth key by `atomicMax` in a first mode, then in a
second, once both passes' depths are down, the identifier of each fragment whose key is exactly the
pixel's, by `atomicMax`; the export merges the two rasters, the nearer winning, a tie going to the
greater identifier. The two paths give one image except between two fragments of different
identifiers at exactly the same depth from the hardware raster alone, which the depth test (greater or equal) settles
for the later draw. The host switch `trillion3dGpuFeaturesOff=atomic-vec2u-min-max` names the feature off.

The cut draws in two passes (`visibility/passes/passes.ts`), and the raster follows them
(`frame/render/encodeVisSetup.ts`): each pass has its own decode and bins, its own list of
clusters in the lists buffer and its own half of the hardware slots, its clusters those the cut listed
before its post pass opened — the main pass's — or after, the post pass's, read through a uniform
entry of its own. No kernel reads a verdict. One compute pass exports the buffer (`visibility/raster/export.ts`) into the depth level
the Hi-Z is built from after each pass's depth; the last one, once both passes' depths are down, into
the identifiers the material passes read — the shading mask the surface passes classify by — and a
full-screen draw writes the scene's depth attachment from that level: WebGPU lets a texture be a
storage binding only in a format of its colour table and a `depth32float` texture takes a copy only
from another of its format (§ 6.1 and § 26.1.2.2 of the WebGPU specification), so a compute pass
cannot write the attachment.

A voxel page ([FORMAT.md](../format/pages.md#voxels)) — a voxelized mesh's far levels, a `voxel` HLOD cell —
is a page like any other: catalogued, streamed and chosen by the one cut at its voxels' error. Each
brick draws its box, the box of the cells its mask holds, by its back faces alone, so an eye inside
a box or a box across the near plane still draws; each pixel of the box casts the eye's ray through
the brick's cells (`visibility/shader/voxelWgsl.ts`, `voxelCellTrace`): it enters at the box, or at
the eye inside it, steps cell to cell by a 3D DDA, reads each cell's bit of the brick's 64-bit mask,
and stops at the first solid cell, at most 10 steps — the most cells a line crosses in a 4³ brick.
The ray and its clip depth are affine in the box point: the vertex stage computes them at the box's
corners and the pixel gets its own by interpolation, so a voxel fragment runs the DDA and one
division, reads no buffer, builds no matrix (`visibility/shader/voxelHitWgsl.ts`). Voxel rows have
slots and a shader module of their own (`visibility/shader/visVoxelWgsl.ts`), drawn after the opaque
and cutout ones, on layer 0, and only on a frame whose table holds a voxel row: the other slots
compile the text they compiled before voxels. A voxel fragment always runs its trace: its fragment
traces its cells before it can compare the depth. The shadow pages draw voxel rows in
tiers of their own, sized by the page's bricks as the corner tiers are by its triangles, their
module apart (`render/renderVoxelWgsl.ts`), on the same sequence; the resolve of a voxel class, its
module apart too, traces the pixel again to read its voxel's colour, roughness, occlusion and
normal — its rank one read of its brick and a popcount —, its normal carried by the brick's joint.
Every voxel module and pipeline is made the
first time the table holds a voxel row or a voxel class: a scene without voxels compiles what it
compiled before them. A skinned mesh's
bricks follow their joint rigidly and are traced at rest. Ray queries take the finer clusters a
voxel page stands for, never the page. The `voxels` view paints each voxel in its level's colour;
the metrics `voxelStepsMean` and `voxelStepsMax` sample the DDA steps a pixel took.
