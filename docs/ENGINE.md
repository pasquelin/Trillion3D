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
scheme ([COMPILER.md](COMPILER.md#the-partitions-grids)), which its root names: the main grid's —
one, or one for each entry of a job's `partitionGrids` —, and each HLOD level's. A cell places its
objects on rows of their meshes: a static object under
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
  one order: the higher level on its grid first, then the lower grid priority — its main grid's,
  each HLOD grid's 0 —, then the lower distance ratio: the squared distance from the eye to the
  box over the squared radius, at most 1, times half the cosine of the view's axis with the way
  from the box to the eye plus a half — 0 from within it —. The settings `sortByExtent`,
  `sortByPriority` and `angleWeight` rank nothing under this scheme.
- `spatialHash`: its square strictly within the circle's radius, the sector around the view's
  heading on the ground, and, under `worldStreamingZCulling`, its content's height range meeting
  the eye's within the radius; on a grid compiled with `pullCoarser`, a wished cell pulls in the
  coarser cells overlapping it, and those in turn (`geometry/partition/coarser.ts`,
  `geometry/hlod/hlodPulls.ts`). The cells wished and not loaded load in one order: the wider first (by
  their half side, or by their level), then the lower grid priority — its main grid's, then each
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
held or told, none draws its actor nor its HLOD 0 actor, and every cell file streams on its own
main grid alone.

**Several main grids.** A scene compiled with `partitionGrids`
([COMPILER.md](COMPILER.md#several-streaming-grids-partitiongrids)) has one main grid for each entry,
and reads as before with one. A cell file streams within the loading range of the main grid its
record names (`main`), ranks by that grid's priority, is tested from above or in space as that grid
lies flat or not, and — while the session's `worldStreamingBlockOnSlowStreaming` is on — holds the
first images back when that grid was compiled to block (`blockOnSlowStreaming`) and the cell is near
and not yet shown. Coarser cells (`pullCoarser`) are pulled in per main grid.

**When the wishes are worked out again.** The cells the view wishes are not planned again at every
step of the eye or the axis (`packages/sdk-browser/src/geometry/partition/streamingUpdate.ts`). Each
frame the view is reduced to a key: its position in metres of the world the camera stands in (before
the frame of the scene's root: a model scaled to a hundredth still skips within 4 world metres), cut
into squares of `worldStreamingLocationQuantization` (its two ground axes, and its height too when
the key is 3D: always on `hashSet`, on `spatialHash` under `worldStreamingZCulling`), its yaw cut
into steps of `worldStreamingRotationQuantization` degrees (and its pitch in 3D; the view has no
roll), and the settings that shape what it wishes (`worldStreamingTargetState`,
`worldStreamingForce2D`, `worldStreamingExtraRadius`, `worldStreamingExtraAngle`, the shape's own
settings, `worldStreamingBlockOnSlowStreaming`, `hlodEnabled`). The wishes are planned again when
that key changed since the last update, or when the scene root's world or a core parent moved (the
cells hanging under them move with them), and at every frame while they may not be skipped:
`worldStreamingUpdateOptimization` off (or both quantizations at 0), the last frame left work (a
cell wished still loading or not yet shown, a page of the index left for a later frame, a placed
file waiting for its HLOD 0 cell to be hidden), a load blocking on slow streaming, the initial load,
or every `worldStreamingForceUpdateFrameCount`th frame (0, never). The first update after such a
frame always runs. A frame that skips the update goes on with the last plan, from the eye it was
made from; the source stays where that update put it. The position and the rotation the key reads
are the view's own when it lies farther than a quantum from the world's origin, and none otherwise,
afresh at each frame; the yaw is always the view's own.

**The shape of the view.** `worldStreamingExtraRadius` (metres) lengthens the radius of the view's
circle or sphere, whichever way it is taken (the grid's range times the scale, or
`worldStreamingRadius`); `worldStreamingExtraAngle` (degrees) widens the sector
(`worldStreamingSector`), a whole turn at most, and does nothing without one.
`worldStreamingForce2D` makes a loose grid (`hashSet`) that streams in 3D wish its cells by their
footprint on the ground, the view's height ignored, as a flat grid does; it changes nothing on a
flat grid or a square grid (`spatialHash`). `worldStreamingTargetState` is what the view asks of the
cells it reaches: `activated` loads and draws them; `loaded` loads them and keeps them placed in
memory without activating any of them: every cell file, every HLOD 0 actor and every HLOD actor
stays loaded, wished and switched as ever, and draws nothing; none holds the images back. Only the
placed rows and cells the world DAG of the cut draws are hidden: a scene whose cut packs no world
DAG (compiled without HLOD) has nothing to hide and stays drawn.

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
// The view must move 8 m or turn 20 degrees before the wishes are worked out again; a frame forced
// every 120 frames.
world.worldStreaming = {
  worldStreamingLocationQuantization: 8,
  worldStreamingRotationQuantization: 20,
  worldStreamingForceUpdateFrameCount: 120,
}
// Every frame, as before: no quantization.
world.worldStreaming = { worldStreamingUpdateOptimization: false }
// 50 m more around the view, a sector 30 degrees wider, a 3D grid wished by its footprint on the ground.
world.worldStreaming = {
  worldStreamingExtraRadius: 50,
  worldStreamingSector: true,
  worldStreamingSectorAngle: 90,
  worldStreamingExtraAngle: 30,
  worldStreamingForce2D: true,
}
// Preload only: the cells load and stay in memory, none is activated.
world.worldStreaming = { worldStreamingTargetState: 'loaded' }
```

| Field                                     | Meaning                                                                                                                             | Default     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `worldStreamingMaxLoadingCells`           | Cells that may load at once once the first image is shown, a whole number; 0 or less, no limit                                      | `4`         |
| `worldStreamingAngleWeight`               | How much the angle to the view's heading weighs in a cell's turn, from 0 to 1                                                       | `0.4`       |
| `worldStreamingSortByExtent`              | The wider cells first by their half side; `false`, by their level                                                                   | `true`      |
| `worldStreamingSortByPriority`            | A grid's priority ranks before the distance; `false`, after                                                                         | `true`      |
| `worldStreamingUseGridRange`              | The circle takes each grid's range times `worldStreamingRangeScale`; `false`, `worldStreamingRadius`                                | `true`      |
| `worldStreamingRangeScale`                | The scale of each grid's loading range, from 0                                                                                      | `1`         |
| `worldStreamingRadius`                    | The circle's radius for every grid, metres, from 0                                                                                  | `100`       |
| `worldStreamingSector`                    | Only a sector of the circle around the view's heading streams cells                                                                 | `false`     |
| `worldStreamingSectorAngle`               | That sector's angle, degrees, from 0 to 360                                                                                         | `360`       |
| `worldStreamingZCulling`                  | A square grid's cell (`spatialHash`) is wished only while its content's height range meets the eye's height within the radius       | `false`     |
| `worldStreamingBlockOnSlowStreaming`      | A grid compiled with `blockOnSlowStreaming` holds the images back while a cell near the view is not shown                           | `true`      |
| `worldStreamingBlockOnSlowStreamingRatio` | The ratio under which a cell of a blocking grid not yet shown blocks, from 0                                                        | `0.25`      |
| `hlodEnabled`                             | The HLOD actors load and draw; `false`, the cells of the main grids draw alone                                                      | `true`      |
| `worldStreamingUpdateOptimization`        | The wishes are worked out again only once the view moved or turned enough, or while work is left; `false`, at every frame           | `true`      |
| `worldStreamingLocationQuantization`      | Metres: the squares the view's position is cut into to tell whether it moved enough; 0, its exact position                          | `4`         |
| `worldStreamingRotationQuantization`      | Degrees: the steps the view's yaw (and pitch in 3D) is cut into to tell whether it turned enough; 0, its exact angle                | `10`        |
| `worldStreamingForceUpdateFrameCount`     | Every that many frames the wishes are worked out again whatever the view did, a whole number from 0; 0, never                       | `0`         |
| `worldStreamingForce2D`                   | A loose grid (`hashSet`) that streams in 3D wishes its cells by their footprint on the ground; no effect on a flat or a square grid | `false`     |
| `worldStreamingExtraRadius`               | Metres added to the radius of the view's circle (a sphere in 3D), from 0                                                            | `0`         |
| `worldStreamingExtraAngle`                | Degrees added to the angle of the view's sector, from 0, a whole turn at most                                                       | `0`         |
| `worldStreamingTargetState`               | `activated`: the cells the view reaches load and draw; `loaded`: they load and stay in memory, none is activated                    | `activated` |
| `hlodWarmup`                              | A switch that draws an HLOD actor whose layer asks one waits on its warm-up                                                         | `true`      |
| `hlodWarmupFrames`                        | The frames in a row a warm-up lasts, a whole number from 0                                                                          | `5`         |
| `hlodWarmupGeometry`                      | A warm-up asks the actor's geometry, ahead of the views' requests                                                                   | `true`      |
| `hlodWarmupTextures`                      | A warm-up asks the actor's textures                                                                                                 | `true`      |
| `hlodWarmupTextureScale`                  | The scale of the size the actor covers on screen its textures are asked at, from 0                                                  | `2`         |
| `hlodWarmupTextureClamp`                  | The most texels asked along a texture's side, a whole number from 1                                                                 | `2048`      |

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

An object that names a draw distance (`objectSettings.drawDistance`,
[COMPILER.md](COMPILER.md#object-settings)) is tested first, before its frustum test: the centre of
its root's bounds, from the eye, nearer than its `min` or farther than its `max` culls it
(`cutDrawDistanceCulling`), both distances multiplied by `cutViewDistanceScale` first. A group of 64
placements of the placement tree holds the nearest and the farthest distance of its placements and
is culled only where none can be drawn — its box's centre distance, nearer or farther by the box's
half diagonal, lies outside them —, so a distant group costs its placements nothing; a group with a
placement that names no distance is never culled by it, and a cut in one pass (above) tests its
placements alone. The post pass tests none again: what it holds passed in the main pass, the eye
unchanged. The sun's shadows and the rays' scene take the same test, from the same eye, with the
same scale: an object out of its distances casts no shadow in the virtual shadow maps and is not
met by the bounce and reflection rays (their scene is the objects' proxies); `cutDrawDistanceCulling`
off turns the three off. The shadow of an object is tested at the centre of its bounds, the main
view's eye; the rays' at the centre of its root's bounds.

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
preset — only `cutViewDistanceScale` is written by a level, the view distance's —, changed later by
`world.cut` from the next frame
(`packages/sdk-core/src/contracts/cutOptions.ts`); a value a setting does not take is refused:

```ts
const world = createWorld(canvas, { cutTwoPassOcclusion: false })
world.cut = { cutLodBiasFollowsUpscale: false, cutLodBiasMin: -1 }
world.cut = { cutTwoPassOcclusion: null } // back to the preset's, here the default
```

The view distance's levels write `cutViewDistanceScale`: 0.4 at `smooth`, 0.6 at `balanced`, 0.8 at
`fine`; `max` writes nothing (1). `pixelError` and the cut's other settings stay at their defaults
at every level.

```ts
const world = createWorld(canvas, { quality: { preset: 'balanced' } })
// cutViewDistanceScale is 0.6: every draw distance is 60 % of what the scene names
world.cut = { cutViewDistanceScale: 1 } // the page's value holds over the preset
world.cut = { cutDrawDistanceCulling: false } // every object drawn at every distance
```

| Field                      | Meaning                                                                                               | Default    |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| `cutTwoPassOcclusion`      | Each view's cut runs its two passes; `false`, one pass that occludes nothing                          | `true`     |
| `cutOcclusionCulling`      | The cut tests its boxes against the depth pyramids at all                                             | `true`     |
| `cutFrustumCulling`        | The cut rejects the boxes outside the frustum                                                         | `true`     |
| `cutMinLodCulling`         | The cut prunes a leaf whose least own error still shows at its nearest                                | `true`     |
| `cutDrawDistanceCulling`   | The cut culls an object outside the draw distances it names (`drawDistance`); `false`, none is culled | `true`     |
| `cutViewDistanceScale`     | The scale every draw distance, min and max, is multiplied by, a finite number of at least 0           | `1`        |
| `cutLodBiasFollowsUpscale` | An upscaled image's threshold follows the display over the render width                               | `true`     |
| `cutLodBiasOffset`         | The bias's offset, in powers of two, any finite number                                                | `0`        |
| `cutLodBiasMin`            | The bias's floor, in powers of two, any finite number                                                 | `-2`       |
| `cutMaxNodes`              | Most nodes one pass opens, a whole number from 1 to 2³¹ − 1                                           | `2097152`  |
| `cutMaxCandidateClusters`  | Most candidate clusters one cut lists, a whole number from 1 to 2³¹ − 1                               | `16777216` |
| `cutMaxVisibleClusters`    | Most clusters one cut draws, a whole number from 1 to 2³¹ − 1                                         | `4194304`  |

**Depth pyramid settings.** The depth pyramid keeps its culling layer (the opaque depth, f32, the
farthest of each 2 × 2, edges clamped) whatever the settings. Its trace layers are what the
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
`visibility/hiz/gpu/rectWgsl.ts`) or, by `hizTransparentTest` `'reference'`, over four texels a
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
with a background pixel, a pyramid that is not this image's, or a world grid (the bounce's) is not
cut. The settings are world options by their field, changed by `world.hiz` from the next frame
(`packages/sdk-core/src/contracts/hizOptions.ts`):

```ts
const world = createWorld(canvas, { hizTransparentTest: 'reference' })
world.hiz = { hizTrace: 'planes', hizFoldTransparents: true }
world.hiz = { hizTrace: null } // back to the default, the reference's walk
world.hiz = { hizFullResDepth: false } // the probes' walk stops at the half-resolution level
world.hiz = { lightGridHizCull: false } // every cell the lights reach is listed
```

| Field                  | Meaning                                                                      | Default       |
| ---------------------- | ---------------------------------------------------------------------------- | ------------- |
| `hizTrace`             | How the reflections' trace reads the pyramid: `'reference'`, or `'planes'`   | `'reference'` |
| `hizFoldTransparents`  | The trace layers hold the nearest transparent surface beside the opaque one  | `false`       |
| `hizTransparentTest`   | How a transparent cluster is tested: `'finer'` (16 texels), or `'reference'` | `'finer'`     |
| `hizFullResDepth`      | The screen probes' walk goes down to the full-resolution depth               | `true`        |
| `lightGridHizCull`     | The light grid leaves empty the cells behind their column's farthest depth   | `true`        |
| `hizPrime`             | When a primed pyramid is built: `'off'`, `'whenMissing'` or `'always'`       | `'off'`       |
| `hizPrimeSizeBias`     | The primed draw is the image shifted right by `1 + this`, from 0 to 8        | `2`           |
| `hizPrimeDepthBias`    | Metres the primed depth is pushed away from the eye by                       | `1.5`         |
| `hizPrimeErrorScale`   | Factor on the cut's pixel error for the primed draw                          | `32`          |
| `hizPrimeFarFieldOnly` | The primed draw holds the objects that set `farField` alone                  | `true`        |

**The primed pyramid** (`frame/render/primeHiz.ts`). The cut's main pass tests a box against the
pyramid of the image before; a view with none (its first image, a resize, a cut of the camera) tests
nothing and draws everything its post pass would have judged. With `hizPrime` `'whenMissing'` such an
image first builds a pyramid of its own from a small draw, and `'always'` does for every image. The
primed view (`frame/render/primeState.ts`) holds a depth target and a visibility target at the main
view's allocated size shifted right by `1 + hizPrimeSizeBias`, a raster over them and a Hi-Z
pyramid. Its cut (`GpuSelection.aside(true)`) is the main view's frustum at the image's render matrix,
over the placements that set `farField` (the cut's view filter, `geometry/selection/viewFilter.ts`;
all of them without `hizPrimeFarFieldOnly`), at `hizPrimeErrorScale` times the pixel error, in one
pass: no page is asked, no readback copies it and no row is stamped. The main pass of that cut is
rastered, hardware slots then software lists, into the small depth (`frame/render/primeStage.ts`,
no identifier is resolved), and the pyramid is built from it with a push of its level 0
(`visibility/hiz/gpu/primedWgsl.ts`): the depth is turned to the distance it stands for,
`hizPrimeDepthBias` is added and the sum turned back, clamped to [0, 1], the far plane's zero staying
zero. It is built in a command buffer of its own, submitted before the image's: the cut's tables and
the raster's buffers are written by the queue, and an image encoded behind it would read the last
write. The image's cut then runs two passes against it, with this image's matrix, depth map and the
primed size in place of the previous image's; it is never kept for the next image. A scene where no
object sets `farField` allocates nothing, encodes nothing and sends nothing. Limits: the rows' words
and the deformation are those of the image before (the rows pass runs in the image's own buffer), a
tessellated row is left out, and an object of a compiled world has no `farField` of its own yet.

```ts
const world = createWorld(canvas, { hizPrime: 'whenMissing' })
mountains.farField = true // drawn into the primed pyramid
world.hiz = { hizPrime: 'always', hizPrimeSizeBias: 3, hizPrimeErrorScale: 16 }
world.hiz = { hizPrimeFarFieldOnly: false } // the whole cut is primed, not the flagged objects
world.hiz = { hizPrime: null } // back to 'off'
```

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

## Material graph

A material of any domain may wear a graph (`world/material/graph/`, authored in [docs/SDK.md](SDK.md#material-graph)): nodes wired into the outputs its domain reads, compiled by `materials/graph/` to one WGSL function an output. The graph is data: a `GraphStore` of nodes (`id`, `kind`, `props`, `inputs`: a wire is a node and one of its outputs), the wires of the outputs, the textures of its texture nodes and the values written to its parameters. A wire may only name a node already added, so a graph has no cycle and the nodes are in compile order. It is a `Material` field (`graph`), heard like a texture (`Material.assignGraph`), cloned with the material, saved as `GraphData` by the material's `toJSON` (a graph holding a texture is `SCENE_NOT_SAVABLE`), and checked at assignment against the material's domain.

**The outputs** (`graph/outputs.ts`) are ten, each with its type and its default (`baseColor` float3 0 0 0, `metallic` 0, `specular` 0.5, `roughness` 0.5, `emissive` float3 0, `opacity` 1, `opacityMask` 1, `normal` float3 0 0 1, `ambientOcclusion` 1, `subsurfaceColor` float3 1 1 1); a domain lists those it reads (`DOMAIN_OUTPUTS`): a surface all ten, the opacity only when it blends, the mask only when it is masked (`outputActive`, by `alphaModeOf`); a light function `emissive`; a volume `baseColor` (its albedo), `subsurfaceColor` (its extinction), `emissive` and `ambientOcclusion`. An output a domain does not read, or an inactive one, takes its default and is not compiled.

**The compile** (`materials/graph/compile.ts`) is a translation of each wired output's wire into WGSL `let` lines, one function `mg<Output>(ctx: MgContext, g: MgValues)` each. A node is translated once (`State.value` memoises by node), its output's component mask applied. Values are typed `flex` (a scalar written as a constant, which fits any width), `f1` to `f4` and `texture` (`graph/valueType.ts`); an operation of a scalar and a vector repeats the scalar (`splat`), of two vectors of different widths is refused; a cast (`value.ts`) may repeat a scalar, cut components or fill with zeros only where the use allows. A constant stays a literal and folds through the operation (`arith.ts`, `vector.ts`, `choose.ts`): zero or one factors, equal or constant-alpha `lerp`, a power of 0 or 1, a base 0, a choice between constants; the result of an output is cast to its type (`forceCast`). Errors are `INVALID_MATERIAL` with the node.

**The values** a compiled function reads are one uniform `MgValues`: `v`, a `vec4f` per parameter name (a scalar reads `.x`), then `t`, the colour-atlas slot of each texture, four to a `vec4u` (`materials/graph/layout.ts`, `Slots`). `Slots.fill(graph, buffer, offset, slotOf)` writes them from the graph's values; it is false while a texture has no slot yet. A texture parameter `name` is one slot, replaced by the texture `graph.set(name, texture)` gives. The context `MgContext` is the host's: eight texture coordinate sets, the world position, the eye, the object's position, the vertex and pixel normals, the time (the game's and the real one), and the footprint of the coordinate (`ddx`, `ddy`).

**Textures** are read through the colour atlas (`colorSample`, `materials/virtual/wgsl.ts`) at the sample's coordinate, `mipMode` `none` with the footprint of the coordinate — `dpdx`/`dpdy` of the coordinate for a program whose pixels are neighbours (`derivatives: 'screen'`), the context's `ddx`/`ddy` for one that has no neighbours (`'context'`) —, `bias` that footprint scaled by `exp2(bias)`, `level` a footprint of one texel of the level (`mgSampleLevel`).

**Light functions** (`lighting/lightFunction/graphSlot.ts`) compile the graph of the material for the atlas (`compileGraph`, screen derivatives) once a version of the material: `mgEmissive` is the colour of the slot, black where `emissive` is not wired, and the slot's parameters are a 16-byte head (the time twice) then `MgValues`. The program is keyed by the graph's text (`SlotPrograms`, `slotPrograms.ts`), the slot's group bound at the size it reads. A slot is drawn again when the material or a texture changes, while a texture is not read at the detail the slot shows, and at each image when the graph reads the time (`GraphSlot.animated`; `LightFunctionAtlas.waiting` and `changes` follow). A graph the compile refuses names `light-function-graph-refused` once and the slot is drawn from the material's parameters. The atlas cannot give a world position, a camera or a normal: those nodes are refused at compile, and the position of the object is zero.

**The surface and the volume** are not read yet: a graph worn by a surface or a volume material compiles (`compileGraph`, the pass's own pool for `sample`, `derivatives: 'context'`) and is kept with the material, but the resolve and the fog's voxelisation still use the material's constants and maps. Their hook is `mgBaseColor`, `mgMetallic`, `mgSpecular`, `mgRoughness`, `mgEmissive`, `mgOpacity`, `mgOpacityMask`, `mgNormal`, `mgAmbientOcclusion` and `mgSubsurfaceColor`, each called with the context filled from the pixel or the voxel.

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
reader outside the composition uses — the lighting parameters, the pre-exposure every light is written
multiplied by, the temporal resolve's weights and its correction by the ratio of one image's scale
(the exposure over its pre-exposure) to the last's, the reflections' ranges and the
background a mirror shows, the display layers —, so the lag is theirs and the image's never. A frame
waits for nothing: no stall, no readback awaited. The settings are `world.exposureSettings`
(`packages/sdk-core/src/contracts/exposureOptions.ts`); a view whose exposure is still moving toward
its target is drawn again (`exposureMoving`, `frame/loop/unsettled.ts`) and a still one is held.
A view lit by no declared lamp shows its albedo as it is (`UNLIT_COMPOSITIONS`): no exposure, no
curve, whatever `world.exposure` says. The flat `scene.background` is a display colour, drawn as it
is, never exposed. A manual exposure runs no pass: its number is the lighting parameter and the
composition's multiplier, exactly as before the automatic one existed.

**Pre-exposure** (`post/exposure/pre.ts`, `preExposureOf`, option `preExposure` of
`world.exposureSettings`, on by default; `preExposureOverride`, 0 by default, names the number
instead). Every light an image holds is written already multiplied by one number, the image's
pre-exposure: the exposure the CPU knows (`appliedExposureOf`, the last one measured, or the manual
number) times the luminance of the scene colour tint times the local exposure's mean gain
(`averageLocalExposureOf`: the mean, over the histogram's buckets, of the log of the gain the local
exposure gives a pixel of that luminance, computed by the exposure's update with the exposure and
read back with it, `meterWgsl.ts`; 1 where the local exposure does not run and for a manual
exposure), 1 for a view that is not lit, that shows raw
values or that runs no post (a capture, the sky light's capture included). It is fixed once an image
(`beginPreExposure`) and read, for the whole image, from `preExposureOf`. The composition multiplies
the image by the exposure over that number (`view.preExposure.y`: the exposure the GPU measured on
the image divided by the pre-exposure it holds, `meterWgsl.ts`, copied into the view's uniform and
the finishing's), so the picture is the same with the option off. What it gains is range: a half
float holds the light of the image at any exposure. The writers apply it at the end of what they
sum, over `preExposed(rgb)` (`post/exposure/preWgsl.ts`: the light multiplied) or, for a surface's
final write, `preExposedClipped(rgb)`: the sum of every term multiplied by the pre-exposure first,
the whole colour then held to 32256, as a base pass clips its output: the opaque
resolve (`lighting/deferred/surfaceWgsl.ts`: the surface, an unlit one, the fog laid over the
background, the lit views), the translucent layers (`blend/shader.ts`, the transmissive stage in
`blend/transmission/transmitWgsl.ts`), the particles (`particles/gpu/particlesWgsl.ts`), the
clouds' traced luminance and the fog laid on them (`modules/sky/clouds/traceWgsl.ts`,
`composeWgsl.ts`), the fog volume (above). The sky (`lighting/atmosphere/skyWgsl.ts`) is another's
writer. Reflections, the bounce, the fog's analytic law and the haze are sums of the surface's
terms, in the units of the light before it is written, and need none of their own. What is kept from
one image to the next is brought to the new number by the ratio of the pre-exposures: the temporal
history's colour (`historyRead`, an as-is pixel excepted), the fog volume's cells, the clouds'
reconstruction history (`sampleHistoryLight`), and the radiance image the reflections and the
screen probes read, divided by the pre-exposure it was lit with (`ReflectionView.radiance.w`). The
histogram measures the image divided by it, the local exposure, the bloom, the depth of field and
the light shafts work on the image multiplied by the exposure over it.

```js
const world = createWorld('viewer')
world.exposureSettings = { preExposure: false } // every light written as it is; the same picture
world.exposureSettings = { preExposureOverride: 0.25 } // lights written multiplied by 0.25
```

**Exposure compensation curve** (`packages/sdk-core/src/contracts/exposureCurve.ts`, option
`exposureCurve` of the session and of `createWorld`, `explorer.setExposureCurve`; none by default,
which is a factor of 1 and the same image). Stops added to the exposure's target by how bright the
scene is. The curve (keys by EV100, linear, constant or cubic between them, an extrapolation on each
side) is baked once into 64 half-float samples of `2^compensation` over EV100 -10 to +20
(`bakeExposureCurve`, `exposureCurveTable`: the same option object gives the same table), held in
a uniform of the update (`meter.ts`). The update reads it at the frame's mean luminance, before the
range holds it: `ev = log2(mean / 0.18)`, the place in the table `(ev + 10) · 63 / 30` clamped, the
two samples around it mixed (`post/exposure/curveWgsl.ts`), and multiplies the exposure's bias by
the factor (`meterWgsl.ts`, `adapt`). The factor is part of the bias the readback and the local
exposure's middle grey take.

```js
const world = createWorld('viewer', {
  exposureCurve: [
    [-4, 1],
    [0, 0],
    [8, -1],
  ], // [EV100, stops]: dark scenes brighter, bright ones darker
})
explorer.setExposureCurve([{ ev: 0, compensation: 0.5, interpolation: 'cubic' }, [10, -0.5]])
explorer.setExposureCurve(null) // no curve
```

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

<!-- wave-1: W1-1/W1-3/W1-9 docs pending -->

## Light functions

A light that wears a light function (`SceneLight.lightFunction`, the id of a `material.lightFunction`
material; `world/material/lightFunctionMaterial.ts`) multiplies its colour, at each point, by what the
material gives there. The material is of the engine's one material system, in the light function
domain: its colour is its emission, `emissive` times `emissiveIntensity` times `emissiveMap` at the
projection coordinate; it reads no world position and no depth, which is what lets the atlas draw it
once a material. The map is a slot of the materials' colour atlas (`lighting/lightFunction/maps.ts`:
`appendWebgpuTexture`, tiles asked by `warm` at the pixels the slot shows, the slot drawn again till
they are resident). Its record fields are `lightFunction`, `lightFunctionScale` (10.24 m on each
axis), `lightFunctionFadeDistance` (1000 m), `lightFunctionDisabledBrightness` (0.5) and, for a
rectangle, `lightFunctionConeAngle` (0, at most 89 degrees) (`scene/light/lightFunction.ts`); the
light's 24 floats do not grow: the light function table's entry the light reads rides in its kind word,
above the rank and the flags (`LIGHT_FUNCTION_STEP`; 0, none), set by the frame, not by the host
(`SceneLightStore.assignLightFunction`).

Each image (`lighting/lightFunction/frame.ts`) plans which lights read which entry
(`plan.ts`): the lights that wear a material, each material once. A limit (`lightFunctionMaxLights`,
the atlas's slots) leaves out the farthest lights, a sun counting as at the eye; the table of entries
(`entries.ts`, `layout.ts`) holds for each light its fade distance, kind, disabled brightness (a half
float), the slot's corner and the cone's tangent, and the matrix from the world to the light's axes
(`up, right, along`, each over its scale). The atlas (`atlas.ts`) is one `rgba32uint` texture: the
slots on top, the table under them, so that every pass reads both through one binding. A slot is drawn
by a program of its format and of whether the material wears a map (`renderWgsl.ts`), over `uv` from 0
to 1 across its texels; it holds the square root of the colour, the grey of its three channels or the
three (`lightFunctionFormat`); a slot is drawn again when its material is written or its map's slot
or detail moved; while a map is not read at the detail the slot shows, the held frame is drawn
(`lightFunctionsWaiting`).

The read (`lightFunctionReadWgsl`) takes the point to the light's axes and the kind to a coordinate:
a spot `xy / (z tan) / 2 + 1/2`, a rectangle the same when it has a cone, a point light its longitude
and latitude, a sun its axes; the coordinate wraps, the slot is read bilinear and clamped to the slot,
squared, and faded to the disabled brightness by `saturate((fade - distance) / (fade / 5))` from the eye.
The opaque lighting multiplies the light's colour by it, diffuse and specular alike (`declaredLight`,
`declaredLightSplit`); the volumetric fog multiplies the sun's colour and, where `lightFunctionFog`
is set, each local light's (`fogSun`, `fogLocal`); the translucent layers read it where
`lightFunctionTranslucent` is set. The bounce's light term (`declaredIrradiance`, `lightsIrradiance`) multiplies
what each light adds at a hit by the function, before its shadow ray (`irradianceTerm`): a light the function
dims to nothing casts none; where `lightFunctionBounce` is set,
the probe pass (`probes/probeBindings.ts`, `PROBE_LIGHT_FUNCTION`: binding 10, the eye from the cascades'
uniform `BounceGrid.eye`) and the screen probes' scene trace (`TRACE_SCENE_LIGHT_FUNCTION`: binding 16, the
view's eye) bind the atlas, a stand-in elsewhere. The probes are traced again (`restart`) when the atlas changes
(`LightFunctionAtlas.changes`, `lightFunctionRevision`), so a material that reads `time` restarts them at each
image. The reflections' rays (`surfaceSeen`) evaluate no light. The clouds' lamps take the light as it is.
The binding spends the one storage texture left of the translucent layers' four (a sampled texture
elsewhere): 15 of 16 sampled textures, 7 of 8 storage buffers, 4 of 4 storage textures. The bounce's programs
take a sampled texture each: the probe pass 4 of 16 sampled textures (5 of 8 storage buffers, 1 of 4 storage
textures), the screen probes' scene trace 10 of 16 (6 of 8, 2 of 4).

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
sky light gives it (the sky module's `skyLight` part). The probes thus hold the sky the scene lets through: a street is
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
shadow ray its hit casts. A probe's ray spends at most `probeRayWork` units — a box tested, a node visited,
a triangle tested — and `probeRayTriangles` triangle tests (`lighting/bounce/runtime/runtimeLayout.ts`): in a
street a ray crosses many overlapping boxes. Each shadow ray its hits cast has a budget of its own
(`shadowRayWork` units, `shadowRayTriangles` triangle tests), spent from nothing, never from the ray's: a
shadow ray that meets nothing has no hit to stop it and walks its whole segment, the only kind that does, so
sharing the ray's budget would cut exactly the rays that reach the light. A probe's ray therefore costs at
most its own budget plus one shadow budget for each shadow-casting light that adds light at its first surface.
A shadow ray asks only whether anything stands on its segment: it walks the placement tree once, in index
order, and stops at the first surface (`placementTreeAnyHit`, `geometry/dag/tree/treeWalkWgsl.ts`), where the
rays that need the nearest surface walk it front to back and read a node again for every four of its children
they meet. A ray that spends its budget has not finished: a probe's ray whose own walk spends it ends as an
opaque hit, at the surface the walk had found or else at the furthest entry it had reached, of a placement's
box or of a leaf its cut tested, in that placement (a walk that entered none reads a surface of no tint),
bringing the light the probes hold there, so a probe averages every ray it fired; a shadow ray that spends its
own is lit, as a point no object was tested against is, and the ray it was cast for keeps its weight. Only a
mesh whose walk ran out of its stack inside one placement shades the point, as that placement's own walk could
not tell. The shadow ray starts off its point along the light, `shadowBiasMetres` (2 cm) at normal incidence
up to `shadowBiasSlopeMetres` (4 cm) more at grazing incidence, not along the normal, at most half the way to
a lamp, and a lamp's ray ends `shadowBiasMetres` short of it, so a surface the lamp stands against does not
shade the point. A reflection's ray keeps answering nothing when it spends its much smaller budget, which is
about one node's scan of the tree (a full node of 64 children costs 64 units), and the probes answer it. The
marks follow what the image draws: a view that stands still but whose cut refines, or whose pages arrive,
marks the cells of its new surfaces again (`lighting/bounce/marks.ts`, `frame/render/encodeLights.ts`). The
frame metrics publish the state of the field as `metrics.bounce` (`BounceFrameMetrics`): whether the probes
exist, the probes alive, those still unfilled, the entries of the table that name a probe, the probes that
hold light, and, counted on the GPU a few images late, the rays fired, those that brought light back, those
that met no surface and so reached the sky (`raysEscaped`), the shadow rays of their hits that came back lit —
no surface found on their segment, those that spent their own budget first included — (`shadowRaysFree`) and
those that shaded the point, by a surface found or by a mesh's walk that ran out of stack
(`shadowRaysBlocked`), those that spent their budget by what spent it (`raysExhaustedBy`), and every ray by
the work it spent (`rayWork`), and, for the image counted, the work all of them spent (`imageRayWork`) and the
part of it the placement tree's groups took (`imageRayMembers`: a ray that meets a group's box reads every
member of it) (`lighting/bounce/census.ts`). The probes' update and their census count in the memory of their
workgroup and add to the buffer once, as the reflections' trace, the blended items' verdict and the cut's
totals do: one reduction, a lane a counter (`gpu/core/workgroupTallyWgsl.ts`); a histogram wider than its
workgroup (the coverage of the texture levels) pours its bins in a loop of its own. The placements that wear a
proxy and the triangles they wear are published beside (`geometry/dag/proxy/proxyBoxes.ts`).

## Distance fields

A mesh whose `meshBuild` sets `distanceField` (true by default, as in the reference's gameplay templates; the settings are in
[COMPILER.md](COMPILER.md#distance-fields)) gets a signed distance field: bricks of 8 × 8 × 8 bytes around its
surface, 7 voxels of each its own and the eighth the trilinear filter's, a voxel the distance to the surface in
the band of four voxels either side, three mips, the coarsest always loaded. The compiler writes every mesh's in
`distanceFields.bin` (`asset-compiler-rust/src/distance_field/`), named by the manifest's `distanceFields`
section; `sdk-core/src/lighting/distanceFieldFile.ts` reads it (`parseDistanceFields`: per compiled mesh its box,
and per mip the indirection table, the bricks, the distance scale and bias, the volume-to-virtual-coordinate
scale and add).

The global distance field composites them into clipmaps around the viewer: `sdk-core/src/lighting/globalDistanceField.ts`
places them (`clipmapExtent`, `placeClipmap`, `pageAtlasSizeInPages`, `updateFrequency`) and
`contracts/globalDistanceFieldOptions.ts` holds the reference's settings with their defaults (4 clipmaps of 128
voxels, an extent of the view distance 20000 cm over 8 doubling for each next, mips by 4, pages of 7 voxels, the
static meshes composited apart, two clipmaps updated a frame; lengths in centimetres, as the sky light's).
`lighting/distanceField/globalReadWgsl.ts` reads them: `gdfSample`, `gdfDistanceToNearestSurface`,
`gdfConeTrace` and `gdfSkyVisibility`, the fog's sky visibility (one 45 degree cone straight up, ten steps);
The reads bind four resources, consecutive from a first binding: the view block (`GdfView`), the page table
(`texture_3d<u32>`), the page atlas (a read-only storage buffer of bytes) and the coarse mip (`texture_3d<f32>`,
`r32float`), no sampler; a position is carried to the field's translated space by `gdfTranslated` first. A pass
takes their layout entries and bind group entries from the scene (`readLayoutEntries`, `readEntries`) and makes its
group again when `readGeneration` changes. `lighting/distanceField/representationWgsl.ts` tells whether a pixel's surface has a field
(`hasDistanceFieldRepresentation`, `screenTraceDepthThresholdScale`):

```ts
import { globalDistanceFieldReadWgsl } from './lighting/distanceField/globalReadWgsl.ts'
const read = globalDistanceFieldReadWgsl(/* group */ 2, /* first binding */ 0)
// in a program: let visibility = gdfSkyVisibility(gdfTranslated(positionInCentimetres), vec3f(0.0, 1.0, 0.0));
```

The sky light's occlusion by the field (`lighting/distanceField/ao/`) is drawn (`encodeSkyOcclusion`, in the indirect
light's step, after the distance fields' update and the depth pyramid) when the sky light is dynamic and casts
shadows, no screen probes light the pixels and the scene has distance-field objects (`skyOcclusionGate`): the normals and depths of the scene at half resolution
(`dfaoNormals`); nine cones over each surface's hemisphere, traced at a quarter of that resolution against the global
field from the sky light's distance on (`globalDistanceFieldStartDistance`, 100 cm) — and, at the high quality
(`distanceFieldOcclusionQuality` 2), against the meshes' own fields up to it, their screen tiles listed by drawing
each culled mesh's bounding sphere —; the cones' visibilities combined into a bent normal; the bent normal upsampled
by the surface's plane and normal and filtered over time (`distanceFieldOcclusionUseHistory`, a history weight of
0.85, a stability pass that fills what dropped its history). The settings are
`contracts/distanceFieldOcclusionOptions.ts`, the reference's console variables with their defaults. A lit pixel reads
the image with `dfaoReadWgsl` and the sky light applies it with `skyLightOcclusionWgsl` (`modules/sky/skyLight/`): the
diffuse light read along the bent normal, scaled by the contrast curve, exponent and least occlusion of the light's
settings and combined with the material's and the screen's occlusion by the least or the product; the specular light
by the bent normal's length or its cone's intersection with the reflection's, plus the tint. The meshes' fields are
read through `meshFieldWgsl` (`loadDfObjectBounds`, `loadDfObjectData`, `dfAssetMip`), the one reader of the
placements' records; the sky light's read takes how the image is applied from the occlusion's state
(`skyOcclusionUse`, the `occlusion` argument of `writeSkyLightRead`).

The volumetric fog finds the sky's visibility of each sample of a cell, not of the cell's first alone, through the
global field (`FOG_SKY_VISIBILITY_WGSL`, a cone straight up), under the same gate with the sky light's volumetric
shadow, the global field on and a perspective view (`fogSkyField`); the scatter that binds the field is made at the
first image that wants it (`scatterSky`), the plain one serving until it is compiled.

The scene side is `lighting/distanceField/scene.ts` (`createDistanceFieldScene`, made at the first image of a
session whose cache carries fields, `EngineContext.distanceFields`, read from the manifest's `distanceFields`
section by `fieldsLoad.ts`; each image of the main view calls `encodeDistanceFields`, `frame.ts`):

- **Placements** (`objectTracker.ts`, `objectRecords.ts`, `objectBuffers.ts`): the cut's roots whose mesh has a
  field are read as they are, never changed; a root added, moved, shown or hidden, or that starts or stops moving
  (`lights.mobility.moves`), rewrites its records on the GPU — bounds, 3 `vec4` (centre as a high and a low float,
  sphere radius, box half-extent, flags); data, 10 `vec4` (world-to-volume rows relative to the high centre,
  volume extent and surface bias, draw distances, volume-to-world rows and scale, asset) — and names the region it
  changed for the global field, per cache (static, movable).
- **Atlas** (`atlasState.ts`, `atlasRequests.ts`, `atlasGpu.ts`, `brickUpload.ts`, `streaming.ts`,
  `streamingWgsl.ts`): the coarsest mip of a mesh is loaded with its first placement; the GPU asks each frame for
  the mips its nearest placement wants (the outer clipmap's box: two mips; the clipmap half way in: three), the
  answer comes back through a ring of four staging buffers, and the mips that fit (`meshDistanceFieldBrickAtlasDepth`,
  `meshDistanceFieldUploadKiB`) are loaded a frame later, in blocks of `meshDistanceFieldBlockBricks` bricks of an
  `r8unorm` 3D texture, their indirection tables in one word buffer allocated first fit.
- **Clipmaps** (`updateRegions.ts`, `regionBounds.ts`): the centre snapped to a page, the scroll, the update regions
  (modified boxes that reach the clipmap, the slabs the camera uncovered, the static clipmap's for the movable
  one), the whole composition when needed, the frequency and phase of each clipmap's turn.
- **Passes** (`globalUpdate.ts`, `cullWgsl.ts`, `allocateWgsl.ts`, `composeWgsl.ts`, `mipWgsl.ts`), per cache, in the
  reference's order: placements culled to the clipmaps; update regions to page tiles and culling cells; placements
  culled to the cells; pages allocated from the free list, and returned; pages composited, a voxel the nearest
  distance of the placements within the influence range, a byte over twice the range, the nearer of it and the static
  page under a movable one; the coarse mip propagated in five steps. The page atlas is a storage buffer of bytes (a
  page 8 × 8 × 8, the eighth the filter's margin) read with an explicit trilinear filter (`atlasFetchWgsl.ts`), since
  a compute pass cannot write an 8-bit texture on every device and the composition reads it back; the page tables are
  `r32uint` volumes, the mip an `r32float` volume. An indirect dispatch's arguments are written from counters by a
  one-thread pass, so a count past the device's workgroup limit runs in rows.
- **Reads**: the positions `globalReadWgsl.ts` takes are translated (`gdfTranslated`, the view's translation added to
  a world position in centimetres); the bindings are the view block, the page table, the atlas buffer and the coarse
  mip (`readLayoutEntries`, `readEntries`; they change with `readGeneration`).
- **Not carried over**: the reference's coverage atlas, object grid and landscape heightfields belong to its other
  lighting systems and to landscapes; this engine has none of them.

```ts
const scene = createDistanceFieldScene(device, fields) // fields: parseDistanceFields(bytes)
scene.occlusionDistance = 600 // the sky light's occlusion distance, centimetres
// each image, before the passes that read the field:
scene.update(
  encoder,
  { roots, moving: (rank) => false, epoch: 0, origin: eyeInCentimetres, frame, delta },
  settings,
)
device.queue.submit([encoder.finish()])
scene.submitted()
```

## Sky module

The sky is one module (`packages/sdk-core/src/modules/sky/descriptor.ts`, `SKY_MODULE`): the air, the
sun, the sky light, the height fog and the clouds of a new world's level, five parts each switched
alone, off by default. The module manager (`modules/manager.ts`) holds one decision per source
(editor, page, quality, scene) and resolves a module as the strongest source says, per part and per
field (`mergeModuleParts`); a world builds its manager with the sky and stats modules
(`session/world/worldModules.ts`) and starts or stops each, in registration order and the reverse,
at every write of `scene.sky` or `world.modules`.

A module that is off holds nothing. The sky's start is the only place its lights are made and its
parts resolved (`resolveSky`); off, `WorldModules.sky` is `NO_SKY` (no resolved part, no light), the
display carries no fog and no atmosphere, and a pass that reads a part reads it from
`modules.sky.resolved`, where an absent part is the pass's gate: no resource is made, no pass
encoded. The module's lights hang from no scene (`session/world/skyLights.ts`): the sun is one
directional light aimed by the part's `rotation` (`sunDirection`), the sky light one light of kind
`sky`; each sync shows them after the scene's lights (`session/world/lights.ts`).

**One sky light.** The scene keeps one sky light: the last one shown replaces the others, whose
radiance, irradiance and fog factor are dropped, and the fog scatters that light's own
`fogScattering` — not a sum or a mean of several. The sun competes with the scene's directional
lights by the air's rule, the brightest of each index.

```js
world.scene.sky = true // the level: air, sun (6 lux, 6500 K), sky light, height fog, clouds
world.scene.sky = { clouds: false, sun: { shadowsClouds: false } } // two words, one object
world.modules.set('sky', { heightFog: false }) // the page, over the scene's
world.modules.state('sky') // { enabled: true, by: 'scene', parts: { …, heightFog: false } }
```

A sun with `shadowsClouds` makes the cloud march read the sun's opaque shadow map, and only for the
air's first light (`cloudsReadOpaqueShadow(light, sunIndex)`, `modules/sky/cloudShadow.ts`). A scene
saved before the module is read once into its parts (`session/saved/legacySky.ts`).

## Fog

The height fog part of the sky module is a term of the one lighting model, applied by every program that lights a surface:
the law is `packages/sdk-core/src/scene/core/fog.ts` and `fogHeight.ts`, its shader text
`lighting/fogShader.ts`, its options [SDK.md](SDK.md#height-fog-part). A surface's radiance `L` reaches the
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
- **Lights in the volume.** Each light scatters its colour times its `fogScattering` (lane 14 of
  its record, `1` by default; the volume and the clouds' lamps skip a light of `0`): the sun by the
  phase function and its shadow where its `shadowsFog` flag is set (a bit of the kind word, lane 12:
  the rank, under 4, plus 4 for a shadow, plus 8 for the fog's shadow; a sun's by default); a local
  light by the inverse square of the distance a cell's radius longer, the window of its range, a
  rectangle's form factor, and one sample of its shadow map where `shadowsFog` is set. The sky light
  adds its irradiance's bands over π times its share (the `w` of the sky block's first slot, zero
  without a sky light). A light's light function multiplies its colour there ([Light functions](#light-functions)): the sun's always, a local light's where `lightFunctionFog` is set. The sky light's term is multiplied by the sky's visibility of the cell, the share a cone of 45 degrees straight up sees
  through the global distance field (`lighting/fog/skyVisibilityWgsl.ts`, a pass of its own before the scatter, whose
  volume the scatter loads as a storage texture: the scatter binds the most sampled textures a stage may), where the
  frame gives the field (the light is dynamic, casts shadows and a volumetric shadow, no screen probes light the fog, the
  view a perspective); the cell's first sample gives it to all the samples the scatter takes. Not applied, with the reason:
  the cloud shadow on the sun (the cloud shadow map is declared but no frame draws or binds it). The static term is
  the baked light of the [volumetric lightmap](#volumetric-lightmap), added to the light of each sample: a pass of its own
  before the scatter (`lighting/fog/staticWgsl.ts`; the scatter binds the most sampled textures a stage may and the lightmap is
  nine more) takes the samples the scatter takes — the cell's plan (`planWgsl.ts`: hidden, history, how many samples) and
  `fogSampleOffset` give the same points — and writes the mean of what they add, in a volume of three floats a cell that
  the scatter loads as a storage texture and adds to the mean of the lights. The scatter's light and this term are sums over
  the same samples, so their sum is the one the scatter would make sample by sample. A sample adds the lightmap's two
  bands dotted with the phase's zonal harmonic, over π, never negative, times the fog's
  `volumetric.staticLightingScatteringIntensity` (`FogStaticLight.intensity`: the fog's value while the image's lighting and the
  `volumetricLightmap` setting are on and the scene has a lightmap, else 0); and, where the sky light is stationary and
  casts shadows and the lightmap holds a bent normal (`skyShadowing`), the sky light's term times the bent normal's length
  in place of the global field's visibility. A static sky light lights the fog by none of its own harmonics (the lightmap holds
  its light), nor a view whose sky lighting is off, unless the fog's own colours stand in (`useFogColors`). The pre-exposure is applied: each cell's light is written multiplied by the
  image's pre-exposure (`frame.exposure.x`), the history's brought to it by the ratio of the two
  (`frame.exposure.y`), the extinction left as it is, and a surface reads the light divided by it
  again (`FOG_VIEW_SLOT.exposure`, `fogVolumeLookup`) — [Exposure](#exposure-and-the-display-curve).
  The clouds' lamps read a light as the
  fog does (`volumeLamp`, `lighting/direct/lampSeenWgsl.ts`): a lamp by `lampSeen` at `LAMP_BIAS`, a
  rectangle by its form factor, each times its `fogScattering`.
- **Objects of the volume material domain.** A mesh with a material of the volume domain
  (`material.volume`) draws no surface and a declared object (`addFogVolume`) none either: each is a
  box, or a sphere, voxelised into the medium before the light is scattered (`lighting/fog/voxel*.ts`).
  The record of each object that reaches the volume — its sphere closer to the eye than the fog's
  distance plus its radius — is written relative to the eye (`writeVoxelObjects`). A first pass, a
  thread an object (`prepareMain`), takes its sphere to view space, the slices of its nearest and
  farthest depth (`trunc(log2(depth · B + O) · S)`, the first held at 0, the last at the grid's) and
  the view-space rectangle of its box's corners. The second pass, a thread a cell (`voxelizeMain`),
  is the rasterisation of each object's camera-facing quad on each slice, seen from the cell: the
  quad lies at the slice's depth — the slice plus the frame's first depth offset —, over the
  object's rectangle (a box) or the square around the circle the sphere cuts the slice at (a sphere,
  radius `√(r² − Δ²)`, `Δ` the slice's distance from the sphere's centre in depth), shifted across
  by the frame's first offsets over the grid (`offset / cells` in device units, the quad's own
  shift); it covers the cell whose centre lies in its projection, left and top edges in, right and
  bottom out. A covered cell reads the object's material at its centre's place on the slice — the
  ray through it with the matrix the depth was drawn with — and counts it where that place lies in
  the object's sphere or box, by `fade³` with `fade = 1 − saturate((depth / distance − 0.6) / 0.4)`.
  What it adds — `albedo · extinction` of scattering, `extinction`, emissive light — goes in two
  volumes (scattering with extinction, emissive) that the scatter adds to the cell's medium
  (`fogMedium`): the object's scattering to the particles', its extinction to the extinction, its
  emissive light to the glow. Passes of `volumetricFogVoxelizationSlicesPerPass` slices (8) divide an
  object's slices; `volumetricFogVoxelizationShowOnlyPass` keeps one of them. The glow switch
  `volumetricFogGlow` gates the emissive light of the objects as it gates the fog's. Authored
  numbers are per metre and the cells are metres: the scale of the units is 1. The sum over objects
  is made in single precision, once, where a blend unit adds half floats object by object.
- **Block.** Six `vec4` of the light buffer, behind the irradiance (`FOG_SLOT`): colour and mode, the
  law, the range, the lobe, the sky's factor, the sun (direction toward it and luminance).

## Volumetric lightmap

Precomputed indirect light, baked by the compiler (`lightmapBake`, [COMPILER.md](COMPILER.md#volumetric-lightmap)) and read by position (`lighting/volumetricLightmap/`,
`sdk-core/src/lighting/volumetricLightmapFile.ts`; the file is [FORMAT.md](FORMAT.md#volumetric-lightmapbin)).
`parseVolumetricLightmap(bytes)` reads the file; `createVolumetricLightmapTextures(device, data)`
makes its ten 3D textures (a black texel each where there is no lightmap, or no bent normal);
`writeVolumetricLightmapView(words, at, data, shown)` writes the four `vec4f` a shader finds a
position with (zeros when the lightmap is absent or `shown` is false, the `volumetricLightmap`
setting). `volumetricLightmapWgsl(group, first)` is the sampling, for a program that binds
`VOLUMETRIC_LIGHTMAP_BINDINGS` (12) consecutive bindings from `first`
(`volumetricLightmapLayoutEntries`, `volumetricLightmapGroupEntries`): the view block, a bilinear
sampler clamped to the edge, the indirection volume (a read-only storage texture, read by load:
none of the stage's sixteen sampled textures), nine filtered textures.

- `vlmBrickUvs(world)`: the position clamped into the volume (at most 0.99 of its size), its
  indirection texel, then the brick's place in the atlas at the fraction of its span the position
  lies at, in padded bricks, half a texel in. A zero view answers the origin.
- `vlmSh1`, `vlmSh2`, `vlmSh3(uv)`: the light in one, two or three bands. The coefficients are
  read from [0, 1] back to [-1, 1] and multiplied by the ambient and by the scales
  `0.488603/0.282095` (the three linear ones), `1.092548/0.282095`, `4 · 0.315392/0.282095` and
  `2 · 0.546274/0.282095` the file divided them by. `vlmDotSh1`, `vlmDotSh2`, `vlmDotSh3` project
  them on a basis.
- `vlmSkyBentNormal(uv)` (mapped back to [-1, 1]; its length is the sky's visibility) and
  `vlmDirectionalShadowing(uv)`.

A scene's one lightmap covers all of it: there are no sub-level bricks to stream in or out. The
fog reads it as its static term:

```wgsl
// where the cell's world position is `world`, the fog's phase `phaseG` and the view direction `cameraVector`
// (from the eye to the point; the bake's coefficients are those of the scene's own axes, up or not)
var brickUvs=vec3f(0.0);
if(skyScattering>0.0||staticIntensity>0.0){brickUvs=vlmBrickUvs(world);}
// the sky's visibility, where the sky light wants its static shadowing
if(skyStaticShadowing>0.0){visibility=length(vlmSkyBentNormal(brickUvs));}
// the static term: the indirect light of the stationary lights, the direct and indirect of the static
if(staticIntensity>0.0){
 let hg=vec4f(1.0,cameraVector.y,cameraVector.z,cameraVector.x)*vec4f(1.0,phaseG,phaseG,phaseG);
 lightScattering+=(staticIntensity/PI)*max(vlmDotSh2(vlmSh2(brickUvs),hg),vec3f(0.0));
}
```

`staticIntensity` is the height fog part's `volumetric.staticLightingScatteringIntensity` (default 1, never
below 0) while the image's lighting and the `volumetricLightmap` setting are on, else 0. The session reads the file
with the manifest (`readVolumetricLightmap`, `lighting/volumetricLightmap/fileLoad.ts`, verified against the size and digest
the manifest announces; `EngineContext.volumetricLightmapData`), none for a cache that baked none; its textures are made once,
at the first image that reads them and the setting is on (`volumetricLightmapOf`), and freed with the runtime. A scene
without a lightmap allocates none.

## Atmosphere and sky light

The `atmosphere` part of the sky module is a planet's air lit by the sun: a term of the one lighting model like the fog,
whose coefficients and defaults are `packages/sdk-core/src/scene/core/atmosphere.ts` (an Earth-like
planet of 6360 km, air 60 km thick, ground at `y = groundHeight`, 0 by default). Distances of the
planet are kilometres, the scene stays in metres. Where it is on, `scene.background` is not shown.

**Units.** The sun is the brightest directional light of index 0 (`atmosphereSunIndex`, 0 by
default; the second light, below, has index 1) not flagged `atmosphereSun: false` — its colour times
its intensity, each channel weighed by the eye's sensitivity (the sRGB luminance weights, the fog's
sun the same) —, an illuminance `E`. The store holds the sun as lights come and
go, whether or not there is air: a light added replaces it only if brighter; the sun removed gives
its place to the brightest of the others, the first added of equals (a removal moves no one's place
in that order); a light changed is judged again the same way, the sun keeping its place against an
equal. The radiance reaching the eye through the air is `L = E · ∫ T(eye→p) · T(p→sun) ·
(σs_R φ_R + σs_M φ_M) dt`, plus the multiply-scattered share, per steradian — the scale a surface
reads (`L = albedo / π · E · cosθ`), so a 10-lux sun gives the same sky-to-sun ratio at any
intensity. A surface is lit by `E · T(ground→sun)`, written into the sun's own slot of the light
buffer by the store (`atmosphereSun.ts`; the declared light is untouched, the transmittance
integrated on the CPU over 15 samples, once when the air or the sun moves). The sun's disk is drawn
at `E · tint / (2π(1 − cos α))`, `α` its angular radius, `tint` its `sunDiskTint`, times the
transmittance toward it and the rim's softening, each channel held under 64000 after the product
(the image's sky under 32256). A light's colour is multiplied by that of a black body at its
temperature when `useTemperature` is on (`lightColour`, `scene/light/fields.ts`, the clamp 1000 to
15000 K), before the intensity, in the sun's choice, its illuminance and its light on surfaces.

**Two lights.** The air holds up to two lights, one per index (`SceneLight.atmosphereSunIndex`, 0 or
1, 0 by default), each chosen among the lights that may light the air as the sun is (brightest,
strictly, at adding; the brightest of its index at removal; a light that changes index is removed
and added again). Their directions, illuminances and disks are slots of the atmosphere's block
(`ATMOSPHERE_SLOT`, the second in `second*`, its disk slot's last lane saying that there is one).
Every march of the air (`integrateAir`) adds, per step, the second light's own scattering — its
phase, its planet shadow, its transmittance from the table, its multiple scattering — to the first's,
and, where the ray ends on the ground, its bounce; the sky table, the haze volume, the mean sky at
6 km, the sky light's capture and the sky by direction all march both. The multiple-scattering and
transmittance tables depend on the air alone. The sky draws both disks. A surface lit by the second
light receives its illuminance times the transmittance toward it, written into its own slot as the
sun's is. Where there is no second light the marches run their per-light loops once and read nothing
of it. A saved world keeps each light's index (`SavedNode.light.atmosphereSunIndex`, written only
for index 1).

**The tables** (`lighting/atmosphere/`): their sizes and sample counts are the quality settings of the
sky (`AirShape`, `shape.ts`; the defaults the reference's top level), the programs written once for
a shape and made again when the settings make another. A transmittance table (256 × 64, 10 samples,
stored as its square root, in four half floats or, at `transmittanceSmallFormat`, four bytes) and a
multiple-scattering table (32 × 32, 15 samples; from the first 8 of 64 directions over the sphere at
`multiScatterHighQuality`) are built when the air changes; the sky seen from the eye (192 × 104, 4
to 32 samples by distance, the cap no more than 32 times `sampleCountScale`) and the haze volume
(32 × 32 × 16 cells over 96 km, up to 4 samples a slice, twice `sampleCountScale` at most) are built
each image, a thread to a texel, with the mean sky radiance at 6 km (the 64 directions of a grid
jittered by a fixed generator, `sphereSamples.ts`) that the fog takes on; the sky light's capture
(1024 directions) and the sky by direction (128 × 64 texels, in the scene's own axes, kept in the
light buffer) are made when the sun, the air or the altitude of the capture's place moves. The haze
volume lives in a region of the light buffer of 32768 cells (16384 in 32-bit floats,
`skyTablesFullPrecision`): the slices are cut to fit, and a surface reads its size from the view's
block (`VIEW_SLOT.volume`). A sky pixel is marched, not read from the table, at `skyTableFast` off
(`atmosphereSamplesMin`, `atmosphereSamplesMax`, jittered by the blue noise).

**Shade on the air.** A directional light that asks for it (`SceneLight.shadowsAir`) shades the air:
at each step of the sky table's march and of the haze volume's, the light's virtual shadow map is read
at the step's place (`airShadow`, `airShadowWgsl.ts`; one sample, as the fog's volume reads the sun's)
and multiplies the light scattered into the ray, the multiply-scattered share left unshaded. The
planet's shadow and the scene's multiply. `atmosphereSampleLightShadowMap` turns the read off.

**What the clouds read of the air.** Besides the haze surfaces read, the air builds, when the clouds
ask (`airRequests`, `encodeAtmosphere.ts`), the haze's light alone and the air's alone in two volumes
of the same cells (`hazeSeparate`, the march keeping `radianceMie` and `radianceRay` apart, the
ozone's absorption shared half and half), and the haze all around a capture's place (`capture360`: a
longitude and the sine of the latitude across, the distance down), read with `hazeOnly`, `airOnly`
and `captureHaze` (`separatedWgsl.ts`). The clouds' high-quality haze (`cloudHighQualityAerial`)
marches it for the pixel to the cloud's depth (`cloudHaze`, `cloudHazeWgsl.ts`).

**Drawing.** The sky is premultiplied radiance over the HDR image where the resolve left the
background, under the fog's height law like any pixel ([Fog](#fog), the sky), so exposure, the curve
and the temporal resolve treat it as any surface. The haze
(aerial perspective) is read by every surface through the light buffer — the volume lives behind
the fog's block (`lighting/atmosphere/layout.ts`) —, over the fog: `L' = L · T + S`, opaque and
transparent alike (`fogged`, `fogOver`, `lighting/fogShader.ts`); the fog takes the sky's mean
radiance on as its own colour and scatters the sun's light on the ground ([Fog](#fog)). A scene
without an atmosphere reads none of it. The unlit view and the views that paint raw values show none.

**Sky light.** The `skyLight` part (a light that affects the world) gives the scene the sky it captures
into a cube (`modules/sky/skyLight`): the cube, filtered by roughness, and nine harmonics summed from it, on
the GPU, never read back. Every reader reads that one cube, through the light's read
(`modules/sky/skyLight/read.ts`), at the colour of the light times its intensity, black in a view whose
`skyLighting` override is off. The diffuse light of a surface is the harmonics along its normal
(`skyLightDiffuse`): where the bounce probes answer they carry the sky, occluded by the scene
([Light that bounces](#light-that-bounces)); the share they leave is the sky light's own diffuse light, the
sky nothing hides. The volumetric fog scatters the harmonics' first three terms along the way to the eye,
times the part's `volumetricScatteringIntensity`. A specular read takes the cube along the reflection
vector at the mip its roughness asks (`skyLightReflection`); a bounce probe's ray that leaves the scene
reads it sharp (`skyLightRay`). Its lower half is the part's `lowerHemisphereColor`, black by default,
laid into the cube at the capture. Without an atmosphere the cube is black (clouds aside). A specified
cubemap blends to a second one by a fraction (`SkyLightInputs.blend`): both are filtered, and the light
mixes the two cubes and their harmonics.

**Reflections.** A reflection ray that leaves the scene reaches the sky along its direction
(`reflectionEnvironment`, `lighting/reflections/field.ts`): the sky light's cube, sharp for a ray, at the
roughness of the lobe for the field's read; a scene with an atmosphere and no sky light shows the
atmosphere's sky by direction above the horizon and none below it; a scene with neither keeps the flat
background the screen draws. Where the probes hold the sky, the field of a reflection takes the
environment for the share they do not answer alone, the sky never twice.

**Sky light, captured scene** (`modules/sky/skyLight/captureScene.ts`). A sky light whose
`realTimeCapture` is off and whose `sourceType` is `'capturedScene'` (the default) lights the scene
with the scene itself, drawn once into its cube from the light's position. Six cameras, one per
face of the cube, +x, -x, +y, -y, +z, -z, each square with a field of 90 degrees and its nearest
distance the light's `skyDistanceThreshold` (150000 cm, so nothing nearer than 1500 m is in the
cube), draw the scene aside (`Engine.captureHdrViews`, `frame/io/hdrCapture.ts`) at the cube's side
(`cubemapResolution`, made a power of two) times `skyLightCaptureSupersample` (1). The image of a
face is the lit linear radiance, before exposure, the effects and the tone curve; it is clamped to
the half float's range, the colour below the horizon is the light's `lowerHemisphereColor` when
`lowerHemisphereIsSolidColor`, and it is copied into the face (`copySceneFaceMain`); then the mips,
the filter by roughness and the nine harmonics are made as for any source (`captureFilter.ts`). The
mean of the sky radiance the light reports is the harmonics' last vector, as for any source.

The faces are drawn by a view of their own with `ViewOverrides` (`frame/backend/state/viewOverrides.ts`):
no sky light, every surface of roughness 1, no particle, light shaft, light function, effect,
exposure, tone curve or temporal pass, the cut asked at `skyLightCaptureLodDistanceScale` (1, a
value of zero or less being 1), the reflections traced unless `skyLightCaptureReflections` is off;
with `captureEmissiveOnly` the lights, the probes, the reflections and the occlusion are off and the
diffuse and specular colours are zero, so that only what the surfaces emit is in the cube. The main
view holds the neutral overrides: its programs read none of them, and the rewrite of the roughness
and the diffuse colour (`lighting/deferred/surfaceOverride.ts`) is a pass encoded for a capture view
only.

It is drawn between two frames, after the frame is submitted, never inside it; the cube read by the
lighting (`read()`) is the last one made, and stays until the next replaces it. A capture is asked
when the light is created, when it first captures a scene, when its cubemap or the angle of its
cubemap changes, when `realTimeCapture` is switched, when its cube is made again (a new
`cubemapResolution`), and by `recapture()`; not when its colour, intensity, lower hemisphere or
distance threshold changes, nor when it moves: those apply at the next capture. A static light is
not captured, and neither is a light with `affectsWorld` off.

```ts
const part = resolveSkyLight({
  realTimeCapture: false, // the scene is captured, not the sky
  sourceType: 'capturedScene',
  mobility: 'stationary', // a static light is not captured
  cubemapResolution: 128,
  skyDistanceThreshold: 150000, // centimetres: the near plane of the faces
  captureEmissiveOnly: false,
})
const capture = createSkyLightCapture(device, report)
const input = {
  part,
  width: skyLightCubeWidth(part, maxCubeSide),
  position: [0, 10, 0],
  frame,
  atmosphere: false,
  fogShown: false,
}
// Once a frame, after it is submitted:
if (capture.sceneDue(input)) await capture.captureScene(engine, input)
const sky = capture.read() // the cube, its mips and the harmonics; none before the first capture
// The world changed (a building came down): the sky is captured again at the next look.
capture.recapture()
```

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
