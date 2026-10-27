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

| Stage                                                        | Code                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Frame gate: camera copy, held-frame test, pipelines asked    | `gate/gateCore.ts`, `frame/loop/hold.ts`, `src/frame/render/render.ts` |
| World poses uploaded                                         | `src/frame/render/worldUpload.ts`                                      |
| GPU deformation                                              | `deformation/compute.ts`                                               |
| Composed placements                                          | `compose/gpuCompose.ts`                                                |
| Cut: GPU selection, the engine's one cut                     | `src/frame/render/gpuCut.ts`                                           |
| Decode and bins of the cut's main pass's visible clusters    | `visibility/decode/decode.ts`, `visibility/bins/bins.ts`               |
| Visibility raster, the cut's post pass between its halves    | `visibility/passes/passes.ts`                                          |
| Material surfaces, one dispatch per class                    | `materials/classes/materialPasses.ts`                                  |
| Surface cache: card pages captured, once a raster is plugged | `lighting/surfaceCache/frame.ts`                                       |
| Surface cache: the cards' texels lit, after the lights go up | `lighting/surfaceCache/lighting/frame.ts`                              |
| Light buffer, bounce, light grid, virtual shadow maps        | `src/frame/render/encodeLights.ts`                                     |
| Lit image: tile classes, colour, sun, local lights, indirect | `lighting/deferred/deferred.ts`                                        |
| Sky, height fog, haze on the surfaces, clouds                | `src/frame/render/encodeClouds.ts`                                     |
| Transparents, distortion, particles                          | `src/frame/render/encodeBlend.ts`                                      |
| Temporal resolve                                             | `taa/frame.ts`                                                         |
| Exposure: histogram and update of the image composed         | `post/exposure/meter.ts`                                               |
| Finishing: scene chain, local exposure's grid and blur       | `post/finish/frame.ts`                                                 |
| Effect chain (bloom)                                         | `src/frame/render/encodeEffects.ts`                                    |
| Composition, presentation, submission                        | `lighting/deferred/deferred.ts`, `src/frame/render/encoder.ts`         |

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
double arithmetic, the world, the stretch and the world box of each linked root, its moved pose
named to the poses the next drawn frame keeps, from which the velocity reads its motion; the
decode of the visible clusters reads the composed worlds where it decodes them
(`visibility/decode/decodeWgsl.ts`); the members pass writes the leaf boxes the
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
actor its layer built of them stands for them, as any cell's actor. An actor whose layer asks no
cluster DAG (`clusterDag`, off by default for a merged, approximated or simplified mesh) is its
level 0 alone and is drawn whole at every distance: its roots stand in together, none withheld
while another is not resident, no error cutting it (`geometry/hlod/worldHlod.ts`); one whose layer
asks for a DAG is cut by its pixel error as any DAG is. The objects standing as
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
under `worldStreamingBlockOnSlowStreamingRatio` blocks; a view whose radius is nearly zero (under
10⁻¹⁰ m) blocks nothing. While one does, no image is presented, the loop taking the whole frame
(`frame/loop/firstImage.ts`), until each file that blocks is shown; meanwhile every cell wished
loads at once, the cap `worldStreamingMaxLoadingCells` lifted as in the initial load, no HLOD cell
turns visible, no other file shows and no switch waits on a warm-up. The HLOD grids never block. With `hlodEnabled` off, no HLOD cell is
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
`worldStreamingPriority`, `worldStreamingUseVelocity`, `worldStreamingForce2D`,
`worldStreamingExtraRadius`, `worldStreamingExtraAngle`, the shape's own settings,
`worldStreamingBlockOnSlowStreaming`, `hlodEnabled`). The wishes are planned again when that key
changed since the last update, or when the scene root's world or a core parent moved (the cells
hang under nodes a host moves, and the bounds the plan reads move with them), and at every frame
while they may not be skipped:
`worldStreamingUpdateOptimization` off (or both quantizations at 0), the last frame left work (a
cell wished still loading or not yet shown, a page of the index left for a later frame, a placed
file waiting for its HLOD 0 cell to be hidden), a load blocking on slow streaming, the initial load,
or every `worldStreamingForceUpdateFrameCount`th frame (0, never). The first update after such a
frame always runs. A frame that skips the update goes on with the last plan, from the eye it was
made from; the source stays where that update put it. The position and the rotation the key reads
are the view's own when it lies farther than a quantum from the world's origin, and none otherwise,
afresh at each frame; the yaw is always the view's own: its heading on the ground, which a view
looking straight down or up takes from its up vector.

**The shape of the view.** `worldStreamingExtraRadius` (metres) lengthens the radius of the view's
circle or sphere, whichever way it is taken (the grid's range times the scale, or
`worldStreamingRadius`); `worldStreamingExtraAngle` (degrees) widens the sector
(`worldStreamingSector`), a whole turn at most, and does nothing without one. A shape whose radius
(under 1e-8 centimetres) or angle (under 1e-8 degrees) is nearly zero is no shape: it wishes no
cell, and a cell it ranks is ranked last. `worldStreamingForce2D` makes a loose grid (`hashSet`)
that streams in 3D wish its cells by their footprint on the ground, the view's height ignored, as a
flat grid does; it changes nothing on a flat grid or a square grid (`spatialHash`).

**The order cells load in.** `worldStreamingPriority` is the view's priority as a streaming source,
0 (highest) to 255 (lowest), 128 by default: the source of the highest priority loads first. A
scene has one view, so every cell it wishes carries the one priority and no order changes; the
setting only makes the cells wished again when it moves. `worldStreamingUseVelocity` (false) adds
the view's average velocity to the axis a loose grid's cells are sorted along, so that a cell ahead
of where the view goes loads before one ahead of where it looks (the axis is the unit axis plus the
velocity in centimetres per second, made unit again). The velocity is measured on the view's eye in
the world and the session's clock, averaged over its last frames — none after a jump of more than
100 m of the world or an idle of more than 5 s — and carried to the scene's frame as a vector.

**What the view asks of its cells.** `worldStreamingTargetState`: `activated` loads and draws them;
`loaded` loads them and keeps them placed in memory without activating any of them: every cell
file, every HLOD 0 actor and every HLOD actor a cell holds stays loaded, wished and switched as
ever, and draws nothing, and the rows of a scene compiled without HLOD are parked, their place kept;
none holds the images back. The actors always loaded, which no cell holds, stay activated and drawn
over every cell, wished or not.

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
// The cells ahead of where the view is going load first.
world.worldStreaming = { worldStreamingUseVelocity: true }
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
| `worldStreamingTargetState`               | `activated`: the cells the view reaches load and draw; `loaded`: they load and stay placed, none activated                          | `activated` |
| `worldStreamingPriority`                  | The view's priority as a streaming source, 0 (highest) to 255 (lowest); with one view it changes no order                           | `128`       |
| `worldStreamingUseVelocity`               | The view's average velocity is added to the axis a loose grid's cells are sorted along                                              | `false`     |
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
[COMPILER.md](COMPILER.md#object-settings)) is tested first, before its frustum test, from the
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
([Dynamic resolution](#dynamic-resolution), `frame/scale/dynamicResolution.ts`), so it works where
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
cut. The settings are world options by their field, changed by `world.hiz` from the next frame
(`packages/sdk-core/src/contracts/hizOptions.ts`):

```ts
const world = createWorld(canvas, { hizTransparentTest: 'reference' })
world.hiz = { hizTrace: 'planes', hizFoldTransparents: true }
world.hiz = { hizTrace: null } // back to the default, the reference's walk
world.hiz = { hizFullResDepth: false } // the probes' walk stops at the half-resolution level
world.hiz = { lightGridHizCull: false } // every cell the lights reach is listed
world.hiz = { lightGridMaxCulledLightsPerCell: 64 } // 64 light entries a cell instead of 32
```

| Field                             | Meaning                                                                                    | Default       |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------- |
| `hizTrace`                        | How the reflections' trace reads the pyramid: `'reference'`, or `'planes'`                 | `'reference'` |
| `hizFoldTransparents`             | The trace layers hold the nearest transparent surface beside the opaque one                | `false`       |
| `hizTransparentTest`              | How a transparent cluster is tested: `'finer'` (16 texels), or `'reference'`               | `'finer'`     |
| `hizFullResDepth`                 | The screen probes' walk goes down to the full-resolution depth                             | `true`        |
| `lightGridHizCull`                | The light grid leaves empty the cells behind their column's farthest depth                 | `true`        |
| `lightGridMaxCulledLightsPerCell` | Light entries the view's light grid holds per cell; past it a column drops its last lights | `32`          |
| `hizPrime`                        | When a primed pyramid is built: `'off'`, `'whenMissing'` or `'always'`                     | `'off'`       |
| `hizPrimeSizeBias`                | The primed draw is the image shifted right by `1 + this`, a whole number from 0 to 30      | `2`           |
| `hizPrimeDepthBias`               | Metres the primed depth is pushed away from the eye by, any number                         | `1.5`         |
| `hizPrimeErrorScale`              | Factor on the cut's pixel error for the primed draw, any number                            | `32`          |
| `hizPrimeFarFieldOnly`            | The primed draw holds the objects that set `farField` alone                                | `true`        |

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

## Tessellation of displaced rows

A row whose surface is displaced (`FLAG_DISPLACED`, bit 31 of the page's flags) is drawn by the
tessellation, not by either rasterizer, when the `tessellation` setting is on and the cluster is none
of a line, a sprite or a voxel brick (`visibility/tessellation/rowWgsl.ts`, `tessellatedRow`): the
cluster cull lists it with the tag `VIS_TAG_TESSELLATED` and the bins queue it in the tessellation's
list. A masked
surface, a skinned or morphed one and one the host rewrites in place are tessellated: their corners
are read as the frame deforms them, and a masked surface's cutout is read at the micro-triangles'
vertices (below). A scene that holds no displaced surface allocates, compiles, binds and dispatches
nothing for it, and the cluster cull is the text it was.

Each pass of the cut (`visibility/raster/raster.ts`) runs, in the same compute pass as its decode
and bins:

1. **Seeding** (`seedWgsl.ts`): one workgroup a listed cluster, dispatched from the list's own
   header, each triangle's three edge factors from the corners in the world — an edge's length over the depth of its nearer end, times the pixels a unit
   subtends at depth one per pixel an edge may span (the cut's `pixelError`), over the dicing rate.
   A triangle none of whose factors passes 8 is queued whole; any other is cut once by the pattern
   of its factors over 14, held to 8 pieces an edge.
2. **Six levels of splitting** (`splitWgsl.ts`, planned by `planWgsl.ts`): each patch of the level is
   placed on its triangle by its barycentrics; the box its corners span, grown by the displacement
   along the cone of the three normals, is judged by the view (`sightWgsl.ts`): outside the frustum,
   behind the eye or past the clip plane it is gone; under the Hi-Z pyramid it is hidden. The main
   pass tests the previous image's pyramid at the previous image's matrix and keeps the patches it
   hides (`occluded`, as large as the queue); the post pass takes them up again (`tessResume`) and
   tests them, and every patch of its own, against the pyramid built from what the main pass drew,
   dropping what it hides. A cut in one pass tests no patch. The factors of a patch that is seen are
   measured again — an edge past the far distance, where the displacement has faded, is cut a quarter
   as finely — and a patch still asking more than 14 is cut by its pattern and its children go to the
   next level; the others go to the pass's visible list.
3. The dicing's dispatch (`tessVisibleArgs`), then the **dicing** inside each mode of the software
   raster (`diceWgsl.ts`): a group takes `tessellationMaxPatchesPerGroup` patches one after another,
   its 64 threads a patch's vertices — a barycentric point of the source triangle, its height read in
   the height map at the level the micro-triangle's size asks for, its clip position pushed along the
   interpolated normal — then its micro-triangles, each set up as a software triangle and written by
   the same rule as the rasterizers' (`visWriteWgsl`). The pixel's identifier is the source
   triangle's. A vertex of a masked row whose cutout is not kept (the base map's alpha at the
   vertex, times the vertex colour's, under the material's threshold) drops the micro-triangles that
   use it; no pixel is tested.

A pattern is a triangle of 15-bit barycentric vertices and the triangles that join them, one for each
triple of edge factors from 1 to 14: the edge of factor `n` is cut in `n` pieces, so neighbours cut
a shared edge alike. The 560 patterns are built once, the first time a displaced surface is drawn
(`visibility/tessellation/table/`); they are the reference's table word for word.

**What the pixel shows.** The visibility buffer holds the source triangle's identifier, not the
point of it the pixel shows. The resolve of a class that draws a displaced pixel (a pipeline of its
own over a group of its own, made when a scene tessellates one: `prismFrame.ts`; no other class
binds anything more) solves the displaced prism: from the depth the pixel resolved to it takes the
pixel's position in the object's space, then twice the closest point of the triangle, its
interpolated normal, the distance the pixel lies along it and the corners pushed by that distance;
the weights of the pixel on the final triangle, and those of the two neighbouring pixels by the rays
through them, give the pixel's barycentrics and their derivatives (`prismWgsl.ts`). A base map,
normals and every other attribute of the surface follow the displaced surface.

**Shadows.** A virtual shadow map draws the displaced surfaces the same way (`lighting/shadows/vsm/
tessellation/`): the records of a displaced surface — a caster row and the window of map pages it
casts into — are not drawn as their triangles; the records of a view pass of the raster are cut into
patches by the same seeding (every triangle queued whole), six levels of splitting by the view of the
window's map — a patch off the window is gone — and a vertex stage that dices the visible patches with the image's
factors, pattern and height read, and draws them into the window with the casters' own depth
fragment. A point the fade has not left whole takes the least displacement, `−center × magnitude`,
so the surface does not shadow itself where it fades out. The two shadow settings of `world.tessellation` ([SDK.md](SDK.md)) decide, per kind
of light, whether the maps take it; off, a surface casts the flat triangles it is made of. A
masked displaced surface is cut out at the vertices of its patches where the device grants a
vertex stage nine storage buffers, and per pixel where it grants eight (see Masked casters in the
shadow maps, below).

The primitive's culling boxes are grown by the material's largest displacement
(`geometry/dag/pack/packNodes.ts`): the box tests of the cut and the occlusion culling then hold
every displaced point.

### Motion of a displaced pixel

The velocity stage moves a displaced pixel back by the point of its triangle that lies under it —
the point of the same weights on the triangle as the last image deformed and placed it — and adds
this image's displacement to it whole, so a displaced surface that moves, turns or deforms has the
motion its surface has, not the flat triangle's. Only an image that draws a surface tessellated
does so: it runs its own programs for the velocity stage and the temporal pass's nearest velocity,
compiled when the scene first holds a displaced surface; every other image, and a scene without a
displaced surface, runs the programs it ran before, which hold none of the solve.

### The clip switch

The patches' sight test and the cluster cull's routing of what reaches behind the plane to the
hardware raster (`straddlesClipPlane`) follow the one project switch that decides whether a view's
clip plane is cut by the rasters
(`cutClipPlane`), chosen when the programs are made: without it none of the plane's code is in
their text.

### Masked casters in the shadow maps

A displaced row whose material is masked is drawn through the patches in the shadow maps too,
with the cutout the image's dicing reads. On a device whose vertex stage binds nine storage buffers
(the engine asks for all the adapter offers, its vertex stage's limit included) the patches' vertices
are cut out; on a device that grants only the eight WebGPU guarantees the patches are drawn whole and
the fragment cuts them out per pixel, as any masked row's triangles are.

## Material surfaces

The visibility buffer is resolved into the material surfaces in compute, one indirect dispatch per
material class over that class's pixels alone (`materials/classes/materialPasses.ts`). The surfaces
and the feedback target are cleared first, by a pass of no draw; then one compute pass sorts every
pixel into the bin of its class — the shading bins (`materials/classes/shadeBins.ts`,
`visibility/shader/shadeBinsWgsl.ts`, `visibility/shader/shadeBinKernelsWgsl.ts`). The depth export
writes each pixel's shading mask once (`r32uint`: bit 0 set, the bin from bit 4, the bin's quad mode
at bit 18; `visibility/raster/exportWgsl.ts`), and the kernels read only that; a tile with no pixel
of any bin leaves before any vote, and a mode no bin holds has no pass. On a device whose subgroups
are the 64-lane workgroup the votes and places are subgroup operations with no barrier, else the
workgroup's barriers:

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
write and nothing to give, and does nothing (`shadesPixel`). Each class the resident clusters wear
(`PresentClasses`, counted as the clusters' records are written) then shades its bin (`shade_cs`, `visibility/shader/shadeEntryWgsl.ts`) and stores its pixels
(`storeSurface`, `visibility/shader/shadeOutputsWgsl.ts`): no pixel is shaded by a class it is not
of, whatever the classes' count or where their borders run. A class's kernel decodes each pixel's
own triangle from its identifier — the decoded cluster at the index the identifier names, the
triangle's corners, their attributes and world positions (`visibility/shader/pixelTriangleWgsl.ts`)
— with no per-triangle cache between the bins and the shading. The bins' head — the class word of each
class key, the surfaces' layers — and their elements are two record tables (`r32uint`, read by
load); each bin's element count, first word and mode are one `vec4u` of a read-only storage buffer.

The surfaces are two layered targets (`materials/surface/surfaceAllocation.ts`): the colours,
`rgba16float` — base colour and metalness, normal and roughness, the emission and occlusion while a
surface of the image can mark it, the thin transmission while a sheet transmits — and the words,
`r32uint` — the flags, the narrowest word a compute stage stores. A class stores every layer through
two storage bindings, the feedback target and the lobes target through two more: four storage
textures a stage, what every device holds. Each reader binds views, one layer each, in the formats
it read before; a layer the frame does
not hold is a 1×1 stand-in, and the head names to the classes the layers it holds, so no class
writes one it has not made. Lighting reads those surfaces and the depth; transparency and
transmission are shaded apart.

The binning mode and the surfaces' format are run-time settings, the reference's by default, world
options by their fields, held over the quality preset — no preset level writes them —, changed later
by `world.shading` from the next frame (`packages/sdk-core/src/contracts/shadingOptions.ts`); a value
they do not take is refused:

```ts
const world = createWorld(canvas, { shadeBinningMode: 'quad' })
world.shading = { shadeBinningMode: null } // back to the preset's, here the default
world.shading = { clearCoatNormal: true } // a clear coat keeps a bottom normal
```

| Field              | Meaning                                                                                         | Default  |
| ------------------ | ----------------------------------------------------------------------------------------------- | -------- |
| `shadeBinningMode` | `'auto'` as each class asks, `'pixel'` every pixel alone, `'quad'` by 2 × 2 quad                | `'auto'` |
| `irisNormal`       | `false`: the eye's iris by the direction of its `tangent`; `true`: by an iris normal of its own | `false`  |
| `clearCoatNormal`  | `false`: a clear coat shares its base's normal; `true`: it keeps a bottom normal                | `false`  |
| `normalCurvatureScale` | scale of the roughness a `normalCurvatureToRoughness` material takes from its vertex normal, any number, held to [0, 2] where read | `1`      |
| `normalCurvatureBias`  | bias added to that roughness, any number, held to [-1, 1] where read                                                     | `0`      |
| `normalCurvatureExponent` | exponent on the normal's change across a pixel, any number, held to [0.05, 20] where read                              | `0.333`  |

**The normal curvature** (`normalCurvatureRoughness`, `normalCurvatureApply`, `lighting/ormWgsl.ts`). A material with `normalCurvatureToRoughness` has its roughness raised to `saturate(max(dNdx·dNdx, dNdy·dNdy)^exponent · scale + bias)`, `dNdx` and `dNdy` the change of the interpolated vertex normal across one pixel, taken before the normal map, a graph's normal or a hair's tangent bends the normal. The option is bit 11 of the record's model word (`NORMAL_CURVATURE_MODEL_BIT`); the blend vertex stage carries it to bit 31 of the item's flags (`normalCurvatureFlag`, `NORMAL_CURVATURE_FLAG_MASK`). The opaque resolve builds the neighbouring weights only for a pixel whose material asks for it; a blended fragment reads the derivatives of its interpolated normal. The curve is three words of the resolve's and the blend view's uniforms (`normalCurvature`). A voxel pixel has no curvature (its shading normal is drawn, not interpolated); the clear coat takes the same curvature for its own roughness. The earlier widening of the roughness by the neighbours' bent normals is gone.

**The clear coat** (`lighting/direct/clearCoatWgsl.ts`, `lobesWgsl.ts`). A pixel whose coat weight is above zero keeps its
coat in the lobes target (`PHYSICAL_SURFACE_FLAG`, the coat's weight, roughness and normal; the lobed lighting program and the lobes
target are made wherever a surface carries one, `hasLightingLobes`) and is lit as the reference's clear coat model lights it
(`coatedLight`): the top layer's context on the coat's normal, its highlight direction moved by the light's sphere (the coat's roughness
narrows the sphere's sine, `1 − R²` over `1 − α_c`), its specular `c · direct · D · Vis · F` of a dielectric of reflectance 0.04 and its
sphere's energy (`lobeEnergy`); the base lit through it by the context refracted into the coat (`refractedCoat`, the
fixed index 1.5), the transmittance of a metal base (`coatTransmittance`), diffuse `mix(d, (1 − F)² · T · d, c)`
and specular `mix(F(plain), (1 − F)² · T · F(refracted), c)`; an anisotropic base's `D`, `Vis` along its tangent frame, a rectangle's two
fitted lobes (`coatedRect`), the legacy energy conservation: none. A point light, a lamp of size and a rectangle each have their entry
(`coatedPoint`, `coatedLamp`, `coatedRect`), `surfaceLight`, `lampLight` and `rectLightSplit` ask them where the pixel has a coat
(`hasCoat`). The indirect light's diffuse colour is the base's remapped (`coatRemap`, through `clothDiffuse`), its specular
reflectance too (`indirectF0`), and the reflections combine the base's and the coat's as the reference's layer combine does
(`reflectionShare`: the base weighed by its environment BRDF with the grazing term scaled by `1 − c`, times `1 − F`, the coat's reflection times
`F`, `F = c ·` the coat's energy at its roughness and angle to the view; `coatLayerKeep` is that `1 − F`). The coat's normal is the
base's unless `clearCoatNormal` is on (`uni.clearCoatNormal`, `ShadeUni` and `BlendView`, one word each): then the surface normal is
the coat's and the base's the graph's `clearCoatBottomNormal` (or the material's normal map), their octahedral difference stored in
8 bits quartered, and the coat's sphere highlight is found without the Newton step.

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

**The outputs** (`graph/outputs.ts`) are twenty-seven, each with its type and its default (`baseColor` float3 0 0 0, `metallic` 0, `specular` 0.5, `roughness` 0.5, `emissive` float3 0, `opacity` 1, `opacityMask` 1, `normal` float3 0 0 1, `ambientOcclusion` 1, `subsurfaceColor` float3 1 1 1, `anisotropy` 0, `tangent` float3 1 0 0, `clearCoat` 1, `clearCoatRoughness` 0.1, `refraction` 1, `worldPositionOffset` float3 0, `shadingModel` 1, `pixelDepthOffset` 0, `cloth` 0, `displacement` 0.5, `clearCoatBottomNormal` float3 0 0 1, and the water's `scatteringCoefficients` float3 0, `absorptionCoefficients` float3 0, `phaseG` 0, `colorScaleBehindWater` float3 1: a surface whose graph wires one is single-layer water, `isWaterGraph`, and reads `opacity` as the coverage of its base material and `refraction`; and the thin translucent model's `transmittanceColor` float3 0.5 and `surfaceCoverage` 1: a lit surface whose graph wires one is thin translucent, `isThinTranslucentGraph`, its record transmits and it reads `opacity` as the coverage of its lit layer; `pixelDepthOffset` is read by a translucent surface too, for the depth of its responsiveness mark); a domain lists those it reads (`DOMAIN_OUTPUTS`): a surface all of them — the opacity only when it blends, the mask only when it is masked, the refraction only where the transparent pass draws it, and a surface that is not lit nothing but `emissive`, the opacity or mask and `worldPositionOffset` (`outputActive`, by `alphaModeOf`) —; a light function `emissive`; a volume `baseColor` (its albedo), `subsurfaceColor` (its extinction), and `emissive`. An output a domain does not read, or an inactive one, takes its default and is not compiled; a lobe (`anisotropy`, `clearCoat`) is on where its output is wired.

**The compile** (`materials/graph/compile.ts`) is a translation of each wired output's wire into WGSL `let` lines, one function `mg<Output>(ctx: MgContext, g: MgValues)` each. A node is translated once (`State.value` memoises by node), its output's component mask applied. Values are typed `flex` (a scalar written as a constant, which fits any width), `f1` to `f4` and `texture` (`graph/valueType.ts`); an operation of a scalar and a vector repeats the scalar (`splat`), of two vectors of different widths is refused; a cast (`value.ts`) may repeat a scalar, cut components or fill with zeros only where the use allows. A constant stays a literal and folds through the operation (`arith.ts`, `vector.ts`, `choose.ts`): zero or one factors, equal or constant-alpha `lerp`, a power of 0 or 1, a base 0, a choice between constants, a function of a constant that has no finite value being refused (no shader literal holds it); the result of an output is cast to its type (`forceCast`). The emitter knows which values every pixel shares (`Emitter.uniform`: a constant, a parameter slot, a local computed from these alone), as the nodes whose result depends on it ask: a divisor of that kind is held to at least 1e-5 in magnitude (`divide`, `fmod`; a varying dividend is multiplied by the floored divisor's reciprocal, one local for all the pixels), `normalize` scales by the reciprocal root of the squared length held to 1e-10 (a zero vector stays zero), `round` goes up at a half. The noise functions are one block (`noiseWgsl.ts`) listed by a program whose graph calls `mgNoise` (`Uses.noise`); the vertex colour (`Uses.colour`) is read from `MgContext.vertexColor`, which no pass fills yet, so a graph that reads it is refused (`CompileOptions.vertexColor`). Errors are `INVALID_MATERIAL` with the node.

**The values** a compiled function reads are one uniform `MgValues`: `v`, a `vec4f` per parameter name (a scalar reads `.x`), then `t`, the colour-atlas slot of each texture, four to a `vec4u` (`materials/graph/layout.ts`, `Slots`). `Slots.fill(graph, buffer, offset, slotOf)` writes them from the graph's values; it is false while a texture has no slot yet. A texture parameter `name` is one slot, replaced by the texture `graph.set(name, texture)` gives. The context `MgContext` is the host's: eight texture coordinate sets, the world position, the eye, the object's position, the vertex and pixel normals, and the time (the game's and the real one); the footprint of a texture read is the context evaluated at the pixels beside (`mgNeighbour`).

**Textures** are read through the colour atlas (`colorSample`, `materials/virtual/wgsl.ts`) at the sample's coordinate, `mipMode` `none` with the footprint of the coordinate — `dpdx`/`dpdy` of the coordinate for a program whose pixels are neighbours (`derivatives: 'screen'`), the context's `ddx`/`ddy` for one that has no neighbours (`'context'`) —, `bias` that footprint scaled by `exp2(bias)`, `level` a footprint of one texel of the level (`mgSampleLevel`).

**Light functions** (`lighting/lightFunction/graphSlot.ts`) compile the graph of the material for the atlas (`compileGraph`, screen derivatives) once a version of the material: `mgEmissive` is the colour of the slot, black where `emissive` is not wired, and the slot's parameters are a 16-byte head (the time twice) then `MgValues`. The program is keyed by the graph's text (`SlotPrograms`, `slotPrograms.ts`), the slot's group bound at the size it reads. A slot is drawn again when the material or a texture changes, while a texture is not read at the detail the slot shows, and at each image when the graph reads the time (`GraphSlot.animated`; `LightFunctionAtlas.waiting` and `changes` follow). A graph the compile refuses names `light-function-graph-refused` once and the slot is drawn from the material's parameters. The atlas cannot give a world position, a camera or a normal: those nodes are refused at compile, and the position of the object is zero.

**The surface** (`materials/graph/surfaceProgram.ts`, `surfaceClasses.ts`, `kept.ts`, `table/graphRecord.ts`, `visibility/shader/shadeGraphWgsl.ts`). A surface that wears a graph (`PageSurface.graph`, carried by the families that draw the material's colour: `GRAPH_FAMILIES`) has its program compiled once for each shape of the graph (`compileKept`, `graph.shape`; a value written to a parameter compiles nothing) and one compile gives everything: the text with no suffix is the program's identity (`CompiledGraph.key`, whole, so that no hash collision makes two programs of one), its hash of sixty-four bits names it, and the transparent pass's declarations are named by it (`named`). A program is known by that text and by what the surface says besides — whether it is lit (an unlit surface compiles its emission, opacity, mask and offset alone: `outputActive`) and whether its emission may be negative (`allowNegativeEmissive`) —: two surfaces whose graphs compile alike share a program, each with its own values. A program is a resolve class of its own: its key is one of the `GRAPH_CLASS_KEYS` (256) past the features' (`MATERIAL_CLASS_KEYS`), over the features its rows are worn on (`graphClassKey`; `CLASS_KEY` holds the features, `CLASS_BIN` the bin), so every class of a program shares one module (`shadePipelines.ts`, `graphModule`). The census of the worn surfaces (`shadeCensus.ts`) gives the classes in use at each retake (`releaseGraphClasses`): a class no surface needs frees its key after two censuses, and a pipeline is made for the class a key stands for now (`classIdentity`, `ShadeClasses.prune`), so a session that edits a graph over and over never runs out of keys; one that wears more at once than there are keys draws the surfaces past them from their parameters and names it. The row of such a surface reads none of its maps or vertex colours (`wearGraph`): the graph computes them. The values — a header texel with the program's id and its bits (`GRAPH_HEADER`: `mask` when the graph wires an `opacityMask`, `blend` for a transparent pass's program, whose ids count from one as the resolve's do), then the parameters' vectors and the colour-atlas slot of each texture (`Slots.fill`) — are written in the material table beside the surface's record, in a block of record places the surface owns (`graphRecord.ts`; the record's `graph` word names its first texel plus one; the header is read by `materialGraphHead`); the record itself holds neutral factors and no map slot for such a surface (`writeMaterialRecord`: no factor of the material reaches a pass), and its lobe extension holds zeros (`writeLobeRecord`). The resolve reads the values with the table's own binding (`graphLoadWgsl`): no binding, no pass and no program for a surface without a graph. The resolve evaluates the graph at the pixel in `shadeSurface` (the splices of `ShadeGraph`): the context (`MgContext`: the page's eight UV sets, the world position at the pixel's weights, the camera in `ShadeUni.eye`, the object's origin, the vertex and pixel normals, the clocks of the graph frame), the footprint of each texture read from the same context a pixel to the right and a pixel below (`mgNeighbour`: the coordinate sets plus their derivatives, the world position at the next pixels' weights, `bx`/`by` declared once), the normal and the outputs after the vertex normal is known (`heldOutputs`: one rule for the resolve and the transparent pass), the diagnostic views' colours, the thin transmission and the specular (`specularFlag`, the second byte of the surface flags: `surfaceSpecular`, `surfaceF0`). The lobes the graph wires are set in the pixel's lobe record (`graphLobes`: the strength, the axis law, the tangent, the coat) before the record's own call stores them: one construction of the lobes, for the material's and the graph's. The lighting gives every anisotropy, a material's or a graph's, the widths α(1 + a) along and α(1 − a) across (`lobeAxis`, `lobeAcross`). The tile requests of the textures replace the maps' (`mgAsk` re-evaluates the coordinate of the read the pixel's pick names). A graph's textures join the colour atlas with the materials' (`collectWebgpuMaterialTextures`); a graph that reads the time keeps the frame drawing (`vis.graphsAnimated`, `blendGraphsAnimated`).

**The graph frame** (`visibility/shader/graphFrameWgsl.ts`, `frame/render/graphFrame.ts`). What a raster reads of the image to evaluate a graph's cutout and offset is one small uniform (48 bytes) for every pass that places a vertex or cuts a pixel — the visibility rasters and the binning, the dicing and the tessellation's seeding and splitting, the shadow depth passes, the resolves, the temporal pass, the transparent pass —: the clocks of the image and of the image before (the world's time and the wall clock), the camera and the camera before, and in the fourth float of the camera whether the blue noise a dithered cutout is cut by is bound. It is written once an image (`resetFrameCounters`) and bound at the number each layout gives it (`VIS_BINDINGS.frame`, `SHADE_BINDINGS.frame`, `BLEND_BINDINGS.frame`, `TESS_BINDINGS.frame`, the velocity stage's); the clocks a graph reads are one value in all of them, and no value in the material table is rewritten to follow an image.

**The graph outputs the rasters evaluate** (`materials/graph/outputProgram.ts`, `maskProgram.ts`, `wpoProgram.ts`, `graphRasters.ts`). One registry (`rasterRegistry`) builds, for each program of a surface graph, the program restricted to one output — the cutout (`opacityMask`, `maskOf`) or the offset (`worldPositionOffset`, `wpoOf`) — with the same values and layout as the resolve's, the rules each output keeps (the texture sets it names, whether it reads a texture and the device lets its stage) deciding what the rasters refuse, through `refuseGraph`. `GraphRasters` is the sorted list of those programs the session's surfaces wear (`graphRastersOf`), held in `WebgpuVisState.rasters` from its open (`holdGraphRasters`, before the first module is made) and read by every module that evaluates them: the sets `cameraMasks`, `shadowMasks`, `diceMasks` for the cutouts; `visibilityWpo`, `voxelWpo`, `tessellationWpo`, `diceWpo`, `shadowWpo`, `shadowSplitWpo`, `patchVertexWpo`, `shadeWpo`, `blendWpo` and `velocityWpo` for the offsets, each naming the bindings its module reads them at. A module made with none is word for word the one without. `GraphRasters.textures` is the device's answer to whether a vertex stage may read the colour atlas (`grantsVertexTextures`: ten storage buffers, because the fullest vertex stage binds that many with it). A graph that joins the session afterwards is taken at the frame entry that retakes the census (`followGraphRasters`, `frame/prepare/lateGraphs.ts`): the set is extended, the visibility module and its pipelines are made again, the software raster follows the set (`ensureGpuRaster`), the shadow maps' rasters and tessellation follow the set they are handed (`vsmRenderContext` compares it), and, where an offset joined, the temporal pass (`rigTemporalAgain`, history started again) is made again — compiled off the thread under a held frame (`track`, `deviceAnswering`), the previous image shown, the session not opened again. The transparent pass takes the set when it builds its programs for the copies a session gains (`growth.ts`).

**The transparent pass** (`blend/graphWgsl.ts`). The blend module holds the functions of every program of the graphs its items wear (`graphProgramsOf`, compiled for the pass: `programOf(surface, 'blend')`), the front stage's and the transmissive stages' modules too, and evaluates the program of each fragment once, among the screen derivatives (`blendGrads`), before any test: the record's `graph` word (under the facing bits the vertex stage puts above the item's rank) names the values and their header the program, and a switch picks its function (`@diagnostic(off, derivative_uniformity)` on the functions that take derivatives under it: a quad shares one primitive). The record is neutral for such an item, so the vertex stage hands the fragments factors that change nothing, no map and no thin transmission. The lobes of a lobed module are the graph's (`blendGraphLobes`, before the item is lit), the refraction the transmissive stage bends by is the graph's where it wires one (`transmitInvIor`: the index as wired, zero meaning none; of the reference's three refraction modes the index of refraction is the one ported), and the specular sets the pixel's reflectance before its lights (`surfaceSpecular`). A session whose copies bring a program its modules do not hold builds its blend programs again (`grantGraphs`, `buildGranted`).

**The volume** (`lighting/fog/voxelGraph.ts`). The objects' graphs of an image are the programs of one voxelisation program, made when the set changes (`FogGraphResources.graphVoxelize`; the programs of the set in place and of the one before it are kept, so a camera that walks across the edge of a fog object with a graph compiles neither again): an object's record names its program by its place in the set and its values by their texel in one buffer (`voxelGraphValues`); the colour atlas is bound where a graph reads a texture; the plain voxelisation serves until the program is compiled. A cell the object's mask or the fade leaves nothing of never evaluates the graph. The textures are taken into the atlas and asked at full detail (`fogGraphMaps`).

**The opacity mask** (`materials/graph/maskProgram.ts`, `visibility/shader/maskGraphWgsl.ts`, `maskSets.ts`, `materials/table/graphRecord.ts`). A surface whose resolve-kind graph wires `opacityMask` is a masked surface (`blendOf` gives `'mask'`; its rows carry the cutout bit, `FLAG_MASK`, its record the clip value as `cut`, a number kept as it is, 0 included). Its mask is the opaque resolve program restricted to that one output: the values the surface writes beside its record keep the layout of that program, so the mask reads them as the resolve does, and is chosen by the program's id in the header, which also says the program holds a mask (`GRAPH_HEADER.mask`). Every raster that cuts holds the mask functions of the programs the session's set holds (`MaskSet`: `cameraMasks` for the visibility rasters and the dicing, with the footprint of the render pixel, `shadowMasks` for the shadow depth passes, at the pool's own level), `maskKeepWgsl` selecting by the id; a program the module does not hold keeps every pixel. `maskKeepAt` is the same test with the pixel a dithered cut needs (the hardware and the compute raster, and the shadow raster); `maskKeep` is the one without a pixel. A module made without graph masks and without a dither is word for word what it was. The clocks a mask reads are the graph frame's. The dither is a bit of the record's model word (`DITHER_MODEL_BIT`, set from `ditherOpacityMask` for any masked surface, a graph's or an `alphaTest`'s): the cut value plus `0.83 · noise − 0.5`, the noise the engine's blue noise (`blueNoiseScalar`) read at the pixel and at the image's frame (the real time at sixty a second), applied where the graph frame says the noise is bound (`eye.w`); the dicing, which cuts at a vertex, keeps the hard test. The mask of a diced vertex below the clip value drops the micro-triangles that use it, as a vertex behind the camera does. A mask the rasters cannot evaluate (a world position, a camera, a normal, two texture sets) is refused through `refuseGraph`; its surface is drawn whole.

**The pixel programs** (`materials/graph/pixelProgram.ts`, `pdoProgram.ts`, `displacementProgram.ts`). Beside the cutout, two more outputs are evaluated by the rasters in the cutout's context (its first texture set, its footprint, the clocks; a graph that reads a world position, the camera, a normal, a vertex colour or two sets there is refused): `pixelDepthOffset` and `displacement`. `pixelOf` joins the three restricted programs of one surface program into one `PixelProgram` (`cuts`, `offsets`, `displaces`; `GraphRasters.masks` holds them), whose header bits (`GRAPH_HEADER.mask`, `depthOffset`, `displacement`) name which outputs the values carry. _Depth offset_: a row that wires it carries `FLAG_DEPTH_OFFSET` and, to read its coordinate, `FLAG_MASK`; the software raster (`writePixel`, `raster/pixelWgsl.ts`) and the hardware raster's fragment (`shader/visWgsl.ts`) evaluate `depthOffsetValue` after the cutout and write `offsetDepth` in the depth key's place — the output times the cosine of the pixel's ray with the view axis (`Uniforms.focal`, the projection's scale on each axis) added to the clip w, never nearer than the plane's, and the offset over `Uniforms.depthSpan` taken off an orthographic view's affine depth —, taking the early-out once it is read; the shadow maps and the dicing write their triangles' depth, as the reference's depth-only and tessellated paths do. _Displacement_: a surface whose record has `displacement` numbers (the material's `displacementMagnitude`, `displacementCenter`, `displacementFadeStart`/`End`, `session/world/materials/surface.ts`) and no height map, the output being wired, has a displacement record (`materials/table/displacementRecord.ts`) with the mark `1` in `map.z`, its rank in `map.w` and the output's texture set in `map.y`; `diceHeight` (`visibility/tessellation/heightWgsl.ts`, the weak default being the map's read in `diceSetupWgsl.ts`) then reads `displacementValue` for that rank, in the dicing of the image and of the shadow maps alike (`maskKeepWgsl` lists it where a program displaces); the rows carry `FLAG_DISPLACED` and the culling boxes grow by the displacement's reach (`pagesDisplacementReach`). The reference's `TessellationMultiplier` is deprecated and read by no shader: it is no output.

**The shading model per pixel** (`materials/graph/outputsOf.ts`, `visibility/shader/shadeGraphWgsl.ts`, `GRAPH_SHADING_MODELS`). Where the material says `fromMaterialExpression` (`VisMaterial.modelFromGraph`, `isCompiled`: under any other name the output is not compiled) and an opaque or masked lit surface's graph wires `shadingModel`, its resolve program computes `mgModel` — the output rounded, the reference's numbering — after the other outputs: an unlit pixel shows its emission (`rgb` the emission, no emissive, metalness or occlusion) and leaves the surface flags unlit; the thin transmission (`subsurfaceColor`) is kept only for `subsurface` and `twoSidedFoliage`; the clear coat only for `clearCoat`, the cloth lobe (`cloth`, its fuzz colour `subsurfaceColor`) only for `cloth`, in the lobe record the graph writes (`physicalRecord.sheen`, packed by `clothTexel`). A graph that wires `cloth` and no model keeps the cloth on and no thin transmission (`subsurfaceColor` being the fuzz colour). The transparent pass reads none of them.

**The shading model of a material without a graph** (`visibility/shader/materialModelWgsl.ts`, `MaterialParameters.shadingModel`). The record's model word holds a code (bits 29-31: skin, profile, eye, hair, unlit, thin subsurface), the profile (bits 20-27) and the subsurface opacity byte (an eye's is one minus its iris mask); the record carries an eye's distance of the iris (`irisDistance`, one more word, the record is eleven texels). The resolve sets the pixel model and the thin target as the graph's per-pixel model does; a hair takes the page's tangent in the normal's place (the tangent is decoded for it), an unlit pixel its emission alone.

**The preintegrated environment BRDF** (`sdk-core/src/lighting/environmentBrdf.ts`, `lighting/direct/environmentBrdfWgsl.ts`). What a surface keeps of the light of every direction — the probes', the screen's, the trace's, the coat's own share (`reflectionWeight`, `coatLayerKeep`) — is `f0 · A + f90 · B` read at (N·V, perceptual roughness) from a 128 × 32 table of two 16-bit values (`A` under a Fresnel of one, `B` under its fifth power), each texel the integral of the GGX lobe with the Smith visibility over 128 stratified samples at the texel's centre; it is built once, held in the light buffer after the skin table (`LIGHT_BUFFER_AT.envBrdf`) and read bilinear, clamped to the edge, as a texture would be. `f90` is `clamp(50 · f0.g)`. The rectangles' fitted lobe (`ltcTable.ts`) keeps its own split-sum (`rectLtc`).

**The preintegrated skin, the subsurface profile, the hair and the eye** (`materials/surface/pixelModel.ts`, `lighting/direct/shadingModelWgsl.ts`, `surfaceModelTerms.ts`). A pixel whose `mgModel` is 3, 5, 7 or 9 keeps the physical model in the low three bits of its surface flags — it is classed, shadowed and reflected as one — and carries its number in bits 25 to 28 (`PIXEL_MODEL_SHIFT`); a pixel with a model is of the `single` tile class (`pixelTileClass`), so the programs of the `simple` class hold none of it. What a model reads beyond the surface's values is left in the thin transmission's target, whose texel is written without the sheet's flag (`SUBSURFACE_FLAG` marks a back-lit sheet, which a skin is not): a skin's `subsurfaceColor` and `opacity`; a subsurface profile's number (the material's `subsurfaceProfile`, held in its record's model word, `subsurfaceProfileOfModel`) and `opacity` (a pixel at or under `SUBSURFACE_OPACITY_THRESHOLD`, 0.1, keeps the plain model); an eye's profile number in `x`, one minus its iris mask in the opacity, its distance in the metalness and the octahedral iris direction in `y` and `z` — or, with `irisNormal` (`uni.irisNormal`, the `MODEL_SWITCH` bits of `view.views.w`), its iris normal and its caustic normal as octahedral differences from the surface's, the caustic's first in the metalness and its second in the specular byte (the lobe is then held at 0.25); the target is made when a surface's graph wires `shadingModel` (`writesSubsurfaceTarget`). `litPixelStatements` reads the number and the texel once (`setPixelModel`; it gives a hair's scatter amount and an eye's iris distance back out of the metalness, which neither is). In the light term (`declaredLightWgsl`) a model's term joins `transmitted` (`modelTransmission`): the skin reads the preintegrated table — the imported image, `skinTable.bin`, held in the light buffer after the rectangles' lobe (`LIGHT_BUFFER_AT.skin`), written when a scene holds a graph with a shading model (`followSkinTable`) —, the hair gives its own BSDF alone (no diffuse, no specular), the eye a diffuse of its own over a specular lobe whose grazing reflectance is one (`modelLobeSurface`; its highlight's half vector is moved by a sphere light without the Newton step, `sphereHalfCosines`). The indirect light's diffuse colour passes through `modelDiffuse` beside the cloth's hook (`clothDiffuse`): the skin adds its subsurface colour, the hair is its response to the environment. A hair reflects nothing (`surfaceReflects`). The eye's iris values and the clear coat's bottom normal are held as the reference's surface buffer holds them: `unorm8` steps of 1/255, the octahedral differences of the iris and caustic normals halved (`*0.5 + 128/255`), the coat's bottom-normal difference quartered (`*0.25 + 128/255`, `clearCoatNormal`, `uni.clearCoatNormal`: the pixel's normal then the coat's, `coatBase`, and its base the decoded bottom normal; `MODEL_SWITCH.clearCoatNormal` moves the coat's half vector without the Newton step, `sphereNoNewton`). The shadow of a skin, as of the thin transmission, is the shadow maps' own with the light a subsurface receiver lets through (`vsmSubsurfaceShadow`, `docs/SHADOWS.md`); a subsurface profile's, a hair's and an eye's are read from any side of the surface and not back-face culled (`vsmSubsurfaceModel`). A subsurface-profile pixel takes the light term of `profileModelWgsl.ts` in place of the plain lobes: the Burley diffuse (`profileBurley`) and a specular of two GGX lobes (`profileSpecular`, from the profile's dual specular, which the light buffer holds a `vec4` a profile, `LIGHT_BUFFER_AT.profiles`, `followSubsurfaceProfiles`) with the visibility of their average roughness, a rectangle's the fitted lobe at each roughness, mixed (`profileRectLight`); from a light that transmits (`SceneLight.transmission`, on a movable light that casts a shadow: bit 16 of its kind word, `transmitsLight`) it takes a transmission term (`profileTransmission`, `PROFILE_TRANSMISSION_WGSL`): the profile's transmission samples (`PROFILE_COLUMNS.transmissionProfile`, 32 of them over 5 cm, blended by the two nearest) at the optical depth the light's shadow reads as, `(1 - shade) * 5` cm (the shadow maps give a profile no distance of their own; its encoded optical thickness is the shadow itself), times the Henyey-Greenstein phase of the profile's scattering distribution at the cosine of the light's opposite with the view refracted into the surface by the profile's inverse index of refraction; the term is weighed by the light's shadow and its diffuse share like the diffuse light, and joins the light the scattering spreads (`scatterAdd`). The texel and the samples are in the light buffer after the dual specular, `LIT_TRANSMISSION_VEC4S` `vec4` a profile (`LIGHT_BUFFER_AT.transmissions`, `litTransmissionRows`). Where the scattering runs (`MODEL_SWITCH.subsurfaceScattering`), the pixels of the profile and eye models are lit with a base colour of one, the surface's colour being multiplied back after the scattering, or with the checkerboard (`sssLitBase`, `sssLitSpecular`), and every light adds the luminance of its diffuse light to the lit image's alpha (`scatterAdd`, `lightOut`; the additive blend sums the alpha, `ADDITIVE_LIGHT`; the first pass writes alpha 0 for such a pixel); the indirect pass adds its diffuse light's. The materials' profiles are collected as they are declared (`subsurfaceProfileRow`, `registry.ts`) and handed to each view (`setSubsurfaceProfiles`).

**Single-layer water** (`blend/water/`, `isWaterGraph`, `VisMaterial.water`). A lit surface whose graph wires a water output is a blend item of the rank class `WATER_BASE` (three culls past the refracting ones, `waterRank`): every blend pass but two skips it (`drawBlendRuns`, `water: 'only' | 'with'`), the front pass draws it with the others — its fragment covers its pixel whatever its coverage (`GRAPH_FLAG.water`) — and `encodeWater` draws it, at the head of `encodeBlend`, in the order of the reference's pass (`waterPass.ts`): the scene's depth copied and the water drawn into the copy (`fsWaterDepth`, `singleLayerWaterDepthPrepass`); the scene's linear depth, at `singleLayerWaterRefractionDownsample` (`waterPassWgsl.ts`); the tiles of 8 by 8 pixels that hold water, marked then listed in Z-order, by subgroups where granted (`waterTileWgsl.ts`); the scene's colour, for the listed tiles alone where the refraction mask limits what is read; the refraction mask (`fsWaterMask`: distance, Fresnel and depth cullings, packed with a water flag); the shading (`fsWater`, no blend: forward lights split into the diffuse share under the base material's coverage and the specular share, ambient, `waterVolume` — the reference's `EvaluateWaterVolumeLighting` on the bilateral read of the copy's depth, the refraction offset of the distortion's constants, the sun that the light buffer names as the forward directional light —, the fog), writing the water's normal, roughness, reflectance and flag beside; the water's velocity (`waterVelocity` in the velocity stage, `csWaterIds`: the camera's vector at the water's depth, its identifier cleared); the sun kept apart where `singleLayerWaterShadersSupportDistanceFieldShadow` or `…VsmFiltering` holds (`waterSunSplit`: the forward directional light lit alone and taken off the walk's sum, written to a fifth target, its in-scattering too), whose distance-field shadow is traced a second time at the water's depth (`encodeWaterSunFieldShadow`: the Hi-Z with its front word forced up by a copy of the levels uniform, `foldedDepth`) into a mask of its own; the composite (`fsWaterComposite`, `One, SrcAlpha`: the separated sun times that mask, and the reflection of that surface, `surfaceReflection` for the technique, faded in over 50 cm above the scene, dimmed by the fog); and the water's depth copied over the scene's. The reflections' indirect light is gated here: `waterFrontOf` asks the settings for the front layer (`resolveReflections`, `water`), which is then traced at every level that traces, in blocks of the water's own side, with the reconstruction and the denoising the water's settings leave on (`ReflectionSettings.frontBlock`, `frontReconstruction`, `frontTemporal`, `frontBilateral`, `frontSceneTraces`: the second layer's flags ride in `reflectionView.scene.w` and its block in `grid.w`, read by `reflectionBlock` and `reflectionDone` through the pipeline's `REFLECTION_LAYER`); the front stage is compiled for the reflecting surface wherever the items hold water. The module holds the water's code only in a scene that holds water (`BlendProgramSetup.water`); `BlendGraph` holds its four outputs only then. A graph wires the coefficients per centimetre as the reference does: depths are metres in the world, centimetres in the law (`WATER_CM`).

**The world position offset** (`materials/graph/wpoProgram.ts`, `outputProgram.ts`, `visibility/shader/wpoGraphWgsl.ts`, `wpoSets.ts`, `pageGeometryWgsl.ts`, `geometry/rows/page/offsetRow.ts`, `frame/render/offsetReach.ts`). The `worldPositionOffset` output (float3, zero by default, read by every surface, lit or not) compiles in the surface's program like the others; the program restricted to that output (`wpoOf`) is what the passes that place a vertex hold, chosen by the program's key (its id, with the high bit set for a transparent pass's). Every page-geometry pass places a vertex with `pagePosition` (and `pagePreviousPosition` for the image before), which adds the offset of `pageOffset` where the row's word says its surface moves (`PageInfo.wpo`: `WPO_ROW_MOVES`, `WPO_ROW_VELOCITY` where the temporal pass reprojects by it, `WPO_ROW_ALWAYS` where the surface evaluates whatever its object says); a brick of voxels takes the offset at the centre of its box for each of its corners and for the cells traced in it (`voxelCarry`), so it moves rigidly, and the tessellation's seeding, splitting and dicing place a patch's corners with `pagePosition` too, so a displaced surface is diced on the moved triangle, the resolve's prism solve and the velocity stage solving it on the same corners. `pageWpoLocal` is a default of zero (a declaration marked weak, `wgslFn`'s `weak`, which the assembler gives way to a declaration of the same name); a module that evaluates offsets lists the real one (`wpoGraphWgsl(wpoSet)`), so a module made without offsets is the page geometry's own, and every module sees the same moved vertex: the hardware raster's vertex stage and its voxel slots, the compute raster, the tessellation, the surface resolve's graph classes, the shadow maps' depth raster, voxel tiers and tessellated patches, the transparent pass's vertex stage (and its front stage), the velocity stage and the temporal pass's nearest velocity. The offset is evaluated in the world from the vertex as the page and its deformation place it (a texture it reads at the finest level, `textureSampleLevel`, the neighbours of its footprint the vertex itself), held to the cluster's greatest offset (`wpoMost`), brought into the primitive's space by the inverse of its world's linear part, and zero where the object does not evaluate it: its disable distance (`wpoDisableSq`) measured from the camera (the graph frame's) to the centre of its bounds (`wpoCentre`) unless a surface always evaluates; in a shadow pass `wpoThreshold`, set from the projection record of the map it draws (`wpoThreshold`, a float at byte 292, `vsmWpoThreshold` in `vsm/clipmap.ts`: the square of the distance past which the clipmap level, held back by `shadowClipmapWpoDisableDistanceLodBias` and the clipmap's whole resolution bias, no longer shows the motion, a shift of which redraws the level only with `shadowClipmapWpoDisableDistanceInvalidateOnScaleChange` on; zero for a local light's map or with `shadowClipmapWpoDisableDistance` off), replaces the camera: the offset is evaluated where the threshold is not past the object's distance. `previous` asks the same at the clocks and the camera of the image before, the object placed where the placement's motion says it was (`wpoPreviousWorld`); whether it is evaluated is the current image's decision. What an object says of its offset is read once for each change, never each image (`followOffsets`): which roots wear an offset the session holds is decided by their pages' surfaces and re-read when a surface's offset facts moved (`MaterialTable.offsetEpoch`), the roots changed, a switch of any node was written (`offsetSwitchEdits`) or the set of rasters grew; the image then walks the roots that wear one, reads their node's switches (`objectOffsetRow`: `evaluateWorldPositionOffset`, `worldPositionOffsetWritesVelocity`, `worldPositionOffsetDisableDistance`, `shadowCacheInvalidation`, held in `RootOffsets`) and writes them into the placement's record (`PlacementInfo`), which the decode merges with the cluster's own offset words — the surface's bits, zero where the object does not evaluate its offset unless the surface always does — into the decoded cluster (`visibility/decode/decodeWgsl.ts`; a transparent item carries the same words), and tells the shadow scheduler of the roots whose offset is evaluated now (`noteDeformed`) — every one that casts with `shadowCacheInvalidation` `always`, by its instance bounds alone, none with `rigid` or `static`. `static` also keeps the object out of the moving casters (`MARK_BITS.cacheStatic`, `MOBILITY_CACHE_STATIC`): the casters' diff (`lighting/shadows/casters/castDiffWgsl.ts`) stales nothing for a pose change of a placement that was and is pinned, and only an arrival, a departure or a change of its other bits stales its pages. A cluster whose bounds the offset may leave carries the surface's greatest offset as its root's reach (`ClusterRoot.offsetReach`, added to the deformation's in `holdReach`/`holdOffsetReach`, one writer): every cut grows the bounds of the root's pages by it, the CPU's and the GPU's by the root's mark. The rays of the reflections and the indirect light (`lighting/rays/`), the distance fields and the screen probes' traces see the rest pose.

## Temporal antialiasing

A temporal upscaler (`taa/`): a jittered image, motion derived from the visibility buffer, a
history update with shading rejection, the spatial anti-aliaser before the update, all compute
dispatches, one update for every render scale. The pass runs on every frame drawn and its history is reset only on a camera
cut, the one change the reprojection cannot follow. A still view is drawn while its history fills
— whole cycles of the jitter's phases until every pixel of the history holds its most samples, 16
at the display's resolution and 4 at twice it, a history pixel covering a quarter of a display pixel
(`taaConverged`, `historySampleLaws`) — then held on its
converged image like any still view (`taaConverging`, `frame/loop/hold.ts`); a change draws again
on the history it holds, and a session opened with `drawConverged` (the bench's cost series) keeps
drawing it. Its level (`off`, `low`, `medium`, `high`, `max`, `taa/levels.ts`) sets the
kernel, the flicker rejection and the spatial anti-aliaser, the history's resolution, whether it
resurrects and whether it reprojects by a field; the flicker rejection, the resurrection and the
reprojection field are the level's by default and each a setting of its own
(`temporalShadingRejectionFlickering`, `temporalResurrection`, `temporalReprojectionField`: `level`,
`on` or `off`, `taaKnobs`), a change of the last two remaking the history; a level without the flicker
rejection or the anti-aliaser skips its pass. The thin geometry detection, which relaxes the history where geometry
is thinner than a pixel, runs where the setting `temporalThinGeometry` (`world.temporal`, off by
default) asks for it, at any level but `off`, and in the analysis views of the diagnostic; a change
of the setting starts the history again.

**The history** (`historyShape.ts`, `historyFrames.ts`, `historyTargets.ts`). A history is a few frames,
each a colour and its metadata — the history's validity alone, eight bits — at the history's size,
the display's times the level's percent (`levels.ts`: 100, and 200 at `max`) rounded up. The update is
a compute pass, so its targets are storage textures, and WebGPU lets a compute pass store to the
11-11-10 format, the one- and two-channel 8-bit formats and the 16-bit ones only under the feature
`texture-formats-tier1` (§ 25.19 and § 26.1.1 of the specification; it carries
`rg11b10ufloat-renderable`, and `texture-formats-tier2` carries it): with it the colour is stored in
`rg11b10ufloat` — the history's and the resolved image's —, the validity in `r8unorm`, the
render-resolution shading history in `rgb10a2unorm` (ten bits a channel, its reprojection edge in two)
and the anti-aliaser's target in `rg8uint`; without it in half floats, `rgba8unorm`, `rgba8unorm` and
`rgba8uint`, the core's storage formats (`historyFormatsOf`, requested with the device,
`session/gpuDevice.ts`). The mask of the texels the shading rejection asks the spatial anti-aliaser on is an `r8uint` storage texture, one byte a texel, whatever the history's formats, where the device has `texture-formats-tier1` (and its driver accepts it) and grants four storage textures a stage (the rejection then binds four), else a buffer of a 32-bit word a texel (`rejectionStorageForms`); a level without the anti-aliaser binds a one-texel stand-in. The update dithers the colour to the format's precision. A history
that would pass the device's widest texture is made at the display's size
(`historyFactor`). The frames follow a sequence (`frameSequenceOf`): without
resurrection, one frame in two textures taking turns, one read as the last image's while the other is
written; with it, the two of the images just drawn and `temporalResurrectionFrames` (rounded up to an even
count) kept for good, every `temporalResurrectionInterval`-th image stored in one of them, the oldest
replaced, and the oldest read as the frame a pixel may be resurrected from (`createFrameRing`,
`planFrame`, `keepFrame`); each frame is a texture of its own, and a view cut drops them all. The update
(`resolveWgsl.ts`, `historyUpdate.ts`) reads the last image's frame and writes its own slot; where the
history is larger than the display's, the resolve (`historyResolve.ts`, its programs `historyResolveWgsl.ts`) brings it down to the colour
the composition reads, a four-by-four Mitchell-Netravali kernel (B = C = 1/3) weighed by
the tone of each colour and held between the least and the greatest of its sixteen, in a compute pass
that writes the half-size image of the scene's chain beside (`SceneChain.begin`), a second
pass doing the display layers; where the history is the display's size the update writes that image
itself, each texel the mean of the four pixels it covers. The chain draws its own (`scene downsample`)
only for an image no pass wrote it beside: the lit image where the temporal pass is off and no blur
drew, or a device that binds fewer than five storage textures to a stage. Memory, bytes of the
history's frames, the half-size image, the resolved image and the analysis's render-resolution
targets (`taaTargetBytes`): a 1920 × 1080 display at `max` costs 166 MB of history in the 11-11-10
format (398 MB in half floats) and 340 MB in all (620 MB); a 5120 × 3280 one costs 1.34 GB (3.22 GB)
for the history on a device with textures of 16384 and 2.75 GB (5.02 GB) in all, and 336 MB for it
(806 MB), 1.68 GB in all (2.47 GB), on a device whose widest texture is 8192, which keeps the history
at 100 %. A debug view's as-is pixels (a normal or depth surface, `AS_IS_FLAG`) are none of the
history's: the composition draws them over its output (below, [The display finishing](#the-display-finishing)).

**The passes are compute dispatches** (`analysis.ts`, `historyUpdate.ts`), each in a compute pass of
its own, timed under its label (`TAA_*_PASS`, `diagnostic/stage/passLabels.ts`). Before the
translucency is composed onto the image (`measureBeforeTranslucency`, `post/taa/frame.ts`, called
by `composeLayers`, the one place the layers are composed) — where the composed image would already
hold the transparent layers —, the measures, on the scene the temporal pass reads, where the flicker
measure or the thin geometry detection runs: the flicker luma, the colour's measurement luma taken
to the gamma space in eight bits, and where the detection runs the material's coverage of the
visibility buffer, each a layer of one texture of a byte a texel a layer (`flickerLumaWgsl.ts`,
64 lanes of 2×2 texels, 16×16 a workgroup), which also holds the thin geometry's mask and coverage
history. Then the dilated velocity, the history reprojection (the resurrected frame's shading
history in it), the thin geometry detection and its weight relaxation (the translucency's trim),
the flicker measure, the shading rejection, the spatial anti-aliaser, a texel a lane, then the history update, one
dispatch over the history in tiles of 8 across — 64 lanes, 8 down, a lane's place in the tile the
bits of its index in the order that puts the four pixels of a half-size texel in four consecutive lanes
(`lanePixel`). The update's lanes beyond the history compute with clamped reads and store nothing. The
history's laws, the flicker measure's rates, the shading rejection's exposure and the thin geometry
detection's thresholds are settings read at each image (`world.temporal`, `TEMPORAL_RULES`): the laws
(`temporalHistorySampleCount`, `temporalShadingRejectionSampleCount`,
`temporalVelocityWeightClampingSampleCount`, `temporalVelocityWeightClampingPixelSpeed`) are the words of
`view.history`, `view.fraction` and `view.rates.y` (`historySampleLaws`) and set the still view's
convergence too (`taaConverged`); the flicker period, its frame rate cap and its parallax speed are
`view.exposure.zw` and `view.rates.x` (`flickerRates.ts`), a period of 0 skipping the measure in the
shading rejection; the offset in stops is `view.preExposure.y`, the factor the measures of the flicker,
the thin geometry and the rejection multiply the exposure by, the history update not; the thresholds of
the thin geometry detection are `view.thin` and `view.thinFade` (`writeThin`; `thinFade.z` is the greatest
relaxation weight, `temporalThinGeometryMaxRelaxationWeight`, which scales the cluster weight before the
3×3 average (0.5, 1, 0.5) that spreads it). The half-size image
(`temporalDownsampleQuality`) is written beside the colour by the update or the resolve, in the
history's colour format (11-11-10 floats where the device stores to them, as the reference's), and by the
motion blur where one is drawn after them, at `'low'`; at `'high'` the scene chain draws it from the
image with the wide filter (`halveWide`, `sceneChain.ts`). The
settings `temporalWaveOps` (`true`, the default of the reference's wave operations), `temporalWaveSize`
(`0`, the device's own size) and `temporalHalfPrecision` (`true`, its 16-bit math) choose how the
programs run (`waveOps.ts`, `world.temporal`): with subgroups (`subgroups`) at a size the programs are
written for — 16, 32 or 64, the adapter's only size, else one pinned with `subgroup-size-control` —
the update is a workgroup of one subgroup's lanes and gathers the half-size image by two
`subgroupShuffleXor` (masks 1 then 2, the horizontal then the vertical exchange of the pairs); without,
a workgroup of 64 lanes and workgroup memory with a barrier between each exchange. WGSL ties a subgroup
to no place in the workgroup (§ 15.5 "Subgroups" of the WGSL specification), which is why the wave
program has the subgroup be the workgroup. Where the device has 16-bit shader floats (`shader-f16`) the
spatial anti-aliaser runs in half floats (`spatialAntiAliasingShader`'s `half`); the other programs
have one variant. A setting that changes the choice compiles the programs it names off the frame, the
frames drawn with those of the pass's first choice meanwhile. A program a driver refuses does not take
the pass with it: its wave programs are replaced by the plain ones, then the packed formats' by the
core's (`createTaaResolves`). WebGPU has one queue per device
(`GPUDevice.queue`, "the primary `GPUQueue` for this device", § 4.4 of the specification; a device
descriptor names the one `defaultQueue`, § 4.3.1): the reference's asynchronous compute has no
counterpart.

**The flicker measure** (`flickerMeasureWgsl.ts`) is a dispatch of its own, run just before the
shading rejection where the level rejects by it (or an analysis view is shown), on the same tiles and
network: so that neither kernel keeps the other's arrays in its registers. It writes the flicker
history of the texels the workgroup writes and, for every texel of its tile — the three each side that
it only reads included, whose values are those of this tile's wrapped network alone — the flicker error
and, in an analysis view, the count, in 32 bits whatever the precision, into a storage buffer of a tile
of cells to each workgroup (`flickerErrorCells.ts`), which the shading rejection reads back as it was
computed; the 16-bit and wave programs follow the shading rejection's.

**The shading rejection** (`rejectionWgsl.ts`) is one dispatch, a workgroup of 256 lanes over a
square of 32 × 32 render texels, four a lane down a column, of which it writes the inner 26 × 26: its
3×3 operators exchange their values in workgroup memory, the tile's neighbourhood wrapping around
past its edge, so a value several operators deep is wrong near the edge and the three texels each side
are only read. In it, in this order: the flicker measure's error read back, where the level rejects by
it; the rejection of the last image's history; where the history resurrects, that of the frame a pixel may be
resurrected from, measured only where some written texel of the workgroup is closer to it and rejected
below a half; the shading history of this image's frame, the rejection the
update reads (an analysis view's words in its place), the reprojection of the resurrected pixels, the
scene colour the update reads and the LDR luma the anti-aliaser reads; and each written texel empties
its occluder word. Three storage textures, what every device binds: the shading history, the
rejection, and the reprojection field's vector and jacobian as two layers of one texture; the scene colour and the luma are storage buffers — the scene colour in the history's colour
format, 11-11-10 floats in a word (or four half floats in two), each channel rounded toward zero as the
format's texture would after the stochastic rounding, the luma a byte a texel, four to a word, each
texel's byte cleared and set by two atomics, the texels of a word belonging to up to two workgroups.

**Resurrection** (`resurrectionWgsl.ts`, `reprojectWgsl.ts`, `rejectionWgsl.ts`). A pixel the last
image's history rejects may take its history from a frame kept for good, as that frame saw it: the
reprojection reads that frame's shading history into the second layer of its reprojected histories,
with the bit of the texels off that frame's screen, and the shading rejection decides each pixel —
the frame is closer to the image than the last image's, by more than 0.05 a channel on average over a
texel's 3×3, for more than four of the nine texels around it, and the texel does not fall off that
frame's screen, and its rejection is better by more than 0.1 —; the pixels resurrected take the vector
and jacobian of the reprojection to that frame and the update reads that frame's colour for them.

**The reprojection field** (`reprojectionFieldWgsl.ts`, `nearestVelocityWgsl.ts`). Where the level
reprojects by a field, each texel's vector is its closest neighbour's, corrected by the jacobian of
the vectors over its 3×3, in render pixels, so a surface that rotates or scales reprojects each of the
history's pixels to its own place; the pixels past the boundary the depth edge sets (found by a browse
of three samples a side, `reprojectionBoundary`) keep the texel's own vector, and a hole-filled texel
keeps the occluder's, with no jacobian. The jacobian and the boundary are written by the nearest
velocity and read by the update; the history of a field's level reads its speed (`temporalReprojectionFieldSpeed`).

**What a material asks of its history** (`responsive`, [Temporal anti-aliasing](COMPILER.md#temporal-anti-aliasing))
is carried by a two-bit code, `off` 0, `medium` 1, `full` 3 (`responsiveCode`): bit 0 reads the pixel
as a pixel animation — its motion vector is no guide to its detail —, bit 1 restarts its history.
The velocity stage writes it with the flags of the pixel in its target, two words a texel
(`rg32uint`): the vector, and the flags, `PIXEL_ANIMATED` (also set where the surface changes its
vertices with no tracked deformation) and `PIXEL_RESTARTS`. The blends and transmissive layers over
a pixel write their material's code, the mark of it (`RESPONSIVE_MARK_WGSL`), into a one-channel
target of their own (`RESPONSIVE_TARGET`), in a pass of their own on every device, as the reference's velocity pass is (`drawResponsive`: the layers drawn again, depth-tested against the opaque scene at the depth a `pixelDepthOffset` moves each pixel to, `frag_depth`; a thin translucent layer as if its opacity were one), where the reference ORs it into the velocity texel (no
64-bit image atomic, no logic-op blend here): the largest of the layers' marks holds every bit
any of them carries, which the OR does; the nearest velocity reads it with the flags and takes the
union. A layer writes it as the reference does (`blendResponsive`, `marksResponsive`): only a
layer of the pass before the depth of field, drawn translucent, additive or multiplying, only
where its opacity is above 0 and under the clip value of its surface's opacity mask plus a 255th
(`ITEM.opacityClip`), and only where it lies in front of the opaque scene (the pass's depth test). The animation bit signs the closest depth the nearest velocity writes, moves the texel in
full for the flicker measure, keeps the thin geometry detection off it and has the rejection read
its colour blurred over its 3×3; the restart bit goes in the marks, and the reprojection puts it in
its word (`REPROJECT_BITS.restarts`) where this image can resurrect a pixel at all
(`view.resurrection.x`, a level without the resurrection reading `full` as `medium`). A texel whose
word says so is disoccluded for the flicker measure and the shading rejection — its history
restarts, its spatial anti-aliaser asked — and is never resurrected; the update reads no more than the
rejection's bits. The `taa-material-history` view shows the code of each pixel as grey.

**The motion blur's flattening** is done by the nearest velocity where both run: its workgroup is a
tile of the blur's (16 × 16 texels) and the dilated velocity — the closest surface's, the camera's
motion taken out where the blur follows what moves alone — is scaled to the blur's pixels, flattened
with the closest depth and reduced to the tile's range there (`velocityShader`'s `fused`,
`flattenWgsl.ts`), the blur's own dispatch left out (`FusedFlatten.written`). The blur sets itself up
ahead of the pass (`WebgpuResolveKind.fuse`: its targets, its uniform and clock, once an image), and
flattens its own motion when the temporal pass is off, when its fused program has not compiled yet
and when the device binds fewer than six storage textures to a stage (seven with two directions); a
second blur of the chain always flattens its own, the first alone is fused.

**The motion blur's half-size image** is written by its filter as it stores the blurred image
(`filterStore`, `filterWgsl.ts`), the last blur of the chain's, for the scene's chain to read in
place of `scene downsample` (`WebgpuResolveKind.half`, `ResolvedImage`): a thread of a
half-resolution class holds its quad of pixels and stores their mean; a thread of a full-resolution
one stores its pixel, and the four lanes of a quad gather in workgroup memory, one barrier, the lane
of the quad's first pixel storing the mean. The image the blur leaves is the chain's; a still image
(no motion, no blur) keeps the temporal pass's, and an image lying in textures larger than itself
(drawn below the display's size with the temporal pass off) has the chain's own. The render
scale is a dynamic resolution (`scale/dynamicResolution.ts`): a history of the frame's GPU busy
times against the frame time budget, both directions, with or without the temporal upscaler
(spatial upscale in the composition where it is off). The loop draws every refresh, or under the
page's frame cap every few (`frame/cadence.ts`); the budget is `dynamicResolutionFrameTimeBudgetMs`,
33.3 ms by default, the frame cap's interval where it is 0 ([below](#dynamic-resolution)). The
page's options are [SDK.md](SDK.md#canvas-camera-and-teardown).

### Dynamic resolution

Where the render scale is `'auto'`, one heuristic fits it to a GPU time budget, and fits the cut's
edge scale (`cutEdgeScaleBudgetMs`) beside it. Each GPU time arrives with the fraction its image was
drawn at; the heuristic keeps the last `dynamicResolutionHistorySize` of them, browses them from the
newest, each suggesting `fraction · target / time` (the square root of the ratio for the render
scale, whose time scales with the area), weighs them by `dynamicResolutionFrameWeightExponent` per
frame back, stops after `dynamicResolutionMaxOverBudgetFrames` frames in a row over the budget, and
proposes the weighted mean. The target is the budget less `dynamicResolutionHeadroomPercent`. A
history all over the budget is forgotten and moves the render scale at once; else a change waits for
`dynamicResolutionChangePeriod` GPU times since the last one, is none under
`dynamicResolutionChangePercentThreshold` percent unless it reaches a bound, and a rise goes
`dynamicResolutionIncreaseAmortization` of the way. The scale's bounds are the page's `renderScale`
(its minimum is 50 % by default); `dynamicResolutionThrottlingMaxPercent` lowers its upper bound.

| Field                                        | Meaning                                                                                                                                                                                                                               | Default |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `dynamicResolutionFrameTimeBudgetMs`         | The frame's GPU time budget, in ms; 0 is the page's frame cap interval instead (the display's refresh unless the page caps the frame rate)                                                                                            | `33.3`  |
| `dynamicResolutionThrottlingMaxPercent`      | The most the render scale may be, in percent of the display, from 0 to 100; 0, none; within the page's bounds                                                                                                                         | `0`     |
| `dynamicResolutionHeadroomPercent`           | The share of the budget left free, in percent, from 0 to 99                                                                                                                                                                           | `10`    |
| `dynamicResolutionOverBudgetHeadroomPercent` | The share of the budget a frame must take to be over it, in percent, from 0 to 99                                                                                                                                                     | `0`     |
| `dynamicResolutionHistorySize`               | The GPU times kept, a whole number from 1 to 4096 (five doubles an entry, allocated at the next sample)                                                                                                                               | `16`    |
| `dynamicResolutionFrameWeightExponent`       | The weight of each frame back against the one after it, 0 or more                                                                                                                                                                     | `0.9`   |
| `dynamicResolutionChangePeriod`              | The fewest GPU times between two changes, a whole number of at least 0                                                                                                                                                                | `8`     |
| `dynamicResolutionIncreaseAmortization`      | How far a rise goes at once, from 0 to 1                                                                                                                                                                                              | `0.9`   |
| `dynamicResolutionChangePercentThreshold`    | The change, in percent from 0 to 100, under which the scale does not move                                                                                                                                                             | `2`     |
| `dynamicResolutionMaxOverBudgetFrames`       | The frames in a row over the budget past which the older ones no longer count, a whole number of at least 0, read no lower than 2                                                                                                     | `2`     |
| `dynamicResolutionUseCpuTimeLogic`           | Whether a frame whose CPU time passes the budget (or the budget less its headroom) is not over budget by its GPU time: lowering the resolution would not shorten it. The CPU time is the engine's own for the image, the one thread's | `false` |

```ts
const world = createWorld(canvas, { renderScale: 'auto', maxFrameRate: 60 })
world.dynamicResolution = {
  dynamicResolutionFrameTimeBudgetMs: 12,
  dynamicResolutionHeadroomPercent: 20,
}
world.dynamicResolution = { dynamicResolutionThrottlingMaxPercent: 70 } // a page that idles draws at most 70 %
explorer.setDynamicResolution('dynamicResolutionUseCpuTimeLogic', true) // from the next GPU time
```

The settings are read again at each GPU time; a number that is not in its range, or not a number,
is refused with the field named, and no quality level writes them. Where the render scale is a
number, nothing is fitted and none of them does anything. The reference's shadow raster budget and
translucency budget have none here (each would size or throttle a pass this engine has no separate
form of), nor has the quantization of the render targets' upper bound (WebGPU has no transient
allocator and a resized target pops: the targets are made once at the bounds' maximum) nor the game
thread's critical path (one thread here).

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
display curve and the transfer bring it into [0, 1]: one read of the tone table ([The tone table](#the-display-finishing)),
baked from the scene's curve and the colour settings (`lighting/deferred/shaders.ts`, `lighting/toneLutRead.ts`,
`lighting/toneMappingWgsl.ts`). `world.exposure` is `'auto'`, the default (`true`), a number above zero — a fixed
exposure, used as it is — or `false`, an exposure of 1. `world.toneMapping` is `'filmic'` by default, or `'none'`, the light as it is
(`TONE_MAPPING_RANK`, `packages/sdk-core/src/scene/core/environment.ts`); the film curve's method — the curve itself or the
standard output transform of the film industry's colour system — is the colour grading's (`tonemappingMethod`).

**Automatic exposure** (`post/exposure/`). Where `world.exposure` is `'auto'` the exposure is found by one of three
methods, `exposureMethod` of `world.exposureSettings` (`packages/sdk-core/src/contracts/exposureOptions.ts`).
`'histogram'`, the default, measures the image composition reads, on the GPU, every image: a compute pass bins the log2
luminance of the texels of the scene's half-size image (the chain the bloom and the local exposure read) into a 64-bucket histogram over a span of stops (workgroup-local counters, one
merge into the buffer, `meterWgsl.ts`), then one thread takes the mean of the logs between two percentiles
(`exposureLowPercent`, `exposureHighPercent`), holds it to a range, and moves the exposure toward `2^bias · 0.18 / mean`:
linearly while it is farther than the transition distance, exponentially inside, at the rise's or the fall's speed, with
the frame's time; a view cut (`gate.temporalRevision`) and the first image jump to the target. `'basic'` is the cheaper
measure: the image is brought down by the scene's chain (`createSceneChain`: the half-size image, then the quarter-size
level, each the mean of the 4 × 4 texels around the one above); a setup (`basicSetup`, `post/exposure/basicWgsl.ts`)
places each quarter-size texel's colour — as it is, divided by the pre-exposure — as a log luminance, no lower
than a luminance of 0.0001 and held between −10 and 20 stops, over the histogram's range, into the alpha of a texture of
the same place; four more levels, each the mean of the 4 × 4 texels around the one above, bring it to a sixty-fourth of
the image on each axis, and one workgroup of 256 lanes sums that grid's texels, each lane a sixteenth of each axis
(`laneRange`), each texel weighted by the metering mask at its corner (no less than 0.05, 1 with no mask) times
`exposureBlackBucketWeight` where its value falls in the darkest bucket; every lane leaves its four sums (weighted
value, weight, value, count) in its own words of the measure's buffer. The exposure's mean is the weighted mean of the
grid's log luminance over all the lanes; the local exposure's mean gain is, as the reference does it, the mean of the
gain each lane's own plain mean gives, weighted by the lane's texel count — not the gain at the grid's plain mean, which
differs as soon as the contrasts above and under middle grey differ (a grid half 2 stops over its mean and half 2 under,
highlight contrast 0.5, shadow contrast 1: 0.76 against 1.0). The two scene chains are one: the finishing's chain is
begun on the metered image before the exposure (`beginFinishScene`) and the basic method draws its grid from the same
half-size and quarter-size levels, once. `'manual'` measures nothing: the exposure is the camera's, below. Every method
shares the speeds, the transition, the range, the bias, the compensation curve and the jump at a first image and a cut.
A view lit by no declared lamp has no radiance to expose, whatever the method.

The exposure the update leaves is copied, on the GPU, into the composition's view uniform, so an image is shown at the
exposure measured on it, and into a staging buffer of the readback ring (`gpu/core/readbackRing.ts`), which brings it to
the CPU a few images late (the meter's last readback, 1 until one came back). **One exposure.** The CPU reads it once an
image: `beginPreExposure` reads the held exposure (`heldExposureOf`: a number or the manual method) or the meter's last
readback and keeps it in `PreExposure.exposure` (`held` the exposure the meter writes); the lighting parameters, the
pre-exposure every light is written multiplied by, the temporal resolve's weights and its correction by the ratio of one
image's scale (the exposure over its pre-exposure) to the last's, the reflections' ranges and the radiance a mirror sees
of the background, the display layers read it from there, so the lag is theirs and the image's never. On the GPU the
meter's exposure buffer is the one source for every method: its `shown` word is copied into the composition's view
uniform and from there into the finishing's, its grey into the finishing's, its words into the readback. A frame waits
for nothing: no stall, no readback awaited. A view whose exposure is still moving toward its target is drawn again
(`exposureMoving`, `frame/loop/unsettled.ts`) and a still one is held. A view lit by no declared lamp shows its albedo as
it is (`UNLIT_COMPOSITIONS`): no exposure, no curve, whatever `world.exposure` says; in a lit view the flat
`scene.background` is scene radiance, exposed and shown like any pixel ([The background](#the-display-finishing)).

**Adaptation runs on the world's time.** The exposure moves by the seconds the world lived between two images
(`createWorldFrames().clock`, the sum of the intervals the clips and the controllers integrate, a pause of the loop
counted as one running interval, `session/world/frames/frames.ts`), handed to the engine by the world as `worldClock`
(`EngineContext.worldClock`, read at each image). A world that holds still does not move its exposure; a hitch moves it
by one interval, not by the seconds the page lost. An engine opened with no world (a bench, a test) adapts on the image
clock it keeps (`WebgpuRun.graphClocks`, taken once an image from the wall clock; the material graphs read the same two
clocks). The engine has no global pause or slow motion of its own: what it reads is the world's integrated seconds, so a
frame the loop slept through counts as one running interval, and a subsystem's own scale (the physics' `timeScale`, the
animation banks') does not reach it.

**Manual exposure** (`exposureMethod: 'manual'`, the camera's). The camera's EV100 is `log2(aperture² · shutter speed ·
100 / ISO)` where `exposureApplyPhysicalCamera` is `true` (the default) — `exposureCameraShutterSpeed` (60, in 1/s, from
0.01 to 8000) and `exposureCameraIso` (100, from 1); the aperture is the depth of field's (`effect.depthOfField`, f/4
where the chain holds none, drawing or not) — and 0 where it is `false`. The white point is the saturation luminance
times `2^EV100`, and the exposure is `2^exposureBias` times the compensation curve's factor over the white point. The
curve is read at the EV100 an image with the white point for its mean would give (the white point over middle grey over
the saturation luminance), or at a mean of 1 where the low and the high percentile are the same. With the physical camera
off, and the default lens, the exposure is two to the bias. No pass runs: the exposure is worked out on the CPU
(`manualExposure`, `packages/sdk-core/src/contracts/exposureManual.ts`) and is the lighting parameter. It is also written
into the meter's exposure buffer, so a switch back to a measuring method starts from the exposure on screen and adapts
over a normal frame, not from the exposure of the last measured image over the seconds the manual stretch lasted — **and
only when it changed**: a held exposure does no work on the GPU (`ExposureMeter.hold`, `writeHeld`,
`post/exposure/meterRun.ts`). `writeHeld` compares the words it would write (the exposure, the one asked, the mean, the
compensation; the scale shown over the pre-exposure, a local mean of 1, the middle grey) with the ones the buffer last
received and writes the range from the first changed word to the last, in one write, and none while the buffer still
holds them; a measuring image's update rewrites the buffer, so the first held image after one writes it again. A held
image copies only the scale shown into the view's uniform, makes no staging copy and no `mapAsync`; the meter knows the
exposure at once (`read.last`, `asked` and `local` set by the hold) and tags each readback with the number of holds, so a
copy still in flight from before a hold, which says an exposure that is no longer the view's, is ignored. A **number**
(`world.exposure = 0.5`) is a fixed exposure: radiance is multiplied by it as it is, the bias, the curve and the camera
ignored. The old multiplier `n` is the same exposure as the manual method with the camera off and the bias `log2(n)`, or
as a fixed EV100 of `−log2(n · saturation luminance)`; no value the number took is lost.

**Lens attenuation** (`exposureLensAttenuation`, 0.78, from 0.01). The luminance that saturates the sensor at EV100 0 is
`0.78 / lens attenuation` (`exposureSaturationLuminance`, 1 at the default, where lighting is unitless). Every EV100 of
the exposure is read from it: the range of the mean, the histogram's stops, the curve's read, the camera's white point. A
lower attenuation raises it.

**Metering mask** (`exposureMeterMask`, `explorer.setExposureMeterMask(image)`, none by default). A picture whose red
channel weighs where the image is measured: bright spots weigh the exposure, dark ones leave it out. It is a plain 8-bit
texture read bilinearly at its first level; the histogram method reads it at the corner of each 2 × 2 quad of half
pixels, at the quad's first (`quadWeight`), and multiplies the pixel's share of its two buckets by it, the basic method
once a texel of its grid. No mask: no texture is made, no read is done.

**The local exposure's middle grey** is 0.18 times the exposure compensation — the bias and the compensation curve's
factor at the frame's mean — and two to `localExposureMiddleGreyBias`. It has one source, the exposure buffer's
`exposure[1].z` (the log2 of it): the update derives it for a measured image, the CPU writes it for a held one (a fixed
exposure's has neither bias nor curve; a manual exposure's cancels the bias and keeps the curve's factor, as the
reference does), and the finishing copies it from there every image (`ExposureMeter.copyGrey`). A fixed exposure and the
manual method measure nothing: their local exposure's mean gain is 1.

```js
const world = createWorld('viewer', {
  exposureMeterMask: await loader.imageBitmap('centre-weighted.png'),
})
world.exposureSettings = { exposureMethod: 'basic' } // the cheaper measure, weighed by the mask
explorer.setExposureMeterMask(null) // every pixel counts the same again
// The camera's exposure: no measure — f/2.8, 1/125 s, ISO 400, no bias.
world.effects.add(effect.depthOfField({ aperture: 2.8 }))
world.exposureSettings = {
  exposureMethod: 'manual',
  exposureCameraShutterSpeed: 125,
  exposureCameraIso: 400,
  exposureBias: 0,
}
// The old multiplier 0.25, as a manual bias with the camera off.
world.exposureSettings = {
  exposureMethod: 'manual',
  exposureApplyPhysicalCamera: false,
  exposureBias: Math.log2(0.25),
}
world.exposure = 0.25 // the same, as a fixed exposure
```

**Pre-exposure** (`post/exposure/pre.ts`, `preExposureOf`, option `preExposure` of
`world.exposureSettings`, on by default; `preExposureOverride`, 0 by default, names the number
instead; `cachedLightingPreExposure`, 4 stops by default, is the fixed number of the lighting kept
from one image to the next, below). Every light an image holds is written already multiplied by one number, the image's
pre-exposure: the exposure the CPU knows (`PreExposure.exposure`: a fixed or manual exposure, `heldExposureOf`, else the meter's last readback) times the luminance of the scene colour tint times the local exposure's mean gain
(`averageLocalExposureOf`: the mean, over the histogram's buckets, of the log of the gain the local
exposure gives a pixel of that luminance, computed by the exposure's update with the exposure and
read back with it, `meterWgsl.ts`; 1 where the local exposure does not run and for a manual
exposure), 1 for a view that is not lit, that shows raw
values or that runs no post (a capture). It is fixed once an image
(`beginPreExposure`) and read, for the whole image, from `preExposureOf`. The composition multiplies
the image by the exposure over that number (`view.preExposure.y`: the exposure the GPU measured on
the image divided by the pre-exposure it holds, `meterWgsl.ts`, copied into the view's uniform and
the finishing's), so the picture is the same with the option off. What it gains is range: a half
float holds the light of the image at any exposure. The writers apply it at the end of what they
sum, over `preExposed(rgb)` (`post/exposure/preWgsl.ts`: the light multiplied) or, for a surface's
final write, `preExposedClipped(rgb)`: the term multiplied by the pre-exposure first,
the whole colour then held to 32256, as a base pass clips its output: the lit image's passes (the
colour pass, `lighting/deferred/colourPassWgsl.ts`: the emission, an unlit surface, the background; the sun's, the local
lights' and the indirect light's passes, each its own term, `lightPassWgsl.ts`, `indirectPassWgsl.ts`), the translucent layers (`blend/shader.ts`, the transmissive stage in
`blend/transmission/transmitWgsl.ts`), the particles (`particles/gpu/particlesWgsl.ts`), the
clouds' traced luminance and the fog laid on them (`modules/sky/clouds/traceWgsl.ts`,
`composeWgsl.ts`), the fog volume (above). The fog pass (`lighting/fog/fogPass.ts`) writes the fog's inscattering over
`preExposed`, and the sky (`lighting/atmosphere/skyWgsl.ts`) is another's writer. Reflections, the bounce, the fog's analytic law and the haze are sums of the surface's
terms, in the units of the light before it is written, and need none of their own. What is kept from
one image to the next is brought to the new number by the ratio of the pre-exposures: the temporal
history's colour (`historyRead`), the fog volume's cells, the clouds'
reconstruction history (`sampleHistoryLight`), and the last lit image the reflections and the
screen probes read, divided by the pre-exposure it was lit with (`ReflectionView.radiance.w`). The
histogram measures the image divided by it, the local exposure, the bloom, the depth of field and
the light shafts work on the image multiplied by the exposure over it. The image before's pre-exposure is kept once, on the pre-exposure (`PreExposure.previous`), and the temporal pass reads
it from there (`pre.now / pre.previous`); the settings of the film and of the colour grading that the pre-exposure and
the finishing both read are read by one module (`post/finish/settings.ts`).

The sky light's real-time capture has a pre-exposure of its own, one number for every image and
every view whatever `preExposure` says: 2 to the minus `cachedLightingPreExposure` (4 stops, 1/16;
from −16 to 16; `cachedPreExposure`, `packages/sdk-core/src/contracts/exposureOptions.ts`). Its faces
are written multiplied by it — the sky, held to 32256 per channel after the multiplication, the
distant fog's light, the clouds' traced luminance, the lower hemisphere's colour — and the light's
colour (`skyLightColor`) is multiplied by its inverse, once, in the uniform every reader of the
cube and of its harmonics reads, so the sky's radiance comes back whole while the capture keeps
its range over about −8 to +12 stops of exposure. A captured scene and a specified cubemap are
written at 1 and read at 1.

```js
const world = createWorld('viewer')
world.exposureSettings = { preExposure: false } // every light written as it is; the same picture
world.exposureSettings = { preExposureOverride: 0.25 } // lights written multiplied by 0.25
world.exposureSettings = { cachedLightingPreExposure: 8 } // the sky light's capture kept for −4 to +16 stops
```

**Exposure compensation curve** (`packages/sdk-core/src/contracts/exposureCurve.ts`, option
`exposureCurve` of the session and of `createWorld`, `explorer.setExposureCurve`; none by default,
which is a factor of 1 and the same image). Stops added to the exposure's target by how bright the
scene is. The curve (keys by EV100, linear, constant or cubic between them, an extrapolation on each
side) is baked once into 64 half-float samples of `2^compensation` over EV100 -10 to +20
(`exposureCurveTable`: the same option object gives the same table), held in
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

**The film curve** (`lighting/filmCurveWgsl.ts`, constants `filmCurveConstants.ts`) is the curve the tone table bakes
for the scene's `'filmic'` display curve: exposed sRGB radiance to the film's wide working gamut, a widening of bright
saturated colours, a blue correction, a glow and a red pull by hue in the grading gamut, a first desaturation, the curve
of each channel — a toe and a shoulder in log luminance (slope 0.88, toe 0.55, shoulder 0.26, black clip 0, white clip
0.04) —, a second desaturation, the blue correction undone, back to sRGB. Middle grey in is middle grey out. A light the
curve does not define, a black one whose logarithm divides by nothing, is shown black (`finiteValue`,
`lighting/storableWgsl.ts`), as the reference's unsigned targets show it.

## The display finishing

Seven things follow the exposure's measure and come before the curve — the colour fringe at the read, the local
exposure, the tint, the bloom's glow, the vignette, the grain —, and the dither after it, in the lit image only (a view
lit by no declared lamp shows its albedo as it is, a diagnostic view and a capture the engine's image). The dither is
always drawn, so the composition of a lit image always carries the finishing's group (`post/finish/frame.ts`). The order
of a frame (`frame/render/surfaceLighting.ts`): the tone table's baking where a setting or the curve changed
(`post/finish/toneFrame.ts`) — first, before the transparents are bound, for the layers copy its words —, the lighting
and the transparents, the temporal resolve, the exposure (`post/exposure/`), the finishing's passes, the effect chain, the
composition. The previous camera of the view is kept once an image, at the lighting's start
(`frame/backend/state/previousCamera.ts`, `beginCamera`): the temporal pass, the sky light's occlusion and the horizon
occlusion each note the number of the image they last drew and read that camera only where it is the image before; a
history that skipped an image starts again, as after a cut.

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
only base where the grid holds no pixel. Middle grey is the local exposure's (above): 0.18 times the exposure
compensation and two to `localExposureMiddleGreyBias`. Thresholds keep the base's own
contrast within a distance of middle grey. The composition computes the gain per pixel from the
pixel's own luminance; the bloom's setup applies the same gain to the half-size image, so the glow is
the glow of what is shown. The settings of one view are
read at each image; a change draws it again (`finishMoving`).

**Vignette** (`SceneEnvironment.vignette`, `world.vignette`, 0.4) is the cosine-fourth law, `1 / (1 +
(v · r)²)²`, `r` the distance from the centre over a circle through the corners whatever the aspect:
it multiplies the image's light, the glow's included, after the exposure.

**Colour fringe, tint, sharpening.** The fringe reads the red and the green of a pixel nearer the image's centre than its
blue, by their wavelengths, in proportion to `chromaticAberration` percent of the distance to the centre
(`fringeTaps`, `finishWgsl.ts`); it is drawn only above 0.01, in a quality other than `'off'`, from
`chromaticAberrationStartOffset` out, capped by `chromaticAberrationMax`. The tint multiplies the scene's colour by
`sceneColorTintRed`, `Green` and `Blue` after the local exposure; the bloom's glow is not tinted. The sharpening is the
scene's `sharpness` (0 to 10) or `tonemapperSharpen` where that is 0 or more.

**Dither.** A triangular noise of one level of the display's channel added to the colour shown (`ditherOf`,
`finishWgsl.ts`): a hash of the pixel's place, moved by a Halton point of the image's number (modulo 8), gives `n` in
[−1, 1); the noise is `s − s · √(1 − |n|)`, `s` the sign of `n`, times the level. `quantizationDitheringBits` makes the level `1 / (2^bits − 1)`; 0 or less takes it from the target (1/255 for
an 8-bit one), 32 makes it too small to show. It is always drawn. Its pattern follows the image's number on every image
drawn; a view that rests, which is not drawn again, keeps the pattern of its last image — the held image is 8 bits, and a
new noise added to it would average, over the images, to the held image and not to the light (over eight images and 64
lights, 0.56 display levels of error against 0.16 for the image composed again from its light,
`post/finish/film.test.ts`); to draw every image at rest, as the reference does, open the session with
`drawConverged: true`.

**Film grain** multiplies the light, after the vignette and the glow, by `lerp(1, g, w)`: `g` is a texel of the grain's
texture — 128 × 128, `rgba8unorm`, generated once at the first image that draws the grain (`post/finish/grain.ts`) —
multiplied by `decode`, the texel count over the sum of the channel, so that its mean is 1; `w` is the strength times the
share of the pixel's zone: `1 − smoothstep(0, shadowsMax, l)` of the dark share, `smoothstep(highlightsMin,
highlightsMax, l)` of the bright, the rest the middle, `l` the exposed luminance read with the weights 0.0406, 0.7330,
−0.0316 (the matrix from the grading gamut to sRGB applied to that gamut's luminance row — an odd luminance, a blue pixel
reads as dark — kept as the reference computes it). The texture's coordinates are `uv · (1920 / 128, 1920 · h / w / 128) /
scale + (halton(i + 1, 2), halton(i + 1, 3))`, `i` the image's number modulo `filmGrainSequenceLength`, sampled bilinear
and repeated: a texel is one pixel of an image 1920 wide. The texture is generated to the reference grain's measured
statistics — the reference's own is an authored asset, which is not copied: per channel a mean of 0.5 and a spread of
0.070, 0.056 and 0.078, skewed toward the bright (0.5, 0.3, 0.6) with heavier tails than a bell; the three channels
following one another (0.62, 0.41, 0.54); texels following their neighbour at one texel's distance, each channel its own
way along each axis (0.20, 0.15, 0.20 along x and 0.06, 0.18, 0.30 along y: the scan's grain is streakier along one axis)
and none at two — by blurring a normal noise with a wrapping kernel on each axis, mixing it by the correlations' Cholesky
factor (each plane blurred for the share of the neighbour correlation a channel asks that the planes before it did not
give), bending it by the skew and the kurtosis and setting its mean and spread, from a seeded generator: the same texture
on every machine, repeating with no seam. At intensity 1 the grain changes a channel by 14, 11 and 15 percent of its
light, one standard deviation. A view whose grain is drawn is drawn again at each image, for its pattern follows the
image's number (`finishAnimated`, `frame/loop/hold.ts`).

**Quality.** `tonemapperQuality` (0 to 5) gates the vignette below 2 and the grain below 4; the quality levels write 0 at
`'smooth'`, 2 at `'balanced'` and 5 at `'fine'` and `'cinematic'`.

**One group, one pipeline.** The composition binds the finishing as group 1 (`finishLayout.ts`): the
uniform (`finishParams.ts`) — the vignette, the exposure copied on the GPU from the view's, the
luminance reading the exposure uses, the local exposure's settings —, the grid, the blurred luminance, a
sampler and the glow; a slot with nothing is an empty image, its flag in the uniform 0. The lit compositions bind the tone table, its sampler and its reading uniform after the as-is pixels' textures (bindings 4 to 6
with them, 2 to 4 without). A frame that can hold an as-is pixel (a row shown as-is, a diagnostic
view: `readsAsIs`) composes with the surfaces' flags and base colour (bindings 2 and 3,
`lighting/deferred/shaders.ts`): after the temporal pass and the chain, as a buffer is visualised,
the display pixel's render texel (`view.surface`, the surfaces' render pixels per display pixel) is
read unfiltered and, where it is as-is, its base colour is shown with the sRGB transfer alone, exact,
no dither — the transparents over it are not shown there, as no translucency is in the buffers a
visualisation reads; any other pixel gets the chain, bit for bit as a frame with none. The pipelines
that finish compile off the frame at the first image that asks (`composesFinish`); until then the image
is drawn plain and drawn again once they arrive. A frame's cost at 1920 × 1080 with all three on: 26
render passes and one compute pass beside the exposure's — the chain down to the fifth level (5), the
local exposure (1 compute, 3 render), the bloom's setup, chain and blurs (18) —, all but four of them
under 500 × 300 texels, and 22 MB of `rgba16float` targets; the composition reads three more textures
per pixel.

**The tone table.** The curve is not evaluated at each pixel. The composition reads, for the exposed light of a pixel,
the colour the display shows from a 3D table of `lutSize` texels a side (32 by default: 128 KiB, 256 KiB without the packed format), the way
the reference does (`lighting/toneLutRead.ts`): the light is addressed by the shaper — `log2(light) / 14 + 0.61` for the
logarithm, with a light of 0 on the first texel —, the table is read trilinearly at `code · (n − 1) / n + 0.5 / n`, and
the value is multiplied by the table's scale. A light of the curve `none` is shown as it is, through the transfer alone,
and the unlit view reads no table.

The table is baked by one compute pass of `n³` threads (`lighting/toneBakeWgsl.ts`, `toneLut.ts`), only when a colour
setting (`COLOR_GRADING_RULES`) or the rank of the scene's display curve differs from the last baking, and made again when
`lutSize` changes. Each texel is, in order: the light of its code (the shaper's inverse); the white balance, a 3 × 3 matrix
made on the processor (`lighting/whiteBalance.ts`: the white of the temperature on the daylight locus from 4000 K, the
black body's below, moved along its isotherm by the tint, adapted to the display's D65 by a von Kries scaling of
Bradford's cone responses); then, for the film curve: the expansion of a bright colour toward a wider gamut, the grade in
the film's working gamut (each zone's saturation, contrast, gamma, gain and offset over the whole light's, the three zones
weighed by the luminance), the blue correction, the glow and the red modifier, the curve of each channel (toe, straight
run, shoulder, blended where they overlap), the two desaturations, the curve's amount, the blue correction undone, then the
correction's polynomial and the power of the display's gamma ratio; for any other curve: the grade in the same gamut, then
the curve itself. Last the transfer — the sRGB curve, the power 1/2.4, or an explicit gamma (`tonemapperGamma` from 1 up;
0 keeps the transfer, and a number under 1 is read as 1: no transfer at all, the linear light as the display value) —,
divided by the table's scale, 1.05 for the film curve (its white clip lifts its output past 1) — except under an explicit
gamma and for the standard output transform, where it is 1 — and 1 for the other curves, and cut to [0, 1], as the
reference's table of unsigned integers cuts it. Each channel is held at ten bits, as the reference's table holds it: the table is
`rgb10a2unorm` where the device grants `texture-formats-tier1` (storage textures of that format, `toneTableFormat`), else
`rgba16float`, in which the baking itself rounds the value to a multiple of 1/1023 before it stores it, so that both hold the same
values (the half float's own rounding, a quarter of a step at most, apart).

**The cube is admitted by the device's memory budget** (`ledgerAdmitted`, `lighting/toneLut.ts` `tableKeeper`): its bytes
are known before it is made (`side³ × 4`, `× 8` in the half float), the cube it replaces is credited, and `lutSize` has no limit of its own but the
largest 3D texture the device makes. Where the room holds fewer texels the cube is the largest side the room holds
(`sideHolding`), not a refusal of the session, and the frame's metrics say so: `toneTable: { side, bytes, why }` (`why`
null when the cube is the size asked; `null` for the whole entry before a cube is made). Not even the least cube (2
texels a side) is optional — a lit image reads a table — so that one is made as any resource that cannot be left out,
outside the admission; the cube's bytes are part of the view's reserve (`effectTargets`, `frame/prepare/targetFunding.ts`).

Against the exact curve the 32-texel table differs, over lights from 0.002 to 45, by a fifth of one display level on
average and 0.4 at most on greys (the 64-texel table: a twentieth, 0.1); only a nearly pure saturated colour at the edge of
the display's gamut differs by more, up to 20 levels, where the exact curve is cut at 0 and the interpolation takes it from
its neighbours' — the reference's own behaviour with the same table. The table ends at an exposed light of 44.5 (the
logarithm's 14 stops): a brighter light reads the last texel, white for the film curve.

**What the table does with a light the curve does not define.** One guard the reference does not have, with its proof
(`lighting/filmCurveWgsl.ts`, `RRT_MEASURES_WGSL`): the square root of the glow's saturation measure is taken of a sum cut
at 0, which is never negative in exact arithmetic and a few units in the last place under 0 for a grey in single
precision. Nothing else is guarded: a black light's logarithm and its chroma divide by nothing, and the value that is not
a number comes out as 0, as the reference's unsigned targets turn it, in the table (`storable`,
`lighting/storableWgsl.ts`: a value that is not a number is 0, +infinity 1, then cut to [0, 1]) and on the path that reads
no table (`displayValue`, `finiteValue`: the same cut on the display value); the float table is read trilinearly, so one
NaN texel would poison the cell around it. A consequence: an exact black light stays black under a colour offset, as the
reference's table shows it. The grade's and the grain's parts are weighed by one smooth step of any order of its edges
(`hermite`, `gpu/core/smoothstepEdges.ts`): `saturate((x − a) / (b − a))`, then `t² (3 − 2t)` — a reversed ramp where the
top is under the start, a step where they are equal —, where WGSL's own `smoothstep` is undefined.

**The layers drawn on display values.** A translucent layer that filters the display (multiply, subtractive, and the
normal and additive ones where a filter surface covers the pixel) and a particle drawn over one map their colour in
display space, as the composition shows it. Their fragment stage has no sampled texture to spare
(`gpu/core/stageLimits.test.ts`: 16 of 16), so they do not read the table: the view carries a copy of the baking's words
(`BAKE_LAYOUT`, 124 words: in the blend view uniform and in each pool's draw words) and the layer runs the baking's chain
on them (`displayLight`, `lighting/toneBakeWgsl.ts`) — the same white balance, grade, curve or method and transfer as the
table, with no texture —, then multiplies by the table's scale. The table is baked, and its words written, before the
transparents are bound (`frame/render/surfaceLighting.ts`). An unlit layer is shown as it is.

**The standard output transform** (`tonemappingMethod: 'standardAces'`, `lighting/aces/`). In the film curve's place, after
the white balance, the expansion of the gamut and the grade, the light in the grading gamut is cut to [0, 100] — the range
the table's quantizer reads, by the caller (`displayLight`) for both versions — and multiplied by
`acesSceneColorMultiplier`; then, by `acesVersion`:

- **Version 2** (the default). The light is taken to XYZ and to the lightness `J`, colourfulness `M` and hue `h` of a
  colour appearance model under the light's viewing condition (a white of 100 nits, a background of 20, a dim surround:
  `acesCam.ts`); its luminance put through the tone scale (a curve of the scene-referred light with a flare toe, fitted so
  that 18 % grey is 10 nits of a 100-nit display and a light of 128 reaches the peak) and back to a lightness; its
  colourfulness compressed with the lightness (expanded where small by a toe run backwards from the gamut's reach,
  compressed toward it above, normalised by a function of the hue); the colour pulled into the display's gamut along the
  line of constant hue that leaves the cusp's lightness for the focus, rolled off between the gamut's edge — a smooth
  minimum of its lower and upper faces, the upper one a curve whose exponent is read from a table by hue — and the reach of
  the grading gamut (`acesHull.ts` holds the numbers); then taken back to sRGB's primaries and cut to [0, 1]
  (`acesWgsl.ts`). The three hue tables — the grading gamut's reach, the display gamut's cusp and the curvature of its
  upper face — are constants of the one display the engine has (sRGB's gamut, a peak of 100 nits, no HDR) and are written
  as numbers (`acesTables.ts`), which a test holds to the ones made from the gamut by the search the transform specifies
  (`acesTables.fixture.ts`). The model on the processor, in double precision, is the tests' oracle, not the engine's
  (`acesModel.fixture.ts`, `acesGamutModel.fixture.ts`; `aces/acesDisplay.test.ts` holds the shader to it to 1.5e-7).
- **Version 1** (`acesVersion: 1`, `aces13Wgsl.ts`), the earlier rendering and output transforms of the film industry's
  colour system, version 1.3, in its own order and numbers, on the three channels. The light times the multiplier is taken
  to the colour encoding's primaries; the gamut compression (`acesGamutCompression`, 0 by default, from 0 to 1) is mixed
  in by its share — each channel's distance from the largest is compressed past a threshold toward a limit (cyan 1.147,
  magenta 1.264, yellow 1.312; thresholds 0.815, 0.803, 0.88; power 1.2), a colour with a negative channel left as it is
  —; the rendering's sweeteners follow: a glow on dark saturated colours, a pull of the reds toward a pivot by a cubic
  spline of the hue 135 degrees wide, the colour taken to the rendering primaries and desaturated by 0.96; the tone scale
  on each channel (a quadratic spline through three points in the logarithms of the light and of the luminance, flat at
  both ends); the luminance taken to a share of the display's range, through XYZ and the display primaries' limit, back
  to nits; to sRGB's primaries by the adaptation of the colour encoding's white to sRGB's; a hundredth; cut to [0, 1]. The
  tone scale is the one the reference configures for a high-range display — 10⁻⁴, 15 and 1000 nits, written as numbers
  (`SCALE`, `aces13Wgsl.ts`) which the model derives from the three luminances (`scaleOf`, `aces13Model.fixture.ts`) — and
  the reference never reconfigures it for a display of 100 nits, so **on an sRGB display the 1000-nit curve is cut at the
  100 nits the display shows, and the picture is much brighter than version 2's**: a neutral light of 0.18, times the
  multiplier 1.5, is shown 0.255 in linear display light against version 2's 0.157, a light of 0.5 0.81 against 0.38, a
  light of 1 is white. The display's luminances are not options: they only matter with an HDR output, which the engine does
  not have. The glow's measures are the film curve's (`RRT_MEASURES_WGSL`). The shader is held, run in JavaScript, to the
  model written from the published matrices and steps (`aces/aces13.test.ts`), and to values worked by hand from them: the
  light the scale puts at its middle point (0.0822144598) shows 0.047999, the slope there is the scale's 1.55, the red
  modifier's weight is 1 at the red.

The default transfer after either version is the power 2.4 (`sdrInverseEotf: 'default'`) and the table's scale 1. The
reference bakes the transform into a second 64-texel table addressed by the quantizer and reads it from the outer one;
ours evaluates it for each texel of the outer table — the same function without the second table's interpolation — so
the layers, which cannot read a table, run the very same function. At `acesSceneColorMultiplier` 1.5 and no other
setting, version 2 shows 18 % grey 118 of 255, as the film curve does, a light of 1 201 against the film curve's 221, a
light of 4 238 against 249.

**The background.** In a lit view the flat `scene.background` colour is scene radiance, not a display colour drawn as it is:
the colour pass writes it into the lit image where no surface drew (`surfaceColourMain`, `lighting/deferred/colourPassWgsl.ts`) as
`srgbToLinear(colour)`, multiplied by the image's pre-exposure like every light, with an alpha of 1 (nothing of the background hidden) — so exposure, the display
curve, the grade and the temporal resolve treat it as any pixel, and **a white background is no longer pure white**: it
is the radiance of 1, shown as a light of 1 is. With a fog and no atmosphere the pixel is the fog's inscattering plus the
background through its transmittance (the fog pass lays it over the colour); a raw diagnostic view shows it as every pixel of its image, as radiance. A ray that
leaves the scene and meets no sky reaches the same radiance (`createSurroundings`, `lighting/reflections/surroundings.ts`:
the colour's `srgbToLinear`, made again only when the colour changes, no exposure division), so a mirror adds what the
screen holds. The sky, where there is one, is drawn over it.

**The alpha channel.** The lit image carries an alpha channel (`propagateAlpha`, a film setting, off by default), and no
stage weighs a colour by it: the exposure meter, the local exposure, the grain and the composition read the colour as it
is. Off, the alpha is read by nothing and the image shown is opaque (`composeAt`, `lighting/deferred/shaders.ts`). On, it is
the share of the background the image leaves visible, an inverse opacity — 1 where nothing is drawn, 0 on a surface —, carried
to the image a capture holds: the colour pass writes 1 where no surface drew and 0 on every surface, the sky multiplies
it by what it lets through (nothing, where it draws), the fog, the clouds and the haze by their transmittance
(`lighting/fog/fogPass.ts`, `modules/sky/clouds/compose.ts`, `lighting/atmosphere/`), the translucent layers by their
transmittance and by the mean of the modulation's channels (`layersOver`); the temporal pass, the depth of field and the
bloom's glow keep it as it is, and the display's last link writes it beside the tonemapped colour. The subsurface
scattering gathers the diffuse light's luminance in it between the lighting and the recombine, which writes 0 back.

**The alpha holdout** (`primitiveAlphaHoldout`, with `propagateAlpha`, off by default; `blend/holdout*.ts`). With it on,
the translucent layers are drawn once more, from far to near, into a target of their own (`encodeHoldout`, once every set of
layers is drawn): it starts as the lit image's alpha in red, green and blue and 1 in its alpha (`holdoutStart`), and each
layer lays its output over it, `visibility = add + visibility · through`, `throughput = throughput · through`
(`HOLDOUT_TARGET`): a blend or thin-translucent layer lets `1 − opacity` through and adds nothing, a layer of blending
`'alphaHoldout'` adds its opacity as well, a layer that multiplies the scene lets `1 − opacity` through behind the fog's
transmittance squared, an additive layer touches neither, a layer that covers lets nothing through; the fog in front scales what a
layer adds by its transmittance and, where the height fog holds out, adds its own coverage of the layer's
(`fsBlendHoldout`, `fsTransmitHoldout`, `holdoutOut`). The visibility it ends with replaces the lit image's alpha
(`applyHoldout`) before the depth of field (`'beforeDepthOfField'`, the default) or, only where a layer left something, after
it (`'afterDepthOfField'`, `applyPendingHoldout`). The composition of the layers leaves the alpha as it is then: the
modulation target is cleared to an alpha of 1 (`MODULATION_KEEPS_ALPHA`). The sky holds out by drawing black, its alpha the
coverage of its air, with a blend that lays the coverage on the image's alpha (`SceneAtmosphere.holdout`; the haze adds no light
but dims), the height fog by adding none and the same blend (`SceneHeightFog.holdout`), the clouds by their `alphaHole` setting and
a composition that lays their coverage the same way (the cloud view-mode 3 only). The single-layer water is an opaque surface
for the alpha (alpha 0, or black with alpha 1 when held out). The object's `holdout` switch (`FLAG_HOLDOUT`, `PLACEMENT_HOLDOUT`)
makes its pixels black with an alpha of 1 and no surface record. With the support off, `propagateAlpha` alone makes a surface of
blending `'alphaHoldout'` raise the alpha as the standard blend does, the particles with it; with the support on the particles add
nothing to the accumulation.

**Agent tools.** `trillion3d_set_film` sets the 32 film settings, `trillion3d_set_color_grading` the 107 colour settings (the grade's eighty have a description of 60 characters or fewer, the meaning of each operation said once, in the tool's text: `llm/colorGradingMeanings.ts`), `trillion3d_set_ambient_occlusion` the occlusion's; their texts name each setting with its default, bounds and meaning, from the rules.

## Direct lighting

**The lit image's passes** (`lighting/deferred/`). The lighting draws the lit image in passes, one for each part
of its sum, each over the pixels that need it, in this order (`DeferredLighting.light`, `litProgram.ts`):

1. **The classification** (`classify.ts`, `classifyWgsl.ts`, one compute dispatch): a workgroup reads the surface flags of a tile of
   8 × 8 pixels and puts the tile in the list of the most demanding class of its pixels, `simple` (the standard
   physical model alone), `single` (another model, diffuse or toon, or a thin two-sided surface) or `complex` (an
   anisotropic or clear-coat lobe); a tile of background, unlit and as-is pixels is in no list. It writes the three
   lists and the arguments of the three indirect draws (`tileClass.ts`).
2. **The surface colour** (`colourPassWgsl.ts`, `surfaceColourMain`, a fullscreen draw that writes every pixel): the
   background where no surface was drawn, a surface shown as it is, an unlit surface's colour, and a lit surface's
   emission under the ambient occlusion.
3. **The sun** (`lightPassWgsl.ts`, `sunPassWgsl`): the scene's directional lights, by their ranks in the light buffer
   (`sunRanks`, written with the buffer), each with its shadow read in the frame's mask, the sun's distance-field
   shadow, the clouds' shade and its light function, added to the image.
4. **The local lights** (`localPassWgsl`): the lights of the pixel's cell of the light grid, the directional ones
   left to the sun, added to the image.
5. **The indirect light** (`indirectPassWgsl.ts`): the environment's and the sky light's diffuse light, the probes'
   bounce, the reflection and a thin surface's back (`thinBack`: the screen probes' backface light where they left
   one in the pixel, else the sky light's irradiance), added to the image.

Passes 3 to 5 draw tile quads, one indirect draw for each class (`tilePass.ts`), each class with a program that holds
only the code its pixels need (`CLASS_CUTS`): the `simple` one no diffuse or toon model, no thin transmission and no
lobe, the `single` one no lobe. A scene with no directional light draws no sun's pass, one with only directional lights no local
lights' pass (`DirectLightResources.suns`, `locals`, the store's counts). They add with a blend of one and one over the image; every pass pre-exposes its term and
holds it to 32256, as a base pass holds its output (`preExposedClipped`), so the image is the sum of the passes' terms. The
sum is not held, for a blend cannot read what it adds to: a pixel whose emission, sun, local and indirect terms are three or
more at the clip passes the 65504 a half float holds; the temporal resolve bounds the colour it reads for that
(`LARGEST_SCENE_COLOR`, `post/taa/colorSpaceWgsl.ts`).
One light term serves the two light passes and the translucent surfaces (`declaredLight`): the walk around it is the
only difference. The sky, the height fog (`lighting/fog/fogPass.ts`), the haze on the surfaces and the clouds follow
([Fog](#fog), [Atmosphere and sky light](#atmosphere-and-sky-light)), then the transparents.

A view of one lighting term (`lightView`, `LIT_VIEWS` in `visibility/shader/shadeMode.ts`) draws only the passes that
give it, the surface black before them: the reflection (1) and the bounced irradiance alone (4,
`BOUNCE_LIGHT_VIEW`, asked by the host with `lightingView` `'bounce'`) only the indirect pass, the lighting on a white
surface (3) the three passes, the shadows (2) a pass of the local lights' program that shows the share of the light
the shadows let through.

Any number of lights: a light grid lists each cell's lights once per image (`lighting/tiles/`), and
each pixel walks its cell's whole list (`lighting/direct/lightLoopWgsl.ts`), moving or still: the
shadow rays are the projection's, paid once, so the lighting never draws a subset. A frame with no
shadowed light runs a program built without the shadow code, and one with no rectangle a program
built without the rectangle code (`lighting/deferred/contractVariants.ts`); a rectangle that casts
counts as a shadowed local light, and as a rectangle. A sun's share is its layer of the
suns' mask at the pixel; a local light's is its four bits of the pixel's mask, the lane of the shadowed local lights of
its cell in the order the cell lists them (`vsmMaskLaneOf`), or, past the lanes the mask keeps
(`shadowOnePassProjectionMaxLightsPerPixel`), one sample of its own map. Shadows are [SHADOWS.md](SHADOWS.md).

The grid's cells are 64 pixels across and 32 slices deep (`gridSlices`, `LIGHT_SETTINGS`): the slice
of a depth is `log2(depth · B + O) · 4.05` (`gridDepthDistribution`), `B` and `O` solved each image
(`lighting/tiles/gridMap.ts`) so that the first slice starts 9.5 cm past the near plane and the last
10 cm past the farthest reach of a local light along the view axis — at least 10 m and twice the near
plane, at most 2 097 m (`gridFarFloor`, `gridFarMax`); every light and pixel beyond is in the last
slice, so no light is dropped. The map heads the grid's buffer (`GRID_HEAD_WORDS`), where the pass and
every reader of a list find it. A cell the pool has no room for walks every light, exactly.

A translucent surface, which no mask holds, reads each light's shadow in its own fragment
(`lighting/direct/shadowWgsl.ts`). By default (`shadowTranslucentQuality` 0) that is one sample of
the light's map at the surface's point, and only the sun's: a shadowed local light lights it whole
(`shadowTranslucentLocalLights` off) and its program holds none of the local lights' read. At
quality 1 it is the opaque projection's own trace, run for the fragment and dithered in a penumbra.
Both are project switches read once when the session opens (`frame/prepare/setup.ts`), compiled into
the translucent programs (`blend/pipelines.ts`); the pages they read are those the opaque pixels
marked — and, at quality 1, the sun's pages of the nearest translucent surface the image before drew
in front of each pixel, which the marking pass reads from the depth pyramid's front layer
(`lighting/shadows/vsm/frame/vsmFrontLayer.ts`) —, a page none holds falling back to the next coarser
level. A material can ask more of its own (`translucentDirectionalLightShadowQuality`,
`translucentLocalLightShadow`, `translucentLocalLightShadowQuality`): its marks ride the item's flags
(`TRANSLUCENT_SHADOW_MARK`, `translucentMarksFrom`) and the programs of a scene whose surfaces ask
nothing hold none of that code. A rectangle light lights a translucent surface as a point light at
its centre unless the switch `translucentRectLights` is on, the programs then holding none of the
rectangle shading (`blend/shader.ts:translucentLitKey`). [SDK.md](SDK.md#a-see-through-surface-reads-the-suns-shadow-with-one-sample)
tells the settings.

A lamp's light at a point is its mask times its falloff. The mask is zero at its range and one at
its centre (the inverse square's window, or the other law's `(1 - d²/R²)^exponent`), times a spot's
fade, the square of a saturated linear ramp in the cosine from the outer cone to the inner one. The
falloff is `1 / (d² + b)` with `b` a square centimetre on a surface, the fog cell's own in a medium,
and none in the light a bounce cache stores; a lamp that is not the inverse square has a falloff of
one. A tube and a sphere have the integral and the horizon wrap of their source (`emitterLength`,
`emitterRadius`, `emitterSoftRadius`); the horizon wrap takes the inverse square even where the
falloff is one. Where a sum is nothing — a point at the lamp's own centre, with no bias — the
reciprocal is nothing, never an infinity: that point takes no light from the lamp. The shares weigh
the diffuse and the specular parts of the term; both at one, the term is the plain one.

A rectangle's term is its integral over the polygon times its shadow's share and the colour the
translucent casters let through. Its shadow is read where the projection traced it: a surface the
projection culls (its normal further past the horizon than the sine of the half angle of the
rectangle's source, half its width) is the exact zero; a thin surface's back is lit from behind and
its normal flipped for the read, as a lamp's. A shadow catcher takes the rectangle's energy as its
form factor with no normal. The surface cache's lighting tests a rectangle that casts by one shadow ray through the global distance field toward its
centre, as any light, and the fog reads its shadow map where it sets `shadowsFog` (below).

A thin double-sided surface (`subsurfaceColor`) adds a transmission to each light's term
(`lighting/direct/thinTransmissionWgsl.ts`): the surface's colour times the light's energy times a wrapped
cosine, `(½ − N·L) / (3/2)²` held to 0..1, times a GGX lobe of α² 0.36 in the cosine of the view against the
light, `L` the direction toward the lamp's centre (the rectangle's centre, its energy its form factor with no
normal). It has no 1/π and no cosine of the front's: its peak is 0.589, and it reaches the lit front up to a
cosine of one half. The light's shadow is read once, for the front's term and this one.

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
is set, each local light's (`fogSun`, `fogLocal`); the translucent layers' own lighting reads it where
`lightFunctionTranslucent` is set, the translucency volume's injection where `lightFunctionDeferred` is.
The surface cache's light term (`declaredIrradiance`) multiplies what each light adds at a texel by the function (`irradianceTerm`): a light the function
dims to nothing casts none; where `lightFunctionBounce` is set,
the radiance cache's trace (the eye from the cascades'
uniform `BounceGrid.eye`) and the screen probes' scene trace (`TRACE_SCENE_LIGHT_FUNCTION`: binding 16, the
view's eye) bind the atlas, a stand-in elsewhere. The probes are traced again (`restart`) when the atlas changes
(`LightFunctionAtlas.changes`, `lightFunctionRevision`), so a material that reads `time` restarts them at each
image. The reflections' rays evaluate no light: a hit reads the surface cache's lit layer. The clouds' lamps take the light as it is.
The binding is the third storage texture of the translucent layers (a sampled texture
elsewhere). The stage's totals are counted by `gpu/core/stageLimits.test.ts`: 16 of 16 sampled textures,
8 of 8 storage buffers — the eighth is the lists of the [local fog volumes](#fog) —, 4 of 4 storage
textures (the translucency volume is the fourth, [Transparent surfaces](#transparent-surfaces)). The bounce's programs
take a sampled texture each: the radiance cache's trace 7 of 16 (7 of 8, 1 of 4), the screen probes' scene trace 16 of 16 (8 of 8, 3 of 4: the ray words and the probes'
points are read as the storage textures they are written through, and the surface cache's library is read for its depth and
its final light alone, `bounce/hitLayouts.test.ts`), their temporal pass 15 of 16 (5 of 8, 2 of 4), the
pool's kernels no sampled texture (5 of 8 storage buffers, 2 of 4 storage textures).

## Light that bounces

Dynamic, on by default (`bounce: false` turns it off): the world's probes hold a radiance cache, a map of the light by direction
in each, traced through the global distance field with the light the surface cache holds where a ray meets a surface
(`bounce/cache/`, `bounce/probeRayWgsl.ts`, `lighting/surfaceCache/hitWgsl.ts`), a count of probes a frame
(`bounceProbesPerFrame`, `bounce/`). The screen probes read it for the rays the screen and the near scene did not answer, and
light the pixels (below); no other grid of rays is traced for the world. The light of a hit is the cache's final lighting, which holds the direct light of
the declared lights, their shadows traced through the field, the sky and the cache's own radiosity: no probe lights a surface
itself, and no ray of the bounce walks a list of lights or casts a shadow ray of its own.

**Where the probes are.** Four levels of probes, each a cube of 48 cells a side centred on the eye and
snapped to its own cells: the first reaches 25 m, its cell 1.04 m, and each next level twice as far,
its cell twice as wide — 2.08, 4.17, 8.33 m (`cascadeLevels`, `cascadeSize`, `cascadeHalfExtentMetres`,
`cascadeBase`, `sdk-core/src/bounce/cascades.ts`). The cells never depend on the scene: a 20 m street is
twenty cells across wherever it lies and however large the district is, where a grid laid on the whole
extent made its cell a fraction of it. A level slides by whole cells with the eye. Beyond the last level,
the sky light answers (below).

**Probes only where the image reads.** A level holds 110 592 cells, the four 442 368; a probe is made
only for a cell the image reads, from a pool of 16 384 (`probePool`), all of it on the GPU, none of it read back to be
decided (`bounce/pool/`). An image that casts screen probes marks from their points once it placed them — the uniform
ones, one a tile, and the adaptive ones placed (`bounce/pool/poolMarkWgsl.ts`, `markProbes`) —: the pool's pass waits for
the placement (`frame/render/preLight.ts`: `placeScreenProbes`, `encodeQueuedBounce`, then `traceScreenProbes`), so the radiance cache's
update that follows fills every cell the probes read before they read it, however far the view moved. Each image that marks
finds for each the finest level that holds it — the rule the lit passes read the field by, the
normal bias a third of a cell included — and sets a bit for each of the eight probes around it; sky marks nothing.
An image that casts none marks from the points the last image cast; where that one cast none either, a tile of 16 pixels, one thread, takes the pixel its jitter picks and reads the
surface there (`markImage`). In the same pass (`bounce/pool/poolWgsl.ts`, the kernels in the order they run:
`releaseProbes`, `allocateProbes`, then the choice of the probes to trace) a probe whose cell left its level when the
level slid is given back, so is one nothing read for 8 marks (`probeKeptMarks`), and a cell marked with no probe takes
one from the stack of free slots, a cell marked again keeps its own; the probes given back come first, so a full pool
gives before it takes. A change of view owes `markJitter` marks, each another point of every tile, so a cell one point
missed is found by the next; a still, marked view costs nothing. A pool with none left refuses a mark: that cell goes
unanswered, and the next level or the sky light answers for it (`refusedMarks` in the diagnostic). Only a few counters
come back to the CPU, a few images late, through the readback ring (`bounce/pool/pool.ts`, no frame waits): the
probes alive, those holding nothing yet or short of their updates, the marks refused, the probes queued and the cells
marked; the series stays open while any are, which is all the CPU needs of the pool.

**What the lit passes read.** A table of one layer (`bounce/atlas.ts`) names the slot of the pool that holds each cell of each
level, by its remainder modulo the side, so that sliding by a cell changes only the entries that come in (written by `publishTable` of
`bounce/pool/poolWgsl.ts`). The table names a probe once its first trace was queued, and forgets it the moment it is given back; the
radiance cache's tags say which cell and level a map was made for, and a mismatch is as good as none. The screen probes find the
eight probes round a point in it and read their maps (`bounce/screen/cacheReadWgsl.ts`).

**What is traced, in what order.** A probe that holds nothing yet comes before every refresh: the finest
level first, the cells nearest the eye first, up to the frame's queue of 2752 probes (176 128 rays of 64)
rather than the count: a sixth of the pool laid in rows of 64, so that a view moving fast fills every cell it
reaches in the image that first reads it. The probes already traced take what the count leaves, by the priority a light
cache gives them — the longer since a probe was traced, over its level plus one, in log₂ buckets, the most
important filled first (`bounce/pool/poolWgsl.ts`: the histograms of costs and the cuts the budget stops in) — each until it took `settledTraces`
updates since the lights last changed: then the series closes and the frame holds. The count is a
number of probes, `bounceProbesPerFrame`, 100 by default and at most the queue — not a duration: the
probes of a frame run side by side and the pass lasts about as long as its longest ray, so the time of a
batch does not follow its size, and a servo on it starved the field (`passMs` in `metrics.bounce`
publishes the last duration of the pass, and steers nothing). The reference mode traces the whole queue.

A probe's ray that leaves the scene reaches the sky (`lighting/atmosphere/skyReadWgsl.ts`): the share
of the ray the scene lets through times the radiance of the sky light's cube in its direction, the
sky above the horizon, the sky light's ground colour below it, black by default — where a sky light
gives it (the sky module's `skyLight` part), none else, whatever the atmosphere draws. The maps thus hold the sky the scene lets through: a street is
lit from above, an arcade is not. A pixel the screen probes read takes the sky light's diffuse light from them, never added again beside the
environment; a pixel they did not read takes the sky light's own unoccluded irradiance (`bounce/applyWgsl.ts`), so the image shows no hole
while the probes fill. A scene with no sky light has no unoccluded light to give there: its
environment (ambient, hemisphere) is the pixel's own term. With a sky light that
captures in real time the probes wait for its first capture, so none holds a sky of none. With the bounce off, or no lamp to bounce, the sky light lights with its unoccluded
irradiance everywhere.

A cell no probe holds, or a probe never traced for it, as
on the first image or after the eye jumped, answers "not yet": the next level reads, and, past the last, the sky light, never dark. A surface a probe's ray, a screen probe's ray or a
reflection hits is not read by the probes: it is read in the surface cache (`lighting/surfaceCache/hitWgsl.ts`), the final
light of the card texels near the hit, which the cache's own lighting keeps up to date from the lights, the sky and its radiosity, so
that a surface out of view has its light and a second bounce of its own. A hit where the cache holds no card, or no card
of the object's mesh cards covers the point, is dark, and fills as the cards are captured. The frame's
bounce counts publish how many probes are alive and how many hold nothing yet (`liveProbes`,
`unfilledProbes`, zero once the light the image reads is filled), and the probe series stays open until
none is, until every probe has its updates and the marks owed are in.

A probe's ray is cut at `rayReachMetres` (200 m by default), past which the sky answers. It leaves the probe's centre, from the
nearest a probe's ray starts at, the diagonal of the probe's cell, so that no ray finds what the probe stands in, and is marched
through the global distance field (`gdfTrace`, [Distance fields](#distance-fields)) as far as that reach: at most 256 steps a
clipmap, a surface expanded by the largest distance the march read, a ray stopped on a sample no mesh covers by noise
drawn at the texel and the image's turn; a ray that starts
inside a surface brings back no light. The light of its hit is read in the surface cache at the point the march ended at
(`scGlobalHit`): the field's gradient gives the face, the object grid's cell one voxel off it the objects near — up to four, the
nearest first — whose mesh cards are read, three voxels wide, until the weights they gave reach 0.9, the cone of the ray at the hit
its radius, the coarsest page of a card, always resident, and no feedback written (a probe's ray asks no finer page; only the
reflections' do). The marks follow what the image draws: a view that stands still but whose cut refines, or whose pages arrive,
marks the cells of its new surfaces again (`lighting/bounce/pool/pool.ts`, `frame/render/encodeLights.ts`). The
frame metrics publish the state of the pool as `metrics.bounce` (`BounceFrameMetrics`): whether the probes
exist, the probes alive, those still unfilled, the cells marked and refused, the probes queued, and the placements that hold a box
(`geometry/dag/placement/placementBoxes.ts`, whose extent the rays' reach is laid on: no triangle of the scene is loaded or posed for the bounce).

**What the pixels read of the screen probes** (`bounce/screen/`, settings `screenProbe…` in `bounce/screenProbeOptions.ts`).
A ray of a screen probe the screen did not answer is answered by one scene stage (`traceSceneWgsl.ts`, one pass, one
kernel), in the order of the reference: the ray is marched through the global distance field from where the screen lost it (two
biases back) as far as the range the radiance cache is trusted to (`spLocalReach`), a hit giving the final light of the surface
cache at the point (`scGlobalHit`; the hit's light fading in over its first voxel and a half, so that a ray never reads its own
surface), and the radiance cache is read (`cacheReadWgsl.ts`), the environment where it covers none, for the ray the march left, its
distance the end of the ray; the cache is never read for a ray the march stopped, and no pass of its own reads it. The
switch `screenProbeSceneTraces` turns the march off: the screen, then the radiance cache alone. The stage asks for the surface cache
(`demandSurfaceCache`) as the reflections do. What a pixel keeps is one `rgba32uint` texture of four words (`SCREEN_PROBE_FORMATS.history`), the lighting's one binding
(`screenIndirect`), each word accumulated over the frames by the temporal pass (`temporalWgsl.ts`) like the irradiance:
the diffuse light; the light of the pixel's rough specular reflection; the light at the back of a thin double-sided sheet that
transmits light; and the direction of open sky the short-range occlusion found, beside its amount. The rough specular is
four samples of the pixel's GGX lobe (visible normals, Hammersley points turned by the pixel's noise) of the radiance of the
probes the pixel reads, each weighed by the share of its direction the pixel's open sky leaves (the occlusion's bent normal and
amount against the hemisphere), tone-mapped, bilinear in the probe's octahedron, mixed toward the diffuse light over pi by the roughness
(`integrateWgsl.ts`, `SP_ROUGH_SPECULAR`) for a pixel at or under `screenProbeMaxRoughnessToEvaluateRoughSpecular` (0.8;
`…ForFoliage` for the sheets that transmit, 0.8): the world's probes no longer light the specular of the opaque pixels whose
reflection ray is not traced, the reflections' resolve reads it (`screenRoughAt`, under `screenSpecularOcclusion`). A pixel
that carries physical lobes (a clear coat, which the surface flag does not tell from an anisotropy) never takes the shortcut of a
reflection traced whole: the base lobe under a coat casts no ray, so its rough specular is evaluated on the base normal and roughness. The back of a
sheet is the irradiance of the probes along the opposite hemisphere, gathered where `screenProbeTwoSidedFoliageBackfaceDiffuse`
is on and the level allows it (`high` does not, `ultra` and `cinematic` do), the pixel's own side otherwise
(`screenBackAt`). The short-range occlusion keeps its bent normal — the mean of the unoccluded directions of the horizon search,
turned onto the pixel's frame, 11 + 11 + 10 bits with its amount in the fourth word — where `screenProbeBentNormal` is on and
the level allows it (`ultra` and `cinematic`): the temporal pass blends it by its direction and its amount, and
the specular occlusion is the share of the reflection's cone the cone of open sky covers. On the pixels of a thin double-sided
sheet the amount is mixed toward 1 by `screenProbeOcclusionFoliageStrength` (0.7 by default), the light scattering through the sheet,
before it is blended with its history (the neighbourhood it is held to is mixed the same way). A pixel the probes did not read has a
zero alpha and the lighting reads the world's probes, as before.

**The reflections' rays** (`lighting/reflections/`, settings in `contracts/reflectionOptions.ts`, levels in
`contracts/reflectionLevels.ts`). A level (`reflectionQuality`) sets the side of the blocks of pixels a grid texel
traces one ray for: one pixel at the default level and the cinematic one, 2 × 2 at `high`. A classification pass
lists, each image, the tracing tiles of 8 × 8 texels where a pixel's lobe is under the roughness a ray is cast for
(`reflectionMaxRoughnessToTrace`), and, for the pixels, the resolve tiles of 8 × 8 pixels where one traces —
`block` of them a side in a tracing tile — and the others, which the field answers alone. The transparents' front layer is
traced like an opaque surface only where the level allows it and the level or the project asks for it
(`reflectionFrontLayer`, false by default: never at `high`, always at `cinematic`); without it a transparent
surface reflects the environment, and its front pass writes the covering depth
alone, not the reflecting surface, so the front layer's normals, lobes and grids are never made. The front pass draws
only where a feature reads what it writes: the front layer's reflections (`reflectionFrontLayer`), the depth pyramid's
fold of the transparents (`hizFoldTransparents`) or the shadow pages the translucent surfaces mark
(`shadowTranslucentQuality` 1, `markingFrontLayer`); with none of them, no transparent run is drawn a second time.

The screen's answer to a ray is the last lit image at the texel the hit lands in, one point of its level 0
(`reflectionSeenAnswer`), the denoiser averaging the rays; the image is read as it is, no filtered level of it is built, and
the two HDR targets that take turns hold one level each (`litImage.ts`: `holdLitImage`, `adoptLitImage`). A pixel traced
at full resolution accumulates its history over two images when it is a mirror, widening to `reflectionMaxFramesAccumulated`
with the roughness of its top layer over 0.05. A pixel whose lobe casts no ray (rougher than
`reflectionMaxRoughnessToTrace`) reflects the surroundings through its lobe and, where the screen probes read it, the
screen probes' rough specular, which the opaque resolve adds (`resolvedIndirect`: `screenRoughAt` under
`screenSpecularOcclusion`, the surroundings giving way to it where the probes hold the sky), the share of a lobe in the band over which its ray gives way
(`reflectionRoughnessFadeLength`) as well, the resolve reading the share no ray answered from the alpha of the reflection target
(`reflectionLeftShare`); the environment alone answers the transparents and the part of a ray the scene did not settle, the sky light's
where one shines, as the reference's rays that miss take it.

The scene stage of a ray the screen left (`sceneTrace.ts`, `reflectionSceneTrace`) marches the global distance field
(`gdfTrace`, [Distance fields](#distance-fields)) from where the screen stopped knowing the ray, less four half voxels of
the clipmap that holds that point, to the longest ray (`screenProbeMaxTraceDistance`), the scene's edge or the surface the
screen met, whichever is nearest: the surface is expanded by the largest distance read, not by the ray's time, and the
step is the distance times a factor the pixel's noise draws between 0.95 and its reciprocal near a mirror (whole from a
cone of π/256). Where it meets a surface, the surface's light is read in the [surface cache](#surface-cache)'s final
lighting (`scGlobalHit`, `surfaceCache/hitWgsl.ts`): the field's gradient gives the face, one voxel of the hit's clipmap along it the
field's object grid gives the cell of the objects near the hit, up to four, and the cards of each are read in turn — at the
hit, three voxels of the clipmap wide, on the finest page of a card that is in the atlas (`reflectionHiResSurface`, on; off, the coarsest), the radius of the ray's cone
at the hit (the lobe's and the pixel's) — until the weights they gave reach 0.9; the light is the sums over their weight.
An object of the grid is named by its instance, which the table of `hitInstances.ts` turns into its placement in the cache
(the several stand-ins of one HLOD root answer to one instance and are told none). Where the lit image agrees with the depth at the hit it
is taken instead (`reflectionSampleSceneColor`), and the light is fogged along the ray; a hit no card gave any weight of
answers nothing, and the ray goes on to the probes' field. A march that meets nothing leaves the scene: the screen is looked at once more
from where the ray leaves the field's outermost clipmap (`gdfClipRayOutside`), then the environment answers. The scene
trace has one switch, `screenProbeSceneTraces`, shared with the screen probes; while it is on and the level traces, the
field takes the sizes of rays marched through it (`sizeForTraces`), the surface cache and the field's object grid are asked
for (`demandSurfaceCache`, from the image the trace runs in, so the cache serves the next) and the rays write the cache's feedback. The scene stage binds the
field's six resources (`REFLECTION_FIELD_WGSL`, bindings 39 to 44 of the trace's group 0), its object grid (54), the cache's tables, its
depth and final layers and its feedback buffer (45 to 53, the albedo, normal, emission, direct and indirect
layers, which no hit reads, left out of the layout), and the table of the placements (55): its sampled textures fourteen of the
sixteen WebGPU guarantees, the ray words and the partial answers being read as storage textures for that: a scene with no distance field binds
the stand-in of one with no clipmap (`createNoFieldRead`) and its rays answer nothing, one whose cache is not made yet the stand-ins of `hitCards.ts`
(a hit then finds no card). What the scene stage returns — the light of a hit, or the sky a ray reaches — takes, before its fog and under the ceiling
of a ray, the sky light's diffuse light at the hit's normal (the zero normal for the sky) times `reflectionSkylightLeaking` (0 by default: none), its tint (`reflectionSkylightLeakingTintRed`, `…Green`, `…Blue`, white by default) and the average
albedo of a hit (`reflectionSkylightLeakingAverageAlbedo`, 0.25) (`reflectionSkylightLeak`, `rayLightWgsl.ts`; the normal of the hit, not the ray's direction). The census counts each ray once by
how its march ended and the steps the marches took (`ReflectionFrameMetrics.sceneEnded`, `sceneWork`), and only where
`reflectionStatistics` is on (false by default, read when the session opens): the kernels are compiled without the counting and bind no
buffer for it otherwise, and nothing is read back.

## Subsurface scattering

**Subsurface scattering** (`lighting/subsurface/`). After the lights and before the sky, a view whose surfaces may carry a
subsurface-profile pixel (`SurfaceBuffer.hasSubsurface`) runs `encodeSubsurfaceScattering`. The lit image holds, per pixel of the
model, the colour (diffuse and specular light) and in its alpha the luminance of the diffuse light (or, with the checkerboard,
the diffuse light on one pixel of two); the surface holds the profile (`x`) and opacity (`w`) in its per-model data. The pass is
tiled in 8 × 8 texels of the scattering's resolution (the image's, or its half): `sssMark` sets a bit a tile in three masks (any
profile pixel; all of them scatter inside their own footprint, "pass-through"; the others), `sssLists` builds each mask's list in
z-order, `sssArgsTiles` the arguments of the indirect dispatches and draws. The setup writes the diffuse light, the depth in
centimetres and the profile of each pixel (`sssSetupMain` over the scattering tiles, `sssSetupPass` over the pass-through ones, into
the last target), lists the scattering tiles by how their pixels scatter (sampled or separable) and `sssArgsScatter` sizes the mip
chain (six levels, a bilinear 2 × 2 filter with a zero border) made when the sampled tiles reach `subsurfaceBurleyMipsMinTileCount`.
The sampled scattering (`sssSampledScatter`: a group reads its ten by ten texels into memory, each pixel draws a count of samples
from its history's variance, radii from the profile's distribution, angles from the R2 sequence, a mip from the sample's density,
and weighs by the diffusion profile over the density, the normals and the depth) and the separable one (`sssSeparableHorizontal`,
`sssSeparableVertical`: the profile's kernel, a boundary tint where the profile changes) leave the scattered light in two targets;
`sssVariance` updates the quality history (a pair of textures, reprojected by the camera and the velocity stage) of the sampled
pixels. The recombine draws a quad a tile of the `all` list into an image of its own, rebuilding the diffuse and the specular
light (`sssReconstruct`), mixing the diffuse with the scattered by the profile's tint and multiplying by the base colour, and the
copy writes it over the lit image (nothing is read where it is written). A list longer than 65535 tiles wraps its dispatch onto a
second axis. The profile ids are stored as `r8uint` where the device grants `texture-formats-tier1`, else `r32uint`. With the scale
at 0 only the reconstruction is drawn, over the whole image.

## Ambient occlusion

**Ambient occlusion** (`lighting/ao/`). After the depth pyramid and the screen probes, before the lit image's passes, a view
that draws it makes the passes of one of two methods (`AoMethod`: what it asks of a view, whether its programs are ready,
its passes). The disc search makes up to five fragment passes: the setup of the half and of the quarter (the four
surfaces a pixel stands for, the farthest of their depths, their normals averaged by how near each depth is to it), the
search at each coarser resolution (an `rgba16float` setup in, an `r8unorm` occlusion out), and the last pass at the
image's size, which reads the surfaces and the depth directly, blends the coarser result in by depth and normal, fades
it, raises it to the power and weighs it by the intensity; at one resolution the last pass is alone, its taps reading the
depth pyramid's cells (the farthest opaque depth of a block of pixels, never the transparents' front). The compute option
makes that last pass over the depth's normals with no blur among a quad, and a smoothing pass after it. The horizon
search makes four passes: the search with its integral, the spatial filter — a compute pass, a workgroup of 16 × 8 pixels
loading its tile of the occlusion and the depth once, into a float texture it writes, **the value stored held to [0, 1]**
as the reference's 8-bit target holds it, before any bilinear read — the temporal filter (which reads the history of the
last image through the camera's motion, or the surface's vector where it moves by itself, and writes the other of two
textures that take turns; the history, kept on the view's state, is white outside its texture) and the upsample. The
colour pass and the indirect pass read the last texture by load and multiply the emission, the sky light's diffuse and, where it is
asked, the screen probes' light by it (`ambientOcclusionApplied`); an image with the occlusion off reads a one-texel
stand-in and a view word at 0, and is lit as it was, bit for bit.

**The horizon history settles before the view rests.** The temporal filter keeps `1 − blend` of its history at each image,
so after `n` images the first image weighs `(1 − blend)ⁿ`: the history is within a tenth of what it converges to after
`ceil(ln 0.1 / ln(1 − blend))` images (`settlingImages`, 22 at the default blend of 0.1; 1 for a blend of 0 or of 1 or
more). The history counts the images drawn on it since it was last dropped (`HorizonHistory.images`: a cut or a remade view
starts the count again, a change of intensity does not), and a view whose horizon occlusion is on, temporal and drawn is
not held — it is drawn again, whatever the temporal anti-aliasing does — until it has them (`ambientOcclusionSettling`, the
`'occlusion'` reason of `frame/loop/unsettled.ts`, as the screen probes' own settling). The history reprojects by the
view's previous camera (`frame/backend/state/previousCamera.ts`) where its last image is the one before, and starts
again as after a cut where it skipped one.

Not drawn where the bounce is on (the probes' short-range occlusion is the one there), nor in an image whose depth was not
drawn, a diagnostic view, or an unlit view. Memory: the textures at the size of the render targets are counted in the
view's bytes and refused by the budget like the screen probes' — one admission sequence for every such view
(`ledgerAdmitted`: the held allocation's bytes credited, the held one given back whichever answers), the bytes asked being
those of the same list of allocations, counted (`ResourceAllocator`). The passes' bind groups are kept by the engine's one
bind-group cache, one set for each of the resources the view has met.

## Distance fields

A mesh whose `meshBuild` sets `distanceField` (true by default, as in the reference's gameplay templates; the settings are in
[COMPILER.md](COMPILER.md#distance-fields)) gets a signed distance field: bricks of 8 × 8 × 8 bytes around its
surface, 7 voxels of each its own and the eighth the trilinear filter's, a voxel the distance to the surface in
the band of four voxels either side, three mips, the coarsest always loaded. The compiler writes every mesh's in
`distanceFields.bin` (`asset-compiler-rust/src/distance_field/`), named by the manifest's `distanceFields`
section; `sdk-core/src/lighting/distanceFieldFile.ts` reads it (`parseDistanceFields`: per compiled mesh, or HLOD cell, its box,
and per mip the indirection table, the bricks, the distance scale and bias, the volume-to-virtual-coordinate
scale and add).

The global distance field composites them into clipmaps around the viewer: `sdk-core/src/lighting/globalDistanceField.ts`
places them (`clipmapExtent`, `pageAtlasSizeInPages`, `updateFrequency`) and
`contracts/globalDistanceFieldOptions.ts` holds the reference's settings with their defaults (4 clipmaps of 128
voxels, an extent of the view distance 20000 cm over 8 doubling for each next, mips by 4, pages of 7 voxels, the
static meshes composited apart, two clipmaps updated a frame; lengths in centimetres, as the sky light's).
`lighting/distanceField/globalReadWgsl.ts` reads them: `gdfSample`, `gdfDistanceToNearestSurface`,
`gdfConeTrace` and `gdfSkyVisibility`, the fog's sky visibility (one 45 degree cone straight up, ten steps);
The reads bind six resources, consecutive from a first binding: the view block (`GdfView`), the page table
(`texture_3d<u32>`), the page atlas as a buffer (a read-only storage buffer of bytes, the coverage atlas past its pages),
the coarse mip (`texture_3d<f32>`, `r32float`), the page atlas as a texture (`texture_3d<f32>`, `r8unorm`) and its
sampler (linear, repeating); the one of the two page atlases the device does not keep is a stand-in of one texel, and the
view block's flag says which is read (`gdfAtlasSample`); a position is carried to the field's translated space by `gdfTranslated` first. A pass
takes their layout entries and bind group entries from the scene (`readLayoutEntries`, `readEntries`) and makes its
group again when `readGeneration` changes. `lighting/distanceField/representationWgsl.ts` tells whether a pixel's surface has a field
(`hasDistanceFieldRepresentation`, `screenTraceDepthThresholdScale`):

```ts
import { globalDistanceFieldReadWgsl } from './lighting/distanceField/globalReadWgsl.ts'
const read = globalDistanceFieldReadWgsl(/* group */ 2, /* first binding */ 0)
// in a program: let visibility = gdfSkyVisibility(gdfTranslated(positionInCentimetres), vec3f(0.0, 1.0, 0.0));
```

The sky light's occlusion by the field (`lighting/distanceField/ao/`) is drawn (`encodeSkyOcclusion`, in the
pre-lighting step, after the distance fields' update and the depth pyramid and before the sky light's read uniform is
written) when the sky light is dynamic and casts shadows, the bounce is off — with it on, the probes carry the sky and
the screen probes its visibility — and the scene has distance-field objects (`skyOcclusionGate`): the normals and depths
of the scene at half resolution (`dfaoNormals`); nine cones over each surface's hemisphere, traced at a quarter of that
resolution against the global field from the sky light's distance on (`globalDistanceFieldStartDistance`, 100 cm) — and,
at the high quality (`distanceFieldOcclusionQuality` 2), against the meshes' own fields up to it, their screen tiles
listed by drawing each culled mesh's bounding sphere —; the cones' visibilities combined into a bent normal; the bent
normal upsampled by the surface's plane and normal and filtered over time (`distanceFieldOcclusionUseHistory`, a history
weight of 0.85, a stability pass that fills what dropped its history). The settings are
`contracts/distanceFieldOcclusionOptions.ts`, each with its default. The last pass
packs the image into a buffer, two words a cell (`dfaoPack`, `packWgsl.ts`): the lit pass has no sampled texture left, so it
reads the image from a read-only storage buffer and a uniform of its own (`DEFERRED_BINDINGS.dfaoBent` and `dfaoRead`,
`writeDfaoRead`), stand-ins where the image drew none.

The indirect light's pass applies it, in a program that holds the code (`indirectPassWgsl` with `skyShadowing`,
`createContractVariants`): made at the first image that has the occlusion, it lights that image once compiled, the program
without it lighting the image meanwhile; no other program holds the code or declares the two bindings — not the indirect
program of an image without the occlusion, not the light passes, nor the translucent layers'. A pixel reads the image
once (`dfaoBentNormal`): the four cells round its place weighed by their bilinear share and by `1 / (|their depth − its
depth| + 0.0001)`, the place held to the view, the result faded to the pixel's normal from the farthest pixel lit
(`distanceFieldOcclusionMaxViewDistance`, `distanceFieldOcclusionViewFadeDistanceScale`). The sky light's diffuse light
(`skyLightVisibility`) then takes the bent normal's length as the share of the sky seen, through the contrast curve (a
logistic of `contrast · (10 · visibility − 5)` brought back to 0 .. 1), the exponent and the least occlusion of the light's
settings, combined with the material's and the screen's occlusion (`occlusion.sky`) by the least or the product; it is read
along the normal turned toward the bent normal by the visibility lost, scaled by the visibility times `mix(dot(bent
direction, normal), 1, visibility)`, and lifted by the tint times what was lost (`environmentLightingOccluded`; the scene's
own environment keeps its occlusion). The sky's reflection goes under the specular occlusion
(`skyLightSpecularOcclusion`): the bent normal's length, or the intersection of the reflection's cone (half angle
`max(roughness, 0.1) · π`) with the open one (`length · π` over the strength), smoothed and shadowed outright as the open
angle falls under 0.1 .. 0.3, lifted by the least occlusion, a two-sided surface taking the length either way. It reaches the
share the reflection's trace left to the field, the surroundings through the base lobe (`REFLECTION_PROBES_LEFT`), the sky
light's own specular light, with the tint of what it took added and weighed by the pixel's reflectance
(`resolvedReflectionOccluded`); what the screen, the march through the field answered, hits of the scene, is left as
it is. Not applied: a thin surface's back lighting, which reads the sky unoccluded; the diffuse occlusion of an indirect
irradiance, which only the mixing of a baked irradiance with reflection captures reads, and the engine has none.
The meshes' fields are read through `meshFieldWgsl` (`loadDfObjectBounds`, `loadDfObjectData`, `dfAssetMip`), the one reader
of the placements' records; the sky light's read takes how the image is applied from the occlusion's state
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
  changed for the global field, per cache (static, movable). The world DAG is one root of the cut (one
  for each placement of its model), drawing every HLOD cell's actor at once, so it places no mesh itself:
  each HLOD cell's field (`MeshDistanceField.hlodCell`, one per cell the layer's `allowDistanceField` gave
  one, in the world's space, [FORMAT.md](FORMAT.md#distance-fields)) is placed by a stand-in for the root
  (`lighting/distanceField/hlodObjects.ts`): at the root's world matrix, with its mark (the world DAG's: the
  shell casts, and a sun's far-shadow test reaches it), one for each instance of the world DAG and each cell.
  A stand-in is read by the tracker only while the cut draws the cell's actor (`WorldCells.draws`, the cell's
  word `CELL_DRAW.hlod`): a cell shown instead of its actor, or an actor not loaded, holds no placement and
  no room in the brick atlas and casts nothing; an actor drawn again is placed again, its coarsest mip taken
  first. The sun's distance-field shadow therefore draws a shell's field exactly where the shell is drawn.
- **Atlas** (`atlasState.ts`, `atlasRequests.ts`, `atlasGpu.ts`, `brickUpload.ts`, `streaming.ts`,
  `streamingWgsl.ts`): the coarsest mip of a mesh is loaded with its first placement; the GPU asks each frame for
  the mips its nearest placement wants (the outer clipmap's box: two mips; the clipmap half way in: three), the
  answer comes back through a ring of four staging buffers, and the mips that fit (`meshDistanceFieldBrickAtlasDepth`,
  `meshDistanceFieldUploadKiB`) are loaded a frame later, in blocks of `meshDistanceFieldBlockBricks` bricks of an
  `r8unorm` 3D texture, their indirection tables in one word buffer allocated first fit.
- **Clipmaps** (`updateRegions.ts`, `regionBounds.ts`): the centre snapped to a page, the scroll, the update regions
  (modified boxes that reach the clipmap, the slabs the camera uncovered, the static clipmap's for the movable
  one), the whole composition when needed, the frequency and phase of each clipmap's turn.
- **Passes** (`globalUpdate.ts`, `cullWgsl.ts`, `allocateWgsl.ts`, `composeWgsl.ts`, `coverageWgsl.ts`, `objectGridWgsl.ts`,
  `mipWgsl.ts`), per cache, in the reference's order: placements culled to the clipmaps; update regions to page tiles and
  culling cells; placements culled to the cells; pages allocated from the free list, and returned; pages composited, a
  voxel the nearest distance of the placements within the influence range, a byte over twice the range, the nearer of it
  and the static page under a movable one; while rays are marched through the field (`traced`), the coverage of the pages
  composited (`coverageWgsl.ts`: a group a page, a thread every second voxel along each axis, the 4 × 4 × 4 lattice; a voxel
  reached by a mostly two-sided placement and by no other within four voxels has a coverage of 0, else 1, written to the
  coverage atlas, four bytes of a row to a word, and one such voxel in the page sets the page's top bit, none clears it; the
  static page's voxel under a movable one counts by its own coverage in the atlas) and then, while a pass reads it
  (`grid`: the surface cache is asked for, `demandSurfaceCache`), their object grid
  (`objectGridWgsl.ts`: a group a page, a thread each of its 4 × 4 × 4 cells, of two voxels along each axis; a cell keeps
  the four objects whose surface lies nearest its centre within 1.44 of its extent plus three voxel extents, a word each, the
  object's row in 24 bits and its distance in 8, sorted; a movable page's cell begins with the static page's; the buffer is
  64 cells of 16 bytes a page of the atlas, held to what the device binds; `gdfObjectGridCellAt` reads the cell of a position,
  the read a hit evaluation adopts); the coarse mip propagated in five steps. The page tables are `r32uint` volumes, the mip
  an `r32float` volume. An indirect dispatch's arguments are written from counters by a one-thread pass, so a count past the
  device's workgroup limit runs in rows.
- **The page atlas** is a 3D texture of bytes (`r8unorm`, 128 × 128 pages of 8 × 8 × 8 voxels to a layer of 8 voxels,
  a page at the place its index splits into: x in 7 bits, y in 7, the layer above) written by the composition in place and
  read with the hardware's trilinear filter (`atlasFetchWgsl.ts`, `gdfAtlasSampleTexture`) where the device grants the
  feature `texture-formats-tier2` (read-write storage textures of 8-bit formats; § 25.19 and § 25.20 of the WebGPU
  specification, https://www.w3.org/TR/webgpu/#texture-formats-tier1; the format in WGSL needs the extension
  `texture_formats_tier1`, https://www.w3.org/TR/WGSL/#texel-formats). The session asks for it with the other optional
  features (`session/gpuDevice.ts`, `gpu/core/textureFormatsTier.ts`). A device without it keeps the atlas as a buffer of
  bytes, a page after the other, read with an explicit trilinear filter (`gdfAtlasSampleBuffer`) — the composition then
  gathers four voxels of a row into a word, since a buffer holds no byte store. Both paths are made from the one set of
  resources and the one text of the reads; the view block's flag chooses. The coverage atlas is a buffer on every device,
  past the pages' bytes (`coverageBase`, the word of the view block it begins at; 0 where the pages are a texture): as a
  second texture it would be the seventeenth sampled texture of the reflections' scene stage, as a buffer of its own one
  more of the eight storage buffers every consumer of the field has to spare.
- **The coverage atlas needs no atomics on textures.** A page's flag is set by an atomic OR into the page table when the
  eight groups that composite a page each add to it, which asks a platform that gives atomics on volume textures (Metal's
  newer shader model does, its older one does not). WGSL has atomics only on storage buffer variables and in workgroup
  memory (§ 6.2.8, https://www.w3.org/TR/WGSL/#atomic-types), none on a texture, and WebGPU has no feature that adds them.
  Here a group takes a whole page and its single thread writes the flag with a plain store, after the workgroup's own
  atomic OR over the lattice, so the atlas is built wherever rays are marched, on every device.
- **Reads**: the positions `globalReadWgsl.ts` takes are translated (`gdfTranslated`, the view's translation added to
  a world position in centimetres); the bindings are the view block, the page table, the atlas buffer, the coarse
  mip, the atlas texture and its sampler (`readLayoutEntries`, `readEntries`; they change with
  `readGeneration`).
- **Rays** (`globalTraceWgsl.ts`): `gdfTrace` marches a ray through the clipmaps from the finest that holds its start:
  at each step the coarse mip, then, near a surface, the page filtered, a flagged page having the coverage the coverage atlas
  gives at the sample, filtered (`gdfCoverageSample`, the lattice's 3 voxels across the page's 7), 0 whole with
  `globalDistanceFieldSimpleCoverageBasedExpand` (false by default); the surface is expanded by half a voxel scaled by the
  coverage (`globalDistanceFieldCoveredExpandSurfaceScale` 1, `globalDistanceFieldNotCoveredExpandSurfaceScale` 0.6), the least
  step by `globalDistanceFieldNotCoveredMinStepScale` (4) where it is 0, a dithered ray stopped there by noise under
  `globalDistanceFieldDitheredTransparencyStepThreshold` (0.5) and `…TraceThreshold` (0.9), at most
  256 steps in a clipmap (`GLOBAL_DISTANCE_FIELD_TRACE_MAX_STEPS`). `gdfNormal` is the central difference of the pages,
  `gdfClipRayOutside` draws a ray out of the outermost clipmap. While rays are marched the field takes
  `globalDistanceFieldTraceResolution` (252 voxels) and `globalDistanceFieldTraceClipmapExtent` (2500 cm, each next
  clipmap twice the one before) in place of its own sizes, and the clipmaps the options ask plus one where the extent of
  the next reaches `globalDistanceFieldTraceViewDistance` (20000 cm; 40000 gives a fifth, 80000 a sixth), plus two where
  the extent of the one after that does; its pages keep the coverage atlas, and the object grid while a pass reads it
  (`resourceShape` carries both, so a field composited without them is made again). The atlas as a buffer, the coverage
  atlas with it, holds the pages the device binds in one buffer at most, fewer than the settings ask where they ask for more.
- **Not carried over**: the reference's landscape heightfields belong to landscapes; this engine has none.

```ts
const scene = createDistanceFieldScene(device, fields) // fields: parseDistanceFields(bytes)
scene.occlusionDistance = 600 // the sky light's occlusion distance, centimetres
// each image, before the passes that read the field:
scene.update(
  encoder,
  {
    roots,
    moving: (rank) => false,
    epoch: 0,
    origin: eyeInCentimetres,
    frame,
    delta,
    traced: false,
  },
  settings,
)
device.queue.submit([encoder.finish()])
scene.submitted()
```

**The sun's distance-field shadow** is a pass of the image (`encodeSunFieldShadow`, after the depth pyramid
and before the lighting; the test that leaves the meshes out of the shadow maps and the cascade's settings are
in [SHADOWS.md](SHADOWS.md#far-casters)). For each sun that has one: the meshes of the scene culled to the
cascade's hull (the slice of the view between its depths, extruded toward the light) and to the class the
shadow maps leave out; their boxes drawn into a grid of tiles across the light, counted, given runs of one
list and written; a ray from each pixel of the half-resolution result through the meshes of its tile,
stepping the fields (at the qualities 2 and 3 a thin transmitting sheet keeps, at each step, the light the thickness it
has gone through lets by the density of an opacity of 1, so that it is never wholly shadowed); a bilateral upsample into a mask of four bytes a pixel, which the opaque resolve reads as
a storage buffer and multiplies the sun's shadow-map share by (the least of the two). Its buffers grow with
the largest grid, the meshes and the lights of the frame and are given back the first image nothing is drawn.

## Surface cache

The compiler gives each mesh a few **cards** (`meshCards.bin`, [FORMAT.md](FORMAT.md)): flat boxes along its faces, each
looking at the mesh along one of the six axis directions. The surface cache keeps the surface each card sees — its albedo,
its normal, its emission, its depth — in one **atlas** of 4096 × 4096 texels (`surfaceCacheAtlasSize`), cut into pages of
128 × 128, so that a ray that hits a mesh reads the colour of the surface where it hit, not one colour for the whole mesh. A
card is kept at a resolution that follows its size on the screen (a power of two from 8 to 512 texels along its longer side;
the levels under 128 are a part of a page). The coarsest level of a wanted card is always in the atlas and locked; a finer
page is captured when the rays asked for it and leaves the atlas when none read it for 256 images. The CPU's side is
`packages/sdk-core/src/lighting/surfaceCache/` (the cards of each placement, the law of the resolution, the allocator, the
requests, the eviction); the GPU's is `packages/sdk-browser/src/lighting/surfaceCache/`.

**Nothing is made for a scene nobody reads the cache of.** The state exists for a session whose cache carries cards, and its
GPU side only while something asks for it each image: a diagnostic view of the atlas, or a pass that reads it
(`demandSurfaceCache`). The memory is `surfaceCacheAtlasSize`: 454 MiB at the default 4096 (seven layers of one 32-bit word a
texel: depth, albedo, normal, emission, and the direct, indirect and final light; one kernel text serves every device, and a
compressed texture is no storage texture), 117 MiB at 2048, 33 MiB at 1024, each with the capture atlas (5 MiB) and 9 MiB for the
capture's surfaces. With `surfaceCacheCompress` 2 and a device that has `texture-compression-bc` the albedo, the normal and the
emission are kept in blocks (BC7, BC5, BC6H, a byte a texel): 311 MiB at 4096, 82 MiB at 2048, 25 MiB at 1024; the colour layers
fall from 192 to 48 MiB at 4096. They are asked of the device's budget as one (`ledgerAdmitted`): where it leaves no room the cache
is off and `metrics.surfaceCache.why` says so.

Each image of the main view, after the distance fields (`encodeSurfaceCache`): the placements follow the cut's roots
(`placements.ts`: a root whose mesh keeps cards, an HLOD cell's actors by the stand-ins of its field); the atlases are made
at the size the settings ask; the cache updates for the camera (`updateSurfaceCache`: which placements have mesh cards, which
pages of which cards are captured, the nearest first, at most `surfaceCacheCardCapturesPerFrame`), and what it changed goes
to the **tables** (`tables.ts`), one storage buffer of words the reads walk: a header, the mesh cards, the cards, the page
table, the pages' records and the table from a placement to its mesh cards. Then the pages it captures: drawn by a raster of
the cards' views, shaded, resolved, copied, in one compute pass (`SURFACE_CACHE_PASS`, the `surfaceCache` stage of the
profile).

- **The raster is a seam** (`capture/raster.ts`, `setCardRaster`). A card's page is seen through an orthographic view along
  the card's depth axis from outside the mesh (`cardPageView`, `atlasViewProjection`); a raster draws the pages into the
  capture atlas's identifiers and depth, and returns the images it drew. Until one is plugged in no page is made.
- **Shading** (`capture/shade.ts`) runs the engine's material classes over the capture atlas as they run over the image: the
  same class pipelines, their own bins, resolve uniform and surfaces. The surfaces' shading places a texel on
  its triangle by one view and writes its uniform and bins once an image, so an image holds the pages of one view and the
  frame shades the first image the raster returns; the pages of the others are asked again.
- **Resolve** gives the card's encodings: the albedo as the square root of the diffuse colour (the base colour less its metal
  plus what the specular lobe of the surface made fully rough sends back along its normal — the tabulated directional albedo of a GGX lobe of roughness 1 at normal incidence, weighted for its multiple scattering, the reflectance at grazing angles occluded under 2% —, plus the colour a thin double-sided sheet transmits), the normal's first two components in the card's frame, the emission
  multiplied by the cached lighting pre-exposure. Two kernels run first, before the image's tables go up — the tables are
  copied in on the image's encoder (`tables.ts`), so these read the cards as they were: **resample** fills a page that takes
  the texels of another card (cards of one mesh with the same materials, facing the same way) or of its own finer level,
  reading the atlas bilinearly over the texels that hold a surface; **resample lighting** (`surfaceCacheResampleLighting`)
  carries into the capture atlas the light each page's card held — a card that had pages before the image —, read
  bilinearly from the card's finest page: the direct light, and with the radiosity the indirect light and the tile's
  accumulation, the mean over its texels. **Copy** writes the pages into the atlas — the depth as `1 - z` in sixteen bits,
  65535 for no surface — and, with `surfaceCacheDilationMode` 2, gives a texel with no surface the mean of the texels around
  it; **lights** writes the light they start with: the carried direct and indirect light and accumulation, and as final
  light the captured albedo over π times their sum plus the captured emission — no light at all without
  `surfaceCacheResampleLighting`.
- **The compressed atlas** (`compress.ts`, `compressWgsl.ts`; `surfaceCacheCompress` 2). WebGPU has no view of a block-compressed
  texture in another format to write through, so the blocks are made in a storage buffer and copied in. After the copy (which
  then writes the depth alone) a kernel for each layer — BC7 for the albedo, BC5 for the normal's two components, BC6H for the
  emission — encodes the blocks of 4 × 4 texels of every page of the image, a thread to a block, with the dilation applied as
  the copy applies it, into one section of a staging buffer laid like the capture atlas; the compute pass ends; and one
  `copyBufferToTexture` of each page's rectangle for each layer puts them in the atlas (the rules of
  [texel copies](https://www.w3.org/TR/webgpu/#texel-copies): whole blocks, rows of 256 bytes). The read library
  hardware-decodes the layers, the emission as a float texture (the atlases' own `compressed` is what a program passes to
  `surfaceCacheSampleWgsl`). An emptied atlas is cleared by encoding the block of a black texel and copying it over each
  square of the atlas. Mode 1 of the setting (compression by writing through a view of another format) has no counterpart in
  WebGPU and compresses nothing, as on a platform without it; the setting's default is 1. `metrics.surfaceCache.compressed`
  says whether the atlas is compressed and `compressionWhy` why not.
- **The read library** (`sampleWgsl.ts`, `surfaceCacheSampleWgsl(group, first, { feedback, compressed })`) is what a pass that
  traces rays imports: `scSampleMeshCards` for a hit's position and normal and the mesh cards of the placement it hit,
  `scEvaluate` for the light there, and, with `feedback`, the report of the finer page the ray's cone would have read. The
  reflections' scene stage reads it through `scGlobalHit` (`hitWgsl.ts`).
- **The feedback** (`feedbackBuffer.ts`, `feedbackWgsl.ts`; `surfaceCacheFeedback`, `…FeedbackTileSize` 16, `…FeedbackMinPageHits`
  16, `…FeedbackUniqueElements` 1024). The rays of an image write, in one pixel of each tile of the image — its place in the tile
  moving from image to image, `feedbackTileJitter` — the card, the level the cone calls for (half a level coarser than its
  footprint asks) and the page they would have read, into one buffer cleared each image, and the last read of the page they did
  read. After the trace two kernels list each distinct element once with the number of times it was written (a table of keys, linear
  probing, then a list of at most `…FeedbackUniqueElements`), the list is copied to a staging buffer of a ring, and the image
  after the one that wrote it (`ring.submitted` at the next `begin`) it maps; the cache's update takes the newest list that came
  back (`UpdateView.feedback`): a page in the atlas that was read is kept, one that was hit more than `…MinPageHits` times and is
  not in the atlas is requested, behind the coarse mips. The list holds the first distinct pages the table finds, not the most hit.
- **The lighting** (`lighting/surfaceCache/lighting/`; `lightSurfaceCache`, called from `encodeDirectLights` once the lights
  are in their buffer and before the bounce) brings the light of the cards' texels up to date, a share of the atlas an image, in
  one compute pass (`SURFACE_CACHE_LIGHTING_PASS`, its own label in the `surfaceCache` stage), in this order. _The update context_ (`contextWgsl.ts`): a thread a page puts the
  page's tiles of 8 × 8 texels in a histogram of 16 priority buckets — 15 less the log2 of four times the images since the page
  was lit times its speed, one over one plus its distance from the eye over the first clipmap's half side, doubled within
  `…MaxDistanceFromFrustumToPrioritize` (500 cm) of the frustum, a page never lit having waited 2048 images —, one thread takes
  the bucket whose tiles reach the budget (`surfaceCacheDirectLightingUpdateFactor` 32 and `…RadiosityUpdateFactor` 64: the atlas's
  texels over the factor, 530 000 texels of direct light an image at 4096), and a thread a page lists its tiles up to it; the
  pages' state (the image each was last lit, the count of its updates) lives in their records (`pageRecords.ts`, words 16 to
  19). _The direct light_: a workgroup a tile finds the tile's depth range and the `…MaxLightsPerTile` (8) lights of most
  luminance times what reaches its centre (`cullWgsl.ts`), a thread a texel adds the irradiance each gives (`directWgsl.ts`):
  the engine's one light term for a point that is not a pixel — falloff, range, a spot's fade, a rectangle's form factor,
  the cosine, the light function, the clouds' shade, the air's tint — and, for a light that casts a shadow, one ray marched
  through the global distance field (`gdfTrace`) from the texel to the light, started `…GlobalSdfShadowRayBias` (1) voxels off the
  surface and three where it grazes the light, a lamp's ray ending a voxel short of it. _The radiosity_: a probe every
  `…RadiosityProbeSpacing` (4) texels of a card, jittered over the images, traces `…HemisphereProbeResolution`² (16) rays from
  `…DistanceFieldSurfaceBias` (10) cm, through the global field; a hit reads the cards at the point (the field's gradient is the face,
  the field's object grid gives the objects, the objects' mesh cards the texels: `scGlobalHit`, `hitWgsl.ts`, the one hit read of
  every ray that brings light back) and gets their final light, a
  miss the sky light; no ray brighter than `…MaxRayIntensity` (40) times the exposure. Each ray is averaged with its
  neighbours' in the probes' atlas (four of them, off-plane probes left out), projected on the first two bands of the
  spherical harmonics, and a texel integrates the four nearest probes' harmonics against the cosine lobe at its normal, blended over
  the last four images. _The final light_ of a texel — its albedo (decoded, `surfaceCacheDiffuseColorBoost`) over π times the direct
  and the indirect light, plus its emission — is written after the direct light for the direct list and again after the radiosity
  for its own, all multiplied by the cached lighting pre-exposure. The probes keep their rays in a trace atlas (one word of light a
  ray) and their harmonics in a three-layer atlas of half floats, 64 + 24 MiB at 4096; the rays the filter averages stay in a buffer of the update's
  size. The lighting settles over images (the larger factor times the blend: 256 at the defaults): the frame is not held while it does.
- **Who reads the cache.** The reflections' scene stage, the screen probes' scene stage, the radiance cache's trace, the world
  probes' update and the cache's own radiosity: each marches its rays through the global field and reads the final light at the hit
  with the same function (`scGlobalHit`, `hitWgsl.ts`; the reflections' rays ask it for the finest page and the page-use
  feedback, the others' do not). What a pass binds of it is the depth, the final light, the tables, the field's object grid and
  the table of instances — never the albedo, the normal, the emission or the direct and indirect light (the library reads
  none of the last two) —, made once a session (`surfaceHitReads`). Each of those passes asks for the cache each image
  (`demandSurfaceCache`), so that the field is sized for traces and carries its object grid. The level of the global illumination
  (`screenProbes`) sets the defaults of the atlas's side, the cards' density and resolutions, the lights a tile, the update factors
  and the radiosity's probes (`SURFACE_CACHE_LEVEL_ROWS`): the reference's rows, `high` a 3584-texel atlas with cards of at least 4
  texels, 4 lights a tile, update factors 64 and 128, probes every 8 texels and 9 rays; `low` a 2048-texel atlas at half the cards' density,
  at most 256 texels, update factors 128 and 128, 9 rays; `ultra` and `cinematic` the settings' own defaults; a setting named over
  a row keeps its value.
- **Not carried over**: the far field, the heightfields, the compression through a view of another format
  (`surfaceCacheCompress` 1) and by the framebuffer, the merging of the cards of many instances; of the lighting, the adaptive
  shadow tracing (the reference runs it with hardware ray tracing alone), the probes' occlusion (likewise), and the lighting
  channels. The cards' lights wear the light functions of `lightFunctionBounce`.

The diagnostic modes `surface-cache-albedo`, `-normal`, `-depth`, `-cards`, `-fill` and `-age` draw the whole atlas onto the
canvas (`debug.ts`): a layer of it, or what the CPU knows of each tile — its card, whether its page is of the coarsest level,
how long ago it was captured. `metrics.surfaceCache` carries the atlas's fill, the placements, cards and pages, the pages the
image captured, copied and left waiting, and why the cache is off.

```ts
world.surfaceCache = { surfaceCacheAtlasSize: 2048 } // a smaller atlas, in less memory
world.diagnostic.mode = 'surface-cache-fill' // the atlas: coarsest levels in green, finer pages in blue
world.onFrame(({ metrics }) => {
  console.log(metrics.surfaceCache) // { pagesUsed, pagesTotal, captured, copied, waiting, why, ... }
})
// a raster of the cards' views (capture/raster.ts), when one exists:
setCardRaster(rt, {
  ready: (placement) => true,
  draw: (rt, encoder, targets, pages, views) => images,
})
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
saved before the module is read once into its parts (`session/saved/legacySky.ts`); its sky light
keeps what that scene said: captured once and again when the scene changes, not every image
(`realTimeCapture` off, `sourceType: 'capturedScene'`), with the light's colour, intensity, ground
colour and volumetric scattering.

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
- **The sky.** The sky's pixels are fogged as any (`fogBeyondAt`, `lighting/fogCompose.ts`, called by
  the fog pass (`lighting/fog/fogPass.ts`) over the sky drawn before it and over the background, with the pixel:
  it lays the light shafts' mask and the local fog volumes over the sky too; `fogBeyond`, the same without them, is what the sky light's
  capture reads): a ray that leaves the scene meets nothing in any distance, a ray of 10¹¹ m that
  gathers the whole height integral, without the haze — the sky is the air. Looking up, with `dirY`
  the ray's rise, `T = 2^(−X)` and `X = baseDensity · 2^(−falloff · (yEye − baseHeight)) / (falloff · dirY)`:
  about 1, but within a degree of the horizon. Level or down, the density below the eye grows
  without end and `T = 1 − maxOpacity`: the fog's colour alone, so the horizon is a line at
  elevation 0, and the ground that is not drawn, past the scene's own, has that colour. The sky's
  table below the horizon — the air before a ground that is not drawn, almost dark — shows only
  where the scene has no height fog. A distance fog leaves the sky as it is. With no atmosphere the
  fog pass fogs the pixels no surface drew (`fogsBackground` — true for a local fog volume and
  no fog too —, `heightFogMain` in `lighting/fog/fogPassWgsl.ts`) with the same law: the fog's inscattering plus the background's radiance
  ([The background](#the-display-finishing)) through the transmittance `T` — the background's
  colour looking up, the fog's alone from the horizon down.
- **Old fields.** `{ color, density, heightFalloff?, baseHeight? }`, the extinction form — `T =
exp(−density · d)` where nothing falls off, the density divided by e every `1 / heightFalloff`
  metres up — is a spelling of this law, mapped exactly: `baseDensity = density / (ln 2)²`,
  `falloff = heightFalloff / ln 2`, the other fields at their defaults (`heightFogOf`). The GPU holds
  one law; no scene changes its image.
- **Where it is drawn.** Three switches of the height fog, on by default (`ResolvedHeightFog`,
  `scene/core/fogHeight.ts`): `inMainView`, the views the page draws; `inReflectionCaptures`, the six
  views of the scene the sky light captures from its own place (`ViewOverrides.reflectionCapture`,
  `skyLightCaptureOverrides`); `inSkyCapture`, the distant fog laid over the sky of the real-time
  capture (`SkyLightInputs.fogShown`, decided on the CPU). Each image writes whether its view shows the
  fog in lane `x` of the height-fog slot of the view block (`FOG_VIEW_SLOT.heightFog`, `fogHiddenIn`,
  `frame/render/fogView.ts`); where it does not, no volume is built for it (`volumeMedium`) and
  `heightFogAlong` answers `(0, 0, 0, 1)` — the surfaces, the translucent layers, the sky pixels
  (`fogBeyondAt`), the clouds and the reflections' rays are unfogged — while the atmosphere's haze, the
  local fog volumes and the linear fog are other components and keep their own. The capture's own pass
  (`fogBeyond`) reads no lane: `heightFogLaw`, the law alone. There is no holdout: the engine's images
  carry no alpha to hold out into.
- **The sky light on the fog.** `skyLightScattering { strength, roughness }` (0 and 0.15 by default)
  with the project switch `fogReadsSkyLight` (off by default): in a view with sky lighting and a ready
  cube (`skyLightFogOf`, `frame/render/skyLightFog.ts`) the programs that lay the fog read the sky
  light's filtered cube of the ready layer in the place of the fog's own cubemap (`FogVolumeState.skyRead`,
  `fogReadOf`: one binding, nothing added to a program), and `heightFogLaw` takes, with `s` the
  strength, `colour = mix(colour, skyLightColour · cube(sceneToCube(ray), mip), s)` and
  `lobe · (1 − s)`, the fog's own cubemap not read: the ray is the one the fog is integrated along, the
  mip is `roughnessMip(roughness, mips)` with the count of the cube's mips (the view block carries the
  strength, the roughness, the count and the light's colour, which `skyLightColor` gives with the
  capture's pre-exposure divided out). The capture's own fog pass reads none of it, the views drawn for a
  capture have no sky lighting (`ViewOverrides.skyLighting`), and the programs that bind no cubemap
  (the reflections' rays) answer no sky light: so the capture never reads what it writes. The
  volume's cells and the local fog volumes are not lit this way. A strength of 0 reads no state and no
  texel.
- **One law, written once.** The analytic fog and the volume's cells read the density of the medium
  through one function (`fogLayerDensity`, `fogDensityAt`, `lighting/fog/lawWgsl.ts`): a layer's
  `baseDensity · 2^(−falloff · (h − baseHeight))`. The analytic fog holds its exponent (to [−125, 126]
  where a ray starts at the eye, to at most 127 where it starts past a distance: `fogOriginTerms`,
  `lighting/fogShader.ts`); the cells read it unbounded. What a density becomes is each one's own, as
  the engines that fixed them have it: the analytic fog reads it as the exponent of two — `T = 2^(−X)`,
  `X` `ln 2` times the density's integral, so a uniform medium extinguishes at `(ln 2)² · density` per
  metre — the volume as an extinction of half the density, per metre. Half is `(ln 2)²` to within
  4.07 %: over any ray and any falloff the volume's optical depth is `0.5 / (ln 2)²` = 1.0407 times the
  analytic fog's, which a test holds them to by running the scatter, the integration and the analytic
  fog on the same ray (the cells' sum is that of each step's far end, off the closed form by at most
  half the share of the density a step's rise changes).
- **The matched glow follows the density.** Where the fog is made to match the volume
  (`fogMatchesVolume`), the glow is the fog's colour in the engines' unit — 10 000 times what it is
  otherwise — and follows the medium's density as the fog's own colour does: the light per centimetre
  is the glow's number times the density per centimetre, the halved density of the cell before the
  extinction scale (`fogMedium`, the frame's `matches` flag). Not matched, the glow is uniform.
- **Lights in the volume.** Each light scatters its colour times its `fogScattering` (lane 14 of
  its record, `1` by default; the volume and the clouds' lamps skip a light of `0`): the sun by the
  phase function and its shadow where its `shadowsFog` flag is set (a bit of the kind word, lane 12:
  the rank, under 4, plus 4 for a shadow, plus 8 for the fog's shadow, plus 16 for the transmission through the profile surfaces; a sun's by default); a local
  light by the inverse square of the distance a cell's radius longer, the window of its range, a
  rectangle's form factor, and one sample of its shadow map where `shadowsFog` is set and the setting
  `volumetricFogLocalShadows` is on (the default). The sun's shadow is also multiplied by the clouds'
  shadow on surfaces (`cloudShadowOnSurface`). The sky light adds the first three harmonics of its
  capture in the direction `−g` times the direction to the eye (`skyLightDiffuseSimple`, times the
  light's colour), times its volumetric scattering intensity (`skyLightScattering`, zero without a sky
  light). A light's light function multiplies its colour there ([Light functions](#light-functions)):
  the sun's always, a local light's where `lightFunctionFog` is set. The sky light's term of each
  sample is multiplied by the sky's visibility of that sample, the share a cone of 45 degrees
  straight up sees through the global distance field (`fogSkyVisibility`,
  `lighting/fog/skyVisibilityWgsl.ts`, read in the scatter itself), where the frame gives the field
  (the light is dynamic, casts shadows and a volumetric shadow, no screen probes light the fog, the
  view a perspective); a scatter with no field sees the whole sky. The static term is
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
- **Local fog volumes** (`SceneLocalFogVolume`, `sdk-core/src/scene/localFog/`, [SDK.md](SDK.md#local-fog-volumes)).
  A volume is a unit sphere in its own space (`p` relative to its centre over its radius, 5 m times its
  matrix's largest column). Radially its density is `radial · 0.75 · (1 − d²)`, so a ray through the
  centre takes `radial`; along its up `h` it is `height · e^(−falloff/100 · (h − offset))`. A ray from
  `start` along the unit `dir` for `run` crosses `radialDepth = radial · (∫(1 − d²) dt) · 3/4` (the sphere's
  integral in closed form) and `heightDepth = height / (falloff · dir.up) · (e^(−f₀) − e^(−(f₀ + dir.up · run ·
falloff)))`, `f₀ = max(−80, (start.up − offset) · falloff)`, `dir.up` held to 1e-4 from 0. `Tr = e^(−radialDepth)`,
  `Th = e^(−heightDepth)`, `T = 1 − (1 − Tr)(1 − Th)`, and the volume's transmittance is `T^radius`
  (the optical depth carried to metres): its coverage is `1 − T^radius`. The ray is cut — from the
  sphere's near side or the larger of the volume's and the view's start distance, to the sphere's far
  side or the point — and, where the fog's volume covers the near air (`localFogVolumeInVolume`, the volume
  built this image), starts past the volume's far end along the ray. Its light is `(sun · phase(−g,
dir · toSun) + skyLight(−g · dir)) · albedo + emissive`, times the coverage: the sun is the forward
  directional light's colour times its illuminance, through the air toward it at the ground where it is
  the air's, and the sky light's first three harmonics are read as three rows of the light buffer that a
  one-thread pass writes each image (`localSkyWgsl.ts`: the harmonic's value is affine in the direction).
  In the analytic law no shadow darkens a local fog volume, neither the sun's nor the sky light's visibility
  nor the clouds'; the cells of the fog's volume light it as they light the rest of the medium, shadows included.
  The units are metres and per metre throughout (the reference's are centimetres and per centimetre); the
  height axis is the matrix's second column, the world's up being +y.
- **Where it lies in the fog.** `localFogOver` (`lighting/fog/localWgsl.ts`) gives the volumes' light and
  transmittance over a point, and `fogLaid`, `fogBeyondWith` (`lighting/fogCompose.ts`) put it in its place:
  every surface the lit passes light, the clouds' layers, the sky's pixels and a pixel the lighting
  paints as background — a translucent surface only where `localFogVolumeOnTranslucent` says so. A scene
  with a volume and no fog still draws it; the sky light's capture does not read them. Voxelised into the
  fog's volume (`localFogVolumeInVolume`, the default), the volumes lie over the height fog, the haze of
  the air behind both, and the fog's volume nearest of all (`over = stack(local, heightFog)`, the haze, then
  `stack(volume, over)`), the analytic law drawing only what lies before the volume's cells. Kept out of it,
  they are not in its cells and lie over the finished fog, the volume's light too, drawn whole
  (`stack(local, stack(volume, over))`), as a volume laid after the fog pass is.
- **In the fog's volume.** A cell adds `ext = −ln(Ta + Tb − Ta·Tb)` with `Ta = e^(−height · e^(−falloff/100 · (h −
offset)))`, `Tb = e^(−radial · fade^0.82)`, `fade = 1 − d`, nothing outside the sphere (the optical depth being
  linear in extinction, the combined transmittance becomes one extinction), held to
  `localFogVolumeMaxVolumeDensity` (1 per metre: 0.01 per centimetre), times the share of the cell's depth
  past the volume's start distance where it cuts the cell; the extinction adds to the cell's, `ext ·
albedo` to its scattering, `ext · emissive` to its glow (the glow's switch `volumetricFogGlow`); the
  lights scatter by the cell's own lighting, so the sun and the sky light that light the volume light these
  too. Nothing for a cell whose back is before the view's start distance. The cell's point, and the points of
  its front and back, are found along the one ray of its pixel (`fogCellRay`, `lighting/fog/gridWgsl.ts`).
- **The block.** The view's volumes are planned on the CPU each image (`lighting/fog/localPlan.ts`): the
  volumes with at least one extinction, sorted by priority, then distance (the farther first), then
  the order of adding, the most `localFogVolumeMaxCount` kept (the nearest and highest), none dropped for lying
  outside the view, written relative to the eye — a centre and a radius, the height axis, the numbers of the
  law, the albedo and phase, the emissive light — into the light buffer's `localFog` block
  (`lighting/fog/localLayout.ts`): 1 292 `vec4`, 20 672 bytes, the header (the count, the switches, the density
  cap, the start distance), the sun's light and direction, the rows of the view-projection the depth was drawn
  with for a point relative to the eye, the view's size and near distance, its tiling, the sky light's three
  rows, and room for 256 volumes of five `vec4` each (`frame/render/localFogView.ts`). It is written once it
  differs from what the buffer holds. A volume's law turns about its up unchanged, so no more of its rotation
  is kept. A scene with none writes nothing and costs the fog's programs a count read. The block is data of the
  light buffer's layout, in every session; the project switch `localFogVolumeSupport` off leaves it unwritten.
- **The tiles.** The view is cut into square tiles of `localFogVolumeTileSize` pixels, and before the fog is laid,
  one compute pass of two dispatches (`lighting/fog/localCull.ts`, `localCullWgsl.ts`) writes into a buffer made for
  the tile grid (`frame/render/localFogGpu.ts`, a read-only storage buffer of words, bound by every program that
  walks it as `localFogTiles`) the list of the volumes that can show over each tile: a count, then the volumes'
  numbers four to a word, in the order they are drawn. The first dispatch, only with `localFogVolumeUsesDepthPyramid`
  and once the image has built its depth pyramid, is a thread a volume: it finds those the pyramid hides — the
  sphere's box is taken to the screen, the furthest depth under its rectangle is read at the level where four texels
  cover it (the same read as the fog's volume's furthest depth), and the volume is hidden where even the box's nearest
  corner lies behind it; a box that reaches the eye's plane is never hidden. The second is a thread a tile: it keeps
  the volumes whose sphere is not wholly outside one of the four planes through the eye and the tile's edges (the
  planes' lengths divided out), nor wholly before the near distance, nor hidden. A pixel — the opaque surfaces, the
  sky, the translucent layers, the clouds — finds its tile by the pixel it is seen in, as the engines that fixed
  this do; the cells of the fog's volume have none and find it by the screen place of their centre. `localFogOver`
  and `localFogMedium` walk the list; a tile of count 0 returns before a volume is read; where the view is not
  tiled (the pass compiling, a grid too large for a binding, a program that binds no lists) they walk every volume
  of the view, with the same image. A header that says no volume is drawn is the whole answer: no stale list or
  volume is ever read. The buffer is made for the grid, once a volume is drawn, kept while it holds the grid and is
  not more than twice what it needs, and let go with the last volume; it counts in the bytes of the view's
  targets (`viewTargetBytes`, `metrics.views`). The tile side asked for is never raised: a grid whose lists
  would not fit a storage buffer of the device (the smaller of its buffer and binding limits) is left untiled,
  said once (`fog-local-tiles-too-large`).
- **In the frame.** Three steps, in the order the frame forces. `prepareLocalFog` (`frame/render/encodeLocalFog.ts`)
  is first, in the lighting's setup after the lights are pushed and before the transparents' groups are bound: it
  reads the settings once, writes the block, and makes or lets go the lists' buffer, which those groups name — a
  buffer made after they were bound would leave them on a destroyed one. `encodeLocalFog` follows the depth
  pyramid, complete with the image's transparents, and precedes the fog's volume that reads the lists.
  `encodeLocalFogSky` follows the sky light's capture, the one pass whose input is that capture's harmonics and
  the view's cross-fade between two sets (read-time values of the view, changing without a capture): it
  writes the three rows each image a volume is drawn, and is not folded into the capture's projection. The
  passes are made once for a device; a refusal to compile one is said (`fog-local-cull-failed`,
  `fog-local-sky-failed`) to the diagnostics of the runtime that last asked, and the volumes are then drawn
  untiled, or without the sky light's term.
- **The project switch.** `localFogVolumeSupport` (project setting, on by default) is read once, when the session opens
  (`WebgpuPagesSetup.localFog`). Off, every program that lays the fog — the opaque and bounce resolves, the blend and
  its transmissive stages, the sky and the clouds, the clouds' trace of the sky light's capture, the fog volume's
  scatter — is made without the local fog volumes' text (`fogComposeWgsl(false)`, `fogGridWgsl(false)`, the air's
  shape `AirShape.localFog`, which the capture also follows where the scene has no atmosphere), the culling and
  sky-term passes are never made, and the lists' buffer never exists. The programs that draw the sky light's cube
  faces and the reflections' are made without them whatever the switch says.
- **What differs from the engines that fixed this, and why.** The lists are a storage buffer, not a texture array:
  the blend's fragment stage holds its 16 sampled textures already, and the lists are
  its eighth and last of the 8 storage buffers (`gpu/core/stageLimits.test.ts` counts them: the next binding there
  must free one); the cells find their tile by projecting their centre, as theirs do; the tiles are
  not drawn one by one with an indirect draw, since the volumes are laid in the lighting, not splatted by a raster
  pass — a tile with no volume is skipped by its count; the planes the sphere is tested against are divided by their
  length (the engines that fixed this compare lerped planes undivided); the pyramid's verdict on a volume is
  found once for all the tiles, not by each tile's thread; the culling runs in the frame's stream and has no async
  switch, and no debug view of the counts is offered. The instance data is 32-bit floats, not packed in half and
  11-bit floats and bytes (the packing's error is at most the 11-bit float's 1.6 % on an extinction and a byte on
  the albedo and distribution; the floats hold what was declared). The start distance's depth-bound optimisation
  (the distance before which the fog's pass skips a pixel) is not made. The clouds find their tile with the
  de-jittered texel while the culling uses the jittered matrix: at most a pixel's seam on a tile's edge under
  the temporal resolve, as theirs.
- **Block.** Six `vec4` of the light buffer, behind the irradiance (`FOG_SLOT`): colour and mode, the
  law, the range, the lobe, the sky's factor, the sun (direction toward it and luminance); the local fog
  volumes' block follows it in the same buffer (above, `LIGHT_BUFFER_AT.localFog`).

## Volumetric lightmap

Precomputed indirect light, baked by the compiler (`lightmapBake`, [COMPILER.md](COMPILER.md#volumetric-lightmap)) and read by position (`lighting/volumetricLightmap/`,
`sdk-core/src/lighting/volumetricLightmapFile.ts`; the file is [FORMAT.md](FORMAT.md#volumetric-lightmapbin)).
`parseVolumetricLightmap(bytes)` reads the file; `createVolumetricLightmapTextures(device, data)`
makes its nine 3D textures (a black texel each where there is no lightmap, or no bent normal);
`writeVolumetricLightmapView(words, at, data, shown)` writes the four `vec4f` a shader finds a
position with (zeros when the lightmap is absent or `shown` is false, the `volumetricLightmap`
setting). `volumetricLightmapWgsl(group, first)` is the sampling, for a program that binds
11 consecutive bindings from `first`
(`volumetricLightmapLayoutEntries`, `volumetricLightmapGroupEntries`): the view block, a bilinear
sampler clamped to the edge, the indirection volume (a read-only storage texture, read by load:
none of the stage's sixteen sampled textures), eight filtered textures.

- `vlmBrickUvs(world)`: the position clamped into the volume (at most 0.99 of its size), its
  indirection texel, then the brick's place in the atlas at the fraction of its span the position
  lies at, in padded bricks, half a texel in. A zero view answers the origin.
- `vlmSh1`, `vlmSh2`, `vlmSh3(uv)`: the light in one, two or three bands. The coefficients are
  read from [0, 1] back to [-1, 1] and multiplied by the ambient and by the scales
  `0.488603/0.282095` (the three linear ones), `1.092548/0.282095`, `4 · 0.315392/0.282095` and
  `2 · 0.546274/0.282095` the file divided them by. `vlmDotSh1`, `vlmDotSh2`, `vlmDotSh3` project
  them on a basis.
- `vlmSkyBentNormal(uv)` (mapped back to [-1, 1]; its length is the sky's visibility). The file also
  keeps the stationary sun's shadowing layer, which no reader takes: a stationary light is treated as a movable one while virtual shadow maps are on (they always are here), and the sun's shadow then comes from its shadow map alone — the lightmap's directional shadowing is read only for a light baked into its shadow channel, which that treatment removes. A `static` light is baked wholly into the indirect light and has no shadowing to read.
  A lightmap baked with a shadowing sky light (`skyLight`) carries real
  data in the bent normal; one baked without reads (-1, -1, -1) from the black stand-in, and the fog's
  sky shadowing stays off (`lightmap.skyBentNormal` is then undefined).

A scene's one lightmap covers all of it. Its finest bricks, where the file keeps them in cells
(`loadingCellSize`), stream: the atlas is made with room for the bricks of the cells (at most
`volumetricLightmapBrickMemory` megabytes, 30 by default), and each image the cells within
`volumetricLightmapLoadingRange` metres of the view (64 by default) are read by a Range, nearest
first, written into free slots of the atlas, and their indirection texels pointed at them; a cell
that leaves the range gives its slots back and its texels read the coarser brick again
(`lighting/volumetricLightmap/cells.ts`). A cell the room cannot hold is not loaded and is told once
(`volumetric-lightmap-room`); a cell that fails to read, `volumetric-lightmap-cell-failed`. The
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

The `atmosphere` part of the sky module is a planet's air lit by the sun: a term of the one lighting
model like the fog, whose coefficients and defaults are
`packages/sdk-core/src/scene/core/atmosphere.ts` (an Earth-like planet of 6360 km, air 60 km thick,
ground at `y = groundHeight`, 0 by default, its top at `groundPosition`, `[0, 0]` by default).
Distances of the planet are kilometres, the scene stays in metres. Where it is on,
`scene.background` is not shown.

**Units.** The sun is the brightest directional light of index 0 (`atmosphereSunIndex`, 0 by
default; the second light, below, has index 1) not flagged `atmosphereSun: false` — its colour times
its intensity, each channel weighed by the eye's sensitivity (the sRGB luminance weights, the fog's
sun the same) —, an illuminance `E`. The store holds the sun as lights come and go, whether or not
there is air: a light added replaces it only if brighter; the sun removed gives its place to the
brightest of the others, the first added of equals (a removal moves no one's place in that order); a
light changed is judged again the same way, the sun keeping its place against an equal. The radiance
reaching the eye through the air is `L = E · ∫ T(eye→p) · T(p→sun) · (σs_R φ_R + σs_M φ_M) dt`, plus
the multiply-scattered share, per steradian — the scale a surface reads (`L = albedo / π · E ·
cosθ`), so a 10-lux sun gives the same sky-to-sun ratio at any intensity. A surface is lit by `E ·
T(ground→sun)`, written into the sun's own slot of the light buffer by the store
(`atmosphereSun.ts`; the declared light is untouched, the transmittance integrated on the CPU over
15 samples, once when the air or the sun moves). The sun's disk is drawn at `E · tint / (2π(1 − cos
α))`, `α` its angular radius, `tint` its `sunDiskTint`, times the transmittance toward it and the
rim's softening, each channel held under 64000 after the product and after the image's pre-exposure
(the sky and the disk are multiplied by it once, and an exposed disk is held under 64000 per
channel, the image's sky under 32256). A light's colour is multiplied by that of a black body at its
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
6 km and the sky light's capture all march both. The multiple-scattering and
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
jittered by a fixed generator, `sphereSamples.ts`) that the fog takes on. The haze
volume lives in a region of the light buffer of 32768 cells (16384 in 32-bit floats,
`skyTablesFullPrecision`): the slices are cut to fit, and a surface reads its size from the view's
block (`VIEW_SLOT.volume`). Each cell is also stored in a 3D texture of the same cells (`hazeVolume`, `rgba16float`,
`HAZE_VOLUME_FORMAT`, written by `storeHaze` beside the region), which the fog pass samples with the hardware's
filter (`hazeSampledWgsl`) — at `skyTablesFullPrecision` it reads the cells by hand from the region instead, which holds them whole —; the translucent layers, the clouds and the reflections' rays still read the region by hand. A sky pixel is marched, not read from the table, at `skyTableFast` off
(`atmosphereSamplesMin`, `atmosphereSamplesMax`, jittered by the blue noise). The atmosphere's
`inMainView` (on) says whether the view the camera sees draws the air: off, the sky pass writes a black
sky (`skyMain`, `AirFrame.hidden`), the fog pass laying the fog over it as over the background, the haze marched on the opaque surfaces
(`encodeOpaqueHaze`) is not drawn, and the haze volume builder writes the view's block alone with its
kind 0 (`HAZE_VIEW_WGSL`) so that no surface, fog or cloud reads a haze; the sun's light tinted by the
air, the tables and the sky light's capture are as they are.

**Shade on the air.** A directional light that asks for it (`SceneLight.shadowsAir`) shades the air:
at each step of the sky table's march and of the haze volume's, the light's virtual shadow map is read
at the step's place (`airShadow`, `airShadowWgsl.ts`; one sample, as the fog's volume reads the sun's)
and multiplies the light scattered into the ray, the multiply-scattered share left unshaded. The
planet's shadow and the scene's multiply. `atmosphereSampleLightShadowMap` turns the read off.

**Shade the clouds cast on the air.** Besides the opaque scene's shade, each step of the sky table's
march, of the haze volume's, of the sky drawn by march, of the haze on the opaque surfaces, of the haze on
a cloud and of the haze around a capture reads the clouds' shadow maps of the air's two lights
(`cloudShadowOnAir`, `lighting/atmosphere/cloudShadowRead.ts`; the share of the light the cloud leaves,
laid in by the light's `cloudShadowOnAtmosphereStrength`) and, for the first light, the clouds' sky
occlusion map (`cloudSkyOcclusionAt`, `airSkyOcclusion`): the multiply-scattered share of that light is
multiplied by it, `multiScatter(...) · shade.z · scattering`, the second light's left as it is. The
occlusion map holds the sky light's `cloudAmbientOcclusionStrength` already, so it is read whole, with no
strength of its own. The tables that depend on the air alone (the multiple-scattering table, the mean
sky at 6 km) read neither. The sky light's capture marches its sky from its place in the planet's frame (its distance from the
planet's centre, held no lower than an eye, `sceneToPlanet`, as the haze around it) through the same
shade (`skyFaceProgram`, the haze around its place `capture360`), from the maps built this image (the
capture's clouds read `cloudShadowOf` where the capture asks, `captureCloudsOf`, not a copy: a getter, so
that nothing is stale), the stand-in that shades nothing where the scene has no clouds
(`cloudShadowStandIn`).

**The clouds' sky occlusion map** (`modules/sky/clouds/skyOcclusionRun.ts`). Where
`cloudSkyOcclusionWanted` (the quality's `cloudSkyAO` and a sky light, that affects the world, with
`cloudAmbientOcclusion` on), the shadow maps' pass builds it after the lights' maps, whether or not a
light casts one: the cloud shadow trace (`cloudShadowMain`) along the planet's vertical, from a square
round the point of the planet's surface under the camera snapped to `cloudSkyAOSnapKm` (a length of 0 or
less read as 0.1 m), its size set by `cloudAmbientOcclusionExtentKm`, into a map of 512 × the scale
texels a side (at most `cloudSkyAOResolutionMax`), with the sky light's strength, no depth bias,
`cloudSkyAOTraceSamples` samples a ray and no temporal blend; then, with `cloudSkyAOFiltering`, the
hemisphere filter (`skyOcclusionFilterMain`: 16 directions, the optical depth that of the mean of the
transmittances) into a second texture. Its matrix and far depth are in the shadow block (`clipSky`,
`far.z`; a far depth of 0 reads as no occlusion), the map in the sets' `ao`.

**What the clouds read of the air.** Besides the haze surfaces read, the air builds, when the clouds
ask (`airRequests`, `encodeAtmosphere.ts`), the haze's light alone and the air's alone in two volumes
of the same cells (`hazeSeparate`, the march keeping `radianceMie` and `radianceRay` apart, the
ozone's absorption shared half and half), and the haze all around a capture's place (`capture360`: a
longitude and the sine of the latitude across, the distance down), read with `hazeOnly`, `airOnly`
and `captureHaze` (`separatedWgsl.ts`). The clouds' high-quality haze (`cloudHighQualityAerial`)
marches it for the pixel to the cloud's depth (`cloudHaze`, `cloudHazeWgsl.ts`).

**Clouds with no atmosphere.** The clouds need an atmosphere no more than the reference's do: a
clouds part is drawn in the view, in its shadow maps and in the sky light's capture whether or not the
scene has an air. With none they stand on the planet of their own
`planetRadiusKm` under the plane `y = 0`, over a stand-in air (`airlessAirOf`, `writeAirlessFrame`): a
white transmittance, no haze (the haze on the clouds and the sun's per-sample tint are off), the
frame's eye where it stands, written once an image whoever asks first. The air's block holds the
lights of the air as they are, the clouds' illuminance outside the air times a transmittance of one
(`packAtmosphere`, the lights of the air with no air: no disk, the light's own illuminance, its place
in the light buffer kept for the clouds' shade), where a clouds part is followed and asks for them
(`SceneLightStore.setAirlessSuns`; the block of a scene with no atmosphere and no clouds stays all
zero), and the distant sky light that lights the clouds is the sky light's own diffuse light of no
direction (the harmonics' first terms, `skyHarmonicsSimple` at the origin, `cloudDistantSky`), read
from group 2 of the trace (`CloudTraceKey.skyLight`). The clouds' own switch is `cloudsOn`: off, no
clouds part is followed (`skyAtQuality`, applied at each image from the session's live sky quality
settings). A reference quirk is not reproduced: with no atmosphere the reference puts the planet's
centre at the view's origin, which bends the ground bounce's normal (`groundContribution`, off by
default) toward the view ray; ours keeps the true normal.

**The capture's clouds and the sun's shadow.** The sky light's capture traces its clouds with the program
of its key (`captureCloudKey`): the sun's shadow in the opaque scene lights them where the capture asks
for the opaque scene's shadows (`skyLightShadowFromOpaque`) and the clouds read the shadow map
(`cloudSampleLightShadowMap`), through the shadow maps' channel of the sun the view uses; the program
is compiled when first asked and the capture waits for it (`cloudsCompiled`).

**The clouds' time.** The clouds drift by the world's time of the image, the clock the material
graphs read (`WebgpuRun.graphClocks.time`, taken once an image from the world's clock, the wall
clock in an engine with no world): a paused world holds the clouds still, and every reader of an
image — the view's trace, the shadow maps, the sky occlusion, the sky light's capture — reads the
one value. A held image is drawn again (`cloudsMoved`) when the world's clock moved since the last
image drawn while a wind drifts the clouds, while a storm flashes, and while a cut leaves the
rebuilding unfinished; not when the wall clock alone ran on.

**The cloud's shade on itself.** The trace program has two forms (`CloudTraceKey.volumeShadowMap`): the
default marches the shade toward each light (`cloudShadow`); with the material's `rayMarchVolumeShadow`
off it reads the lights' shadow maps in group 2 (`cloudMapShadow`, `cloudShadowDepth`), nothing marched.
The sky light's capture takes the same choice and reads the maps built this image.

**The density bound.** Every march (the view, the shadow ray, the ground's bounce, the shadow map) probes
a point first (`cloudProbeAt`: its altitude in the layer and the layout's four pattern reads, with the
layout's screen gradients, `CloudSite`), skips it where the conservative density is not above 0
(`cloudProbeDense`) and reads the rest of the material only after (`cloudPointOf`): an empty sample costs
the four reads. The lamps' shadow rays read the whole material (they have no bound to test).

**The empty-space table** (`modules/sky/clouds/emptySpace.ts`). Where `cloudEmptySpaceSkipping` is on and
the image is not a reflection (`CloudTraceKey.emptySpace`), a compute pass writes, before the view's
trace and from the very block the trace reads, a 32 × 32 table of `r32float` kilometres over the view: a
group of 64 threads to a texel, one to each of 64 slices of `cloudEmptySpaceSkippingDepthKm` along the ray
through the texel (an orthographic view's from the texel's own point, as the trace's rays), each asking
the material's empty-space output (`cloudMaterialEmptySpace`) at the centre of its froxel and, with
`cloudEmptySpaceSkippingCorners`, at its eight corners, keeping the greatest; a slice that answers above
0 stores its own distance moved by `cloudEmptySpaceSkippingSliceBias` slices, the others the whole depth,
and the texel holds the nearest. The trace (`traceExtraWgsl.ts`, group 2, binding 0) starts a ray at
`uint(start / step)` steps along, and steps over empty air one sample at a time, so that the table's
texels never show. The built-in material leaves the output unconnected, which says matter is there
everywhere: its table holds the bias alone. The table is the view's, made on the first ask and kept with
its images (`emptySpaceTableSlot`).

**Orthographic views.** Under an orthographic camera each pixel's ray leaves the pixel's own point on the
near plane and runs along the view's direction, the same for every pixel; its depth, the scene's depth
cut and the layer test are measured from that point. A pixel whose ray starts inside the layer's outer
sphere shows no cloud (the camera is in the sky), and the scene's depth cuts a ray only where the layer
ends before the far plane. The view is traced directly, a ray for each pixel, with no history and no
enlarging, and laid over the lit image as it is traced (the ways that enlarge a reduced image read the
eye's rays, which an orthographic view has none of). The air is drawn as well ([the air under an
orthographic camera](#atmosphere-and-sky-light)).

**Sizes and upsamplings.** The four sizes (a quarter traced, half rebuilt, then enlarged; half; a quarter
rebuilt at the full size; full) and the five ways to lay the image over the scene (bilinear, bilinear with
a jitter, nearest with a depth test, jittered with the depth test, bilateral) are the reference's, step
for step: the trace and rebuild factors, the order of the pixels traced over the images of a cycle (2×2: 0
2 3 1; 4×4: 0 8 2 10 12 4 14 6 3 11 1 9 15 7 13 5), where the fog is laid late (the quarter-to-half and
quarter-to-full sizes), which sizes force the nearest way, the jitter's four directions, the bilateral
choice among the two surfaces of four texels, and its fall back to a soft bilinear read. The scene's depth
is read at the last coordinate of the depth image the trace uses: the view's size less one over a texel of
that image in view pixels (the view's size for the quarter-to-full and full sizes and a direct trace, half
of it for the others).

**The cloud material.** The material's mask term adds to the coverage times (profile + noise); the
layout's placement offset does not move the mask (the placement is added back to the mask's coordinates)
while it moves the pattern, as the material the layout comes from is built; the wind carries the three
noise offsets by `wind · alpha · time / tile` on all three axes.

**Drawing.** The sky is premultiplied radiance over the HDR image where the colour pass left the
background, with no fog in its own draw: the fog pass lays the fog's height law over it like over any pixel
([Fog](#fog), the sky), so exposure, the curve and the temporal resolve treat it as any surface. The haze
(aerial perspective) is read by every surface, over the fog: `L' = L · T + S`, opaque and transparent alike — the
opaque surfaces by the fog pass from the haze volume as a 3D texture (`fogOpaque`, `hazeSampledWgsl`), the translucent
layers through the light buffer, where the volume lives behind the fog's block (`lighting/atmosphere/layout.ts`;
`fogged`, `fogOver`, `lighting/fogShader.ts`); the fog takes the sky's mean radiance on as its own
colour and scatters the sun's light on the ground ([Fog](#fog)). A scene without an atmosphere reads
none of it. The unlit view and the views that paint raw values show none. The sky's draw binds no fog: the
light shafts' occlusion mask is read by the fog pass (`DEFERRED_BINDINGS.fogLightShaft`).

**The air under an orthographic camera.** The sky, the haze on the surfaces and the haze on the clouds are
drawn under an orthographic camera as under a perspective one, from a ray that starts where the pixel's
does: the point of the near plane under the pixel, raised by half the view's height along the planet's up
(so that the bottom row of a view that stands on the ground starts from the eye's height, not from under
the ground), and runs along the view's direction, the same for every pixel (`airRay`, `airRayWgsl.ts`).
The raise is worked out once an image, on the CPU, from the view's matrices, and held in the frame
(`AirFrame.lift`, `writeAirFrame`), the programs adding it as it stands. The sky is read from the table
around the eye at the height each pixel starts at; the haze volume is built along those rays, and a
surface reads it at its distance along the view's direction from the near plane, which is the same for
every pixel of the surface's depth. The sky light's capture, taken from a place of its own, is a
perspective view whatever the camera is.

```js
world.scene.sky = { atmosphere: true, sun: true, clouds: true } // the sky, the haze and the clouds, whatever the camera
// The horizon is seen from the height of the camera's bottom row: raise the camera to look from higher.
camera.position.set(0, 10, 100)
```

**Sky light.** The `skyLight` part (a light that affects the world) gives the scene the sky it
captures into a cube (`modules/sky/skyLight`): the cube, filtered by roughness, and nine harmonics
summed from it (the real-time capture's from the filtered cube, a captured scene's and a specified
cubemap's from the captured cube's mips, before the filter), on the GPU, never read back. Every reader reads that one cube, through the light's
read (`modules/sky/skyLight/read.ts`), at the colour of the light times its intensity, black in a
view whose `skyLighting` override is off. The diffuse light of a surface is the harmonics along its
normal (`skyLightDiffuse`): where the bounce probes answer they carry the sky, occluded by the scene
([Light that bounces](#light-that-bounces)); the share they leave is the sky light's own diffuse
light, the sky nothing hides. The volumetric fog scatters the harmonics' first three terms along the
way to the eye, times the part's `volumetricScatteringIntensity`. A specular read takes the cube
along the reflection vector at the mip its roughness asks (`skyLightReflection`); a bounce probe's
ray that leaves the scene reads it sharp (`skyLightRay`). Its lower half is the sky's own, or, where the part's
`lowerHemisphereIsSolidColor` is on (off by default), the part's `lowerHemisphereColor`, black by default, laid into the cube at the capture by the part's
`lowerHemisphereCoverage` (1 by default: the colour whole, less of it letting the sky and the clouds
below the horizon show through). Without an atmosphere the cube is black (clouds aside). A specified
cubemap is the part's own `cubemap` (six faces of linear texels as data, `SkyLightCubemap`, the form
of the fog's cubemap), the engine making the texture of it and keeping it while the data is the same
(`followSkyCubemaps`: half floats, the whole cube written times the scale that brings the brightest
texel of the cube and of the one it blends to to the half float's largest, 65504, where it passes it
— one scale for the pair (`cubemapPairFit`), so that the mix is of two lights in one unit —, and the
light given the inverse, `skyLightCubemapScales` and `SkyLightInputs.cubemapScale`: no texel is
clamped, on any device; the faces are written one after the other, over several images, no more than
about a million channels converted an image, from one buffer, and the cube is the light's once its
six faces are written, `SkyCubemaps.pending` holding the image drawn until then). It blends to a
second one by a fraction (the part's `cubemapBlend`, `SkyLightInputs.blend`): both are filtered, and
the light mixes the two cubes and their harmonics. The harmonics are seven vectors a cube. A mean
brightness of the cube (an eighth vector) is not kept: its one reader weighs the reflections of a
surface lit by baked light — a lightmap, or the volumetric lightmap read at the surface — by it,
under a sky light that is not movable, and the volumetric lightmap here lights the volumetric fog
alone, no surface (`lighting/fog/staticPass.ts`). The sky light's `cloudAmbientOcclusion…` fields do
not act on the cube, the harmonics or any surface's light: they dim the air's multiple scattering
(Shade the clouds cast on the air, above).

**The real-time capture.** The light is read from the first frame the cube has been drawn whole in (the frame
draws it in the command buffer that lights the image): until then a surface sees no sky light and the
bounce waits, never a cube that was made and not drawn into. The capture is made once a frame, from the main
view's air and clouds; a view drawn beside the main one, and the image drawn aside for a capture, read the
light and make none. The faces are written multiplied by the capture's pre-exposure (`cachedLightingPreExposure`,
[Pre-exposure](#exposure-and-the-display-curve)) and the light's colour holds its inverse. The sky of the capture is held, as the
sky of the view, to 32256 per channel once multiplied by it (half of what a 10-bit float holds, room for what
is added after it); the clouds and the lower hemisphere are not held by it. The sky is marched from the
light's height over the planet's ground, no lower than the eye of a view is held (5 m). A bright sun disk is
not in the capture (it is a light of its own). The cube's side is the part's `cubemapResolution` (made a
power of two), or the quality's `skyLightResolutionOverride` when that is 16 or more: the override is the
real-time capture's alone.

**Reflections.** A reflection ray that leaves the scene reaches the sky along its direction
(`reflectionEnvironment`, `lighting/reflections/field.ts`): the sky light's cube, sharp for a ray, at the
roughness of the lobe for the field's read; a scene with an atmosphere and no sky light shows none, the
sky a ray reaches being the sky light's alone; a scene with neither keeps the flat background the
screen draws. Where the probes hold the sky, the field of a reflection takes the
environment for the share they do not answer alone, the sky never twice.

**Sky light, captured scene** (`modules/sky/skyLight/captureScene.ts`). A sky light whose
`realTimeCapture` is off and whose `sourceType` is `'capturedScene'` (the default) lights the scene
with the scene itself, drawn once into its cube from the light's position. Six cameras, one per face
of the cube, +x, -x, +y, -y, +z, -z, each square with a field of 90 degrees and its nearest distance
the light's `skyDistanceThreshold` (150000 cm, so nothing nearer than 1500 m is in the cube), draw
the scene aside (`Engine.captureHdrViews`, `frame/io/hdrCapture.ts`) at the cube's side
(`cubemapResolution`, made a power of two) times `skyLightCaptureSupersample` (1). The image of a
face is the lit linear radiance, before exposure, the effects and the tone curve; it is clamped to
the half float's range, the colour below the horizon is the light's `lowerHemisphereColor` by its
`lowerHemisphereCoverage` when `lowerHemisphereIsSolidColor`, and it is copied into the face
(`copySceneFaceMain`); then the mips, the nine harmonics and the filter by roughness are made
(`captureFilter.ts`), as for a specified cubemap. The harmonics are summed from the captured cube's mips,
before the filter (`capturedIrradianceMain`): a grid of 32 by 32 texels on each face, read bilinearly at the
mip of that side (the top one for a cube smaller than that), each texel weighted by the share of the sphere
it stands for, and a coefficient is 4π times the weighted sum of the radiance times the basis, over the sum
of the weights. The cube is written at a pre-exposure of 1. The mean of the sky radiance the light reports is
the harmonics' last vector, as for any source.

The faces are drawn by a view of their own with `ViewOverrides` (`frame/backend/state/viewOverrides.ts`):
no sky light, every surface of roughness 1, no particle, light shaft, light function, effect,
exposure, tone curve or temporal pass, the cut asked at `skyLightCaptureLodDistanceScale` (1, a
value of zero or less being 1), no reflection traced;
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
farthest first on the GPU (`blend/order/order.ts`) and lights them with the lit passes' lists
(`src/blend/lighting.ts`). A transmissive surface is sorted and lit among them, composed as
a thin translucent layer (`blend/transmission/transmitWgsl.ts`), and refracts the opaque scene through
one distortion pass drawn before every translucent layer (`src/blend/distortion.ts`).

**The separate translucency** (`blend/translucency.ts`, `blend/draw.ts`). The translucent layers are not drawn into the
lit image: they are drawn over the opaque depth into two targets of their own, the same size and format as the lit
image, made with the frame's targets whenever the scene holds a translucent surface (`sceneBlends`; a texel each
without) and counted by the budget (`translucencyBytes`). The translucency target holds what the layers add in its
colour and, in its alpha, the transmittance — the share of the scene behind them that shows through —, cleared to
black and 1 by the pass: normal and alphaComposite multiply it by `1 − a`, additive leaves it, alphaHoldout multiplies it by
`1 − a` as normal does and cuts away the colour behind it (`BLEND_EQUATIONS`, one table for every target). The modulation
target, cleared to white, holds what the layers that filter the scene multiply it by: multiply and subtractive, each
in a pass of its own beside the blend pass (`drawModulation`), and, under the dual blend, the transmissive layers'
transmittance (`DUAL_MODULATE`, drawn by `fsTransmitModulate`, which reads no light for a colour its blend drops),
the colour of the dual blend added on the translucency target (`DUAL_BLEND`), its alpha left as it is. An image
none of whose layers modulates the scene encodes no pass for it, as a translucency pass with nothing to draw is
skipped: the target is left as it was and the composition reads a white texel in its place (`modulated`,
`groupBare`). The depth of field reads the lit image without them, so no layer of the default pass is
blurred; the image they compose onto is that of the depth of field, or the lit one without it, before the
temporal pass: `scene · modulation · transmittance + light` (`layersOver`). The depth of field's recombine does it as it
writes its output (`ResolveFrame.layers`, `dofRecombineMainWgsl.ts`: `TranslucencyTargets.phase` `fused`), the layers
read as they are drawn, at the render size; with none, or where the recombine drew nothing, the composition does it in
two draws (`composeLayers`, `composeTranslucency`) onto the lit image — which is also composed, in a pass of its own,
only where the next image's reflections keep it (`keepsLitImage`). The lit image's alpha — read by nothing, its colour being read as it is, unless
`propagateAlpha` is on — is multiplied by the layers' transmittance and by the background the modulation leaves visible,
the mean of its three channels. The particles are layers of the same
targets (`drawParticles`, `particleTargets`), their smoke an alphaComposite layer and their fire an additive one
(`BLENDS`); a session that holds a pool makes the targets full size as one that holds a blend does
(`drawsTranslucency`). The see-through views' edges (`encodeXray`), an overlay, still draw into the lit image, over
the layers composed at once (an image with no effects has no depth of field to wait for).

**Double-sided blends** (`blend/plan/plan.ts`, `sidesOf`). A see-through surface of `side: 'double'` is one plan entry on the
pipeline that culls nothing, one draw, as a two-sided surface is in every pass of the image; the material's `twoSidedPasses`
(`false` by default, `PageSurface.twoSidedPasses`) plans two entries instead, its back faces then its front faces, which
share one pipeline that culls nothing and apply the cull in the vertex stage (`planVertexCull`), so that the blend of a
closed shape composes far side then near side.

**The three passes** (`blend/translucencyPasses.ts`, `translucencyPhase.ts`). A see-through surface names the pass of
the image it is drawn in: `Material.translucencyPass` (`ParticlePoolSpec.translucencyPass` for a pool),
`'afterDepthOfField'` by default, apart from the scene and composed over the image once the depth of field has read it,
`'beforeDepthOfField'`, composed onto the scene before the depth of field, which blurs it with the scene it lies in, or
`'afterMotionBlur'`, drawn into a second set of targets (`TranslucencyTargets.late`, made while the scene holds such a
layer, `drawsLateTranslucency`) and composed over the image the temporal pass and the motion blur leave,
read bilinearly where the image is the display's. The last motion blur lays it as it writes its image — in the
last pass of its filter (`lateOver`, `MotionBlurParams.outputs.y`), so that the half-size image it writes beside
carries it too —; where no blur is drawn (off, or a still image) it is composed into an image of its own
(`encodeResolvedEffects`, `composeLateImage`), the temporal pass's output being its history, which is never
written to; the chain then makes the half-size image itself. Where the image shows no effect or runs no chain,
it is composed at once (`composeLateOnto`). With the depth of field drawn on
the image (`splitsTranslucency`), the layers of the pass before it are drawn first and composed onto the lit image at
once, the others after, left to the composition after the depth of field; a pass with no layer is not drawn, and a lone
pass draws every layer. The same plan is drawn once for each set (`encodeBlend`, `layerDraws`): the expansion runs once for each
draw over the same sorted plan, an item whose pass the draw does not keep expanding no instance (`expand/expansionViews.ts`,
the view's filter against the item's pass bit in `draws[item].w`), so each draw has its own arguments and its own instances and
the vertex stage processes no vertex of another pass's item; a slot the CPU knows empty for the view is not encoded
(`slotMayDraw`); the particle pools are split by their pass. The responsiveness pass reads the view of the responsive items
among the draw's alone. Without the depth of field and the late pass one draw
keeps everything. The image composes its layers in one place (`composeLayers`,
`encodeBlend.ts`): the temporal pass measures the scene before the first layers laid on it (once an image), then the
target is composed — onto the lit image for the pass before the depth of field, after the depth of field's pass (or at
once where the image shows no effects or the chain does not follow) for the others.

**What the temporal pass reads of the translucency.** The image it resolves is composed, so the share of a texel's
luma the layers make is rebuilt from it and from the translucency target of the image: the colour before the layers is
`(composed − light) / transmittance`, and the ratio `light / (light + before · transmittance + 0.0005)` of the lumas in
the perceptual space (`post/taa/translucencyWgsl.ts`) trims the thin geometry's relaxation weight, from 0.05 to
0.6, and, past `temporalThinGeometryRejectTranslucency`, keeps the translucency bit alone in the coverage history
(`thinGeometryWgsl.ts`); the flicker measure takes its luma from the colour before the layers and discounts a texel
by the greater of the change the layers made to its colour in the measurement space and `1 − transmittance`, and the
shading rejection composes the colour before the layers with the layers' 3×3 blur (`rejectionWgsl.ts`). A texel of an
image composed with no layers reads no light and a transmittance of 1.

**The clouds on the translucent surfaces, per vertex.** The clouds' shadow maps shade the opaque
surfaces, and the clouds are composed over the lit image before the transparents are drawn, so a
translucent surface is shaded by the clouds, and drawn behind them, only through two readings made
at each vertex of its programs: the clouds' shade, where the project switch
`cloudShadowOnTranslucent` is on (off by default, read once when the session opens, as the clip
plane's is, `createWebgpuBlendState`), and the cloud image, for a surface whose material has
`cloudFog`. A program that reads either (`cloudVertex`: the switch is on, or the scene holds such a
surface, `BlendModePipelines.cloudVertex`) is made with the vertex stage reading both, the map of
the forward directional light (below) at each vertex (`cloudShadeAt`) and the cloud image
(`cloudFogOver`), and handing them to the fragment stage as two extras of its output, named lanes
allocated from one table (`blend/vertexExtras.ts`, `blend/cloudVertexText.ts`: the shade one lane,
the layer four): no lane of another value is borrowed. The struct's thirteen locations, which every
program has, become fifteen, and with the front-face flag they are the sixteen a fragment stage is
granted; the triangle's rank, the diagnostic word and the record's rank share one flat member
(`VSOut.words`) to make the room. Each fragment entry takes the shade first (`cloudShadeVertex`) and
the light of the forward rank, which the light buffer's header names (`DirectLights.forwardRank`),
is multiplied by it, the others unshaded; the fragment lays the layer over the fog it computes
itself (`rgb * transmittance + light`) for a surface that wears the material's bit
(`CLOUD_FOG_MODEL_BIT`). A feature that is off gives its neutral value (a shade of 1, the layer `(0,
0, 0, 1)`) from the stand-in bound in its place: the blend group's layout holds both reads, whatever
the program, the shade's block, map and sampler and the cloud image's block, colour, depth and
sampler (`BLEND_CLOUD_SHADE_BINDINGS`, `BLEND_CLOUD_FOG_BINDINGS`), read by the vertex stage alone —
the fragment stage's sixteen sampled textures and eight storage buffers are spent —, and one place
makes what they are bound with, once an image (`translucentCloudVertex`, `blend/cloudVertex.ts`):
the forward light's map and block, the image the view drew, or the stand-ins of the device
(`cloudShadowStandIn`, `cloudFogStandIn`, each made once for a device: a runtime makes no buffer of
its own while no program reads the clouds). A program that reads neither holds none of the code: its
text is the text it was, thirteen locations.

**The cloud image.** For a surface whose material has `cloudFog` the vertex stage reads the cloud
image of the image (the rebuilt one, or the traced one in the sizes that do not rebuild; with the
fog laid on it when `cloudFogLateOnTranslucent` asks): the colour at the vertex's place on the
screen, and the least of the four front depths a gather there would read, which is the cloud's
front; a vertex further from the eye than the front by the soft blending's length
(`cloudSoftBlendingDistanceOnTranslucent`) or more is under the cloud in full, before it the cloud
fades in. A view that traces its clouds directly (an orthographic one, or `cloudRenderTarget` off)
leaves no image to read.

**The forward directional light.** Of the directional lights of a scene one is chosen for the readers
that take a single one: this shade, and the volumetric fog's light (the fog volume's `sunRank`). It is
the light of the highest `forwardShadingPriority` (a whole number of at least 0, 0 by default, a light
field and a field of the sky's `sun` part); of equal priorities, the one whose declared colour — with
its temperature, before the air tints it, so a sun reddened at the horizon keeps its place — times its
intensity has the greatest squared length, the first added of equals. The light store chooses again
when a directional light is added, changed or removed, and writes its rank plus one into the second
word of the light buffer's header (`LIGHT_HEADER_FORWARD`), `SceneLightStore.forwardDirectionalSlot`
being its rank. The analytic fog's lobe keeps its own sun, the air's first light
(`fogSun.ts`).

```js
const world = createWorld('viewer', { cloudShadowOnTranslucent: true }) // the project switch, at the session's opening
// The sun has a cloud shadow map (`castCloudShadows`, off by default; the sky quality's
// `cloudShadowMap` is on) and lets it shade the surfaces (`cloudShadowOnSurfaceStrength`, above 0; 1
// by default): the translucent surfaces then follow the forward directional light, the sun here.
world.scene.sky = { clouds: true, sun: { castCloudShadows: true, cloudShadowOnSurfaceStrength: 1 } }
```

**The fog of a blended surface.** Per vertex by default (`blend/cloudVertexText.ts`), laid from the farthest layer to the nearest: the vertex stage works out the height or distance fog with the haze behind it (`fogLaidFar`, `lighting/fogCompose.ts`), the local fog volumes of the tile the vertex lies in over them (`fogLocalVertex`: the vertex reads the lists of the volumes, `fogTiles`, visible to its stage), the clouds over both where `cloudFog`, into the one extra `fogLayer`; the fragment lays the fog's volume over it (`fogVolumeOver`) in `blendFog`, the one fog the colour layers, the alpha holdout and the thin layers all take, worked out once. The material record's `fogPerPixel` (`computeFogPerPixel`, and always for single-layer water) selects the per-pixel path, carried to the fragment in the triangle word (`TRI_FOG_PIXEL_SHIFT`; the record's model word has no bit left). `fogVertexOf` (`blend/pipelines.ts`) says whether the scene holds a surface that takes its fog per vertex: without one the programs compile with `fogVertexed` the constant false and no fog lane. The vertex stage reads the light buffer, the fog's cubemap and the lists of the volumes, so those bindings are visible to it; the cluster identity words the diagnostic views colour by sit behind the spans in one buffer (`clusterIdentity`), the vertex stage holding the eight storage buffers WebGPU guarantees.

**The translucency lighting volume.** A blended surface whose material says `translucencyLighting` other
than `'forward'` (the default of a material made in code is `'volumetricNonDirectional'`; a blended scene-file material is imported as `'volume'`, a transmissive one as `'forward'`, `scene/host/prepared/materials.ts`) (`'volume'`, `'volumetric'`, `'volumetricNonDirectional'`, [SDK.md](SDK.md#a-see-through-surface-lit-from-the-translucency-lighting-volume))
takes the direct light from a volume built each image (`lighting/translucency/`) in place of walking the lights in its
fragment. The mode is two bits of the material's record (`materials/surface/surfaceModelWord.ts`,
`TRANSLUCENCY_LIGHTING_MODEL_SHIFT`), which the blend vertex stage carries to two bits of the item's flags
(`translucencyLightingFlags`, `lighting/translucency/modeWgsl.ts`) and the fragment reads back
(`translucencyLightingOf`); a layer is drawn by the pipeline of the lighting program that lights it (`blendLightingOf`: forward, volume, lightless, unlit; part of the plan rank and the pipeline's `BLEND_LIGHTING` constant, which folds the other programs' light code away: the declared lights and their shadow traces only in the forward one, the volume's read in the volume one, the lit path in none of the unlit one); a scene whose blended surfaces are all forward, or none translucent or additive, builds `BlendModePipelines.translucencyVolume`
false (the volume lights those two blending modes alone, and only default lit and thin subsurface surfaces: a volume mode lights every other layer with no declared light, `blendLightsOf`; the mode alone says it, whatever the blending mode): the programs hold none of the volume's code (`translucencyVolumeOf`, `blend/pipelines.ts`), and no pass, texture or
bind group is made (`encodeTranslucencyVolume`, `lighting/translucency/frame.ts`). A surface that asks for the volume after
the session opened is drawn by programs built again (`grantGraphs`), and its field is a layout one (`session/world/repaint.ts`).

The image builds it in one compute pass (`lighting/translucency/gpu.ts`), after the shadow maps it reads and before the
blends, in four steps. (1) The cascades are placed (`bounds.ts`): the sphere that holds the stretch of the view's
frustum the cascade covers (the inner one from the camera to its distance, the outer one from there to its own), its far corners weighed ten times the near ones, a field of 45 degrees and a
square view unless `translucencyVolumeAdaptToPerspective` takes the camera's own (rounded up to a multiple of
`translucencyVolumeFovSnap`), its centre snapped to a multiple of two radii over the cells a side. (2) The lights each
cascade reaches are listed on the CPU (`cullLights`: the directional lights in both, a local light by the sphere
of its range against the cascade's box) into one buffer of light ranks, so that no cell walks a light that cannot reach it.
(3) The injection (`injectWgsl.ts`) runs a thread a cell of either cascade, the two stacked along the depth of one
texture, and adds each listed light's colour over π, times its fall-off, times its shadow read at the cell (one sample of the
virtual shadow map, as a blended surface's cheap read; a cell the maps hold no page for reads lit), to a two-band
spherical harmonic: the constant band of each colour and, in the alpha, the sun's share that reached the cell, and
the three linear terms along the light's direction, kept as the colours' luminance alone (the direction of light
has no colour). The cell's point is moved half a cell away from the light so its own cell takes no overblown share; the sun
takes its light function, the clouds' shade and the air's tint; a local light its light function. In the outer
cascade the shadow and the fall-off fade to the border over a tenth of its size, so that the border cells, which light
every surface past the volume, hold the sun unshadowed and no local light. The light is written multiplied by the
image's pre-exposure, which keeps the half floats' range at any exposure. (4) The temporal filter, where
`translucencyVolumeTemporal` is on, blends each cell with the cell of the volume of the image before at the same point
(the image before's boxes, a cell the point falls in; none where it lies outside them or the camera cut; the outer
cascade's border cells take none), by `translucencyVolumeHistoryWeight`, the history brought to this image's
pre-exposure by the ratio of the two; what it writes is the history of the next image, two volumes taking turns. The
blur (`translucencyVolumeBlur`) then makes each cell the mean of its 3 × 3 × 3 neighbours weighed 1, 2, 1 along each
axis, the cascade's edge held, over the temporal filter's volume where that ran, and packs it into the volume
the surfaces read.

A surface reads the volume in its fragment (`translucencyVolumeLight`, `readWgsl.ts`): its point, moved by a blue
noise of the pixel and the image where `translucencyVolumePositionOffsetRadius` is above 0, is read in the inner
cascade and in the outer one, each by eight loads blended trilinearly (the cell held to the cascade, as a clamped sampler
would), the inner one counting in full inside its box and fading to nothing over the sixth of its size at its edge. The
light is the constant band plus the linear bands along the normal (`volume`, `volumetric`) or the constant band alone
(`volumetricNonDirectional`), never below zero, times the surface's diffuse colour (none for a metal) over the pre-exposure.
It replaces the declared lights' sum; the bounce, the environment and the emission are added as for a forward surface, and
`volumetric` and `volumetricNonDirectional` drop the reflection term (`blendMedium`, `blend/shader.ts`).

**How the volume fits the fragment stage's limits.** The volume is one 3D texture of `rgba32uint`, both cascades
stacked along the depth, four words a cell (the ambient light's four channels and the directional light's three, half
floats), read by `textureLoad` as a read-only storage texture (`BLEND_BINDINGS.translucencyVolume`): it spends none
of the sixteen sampled textures nor of the eight storage buffers the blend's fragment stage already holds, and is the
fourth and last of its four storage textures (`gpu/core/stageLimits.test.ts`). The cascades' boxes and the
read words are three more fields of the blend's view block (`BlendView.volumeCorner`, `volumeScale`, `volumeRead`), which no
program that does not read the volume touches; a view that makes none binds a one-cell stand-in and writes 0
cells a side, which the fragment reads as black. The injection and the filters are compute programs of their own
(`injectWgsl.ts`, `filterWgsl.ts`) in groups of four cells a side, within the compute stage's default limits (the injection
binds five storage buffers, two storage textures, three sampled textures and four uniform buffers). The textures follow the cells a side the settings ask, within what the device's 3D textures hold,
and the device's memory budget may refuse them (`ledgerAdmitted`, through `createHeldTextures`, `gpu/core/heldTextures.ts`, which the fog's volume holds its textures with too): the surfaces then read black.

```js
const world = createWorld('viewer', { translucencyVolumeDim: 32 })
// A pane of glass lit by the volume: the sun and the lamps reach it through their shadow maps, once for the cell,
// not once for every light at every pixel.
const glass = material.meshStandard({
  transparent: true,
  opacity: 0.3,
  translucencyLighting: 'volume',
})
```
**The translucency global illumination volume.** The indirect light of every see-through surface (the blends, the water, the
transmissive stages) is one filtered fetch of a grid fitted to the view (`lighting/translucencyGi/`), in place of the gather of the
world's probes each of its fragments made. The grid is a cell of `translucencyGiGridPixelSize` pixels (32) across the image and
slices on the logarithm of the distance, `log2(depth · translucencyGiGridDistributionLogZScale + translucencyGiGridDistributionLogZOffset)
· translucencyGiGridDistributionZScale`, out to `translucencyGiEndDistance` (80 m): 60 × 34 × 26 cells at 1920 × 1080
(`translucencyGiGrid`, `layout.ts`). Each image, after the screen probes and the radiance cache (`encodeTranslucencyGi`, `frame.ts`),
in one compute pass: the cells worth tracing are the ones whose nearest slice lies in front of the farthest depth of the pyramid
in their footprint, a texel of the depth pyramid two cells across (`giVisible`); a thread a cell traces its
`translucencyGiTracingResolution`² cones (3 × 3) from a point of the cell the image's Halton jitter picks, moved forward where the depth
lies just behind it (`traceCones`, `traceWgsl.ts`; the cells' places and the history's reprojection use the camera's matrices without
the anti-aliasing jitter): the global distance field marched from the point itself, with no bias off a surface and no dither, out to where
the radiance cache is trusted, the surface cache read at the hit (`SP_MARCH`, the screen probes' own march),
the cache's light along the ray for what the march leaves (`spFarOf`); the cache is read, and the probes of the cells are marked
(`markCells`, in the bounce pass the pool marks in, `MarkSurface.markers`, only where the cache is read), `translucencyGiRadianceCacheClipmapBias` (3)
cascades coarser than the cascade that covers the cell, so that the cells that fill the view do not take the probes the surfaces
need; then three separable Gaussian passes along the axes (`filterX`, `filterY`, `filterZ`), the lights written to the half float's precision by a
stochastic rounding (`giQuantize`); then the integration into the two-band
harmonics, blended with the volume of the image before, reprojected through its view-projection (`integrateCells`). The volume is
one `rgba16float` 3D texture, the ambient light in the first half of its slices and the directional light (the linear bands'
luminance) in the second, two such textures taking turns as history; a fragment reads it through a trilinear sampler
(`translucentGiIrradiance`, `readWgsl.ts`), the last half slice fading to the sky light's irradiance, which is also all it reads
where no volume is made (an image whose screen probes cast none, a scene with no blended surface, a camera that is not a
perspective, `translucencyGi` off); a thin two-sided surface's back reads it along the opposite normal, and a material lit as a
medium takes the constant band alone. The volume takes the sampled texture the world's probes' atlas held in the blend programs
(16 of 16 sampled textures, 4 of 16 samplers, 9 of 12 uniform buffers: `gpu/core/stageLimits.test.ts`). What a fragment behind the
front surface of its pixel reflects is the environment through its lobes (`reflectionEnvironmentOf`); the front's is the trace's.
The radiance cache is the world's probes' (the shared path of the reference); a cache of its own for the volume is not made.


## Presentation

A session presents through its own canvas context; a world keeps its device across sessions,
each creating through its own handle (`gpu/core/sessionHandle.ts`, `gpu/core/deviceOwners.ts`,
`gpu/core/errorScope.ts`).

The composition writes the display colour and the canvas in one draw (two attachments) where something reads the
display colour, and the canvas alone otherwise (a pipeline compiled at the first such frame; until then both are
written), so the image is tone mapped once. A reader that finds the display colour left behind (`displayStale`: a
capture, the host's image readback) has the pose drawn again with it, and a held frame the canvas lost draws instead
of presenting it. The display colour is the copy a capture, a view placed at a rectangle of the canvas
and an offscreen composition read, and it stays because the canvas cannot serve them
(§ 21.2 and § 21.4 of the WebGPU specification). `getCurrentTexture()` gives the texture of the frame
being drawn, and it expires when the frame is presented ("Expire the current texture"); the drawing
buffer outlives it, but the only way to write it again is a new `getCurrentTexture()`, which replaces
the buffer ("Replace the drawing buffer": a blank one) — so a GPU copy of what a frame presented, asked
after the frame as a capture is, has no source on the canvas, and the canvas read as an external
image (`copyExternalImageToTexture`, "other Web APIs") converts its colour as the implementation does,
not bit for bit. A view placed at a rectangle redraws its part each frame for the same reason: the
canvas's buffer is replaced at each new texture. Adding `COPY_SRC` to the canvas's `usage` (§ 21.4, the
default is `RENDER_ATTACHMENT` alone) changes none of this. A still view that fills the canvas draws
nothing again: the buffer keeps its pixels, dither included, until a texture is taken
(`presenter.holds`, `frame/loop/hold.ts`).

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
on the opaque depth, never hard-edged: by the difference of the two depths along the view, over
the pool's `softness`. A disc lies across the view, its axes the camera's right and up, and turns by its
rotation; its size, rotation and colour are its own (`ParticleLook`), the pool's where it has none,
and its colour holds to its death unless the pool's `fade` says what it is multiplied by there.

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
in one pose. A bake is sampled at its clip's own rate, which the file records, so the track is as long as the clip: its
frames less one over that rate. The track's clock runs on the CPU with the scene's clips — a frame draws the second
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
| Probes and distance-field rays            | [Light that bounces](#light-that-bounces)       |
| Screen-space ambient occlusion            | [Ambient occlusion](#ambient-occlusion)         |

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
