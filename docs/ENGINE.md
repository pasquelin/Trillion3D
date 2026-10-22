# Engine internals

A map of how a world draws: the engine, the frame's stages in order, what each subsystem owns and
where its code lives, and the rules that hold across files. The code is the contract: each
module's head comment states its rule and its reasons; this page names the module once. Paths are
under `packages/sdk-browser/src/`; `sdk-core/` stands for `packages/sdk-core/src/`, and a path that
starts with `packages/` or `tests/` is from the repository root.

The page's API is [SDK.md](SDK.md); what stays in memory, [RESIDENCY.md](RESIDENCY.md); shadows,
[SHADOWS.md](SHADOWS.md); the cache files, [FORMAT.md](FORMAT.md); the body API,
[PHYSICS.md](PHYSICS.md); the maths, [MATHS.md](MATHS.md). Two internals are public, for a host
that drives pages or diagnostics itself: `createGpuPageCache` (`pages/pool/pages.ts`) and
`createDiagnosticChannel` (`diagnostic/channel.ts`). Every other internal name is reached through
the measurement entry point, `measurement/measurement.ts` ([SDK.md](SDK.md#entry-points)).

## The internal session

A world opens one session on itself (`openMeasuredWorld`, `src/session/explorer.ts`); options
beyond `WorldOptions` serve the bench and the proofs, and a published world runs the defaults.

## The engine

A session draws with one engine, the WebGPU page raster, reading `source.gltf`: its renderer is a
family loaded beside the scene (`webgpuEngine`, `engine/factory.ts`). A bench page hands the
session the raster's factory itself (`engine`, a measurement seam no host reaches) and skips that
load.

A machine that grants no WebGPU device is refused by name, `WEBGPU_UNAVAILABLE`, on the session's
`fatal` event, before anything is read for the scene. The witnesses the bench compares against draw
in pages of their own ([bench/runner/README.md](../bench/runner/README.md#the-witnesses)); the
session never mounts one.

## The frame, in order

One WebGPU image is one command buffer, encoded in this order:

| Stage                                                     | Code                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| Frame gate: camera copy, held-frame test, pipelines asked | `gate/gateCore.ts`, `frame/loop/hold.ts`, `src/frame/render/render.ts` |
| World poses uploaded                                      | `src/frame/render/worldUpload.ts`                                      |
| GPU deformation                                           | `deformation/compute.ts`                                               |
| Composed placements                                       | `compose/gpuCompose.ts`                                                |
| Cut: GPU selection, the engine's one cut                  | `src/frame/render/gpuCut.ts`                                           |
| Draw compaction of the cut's main pass                    | `visibility/draw/drawOps.ts`                                           |
| Visibility raster, the cut's post pass between its halves | `visibility/passes/passes.ts`                                          |
| Material surfaces, one dispatch per class                 | `materials/classes/materialPasses.ts`                                  |
| Light buffer, bounce, light grid, virtual shadow maps     | `src/frame/render/encodeLights.ts`                                     |
| Deferred resolve                                          | `lighting/deferred/deferred.ts`                                        |
| Transparents, distortion, particles                       | `src/frame/render/encodeBlend.ts`                                      |
| Temporal resolve                                          | `taa/frame.ts`                                                         |
| Exposure: histogram and update of the image composed      | `post/exposure/meter.ts`                                               |
| Finishing: scene chain, local exposure's grid and blur    | `post/finish/frame.ts`                                                 |
| Effect chain (bloom)                                      | `src/frame/render/encodeEffects.ts`                                    |
| Composition, presentation, submission                     | `lighting/deferred/deferred.ts`, `src/frame/render/encoder.ts`         |

`src/frame/render/surfaceLighting.ts` encodes the stages from the light buffer on.

## Views

A world draws its own camera as the runtime's main view, then each view `world.addView` made
(`session/world/views.ts`), in the same frame and loop (`frame/schedule/draw.ts`). A view is a
record of what a camera owns (`frame/backend/state/view.ts`): its cut and what its image made of it,
motion, Hi-Z pyramid (what its next image's cut occlusion reads), frame targets, temporal history,
effect chain, presenter (a canvas of its own, or a rectangle of the main canvas), GPU timer and render scale
(`view/viewScale.ts`, following the world's controller within its bounds). Drawing it trades
those members into the runtime groups and back (`frame/backend/state/viewSwitch.ts`); every other
member is the scene's and is shared: placements and their composition, the pages, their residency
— the union of every view's cut under the one budget —, the pools, materials, lights, physics and
pipelines. The virtual shadow maps share their pool, page tables and local lights' maps; a sun's
clipmap follows the eye, so each view keeps its own cache entry (`VsmCacheManager.view`), carried
unreferenced while other views draw and aged by its own view's frames; the pool is asked for every
view's pixels. The projection mask and the light grid keep the largest layout a view asked, so
views of other sizes drawn in turn lay nothing out again. The main view's GPU sample adds the views'
last GPU time, each over the main images between its draws, to the frame the `'auto'` scale fits.

## Scene and camera

Every node is a slot of one transform tree, walked once a frame over what changed
(`packages/sdk-core/src/world/transform/pass.ts`). A material is declared once into the one surface record its meshes wear,
`pages/surfaceRecord.ts`. The engine composes its own projection, reversed depth with an infinite far
plane, one convention for every pass (`camera/depthConvention.ts`).

A node whose parent moves and whose pose only follows it is composed once, on the GPU: its link is
a node flag (`NODE_WORLD_LAZY`, `packages/sdk-core/src/world/transform/nodeFlags.ts`) that the tree's walk
leaves alone, and the placement's compose slot is the parent's. The roots pass writes, in exact
double arithmetic, the world, the stretch, the world box and the motion of each linked root; the
rows pass writes the page-table world words, the sphere and the world-dependent levels of detail
of its rows (`compose/gpuCompose.ts`); the members pass writes the leaf boxes the
placement tree is fitted over, and the one tree refit (`dag/tree/treeRefit.ts`, a pass any caller
names its dirty groups to) fits them and every node above, bottom up. A CPU reader — transparent
depth, a winding — reads the composed world once a frame (`composedWorld`, a
product of the parent's and the local matrix kept by `state.version`), never a second multiply that
is written back. Models and partition rows link before their rows are written, so no matrix is
written for them. A link is never refused for what reads its row: waves, soft bodies and skeletons read the
composed world of their root; rows no root reads — a blended surface's, or a root a growth has not
built yet — are composed for their readers (`compose/composeReaders.ts`) and handed to the roots
pass once their root exists. Only the pose a session opens on is written by an owner, before any
engine exists (`partition/follow.ts`, `world/models/models.ts`); every product of a parent's
world and a local matrix on the CPU is the one product `multiplyMatrix4` (`packages/math/src/matrix/matrix4.ts`), which the GPU composition reproduces word for word (`compose/gpuComposeWgsl.ts`). The refit and the members pass bind the cut's
tables as the cut does, split tables in their parts (`geometry/dag/shader/bindings.ts`).

## A partitioned scene

A compiled scene's spatially loaded objects lie in the cells of the grids of its partition's
scheme ([COMPILER.md](COMPILER.md#the-partitions-grids)), which its root names: the main grid's,
and each HLOD level's. A cell places its objects on rows of their meshes: a static object under
its core node — one with nodes under it under its own node —, an instanced skinned object at its
skin's frame playing its track ([Animation banks](#animation-banks)), an animated object of the
core at its node, its host mesh the row's animation source — its skeleton and morph weights as
the page's clips leave them —, the row live while that mesh is shown. The camera is the scene's
one streaming source (`geometry/partition/source.ts`): at its eye, seen from above, a circle of
each grid's own loading range — scaled, or one radius for every grid —, or a sector of it around
the view's axis. A cell is wished while that shape meets the bounds it streams by, and not wholly
beside or behind the sector (`geometry/partition/plan.ts`, `geometry/hlod/hlodCells.ts`):

- `hashSet`, the default: the bounds it streams by within or on the circle's radius, the sector
  around the view's own axis without its up part — on grids the job does not lay flat, within or
  on a sphere of that radius, the sector a cone around the view's axis that the box's bounding
  sphere meets. The cells wished and not loaded load in
  one order: the higher level on its grid first, then the lower grid priority — the main grid's,
  each HLOD grid's 0 —, then the lower distance ratio: the squared distance from the eye to the
  box over the squared radius, at most 1, times half the cosine of the view's axis with the way
  from the box to the eye plus a half — 0 from within it —. The settings `sortByExtent`,
  `sortByPriority` and `angleWeight` rank nothing under this scheme.
- `spatialHash`: its square strictly within the circle's radius, the sector around the view's
  heading on the ground, and, under `worldStreamingZCulling`, its content's height range meeting
  the eye's within the radius; on a grid compiled with `pullCoarser`, a wished cell pulls in the
  coarser cells overlapping it, and those in turn (`geometry/partition/coarser.ts`,
  `geometry/hlod/hlodPulls.ts`). The cells wished and not loaded load in one order: the wider first (by
  their half side, or by their level), then the lower grid priority — the main grid's, then each
  HLOD grid's, 100 plus its level —, then the nearer, the squared distance to the cell's centre
  times the angle the view turns to reach it, over a half turn, raised to the angle weight.

At most `worldStreamingMaxLoadingCells` load at once, the next starting as one ends: those loading,
less than that, are the room left; at 0 or less none is held back. The actors always loaded — held
by no cell — make one unit a level; it ranks after every cell the view reaches, starts only while
room is left and takes none, and counts among those loading while the reads of its actors are not
done (`geometry/hlod/hlodTops.ts`). Each cell that starts takes a turn, and its reads — a cell's
files, an HLOD cell's actors' roots and rows — ask the session's queue by it, in a lane ahead of the
cut's pages: the queue serves every cell's reads in the one load order, a page never ranked among
them (`geometry/streaming/priority.ts`, `geometry/partition/loadOrder.ts`, `geometry/partition/loadSlots.ts`). The cells not started
are ranked again at each frame; one loading keeps its turn, its reads staying where they were asked.
The initial load — till the session's first image is shown — holds none back, and that image waits
for it: every cell wished visible, its content placed and its roots resident
(`frame/loop/firstImage.ts`).

Each cell is visible or not, as a streamed level is (`geometry/dag/worlds/worldFollow.ts`): it
turns visible once wished and loaded, invisible once wished no more. An HLOD actor is drawn while
the cell it lies in is visible and the cell it stands for is not: a cell shown hides its actor at
once, a cell hidden shows it if it is loaded. A cell file is a main grid cell's part of an HLOD 0
cell: its rows draw while its main cell is visible — shown once wished on the main grid, placed and
its roots resident, hidden once wished no more (`geometry/dag/worlds/worldFiles.ts`) — or while
its HLOD 0 cell is, every file of it loaded, as that cell's HLOD 0 actor; a cell not visible draws
nothing of its own and asks for nothing. The HLOD 0 cell of a layer not instanced is its main
cell's own, on the main grid: its rows draw as that main cell's, and past its range the HLOD 0
actor its layer built of them stands for them, as any cell's actor. The objects standing as
themselves in an actor — an `instanced` layer's every one, any other's those marked
`hlodInstance` — are its rows (`geometry/hlod/hlodRows.ts`): read with the actor, from the bundle
its cell holds with its root pages, placed on their meshes' own rows — grown for the actors
loaded, never for the world's rows — while the actor is loaded, each linked to the actor's cell (`ACTOR_ROW`,
`geometry/dag/worlds/worldLinks.ts`), drawn while that cell draws the actor and counted in its
readiness as its root pages are, painted in the HLOD view with the actor's HLOD level. A switch that draws an actor whose layer asks a warm-up —
every builder's but `instanced`'s — waits so many frames in a row (`frame/prepare/hlodWarm.ts`);
the actor stays warming till it is drawn or let go, and each image, while it is in the drawn
view, asks its geometry — the pages of its first 16 bundles past its root page, ahead of the
views' requests: for the frames of the count as it starts, for one while it stands at zero — and
its textures at the size it covers in that view, its count advancing once a frame — the main
view's image —, however many views draw. The initial load waits on none. A see-through item
follows the same words: its key record names its row's cell file slot and HLOD 0 cell, and the
verdict draws it while either draws its placements (`blend/verdict/verdictWgsl.ts`).

A main grid compiled to block on slow streaming (`blockOnSlowStreaming`,
[COMPILER.md](COMPILER.md)) waits for its cells near the view once the first image is shown
(`geometry/partition/slowStreaming.ts`): a cell file wished and not yet shown whose ratio — on a
square grid its content's distance from the eye less its half side over the grid's loading range,
on a loose grid the distance to the bounds it streams by over the view's radius — is at most 0 or
under `worldStreamingBlockOnSlowStreamingRatio` blocks. While one does, no image is presented, the
loop taking the whole frame (`frame/loop/firstImage.ts`); only the blocking files start loading,
all at once, a unit already loading going on; no HLOD cell turns visible, no other file shows and
no switch waits on a warm-up. The HLOD grids never block. With `hlodEnabled` off, no HLOD cell is
held or told, none draws its actor nor its HLOD 0 actor, and every cell file streams on the main
grid alone.

Every setting is the reference's by default, a world option by its field, held over the quality
preset, changed later by `world.worldStreaming` from the next frame
(`packages/sdk-core/src/contracts/worldStreamingOptions.ts`); a value a setting does not take is
refused:

```ts
const world = createWorld(canvas, {
  worldStreamingMaxLoadingCells: 8,
  worldStreamingRangeScale: 1.5,
  hlodWarmupFrames: 3,
})
world.worldStreaming = { worldStreamingSector: true, worldStreamingSectorAngle: 120 }
world.worldStreaming = { worldStreamingMaxLoadingCells: 0 } // no limit: every cell wished starts at once
world.worldStreaming = { worldStreamingSector: null } // back to the preset's, here the default
// A scene compiled with `partitionGrid: { blockOnSlowStreaming: true }` waits for its near cells
// within a tenth of the main grid's range; the HLOD actors switched off, then on again.
world.worldStreaming = { worldStreamingBlockOnSlowStreamingRatio: 0.1 }
world.worldStreaming = { hlodEnabled: false }
world.worldStreaming = { hlodEnabled: null }
```

| Field                                     | Meaning                                                                                                                       | Default |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| `worldStreamingMaxLoadingCells`           | Cells that may load at once once the first image is shown, a whole number; 0 or less, no limit                                | `4`     |
| `worldStreamingAngleWeight`               | How much the angle to the view's heading weighs in a cell's turn, from 0 to 1                                                 | `0.4`   |
| `worldStreamingSortByExtent`              | The wider cells first by their half side; `false`, by their level                                                             | `true`  |
| `worldStreamingSortByPriority`            | A grid's priority ranks before the distance; `false`, after                                                                   | `true`  |
| `worldStreamingUseGridRange`              | The circle takes each grid's range times `worldStreamingRangeScale`; `false`, `worldStreamingRadius`                          | `true`  |
| `worldStreamingRangeScale`                | The scale of each grid's loading range, from 0                                                                                | `1`     |
| `worldStreamingRadius`                    | The circle's radius for every grid, metres, from 0                                                                            | `100`   |
| `worldStreamingSector`                    | Only a sector of the circle around the view's heading streams cells                                                           | `false` |
| `worldStreamingSectorAngle`               | That sector's angle, degrees, from 0 to 360                                                                                   | `360`   |
| `worldStreamingZCulling`                  | A square grid's cell (`spatialHash`) is wished only while its content's height range meets the eye's height within the radius | `false` |
| `worldStreamingBlockOnSlowStreaming`      | A grid compiled with `blockOnSlowStreaming` holds the images back while a cell near the view is not shown                     | `true`  |
| `worldStreamingBlockOnSlowStreamingRatio` | The ratio under which a cell of a blocking grid not yet shown blocks, from 0                                                  | `0.25`  |
| `hlodEnabled`                             | The HLOD actors load and draw; `false`, the main grid's cells draw alone                                                      | `true`  |
| `hlodWarmup`                              | A switch that draws an HLOD actor whose layer asks one waits on its warm-up                                                   | `true`  |
| `hlodWarmupFrames`                        | The frames in a row a warm-up lasts, a whole number from 0                                                                    | `5`     |
| `hlodWarmupGeometry`                      | A warm-up asks the actor's geometry, ahead of the views' requests                                                             | `true`  |
| `hlodWarmupTextures`                      | A warm-up asks the actor's textures                                                                                           | `true`  |
| `hlodWarmupTextureScale`                  | The scale of the size the actor covers on screen its textures are asked at, from 0                                            | `2`     |
| `hlodWarmupTextureClamp`                  | The most texels asked along a texture's side, a whole number from 1                                                           | `2048`  |

## WebGPU page raster

`webgpuPagesEngine` (`frame/backend/pages.ts`) draws from the bounded page cache of
`pages/pool/pages.ts`. A compute pass selects the camera's resident cut and draws it through indirect
commands into a visibility buffer (`src/frame/render/gpuCut.ts`); occlusion is the cut's own, in two
passes (below, `visibility/passes/passes.ts`). The render
passes whose commands repeat from frame to frame — the raster's slot draws, the material surfaces —
are render bundles, recorded once and replayed while the few identities and revisions they are
keyed by hold (`gpu/core/renderBundles.ts`); their passes keep the timestamps. Which pages load and leave is
[RESIDENCY.md](RESIDENCY.md).

The cut (`geometry/dag/`) descends the placement tree's cells, then each placement's culling tree,
level by level in one descent array, down to the clusters of its leaves; a node's children are
queued only once it is kept. The culling tree is the compiler's ([FORMAT.md](FORMAT.md#cluster-dag)): one
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
([RESIDENCY.md](RESIDENCY.md)) and, while the temporal antialiasing upscales, by the bias
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
keeps it. The poses a frame draws are kept for the next one on the GPU
(`geometry/dag/previousPoses.ts`), those that moved alone, copied as the next frame's main view
opens it, before it sends a pose: every view of a frame tests against the same. A box that covers
no pixel centre is culled in every pass; a box across the near plane is always seen; a placement
no camera culls (a constant-size sprite) is never judged. Every view runs both passes, the main
one and each view drawn aside (`geometry/dag/aside.ts`), against its own last pyramid; a view's
first image — a capture's only one —, a pyramid made again by a resize of the targets and the
switches off cut in one pass that occludes nothing. The readback counts what the main pass held
(`occluded`) and what the post pass hid again (`postHidden`).

The cut's lists hold fixed caps, laid out once in its flags (`geometry/dag/flagSections.ts`), never
grown on demand: the nodes one pass opens (`cutMaxNodes`, rounded down to a multiple of 16), the
candidate clusters of both passes with those the previous pyramid hid, which share the one list
from its two ends (`cutMaxCandidateClusters`, rounded down to a multiple of 64), and the clusters
drawn (`cutMaxVisibleClusters`). Every level of a pass lies in one descent array, behind the level
before it, beside as many items held for the post pass; at the defaults the lists take the
reference's 216 MiB — 2 Mi nodes of 8 bytes a pass and 12 held, 16 Mi candidates of 8, 4 Mi drawn
clusters of 12 —, and 20 bytes for each root slot and cell of the placement tree. Each section is
held to what the packing can ever ask of it — its entries, twice its pages, its pages —, a saving
that changes no cut. A cut past a cap drops what is past it — a node with its subtree, a cluster
neither tested nor drawn — and draws what fits (`geometry/dag/shader/listsWgsl.ts`,
`commitWgsl.ts`); its readback brings back the most each pass asked of each list, and each list
keeps its high-water mark: a cut past a cap that raises the mark is said
once, as a `gpu-cut-lists` warning naming the list, its peak over its cap, the mark and the
setting that raises the cap (`geometry/dag/lists/listFeedback.ts`). Caps changed at run time lay
the flags out again between two frames; caps the device or the cut's share refuses keep the lists
as they are, said once. The readout the host adopts the cut from follows what the cut asks of it
(`geometry/dag/lists/requestSize.ts`): a request a leaf, drawn clusters and requests in lists of as
many ranks, from `streamingMinRequests` (65 536) to `streamingMaxRequests` (1 048 576), made again
between two frames when the size moves; a cut that lists more is adopted by its head, its mask
drawn whole.

```ts
const world = createWorld(canvas, { streamingMinRequests: 262144 }) // the readout starts larger
explorer.setStreaming('streamingMaxRequests', 524288) // and stops growing there, from the next readback
```

```ts
const world = createWorld(canvas, { cutMaxVisibleClusters: 8 * 1048576 })
world.cut = { cutMaxNodes: 4 * 1048576 } // its lists laid out again before the next cut
```

Every setting is the reference's by default, a world option by its field, held over the quality
preset — no preset level writes one —, changed later by `world.cut` from the next frame
(`packages/sdk-core/src/contracts/cutOptions.ts`); a value a setting does not take is refused:

```ts
const world = createWorld(canvas, { cutTwoPassOcclusion: false })
world.cut = { cutLodBiasFollowsUpscale: false, cutLodBiasMin: -1 }
world.cut = { cutTwoPassOcclusion: null } // back to the preset's, here the default
```

| Field                      | Meaning                                                                      | Default    |
| -------------------------- | ---------------------------------------------------------------------------- | ---------- |
| `cutTwoPassOcclusion`      | Each view's cut runs its two passes; `false`, one pass that occludes nothing | `true`     |
| `cutOcclusionCulling`      | The cut tests its boxes against the depth pyramids at all                    | `true`     |
| `cutFrustumCulling`        | The cut rejects the boxes outside the frustum                                | `true`     |
| `cutMinLodCulling`         | The cut prunes a leaf whose least own error still shows at its nearest       | `true`     |
| `cutLodBiasFollowsUpscale` | An upscaled image's threshold follows the display over the render width      | `true`     |
| `cutLodBiasOffset`         | The bias's offset, in powers of two, any finite number                       | `0`        |
| `cutLodBiasMin`            | The bias's floor, in powers of two, any finite number                        | `-2`       |
| `cutMaxNodes`              | Most nodes one pass opens, a whole number from 1 to 2³¹ − 1                  | `2097152`  |
| `cutMaxCandidateClusters`  | Most candidate clusters one cut lists, a whole number from 1 to 2³¹ − 1      | `16777216` |
| `cutMaxVisibleClusters`    | Most clusters one cut draws, a whole number from 1 to 2³¹ − 1                | `4194304`  |

Two rasterizers write the one visibility buffer, chosen cluster by cluster (`visibility/raster/`).
A binning kernel, one workgroup a drawable row (`visibility/raster/binWgsl.ts`), reads each row's
longest edge, vertex box and level-of-detail sphere: a row whose box crosses the near or the far
plane, or whose longest edge projects at `hardwareRasterEdgePixels` (32 by default) or more at the
nearest point of its level-of-detail sphere, goes to the hardware rasterizer; every other one to the
software raster. The sphere is the cluster's, written with its row (`PageInfo.lodSphere`); the edge
and the box are measured from its triangles once, by the first binning after the row's upload, and
kept in the row (`PageInfo.edgeLength`, zero in the CPU's copy, so every upload measures again). A
row whose vertices move in place — a dynamic geometry, a deformation — is measured every image and
judged at the sphere around its box. The software raster is a
compute pass that snaps each triangle to an 8-bit sub-pixel grid, keeps the top-left fill rule and
walks its box, at most 64 pixels a side, in one of three classes — fine, coarse, large
(`visibility/raster/triWgsl.ts`, `visibility/raster/kernelsWgsl.ts`). The row's draw item carries
the choice in its sixth word (`DrawItem.raster`): the compaction bins software rows apart, which the
hardware slots skip and the x-ray view still walks. Lines, sprites and voxels always go to the
hardware; `softwareRaster: false` hands it every row. Both settings are run-time ones, one contract
and one resolver each (`packages/sdk-core/src/contracts/rasterOptions.ts`): world options and
render settings of the world's registry (`session/world/settings.ts`, the page over the preset —
no preset level writes them), session options, and the frame reads them from the engine context.

Both rasterizers write a pixel by the one rule of `VIS_WRITE_WGSL`
(`visibility/raster/pixelWgsl.ts`): the pixel holds two 32-bit words of a work buffer, a depth key —
the reversed depth's bits raised by the row's coplanar layer units — and the identifier
`(row + 1) << 8 | triangle`. WebGPU has no 64-bit atomic, so the write runs in two phases: the
depth phase keeps the atomic maximum of the keys, the identifier phase the atomic maximum of the
identifiers whose key is exactly the pixel's final one. The pixel ends with the 64-bit maximum of
`(depth, identifier)` whatever the order of threads, passes and rasters: the nearest wins, a tie
goes to the greater identifier. The hardware slots are drawn once a phase, their depth attachment
read-only and untested.

The cut draws in two passes (`visibility/passes/passes.ts`), and the raster follows them
(`frame/render/encodeVisSetup.ts`): each pass has its own binning, its own software lists in the
work buffer and its own half of the hardware slots, its rows those its mask holds — the main
pass's the frame mask before the post pass, the post pass's the post mask
(`GpuSelection.postMaskOffset`), read through a uniform entry of its own. No kernel reads a
verdict. Resolves turn the work buffer into the depth level the Hi-Z is built from after each
pass's depth, then, once both passes' depths are down, into the identifier and depth targets the
material passes read (`visibility/raster/resolve.ts`).

A voxel page ([FORMAT.md](FORMAT.md#voxels)) — a voxelized mesh's far levels, a `voxel` HLOD cell —
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
compile the text they compiled before voxels. The hardware raster runs no depth test — every
fragment writes the work buffer by atomic maximum —, so a voxel fragment always runs its trace. The shadow pages draw voxel rows in
tiers of their own, sized by the page's bricks as the corner tiers are by its triangles, their
module apart (`render/renderVoxelWgsl.ts`), on the same sequence; the resolve of a voxel class, its
module apart too, traces the pixel again to read its voxel's colour, roughness, occlusion and
normal — its rank one read of its brick and a popcount —, its normal carried by the brick's joint,
and its shadow receiver is the hit and that normal. Every voxel module and pipeline is made the
first time the table holds a voxel row or a voxel class: a scene without voxels compiles what it
compiled before them. A skinned mesh's
bricks follow their joint rigidly and are traced at rest. Ray queries take the finer clusters a
voxel page stands for, never the page. The `voxels` view paints each voxel in its level's colour;
the metrics `voxelStepsMean` and `voxelStepsMax` sample the DDA steps a pixel took.

## Material surfaces

The visibility buffer is resolved into the material surfaces in compute, one indirect dispatch per
material class over that class's pixels alone (`materials/classes/materialPasses.ts`). The surfaces
and the feedback target are cleared first, by a pass of no draw; then one compute pass sorts every
pixel into the bin of its class — the shading bins (`materials/classes/shadeBins.ts`,
`visibility/shader/shadeBinsWgsl.ts`, `visibility/shader/shadeBinKernelsWgsl.ts`):

- a count of each bin's elements, a workgroup a 16 × 16 tile, a lane a 2 × 2 quad of it along the
  Z-order — four lanes in a row a 4 × 4 square, sixteen an 8 × 8 one —, the tile's bins voted one
  at a time, the greatest first, one counter add a tile and a bin;
- a reservation, a lane a bin, of each bin's range of the elements and its dispatch, a 64-lane
  workgroup every 64 lanes;
- a scatter of each element into its bin's range: the sixteen lanes of an 8 × 8 square all of the
  voted bin's make a full tile, written from the range's start — one shading workgroup's 64 pixels
  —, every other lane's elements loose, from its end, each in lane order.

A bin holds pixels — one word each, its coordinates and its write mask — or quads — two words, the
top-left pixel and a nibble a pixel of the quad —, the reference's two modes: a class whose shading
reads a neighbour's derivative is binned by quad, any other by pixel. Every gradient a class reads
is its triangle's own, analytic (`uvGradients`), so its bin holds pixels unless the
`shadeBinningMode` setting forces quads; a quad's lane on a pixel of another class has nothing to
write and nothing to give, and does nothing (`shadesPixel`). Each class present in the image's rows
then shades its bin (`shade_cs`, `visibility/shader/shadeEntryWgsl.ts`) and stores its pixels
(`storeSurface`, `visibility/shader/shadeOutputsWgsl.ts`): no pixel is shaded by a class it is not
of, whatever the classes' count or where their borders run. The bins' head — the class word of each
class key, each bin's element count, first word and mode, the surfaces' layers — and their elements
are two record tables (`r32uint`, read by load), so the shading binds no ninth storage buffer.

The surfaces are two layered targets (`materials/surface/surfaceAllocation.ts`): the colours,
`rgba16float` — base colour and metalness, normal and roughness, the emission and occlusion while a
surface of the image can mark it, the thin transmission while a sheet transmits — and the words,
`r32uint` — the flags, the narrowest word a compute stage stores, and the shadow receiver's two
words. A class stores every layer through two storage bindings, the feedback target and the lobes
target through two more: four storage textures a stage, what every device holds. Each reader binds
views, one layer each — the receiver's two —, in the formats it read before; a layer the frame does
not hold is a 1×1 stand-in, and the head names to the classes the layers it holds, so no class
writes one it has not made. Lighting reads those surfaces and the depth; transparency and
transmission are shaded apart.

The binning mode is a run-time setting, the reference's by default, a world option by its field,
held over the quality preset — no preset level writes it —, changed later by `world.shading` from
the next frame (`packages/sdk-core/src/contracts/shadingOptions.ts`); a value it does not take is
refused:

```ts
const world = createWorld(canvas, { shadeBinningMode: 'quad' })
world.shading = { shadeBinningMode: null } // back to the preset's, here the default
```

| Field              | Meaning                                                                          | Default  |
| ------------------ | -------------------------------------------------------------------------------- | -------- |
| `shadeBinningMode` | `'auto'` as each class asks, `'pixel'` every pixel alone, `'quad'` by 2 × 2 quad | `'auto'` |

A normal map bends the normal in a tangent frame. A row whose geometry carries tangents
(`FLAG_HAS_TANGENT`) reads them per vertex — a quantized page's stored ones (`FLAG_TANGENT`, decoded
around the vertex's normal by `geometry/cluster/decodeWgsl.ts:clusterTangent`), a source buffer's
floats otherwise (`pageTangent`, `visibility/shader/pageGeometryWgsl.ts`) — and interpolates them;
any other row rebuilds the frame from the triangle's edges and texture deltas
(`geometry/cluster/cotangentFrameWgsl.ts`). The stored frame is the pixel's one tangent source:
decoded once (`storedTangentFrame` in the opaque resolve, `blendTangentFrame` in the blend pass), it
is the frame the normal map bends in and the one the anisotropy direction and the clear coat's
normal map take (`physicalValues`); only without stored tangents does each map build its frame from
its own coordinates. A page stores tangents only for a mesh the compiler was
told to (`meshBuild.storedTangents`, [docs/COMPILER.md](COMPILER.md#mesh-build-settings)).

## Temporal antialiasing

A temporal upscaler (`taa/`): a jittered image, motion derived from the visibility buffer, a
history update with shading rejection, the spatial anti-aliaser before the resolve, one resolve for
every render scale. The pass runs on every frame drawn and its history is reset only on a camera
cut, the one change the reprojection cannot follow. A still view is drawn while its history fills
— whole cycles of the jitter's phases until every display pixel holds its most samples, 16 for a
history at the display's resolution (`taaConverged`, `historySampleLaws`) — then held on its
converged image like any still view (`taaConverging`, `frame/loop/hold.ts`); a change draws again
on the history it holds, and a session opened with `drawConverged` (the bench's cost series) keeps
drawing it. Its level (`off`, `low`, `medium`, `high`, `max`, `taa/levels.ts`) sets the
kernel, the flicker rejection and the spatial anti-aliaser; a level without either skips its
pass. The thin geometry detection, which relaxes the history where geometry is thinner than a
pixel, runs where the setting `temporalThinGeometry` (`world.temporal`, off by default) asks for
it, at any level but `off`, and in the analysis views of the diagnostic; a change of the setting
starts the history again. The render
scale is a dynamic resolution (`scale/dynamicResolution.ts`): a history of the frame's GPU busy
times against the frame time budget, both directions, with or without the temporal upscaler
(spatial upscale in the composition where it is off). The loop draws every refresh, or under the
page's frame cap every few (`frame/cadence.ts`), whose interval is the budget. The page's options are
[SDK.md](SDK.md#canvas-camera-and-teardown).

## Effect chain

`world.effects` (`sdk-core/world/effect/`; API in [SDK.md](SDK.md#canvas-camera-and-teardown)) runs
over linear radiance between the temporal resolve and tone mapping:
`post/effects/webgpuEffects.ts`, one table of pass kinds. An empty chain adds no pass; bloom is `post/effects/bloom/`, [the display finishing](#the-display-finishing).
The passes after tone mapping draw over the composed display image and the canvas
(`encodeOverlayEffects`); an idle pass (an outline of no object) is passed by. The outline
(`effects/outline/outlineWgsl.ts`) reads the visibility identifiers through the page table to each
pixel's root (`pages[row].placement`) and one bit per root its objects' subtrees draw, then an
exact separable distance in two passes scissored to the roots' projected boxes (`rootsRect.ts`).

## Exposure and the display curve

The image the lighting writes is linear radiance. Composition multiplies it by an exposure, then the
display curve brings it into [0, 1], then the sRGB transfer: `lighting/deferred/shaders.ts`,
`lighting/toneMappingWgsl.ts`. `world.exposure` is a number above zero — the manual multiplier, used
as it is — or `'auto'`, the default. `world.toneMapping` is `'filmic'` by default, `'aces'`, `'agx'`,
`'cineon'`, `'neutral'`, `'reinhard'`, `'linear'` or `'none'` the others
(`TONE_MAPPING_RANK`, `packages/sdk-core/src/scene/core/environment.ts`).

**Automatic exposure** (`post/exposure/`) measures the image composition reads, on the GPU, every
image: a compute pass bins the log2 luminance of its half-resolution pixels into a 64-bucket
histogram over a span of stops (workgroup-local counters, one merge into the buffer, `meterWgsl.ts`),
then one thread takes the mean of the logs between two percentiles, holds it to a range, and moves
the exposure toward `2^bias · 0.18 / mean`: linearly while it is farther than the transition
distance, exponentially inside, at the rise's or the fall's speed, with the frame's time; a view cut
(`gate.temporalRevision`) and the first image jump to the target. The exposure it leaves is copied,
on the GPU, into the composition's view uniform, so an image is shown at the exposure measured on it,
and into a staging buffer of the readback ring (`gpu/core/readbackRing.ts`), which brings it to the
CPU a few images late: `appliedExposureOf`, 1 until one came back. That value is the exposure every
reader outside the composition uses — the lighting parameters, the temporal resolve's weights and its
correction by the ratio of one image's exposure to the last's, the reflections' ranges and the
background a mirror shows, the display layers —, so the lag is theirs and the image's never. A frame
waits for nothing: no stall, no readback awaited. The settings are `world.exposureSettings`
(`packages/sdk-core/src/contracts/exposureOptions.ts`); a view whose exposure is still moving toward
its target is drawn again (`exposureMoving`, `frame/loop/unsettled.ts`) and a still one is held.
A view lit by no declared lamp shows its albedo as it is (`UNLIT_COMPOSITIONS`): no exposure, no
curve, whatever `world.exposure` says. The flat `scene.background` is a display colour, drawn as it
is, never exposed. A manual exposure runs no pass: its number is the lighting parameter and the
composition's multiplier, exactly as before the automatic one existed.

**The film curve** (`lighting/filmCurveWgsl.ts`, constants `filmCurveConstants.ts`) is evaluated
analytically in the composition, no table: exposed sRGB radiance to the film's wide working gamut,
a widening of bright saturated colours, a blue correction, a glow and a red pull by hue in the
grading gamut, a first desaturation, the curve of each channel — a toe and a shoulder in log
luminance (slope 0.88, toe 0.55, shoulder 0.26, black clip 0, white clip 0.04) —, a second
desaturation, the blue correction undone, back to sRGB. Middle grey in is middle grey out. A mirror
shows the background as the display shows it, so every curve has an inverse (`toneInverse.ts`); the
film curve's, which has no closed form, is solved by a descent on the CPU (`filmInverse.ts`), once
for each background colour and curve, never per image.

## The display finishing

Three effects follow the exposure's measure and come before the curve, in the lit image only (a view
lit by no declared lamp shows its albedo as it is, a diagnostic view and a capture the engine's
image): the bloom, the local exposure and the vignette. All three are the defaults of a view — a
world starts with its bloom in `world.effects`, the local exposure's contrasts are 0.8, the
environment's vignette 0.4 — and each is off by its own setting: the bloom removed or at intensity 0,
both contrasts and the detail strength at 1, the vignette at 0. An image whose three are off is
composed plain, with no pass, no target and no group (`post/finish/frame.ts`). The order of a frame
(`frame/render/surfaceLighting.ts`): the temporal resolve, the exposure (`post/exposure/`), the
finishing's passes, the effect chain, the composition.

**The scene's chain** (`post/filters/sceneChain.ts`) is the lit image brought to half size — one
bilinear read at the centre of each four pixels, their mean — and then a chain of levels, each the
mean of the 4 × 4 texels around the one above (`downsampleWgsl.ts`), half its size rounded up; a
level past the edge reads the last texel. The local exposure and the bloom share it: each asks the
levels it reads (`need`), each is drawn once.

**Bloom** (`post/effects/bloom/`, settings `packages/sdk-core/src/contracts/bloomOptions.ts`) is six
Gaussian blurs of the chain's levels, finest to widest, added up and added to the image — the glow adds
light: it conserves nothing. A level's blur is `size × sizeScale` percent of that level's width across
(`gaussianRadius`: half of it a radius), tinted by the level's tint and `intensity / 6`; the sizes are
0.3, 1, 2, 10, 30 and 64 percent times 4, the tints 0.3465, 0.138, 0.1176, 0.066, 0.066, 0.061, and
the intensity 0.675, so the glow is about 9 percent of the light. The blur is separable in two passes
(`filters/gaussianStage.ts`) with the Gaussian `exp(−16.7 (x / radius)²)` written for bilinear reads: two
neighbouring texels are one read, placed between them by their weights, at most 32 reads a pass, the
kernel cut at 31 texels (`gaussianKernel.ts`). From a radius of 7 texels the first pass writes half
the width, in the corner of its target, and the second reads it bilinearly. A read past the image is
zero (the sampler clamps; the shader scales a read by how far inside the image it was). From the
widest level to the finest each stage's second pass adds the stage below's output at its pixel, so
the finest stage's is the glow. With a threshold above −1 or a local exposure on, a setup pass
(`bloomWgsl.ts`) draws the half-size image with its local exposure applied and the pixels under the
threshold dimmed, and the bloom's own chain is built under it; otherwise the scene's levels are read as
they are. The blooms of a chain share their images (`bloomTargets.ts`) — they run one after the other —
and each glows from the image the chain was handed. The last bloom's glow is added by the
composition, where the exposure is applied; one before it adds its own to a target the next reads
(`composite`). Coverage is blurred with the colour, and the glow adds to it up to 1, so a glow over a
background shows over it.

**Local exposure** (`post/finish/`, settings `localExposure…` of `world.exposureSettings`,
`exposureOptions.ts`) splits each pixel's log luminance into a base layer, the light of its
neighbourhood, and a detail layer, what the pixel adds to it; it pulls the base toward middle grey by a
contrast scale — highlights above, shadows under — and keeps the detail by its strength, then moves
the pixel's light by the difference (`localGain`, `finishWgsl.ts`). The base is a mix of two
estimates. The bilateral grid (`localWgsl.ts`) is one compute pass over the half-size image: a
workgroup a tile of 64 × 64 pixels, each of its 64 threads sums the 8 × 8 block it reads into 32 bands
of log luminance, a pixel shared between the two bands it lies between, in fixed point; the grid's
cell is the band's sum of log luminance and its sum of weights (each a 64th, in half floats). The
grid is read trilinearly at the pixel's own luminance, so it follows edges; its ratio is the mean log
luminance of the pixels near it and as bright. The blurred luminance is the log2 luminance of the
chain's fifth level — 1/32 of the image —, Gaussian-blurred over `localExposureBlurSize` percent of its
width, mirrored at the edges, bilinearly read; `localExposureBlurBlend` (0.6) is its share, and the
only base where the grid holds no pixel. Middle grey is 0.18 times two to the exposure's bias — the
exposure's own target, where it is automatic — and the local bias. Thresholds keep the base's own
contrast within a distance of middle grey. The composition computes the gain per pixel from the
pixel's own luminance; the bloom's setup applies the same gain to the half-size image, so the glow is
the glow of what is shown. A manual exposure leaves the grey at 0.18. The settings of one view are
read at each image; a change draws it again (`finishMoving`).

**Vignette** (`SceneEnvironment.vignette`, `world.vignette`, 0.4) is the cosine-fourth law, `1 / (1 +
(v · r)²)²`, `r` the distance from the centre over a circle through the corners whatever the aspect:
it multiplies the image's light, the glow's included, after the exposure.

**One group, one pipeline.** The composition binds the finishing as group 1 (`finishLayout.ts`): the
uniform (`finishParams.ts`) — the vignette, the exposure copied on the GPU from the view's, the
luminance reading the exposure uses, the local exposure's settings —, the grid, the blurred luminance, a
sampler and the glow; a slot with nothing is an empty image, its flag in the uniform 0. The pipelines
that finish compile off the frame at the first image that asks (`composesFinish`); until then the image
is drawn plain and drawn again once they arrive. A frame's cost at 1920 × 1080 with all three on: 26
render passes and one compute pass beside the exposure's — the chain down to the fifth level (5), the
local exposure (1 compute, 3 render), the bloom's setup, chain and blurs (18) —, all but four of them
under 500 × 300 texels, and 22 MB of `rgba16float` targets; the composition reads three more textures
per pixel.

## Direct lighting

Any number of lights: a light grid lists each cell's lights once per image (`lighting/tiles/`), and
each pixel walks its cell's whole list (`lighting/direct/lightLoopWgsl.ts`), moving or still: the
shadow rays are the projection's, paid once, so the resolve never draws a subset. A frame with no
shadowed or rectangular light runs a program built without that code
(`lighting/deferred/contractVariants.ts`). Shadows are [SHADOWS.md](SHADOWS.md).

## Light that bounces

Dynamic, on by default (`bounce: false` turns it off): irradiance probes trace
rays against the resident proxy the compiler writes ([FORMAT.md](FORMAT.md)), a count of probes a
frame (`bounceProbesPerFrame`, `bounce/`). The probes and the environment share one basis
(`packages/sdk-core/src/scene/core/irradianceBasis.ts`). Its points are lit by the one light function and loop, in their irradiance
term, shadowed by proxy rays (`lighting/direct/lightLoopWgsl.ts`); each walks the lights of its cell
of a world light grid that the light grid pass lists over a lattice laid on the scene's extent, in the view
grid's own buffer (`bounce/lightCellWgsl.ts`), again only when a light, that lattice or the buffer
changes — the probe rays and the reflections' proxy hits walk the same lists.

**Where the probes are.** Four levels of probes, each a cube of 48 cells a side centred on the eye and
snapped to its own cells: the first reaches 25 m, its cell 1.04 m, and each next level twice as far,
its cell twice as wide — 2.08, 4.17, 8.33 m (`cascadeLevels`, `cascadeSize`, `cascadeHalfExtentMetres`,
`cascadeBase`, `sdk-core/src/bounce/cascades.ts`). The cells never depend on the scene: a 20 m street is
twenty cells across wherever it lies and however large the district is, where a grid laid on the whole
extent made its cell a fraction of it. A level slides by whole cells with the eye. Beyond the last level,
the sky light answers (below).

**Probes only where the image reads.** A level holds 110 592 cells, the four 442 368; a probe is made
only for a cell the image reads, from a pool of 16 384 (`probePool`, `sdk-core/src/bounce/probePool.ts`).
Each image marks the cells it reads (`bounce/markWgsl.ts`): a tile of 16 pixels, one thread, takes the
pixel its jitter picks, reads the surface there, finds the finest level that holds it — the rule the lit
passes read the field by, the normal bias a third of a cell included — and sets a bit for each of the eight
probes around it; sky marks nothing. The bitmap (55 KB) is read back a few images late through the
engine's readback ring (`bounce/marks.ts`, no frame waits): a cell marked with no probe takes one from the
pool, a cell marked again keeps it, one that left its level when the level slid is given back, and so is
one nothing read for 8 marks (`probeKeptMarks`). A change of view owes `markJitter` marks, each another
point of every tile, so a cell one point missed is found by the next; a still, marked view costs nothing.
A pool with none left refuses a mark: that cell goes unanswered, and the next level or the sky light
answers for it (`refusedMarks` in the diagnostic).

**What the lit passes read.** The atlas of the probes holds, in a second layer, a table naming the slot
of the pool that holds each cell of each level, by its remainder modulo the side, so that sliding by a
cell changes only the entries that come in (`bounce/atlas.ts`, `bounce/probes/tableWgsl.ts`). The table
names a probe once its first update was queued, and forgets it the moment it is given back; the probe
says which cell and level it carries, and a mismatch is as good as none. Reading is the same
rule as ever, the eight probes around a point, each weighed by its cell's trilinear share, its facing and
its measured visibility, each level taking its share (`fade`) of what the finer left.

**What is traced, in what order.** A probe that holds nothing yet comes before every refresh: the finest
level first, the cells nearest the eye first, up to the frame's queue of 768 probes (49 152 rays of 64)
rather than the count. The probes already traced take what the count leaves, by the priority a light
cache gives them — the longer since a probe was traced, over its level plus one, in log₂ buckets, the most
important filled first (`bounce/probePool.ts`, `probePlan.ts`) — each until it took `settledTraces`
updates since the lights last changed: then the series closes and the frame holds. The count is a
number of probes, `bounceProbesPerFrame`, 100 by default and at most the queue — not a duration: the
probes of a frame run side by side and the pass lasts about as long as its longest ray, so the time of a
batch does not follow its size, and a servo on it starved the field (`passMs` in `metrics.bounce`
publishes the last duration of the pass, and steers nothing). The reference mode traces the whole queue.

**Smooth probes.** A probe's fresh estimate is averaged with its six neighbours' — the cells beside its
own on each axis, one level — before it is kept (`filterProbes`, `bounce/probes/probeFilterWgsl.ts`):
its own weighs one, a neighbour's the share of the probe's rays that, in their direction, ended where
the neighbour's ray ended — the angle between the ray and the line from the probe to the neighbour's end
point, at the shorter of the two ends, weighs `1 − angle / filterHitAngle` (0.2 rad), zero past it —, kept
where nothing stands between the two probes on either side (the visibility test the field reads by) and
where the neighbour holds light for its cell and level. Light from a surface both probes see alike is
shared, light from a contact is not. A probe holds an order-2 basis, not a map of directions: the rays'
shares are averaged into one weight a neighbour, which weighs the whole basis, and a probe keeps its
own distances unfiltered, so the filter never blurs what stands between probes. The frozen atlas is
read, so an update never sees a neighbour half-written.

A probe ray that leaves the scene reaches the sky (`lighting/atmosphere/skyReadWgsl.ts`): the share
of the ray the scene lets through times the radiance of the sky in its direction, above the horizon
the atmosphere's sky by direction, below it the sky light's ground colour, black by default — when a
sky light gives it (`light.sky()`). The probes thus hold the sky the scene lets through: a street is
lit from above, an arcade is not. A probe in open sky is no longer asleep for good: it is updated
again when the sky or the sun changes, as when any light does (`frame/render/encodeLights.ts`).
A pixel takes the sky light's diffuse light from the probes alone, never added again beside the
environment; the share of a point they do not answer — no probe yet, a point no level holds a probe
for — is the sky light's own unoccluded irradiance (`bounce/applyWgsl.ts`), so the image shows no hole
while the probes fill. A scene with no sky light has no unoccluded light to give there: its
environment (ambient, hemisphere) is the pixel's own term beside the probes, so the probes that
answer stand for the share they leave, and a partial read is no darker. In a scene with an
atmosphere the probes wait for the sky by direction to be built (its first image), so none holds a
sky of none. With the bounce off, or no lamp to bounce, the sky light lights with its unoccluded
irradiance everywhere.

A probe that holds nothing yet — a cell no probe holds, a probe never updated for the cell it carries, as
on the first image or after the eye jumped — answers "not yet": its share of a point goes on to the next
level and, past the last, for a pixel, to the sky light, never to dark. A surface a probe's ray or a
reflection hits is read by another rule (`indirectHeld`, `bounce/indirectWgsl.ts`): the light the
probes hold there and no more, nothing for the share they do not answer. The sky already reaches the
probes through their own rays, occluded by the scene, so the unoccluded sky added to a hit would count
it a second time for a surface the sky does not reach and light every street from above. A surface
whose probes hold nothing yet is dark for the rays that read it, and fills as its probes do, update
after update. The probes are the cells the image reads (above), so a surface the image does not show
has none of its own: a ray that lands on it reads only what the probes round it hold, nothing where
none was made, and the surfaces out of view get no second bounce of their own. A cache of the light on
every surface near the eye, seen by the image or not, is the way to it, and is not built. The frame's
bounce counts publish how many probes are alive and how many hold nothing yet (`liveProbes`,
`unfilledProbes`, zero once the light the image reads is filled), and the probe series stays open until
none is, until every probe has its updates and the marks owed are in.

A probe's ray is cut at `rayReachMetres` (200 m by default), past which the sky answers, and so is the
shadow ray its hit casts. A ray, shadow rays included, spends at most `probeRayWork` units — a box
tested, a node visited, a triangle tested — and `probeRayTriangles` triangle tests
(`lighting/bounce/runtime/runtimeLayout.ts`): in a street a ray crosses many overlapping boxes, and a
shadow ray that meets nothing has no hit to stop it, so the budget is the whole of what the probes can
learn of the light. A shadow ray asks only whether anything stands on its segment: it walks the placement
tree once, in index order, and stops at the first surface (`placementTreeAnyHit`,
`geometry/dag/tree/treeWalkWgsl.ts`), where the rays that need the nearest surface walk it front to
back and read a node again for every four of its children they meet. A ray that spends it has not
finished, and an unfinished trace counts as a hit, never as a ray left out: a shadow ray that spends it is
a blocker, its point shaded, and the ray it was cast for keeps its weight; a probe's ray whose own walk
spends it ends as an opaque hit, at the surface the walk had found or else at the distance it had reached in
the last placement whose box it had entered (a walk that entered none reads a surface of no tint), bringing the
light the probes hold there, so a probe averages every ray it fired. A reflection's ray keeps answering nothing
when it spends its much smaller budget, which is about one node's scan of the tree (a full node of 64 children
costs 64 units), and the probes answer it. The marks follow what the image draws: a view
that stands still but whose cut refines, or whose pages arrive, marks the cells of its new surfaces
again (`lighting/bounce/marks.ts`, `frame/render/encodeLights.ts`). The frame metrics publish the state
of the field as `metrics.bounce` (`BounceFrameMetrics`): whether the probes exist, the probes alive,
those still unfilled, the entries of the table that name a probe, the probes that hold light, and,
counted on the GPU a few images late, the rays fired, those that brought light back, those that met no surface
and so reached the sky (`raysEscaped`), the shadow rays of their hits that found nothing on their segment
(`shadowRaysFree`) and those that found a surface (`shadowRaysBlocked`), those that spent their budget by what
spent it (`raysExhaustedBy`), and every ray by the work it spent (`rayWork`), and, for the image counted, the
work all of them spent (`imageRayWork`) and the part of it the placement tree's groups took (`imageRayMembers`:
a ray that meets a group's box reads every member of it) (`lighting/bounce/census.ts`). The probes' update counts in the memory of its workgroup and adds to the
buffer once, as the reflections' trace does: both use the engine's one workgroup reduction
(`gpu/core/workgroupTallyWgsl.ts`). The placements that wear a
proxy and the triangles they wear are published beside (`geometry/dag/proxy/proxyBoxes.ts`).

## Fog

`scene.fog` is a term of the one lighting model, applied by every program that lights a surface:
the law is `packages/sdk-core/src/scene/core/fog.ts` and `fogHeight.ts`, its shader text
`lighting/fogShader.ts`, its options [SDK.md](SDK.md#scene-fog). A surface's radiance `L` reaches the
eye as `L · T + S`, before the exposure; `T` is the transmittance along the view ray, `S` the light
the medium scatters toward the eye. The linear fog is the ramp from `near` to `far`, `S = color ·
(1 − T)`. The height fog is the reference's:

- **Law.** The density at the height `y` is `baseDensity · 2^(−falloff · (y − baseHeight))`. A ray of
  length `d` that rises by `dy` from an eye at `yEye` gathers `X = baseDensity · 2^(−falloff · (yEye
− baseHeight)) · d · (1 − 2^(−F)) / F`, `F = falloff · dy` (`ln 2` where `F` is nil), and
  `T = max(2^(−X), 1 − maxOpacity)`. `X` is `ln 2` times the integral of the density along the ray,
  used as the exponent of 2: a uniform medium of `baseDensity` extinguishes at `(ln 2)² ·
baseDensity` per metre (`T = exp(−0.4805 · baseDensity · d)`). Steps, in the shader's order: no fog
  past `cutoffDistance`; the eye's height held to 655 m above `baseHeight`, the rise compensated;
  `startDistance` moves the ray's origin along it; the line integral is the mean density of what
  remains, shared with the sun's lobe. The mean density is written from the ray's lower end
  (the same value as from the eye) so a high eye over a steep falloff loses nothing to a product of a
  huge number and a tiny one.
- **Units, and the exact conversion.** The numbers are those of the reference, in scene metres.
  Its density and falloff are per 1000 centimetres: `baseDensity` is its density ÷ 10 per metre,
  `falloff` its falloff ÷ 10 per metre; its distances are centimetres, metres are ÷ 100. So
  the reference's `0.02`, `0.2`, `10 000` are `baseDensity` 0.002 (extinction 9.6e-4 per metre at the
  base height), `falloff` 0.02 (the density halves every 50 m) and a lobe start of 100 m.
- **Defaults**, the reference's, converted: `color` black; `baseDensity` 0.002; `falloff` 0.02;
  `baseHeight` 0; `maxOpacity` 1; `startDistance` 0; `cutoffDistance` 0 (none);
  `directional.exponent` 4, `.startDistance` 100, `.color` black; `skyContribution` white. A fog that
  declares nothing is that fog (`{}`), whose colour a scene with an atmosphere gives it.
- **Colour from the sky.** With an atmosphere, `S = (color + skyContribution · skyMean ·
heightFogContribution) · (1 − T)`, `skyMean` the sky's mean radiance at 6 km (the table the
  atmosphere builds each image, `lighting/atmosphere/captureWgsl.ts`) and `heightFogContribution`
  the atmosphere's (1 by default); the black default `color` leaves the sky alone. The sun's lobe
  adds `(directional.color · sunLuminance + heightFogContribution · E_ground) · max(0, ray · sun)^exponent
/ 4π · (1 − T_lobe)`: `sunLuminance` is the luminance of the sun's colour times its intensity (the
  weights of the sRGB primaries), `E_ground` the sun's illuminance after the air, `T_lobe` the
  transmittance of the same mean density over the length past `directional.startDistance` (none
  before it). So the sun's light is scattered by the default fog over an atmosphere, its declared
  colour black. The sun is the one the store holds, with an atmosphere or none, else the first
  directional light added (`scene/light/fogSun.ts`, written in the fog block by the store). With no
  atmosphere the colour is the declared one and the lobe the declared lobe.
- **The sky.** The sky's pixels are fogged as any (`fogBeyond`, `lighting/fogShader.ts`, called by
  the sky's draw): a ray that leaves the scene meets nothing in any distance, a ray of 10¹¹ m that
  gathers the whole height integral, without the haze — the sky is the air. Looking up, with `dirY`
  the ray's rise, `T = 2^(−X)` and `X = baseDensity · 2^(−falloff · (yEye − baseHeight)) / (falloff · dirY)`:
  about 1, but within a degree of the horizon. Level or down, the density below the eye grows
  without end and `T = 1 − maxOpacity`: the fog's colour alone, so the horizon is a line at
  elevation 0, and the ground that is not drawn, past the scene's own, has that colour. The sky's
  table below the horizon — the air before a ground that is not drawn, almost dark — shows only
  where the scene has no height fog. A distance fog leaves the sky as it is. With no atmosphere the
  lighting fogs the pixels no surface drew itself (`fogsBackground`, `backgroundFog` in
  `lighting/deferred/surfaceWgsl.ts`) with the same law: a layer of the fog's inscattering whose
  coverage is `1 − T`, which the composition lays over the background colour — the colour as it is
  looking up, the fog's alone from the horizon down.
- **Old fields.** `{ color, density, heightFalloff?, baseHeight? }`, the extinction form — `T =
exp(−density · d)` where nothing falls off, the density divided by e every `1 / heightFalloff`
  metres up — is a spelling of this law, mapped exactly: `baseDensity = density / (ln 2)²`,
  `falloff = heightFalloff / ln 2`, the other fields at their defaults (`heightFogOf`). The GPU holds
  one law; no scene changes its image.
- **Block.** Six `vec4` of the light buffer, behind the irradiance (`FOG_SLOT`): colour and mode, the
  law, the range, the lobe, the sky's factor, the sun (direction toward it and luminance).

## Atmosphere and sky light

`scene.atmosphere` is a planet's air lit by the sun: a term of the one lighting model like the fog,
whose coefficients and defaults are `packages/sdk-core/src/scene/core/atmosphere.ts` (an Earth-like
planet of 6360 km, air 60 km thick, ground at `y = groundHeight`, 0 by default). Distances of the
planet are kilometres, the scene stays in metres. Where it is on, `scene.background` is not shown.

**Units.** The sun is the brightest directional light not flagged `atmosphereSun: false` — its
colour times its intensity, each channel weighed by the eye's sensitivity (the sRGB luminance
weights, the fog's sun the same) —, an illuminance `E`. The store holds the sun as lights come and
go, whether or not there is air: a light added replaces it only if brighter; the sun removed gives
its place to the brightest of the others, the first added of equals (a removal moves no one's place
in that order); a light changed is judged again the same way, the sun keeping its place against an
equal. The radiance reaching the eye through the air is `L = E · ∫ T(eye→p) · T(p→sun) ·
(σs_R φ_R + σs_M φ_M) dt`, plus the multiply-scattered share, per steradian — the scale a surface
reads (`L = albedo / π · E · cosθ`), so a 10-lux sun gives the same sky-to-sun ratio at any
intensity. A surface is lit by `E · T(ground→sun)`, written into the sun's own slot of the light
buffer by the store (`atmosphereSun.ts`; the declared light is untouched, the transmittance
integrated on the CPU over 15 samples, once when the air or the sun moves). The sun's disk is drawn
at `E / (2π(1 − cos α))`, `α` its angular radius, times the transmittance toward it.

**The tables** (`lighting/atmosphere/`): a transmittance table (256 × 64) and a multiple-scattering
table (32 × 32), built when the air changes; the sky seen from the eye (192 × 104, 4 to 32 samples
by distance) and the haze volume (32 × 32 × 16 cells over 96 km, 2 samples a slice) built each image,
a thread to a texel; a mean sky radiance at 6 km (64 directions), the sky light's capture (1024
directions) and the sky by direction (128 × 64 texels, in the scene's own axes, kept in the light
buffer) when the sun or the air moves. About 20 000 and 16 000 short marches per image, no
readback in the frame, no pipeline compiled on it.

**Drawing.** The sky is premultiplied radiance over the HDR image where the resolve left the
background, under the fog's height law like any pixel ([Fog](#fog), the sky), so exposure, the curve
and the temporal resolve treat it as any surface. The haze
(aerial perspective) is read by every surface through the light buffer — the volume lives behind
the fog's block (`lighting/atmosphere/layout.ts`) —, over the fog: `L' = L · T + S`, opaque and
transparent alike (`fogged`, `fogOver`, `lighting/fogShader.ts`); the fog takes the sky's mean
radiance on as its own colour and scatters the sun's light on the ground ([Fog](#fog)). A scene
without an atmosphere reads none of it. The unlit view and the views that paint raw values show none.

**Sky light.** `light.sky()` gives the scene the sky's irradiance. The sky's upper half is
projected on the nine harmonics of the environment (`irradianceBasis.ts`) on the GPU, read back
a few frames later without waiting (`Engine.skyCapture`), and kept as the sky light's own block
of the light buffer (`environmentSky.ts`), apart from the environment's other lights; its lower half
is the light's `groundColor`, black by default. Without an atmosphere it is the background colour,
a uniform sky. It is captured once and again whenever the air or the sun changes, never per frame.
That block is the irradiance of a surface the bounce probes do not answer; where they answer they
carry the sky ([Light that bounces](#light-that-bounces)), occluded by the scene.

**Reflections.** A reflection ray that leaves the scene reaches the sky along its direction, sharp
(`reflectionEnvironment`, `lighting/reflections/field.ts`): above the horizon the atmosphere's sky,
scaled by the sky light's colour and intensity — as it is drawn where the scene has no sky light —,
or with no atmosphere the sky light's flat colour; below it the sky light's ground colour. A scene
with neither an atmosphere nor a sky light keeps the flat background the screen draws. Where the
probes hold the sky, the field of a reflection takes the environment for the share they do not
answer alone, the sky never twice.

## Transparent surfaces

The engine culls transparent meshes by a frustum verdict on the GPU (`blend/verdict/verdictWgsl.ts`), orders them
farthest first on the GPU (`blend/order/order.ts`) and lights them with the opaque resolve's lists
(`src/blend/lighting.ts`). A transmissive surface is sorted and lit among them, composed as
a thin translucent layer (`blend/transmission/transmitWgsl.ts`), and refracts the opaque scene through
one distortion pass drawn before every translucent layer (`src/blend/distortion.ts`).

## Presentation

A session presents through its own canvas context; a world keeps its device across sessions,
each creating through its own handle (`gpu/core/sessionHandle.ts`, `gpu/core/deviceOwners.ts`,
`gpu/core/errorScope.ts`).

## Dynamic geometry

Geometry rewritten every frame ([SDK.md](SDK.md#geometry-rewritten-every-frame)) is cut into pages
once and its changed vertices written in place (`world/dynamic/dynamic.ts`) into the float
vertex pool (`pages/pool/geometryPrepare.ts`).

## Physics

The page's side is [PHYSICS.md](PHYSICS.md). Jolt Physics is built into one standalone module
behind a flat C API (`packages/physics-jolt-wasm/src/`), loaded by `physics/joltModule.ts` and
stepped by a worker (`physics/physicsWorker.ts`) on the frames' clock (`physics/step/stepClock.ts`); the
buffer layouts are `packages/sdk-core/src/physics/layout.ts`. Everything the physics draws is drawn between two
steps by one mechanism (`physics/step/twoSteps.ts`).

## Particles

A compute pass steps the pools (`particles/gpu/webgpuParticles.ts`) and one instanced draw a
pool puts them over the lit image after the transparents (`particles/gpu/webgpuParticleDraw.ts`),
or over the display colour of an image drawn without the visibility buffer; both fade each disc
on the opaque depth, never hard-edged.

## GPU deformation

The page's side is [SDK.md](SDK.md#gpu-deformation). One control record per deformed placement
(`deformation/session.ts`), and one per track of the animation banks, whose palettes the GPU poses
(`deformation/bankTracks.ts`); one compute pass before the cut writes deformed positions and
normals that every later pass reads (`deformation/compute.ts`). A skinned, morphed, wave-carried or
soft placement always deforms, whatever its size on screen; only an instanced skinned object rests
([Animation banks](#animation-banks)).

## Animation banks

An instanced skinned object ([COMPILER.md](COMPILER.md#object-settings)) plays a track of its
scene's animation banks ([FORMAT.md](FORMAT.md#animation-banksbin)): every instance of one item is
in one pose. The track's clock runs on the CPU with the scene's clips — a frame draws the second
the track held when it began, then the track advances by the frame's seconds times its play rate
times `animationBankTimeScale`, wrapping when it loops, held at its ends otherwise
(`packages/sdk-core/src/world/animation/bankClock.ts`) —; the GPU evaluates it: one pass before the
deformation turns each joint's two nearest keys, blended, and its inverse bind into the track's
palette, this frame's and the last one's (`deformation/bankWgsl.ts`). Every instance of a track
reads the same deformed vertices, made once an image. An instance whose screen size — its
sampled bounds' diameter over the view's height — falls under its `animationMinScreenSize`, or
under the run-time setting where its own is 0, is drawn in its rest pose; one whose own is negative
always animates; one drawn as its cell's HLOD 0 actor takes the run-time setting. Its bounds, for
every cut and its cell, are its item's sampled bounds.

Every setting is the reference's by default, a world option by its field, held over the quality
preset, changed later from the next frame
(`packages/sdk-core/src/contracts/animationOptions.ts`); a value a setting does not take is
refused:

```ts
const world = createWorld(canvas, { animationMinScreenSize: 0.05 })
```

| Field                        | Meaning                                                                                   | Default |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------- |
| `animationMinScreenSize`     | The screen size under which an instanced skinned object is drawn in its rest pose, from 0 | `0.1`   |
| `animationBankInterpolation` | A track blends its two nearest keys; `false`, its pose is the earlier key's               | `true`  |
| `animationBankTimeScale`     | The scale of the world's seconds the tracks advance by                                    | `1`     |

## Diagnostics and timing

Diagnostics leave through a queued channel outside the measured call (`diagnostic/channel.ts`). The
device asks for every optional feature its kernels can use, each with a plain fallback
(`src/session/gpuDevice.ts`). GPU passes are timed by timestamp queries (`gpu/timing/`), the
stages mapped in `stage/mapping.ts`; CPU and GPU times are never added.

## Proofs

`pnpm run test:gpu` runs every hardware proof (`tests/gpu/<area>/*.gpu.ts`) on Dawn in Node
([TESTS.md](TESTS.md)). The CPU shading oracle encodes linear lighting to sRGB without ACES.

## Lighting: the target and the stages

The target: dynamic global illumination, reflections and shadows at desktop-class cost, on the web,
in software, within the host's byte budgets ([SDK.md](SDK.md#memory-budgets)). One model lights
every surface: direct light, shadows and bounce are summed in linear radiance, fogged,
then tone-mapped and encoded to sRGB once, at composition.

| Stage                                     | Where                                           |
| ----------------------------------------- | ----------------------------------------------- |
| Temporal antialiasing                     | [Temporal antialiasing](#temporal-antialiasing) |
| Stochastic direct light over a light grid | [Direct lighting](#direct-lighting)             |
| Shadows                                   | [SHADOWS.md](SHADOWS.md)                        |
| Probes and proxy rays                     | [Light that bounces](#light-that-bounces)       |

## Rules across files

- **The source contract**: a mesh, material, model, cell or world the scene gains joins the running
  session in place (`addPlacements`, `PlacementGrowth`, `growth/webgpuGrowth.ts`), a world-DAG
  model included (`world/models/modelJoin.ts`); one the device refuses is said once as
  `content-refused` (`noticeRefused`) and the running cut kept. A session opens again for a lost
  device and for an option, nothing else.

- **One mechanism per concern**: one transform tree, one host boundary, one depth convention, one
  cut rule and one residency, one irradiance basis, one fog law, one two-step drawing of physics.
  A second one beside it is a defect.
- **Never per frame**: no pipeline compiled on the frame that first needs it (the frame is held,
  `frame/loop/framePipelines.ts`); no wait on a readback; no allocation in a steady frame; no work
  in a held frame — a view without temporal accumulation where nothing moved
  (`frame/loop/hold.ts`); no bounce pass once converged.
- **The jitter stays in the image**: the cut reads it only in the render matrix its boxes are
  projected with and the frustum planes of that matrix — a box the raster covers in the half pixel
  it moves is never rejected before it —, never in a level of detail or a request; the stochastic
  terms converge in the temporal history, which accumulates them over the jitter's phases.
