# A partitioned scene

A compiled scene's spatially loaded objects lie in the cells of the grids of its partition's scheme
([COMPILER.md](../compiler/the-partitions-grids.md#the-partitions-grids)), which its root names: the
main grid's — one, or one for each entry of a job's `partitionGrids` —, and each HLOD level's. A
cell places its objects on rows of their meshes: a static object under its core node — one with
nodes under it under its own node —, an instanced skinned object at its skin's frame playing its
track ([Animation banks](animation-banks.md#animation-banks)), an animated object of the core at its
node, its host mesh the row's animation source — its skeleton and morph weights as the page's clips
leave them —, the row live while that mesh is shown. The camera is the scene's one streaming source
(`geometry/partition/source.ts`): at its eye, seen from above, a circle of each grid's own loading
range — scaled, or one radius for every grid —, or a sector of it around the view's axis. A cell is
wished while that shape meets the bounds it streams by, and not wholly beside or behind the sector
(`geometry/partition/plan.ts`, `geometry/hlod/hlodCells.ts`):

- `hashSet`, the default: the bounds it streams by within or on the circle's radius, the sector
  around the view's own axis without its up part — on grids the job does not lay flat, within or on
  a sphere of that radius, the sector a cone around the view's axis that the box's bounding sphere
  meets. The cells wished and not loaded load in one order: the higher level on its grid first, then
  the lower grid priority — its main grid's, each HLOD grid's 0 —, then the lower distance ratio:
  the squared distance from the eye to the box over the squared radius, at most 1, times half the
  cosine of the view's axis with the way from the box to the eye plus a half — 0 from within it —.
  The settings `sortByExtent`, `sortByPriority` and `angleWeight` rank nothing under this scheme.
- `spatialHash`: its square strictly within the circle's radius, the sector around the view's
  heading on the ground, and, under `worldStreamingZCulling`, its content's height range meeting the
  eye's within the radius; on a grid compiled with `pullCoarser`, a wished cell pulls in the coarser
  cells overlapping it, and those in turn (`geometry/partition/coarser.ts`,
  `geometry/hlod/hlodPulls.ts`). The cells wished and not loaded load in one order: the wider first
  (by their half side, or by their level), then the lower grid priority — its main grid's, then each
  HLOD grid's, 100 plus its level —, then the nearer, the squared distance to the cell's centre
  times the angle the view turns to reach it, over a half turn, raised to the angle weight.

At most `worldStreamingMaxLoadingCells` load at once, the next starting as one ends: those loading,
less than that, are the room left; at 0 or less none is held back. The actors always loaded — held
by no cell — make one unit a level; it ranks after every cell the view reaches, starts only while
room is left and takes none, and counts among those loading while the reads of its actors are not
done (`geometry/hlod/hlodTops.ts`). Each cell that starts takes a turn, and its reads — a cell's
files, an HLOD cell's actors' roots and rows — ask the session's queue by it, in a lane ahead of the
cut's pages: the queue serves every cell's reads in the one load order, a page never ranked among
them (`geometry/streaming/priority.ts`, `geometry/partition/loadOrder.ts`,
`geometry/partition/loadSlots.ts`). The cells not started are ranked again at each frame; one
loading keeps its turn, its reads staying where they were asked. The initial load — till the
session's first image is shown — holds none back, and that image waits for it: every cell wished
visible, its content placed and its roots resident (`frame/loop/firstImage.ts`).

Each cell is visible or not, as a streamed level is (`geometry/dag/worlds/worldFollow.ts`): it turns
visible once wished and loaded, invisible once wished no more. An HLOD actor is drawn while the cell
it lies in is visible and the cell it stands for is not: a cell shown hides its actor at once, a
cell hidden shows it if it is loaded. A cell file is a main grid cell's part of an HLOD 0 cell: its
rows draw while its main cell is visible — shown once wished on the main grid, placed and its roots
resident, hidden once wished no more (`geometry/dag/worlds/worldFiles.ts`) — or while its HLOD 0
cell is, every file of it loaded, as that cell's HLOD 0 actor; a cell not visible draws nothing of
its own and asks for nothing. The HLOD 0 cell of a layer not instanced is its main cell's own, on
the main grid: its rows draw as that main cell's, and past its range the HLOD 0 actor its layer
built of them stands for them, as any cell's actor. An actor whose layer asks no cluster DAG
(`clusterDag`, off by default for a merged, approximated or simplified mesh) is its level 0 alone
and is drawn whole at every distance: its roots stand in together, none withheld while another is
not resident, no error cutting it (`geometry/hlod/worldHlod.ts`); one whose layer asks for a DAG is
cut by its pixel error as any DAG is. The objects standing as themselves in an actor — an
`instanced` layer's every one, any other's those marked `hlodInstance` — are its rows
(`geometry/hlod/hlodRows.ts`): read with the actor, from the bundle its cell holds with its root
pages, placed on their meshes' own rows — grown for the actors loaded, never for the world's rows —
while the actor is loaded, each linked to the actor's cell (`ACTOR_ROW`,
`geometry/dag/worlds/worldLinks.ts`), drawn while that cell draws the actor and counted in its
readiness as its root pages are, painted in the HLOD view with the actor's HLOD level. A switch that
draws an actor whose layer asks a warm-up — every builder's but `instanced`'s — waits so many frames
in a row (`frame/prepare/hlodWarm.ts`); the actor stays warming till it is drawn or let go, and each
image, while it is in the drawn view, asks its geometry — the pages of its first 16 bundles past its
root page, ahead of the views' requests: for the frames of the count as it starts, for one while it
stands at zero — and its textures at the size it covers in that view, its count advancing once a
frame — the main view's image —, however many views draw. The initial load waits on none. A
see-through item follows the same words: its key record names its row's cell file slot and HLOD 0
cell, and the verdict draws it while either draws its placements (`blend/verdict/verdictWgsl.ts`).

A main grid compiled to block on slow streaming (`blockOnSlowStreaming`,
[COMPILER.md](../COMPILER.md)) waits for its cells near the view once the first image is shown
(`geometry/partition/slowStreaming.ts`): a cell file wished and not yet shown whose ratio — on a
square grid its content's distance from the eye less its half side over the grid's loading range, on
a loose grid the distance to the bounds it streams by over the view's radius — is at most 0 or under
`worldStreamingBlockOnSlowStreamingRatio` blocks; a view whose radius is nearly zero (under 10⁻¹⁰ m)
blocks nothing. While one does, no image is presented, the loop taking the whole frame
(`frame/loop/firstImage.ts`), until each file that blocks is shown; meanwhile every cell wished
loads at once, the cap `worldStreamingMaxLoadingCells` lifted as in the initial load, no HLOD cell
turns visible, no other file shows and no switch waits on a warm-up. The HLOD grids never block.
With `hlodEnabled` off, no HLOD cell is held or told, none draws its actor nor its HLOD 0 actor, and
every cell file streams on its own main grid alone.

**Several main grids.** A scene compiled with `partitionGrids`
([COMPILER.md](../compiler/the-partitions-grids.md#several-streaming-grids-partitiongrids)) has one
main grid for each entry, and reads as before with one. A cell file streams within the loading range
of the main grid its record names (`main`), ranks by that grid's priority, is tested from above or
in space as that grid lies flat or not, and — while the session's
`worldStreamingBlockOnSlowStreaming` is on — holds the first images back when that grid was compiled
to block (`blockOnSlowStreaming`) and the cell is near and not yet shown. Coarser cells
(`pullCoarser`) are pulled in per main grid.

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
changed since the last update, or when the scene root's world or a core parent moved (the cells hang
under nodes a host moves, and the bounds the plan reads move with them), and at every frame while
they may not be skipped: `worldStreamingUpdateOptimization` off (or both quantizations at 0), the
last frame left work (a cell wished still loading or not yet shown, a page of the index left for a
later frame, a placed file waiting for its HLOD 0 cell to be hidden), a load blocking on slow
streaming, the initial load, or every `worldStreamingForceUpdateFrameCount`th frame (0, never). The
first update after such a frame always runs. A frame that skips the update goes on with the last
plan, from the eye it was made from; the source stays where that update put it. The position and the
rotation the key reads are the view's own when it lies farther than a quantum from the world's
origin, and none otherwise, afresh at each frame; the yaw is always the view's own: its heading on
the ground, which a view looking straight down or up takes from its up vector.

**The shape of the view.** `worldStreamingExtraRadius` (metres) lengthens the radius of the view's
circle or sphere, whichever way it is taken (the grid's range times the scale, or
`worldStreamingRadius`); `worldStreamingExtraAngle` (degrees) widens the sector
(`worldStreamingSector`), a whole turn at most, and does nothing without one. A shape whose radius
(under 1e-8 centimetres) or angle (under 1e-8 degrees) is nearly zero is no shape: it wishes no
cell, and a cell it ranks is ranked last. `worldStreamingForce2D` makes a loose grid (`hashSet`)
that streams in 3D wish its cells by their footprint on the ground, the view's height ignored, as a
flat grid does; it changes nothing on a flat grid or a square grid (`spatialHash`).

**The order cells load in.** `worldStreamingPriority` is the view's priority as a streaming source,
0 (highest) to 255 (lowest), 128 by default: the source of the highest priority loads first. A scene
has one view, so every cell it wishes carries the one priority and no order changes; the setting
only makes the cells wished again when it moves. `worldStreamingUseVelocity` (false) adds the view's
average velocity to the axis a loose grid's cells are sorted along, so that a cell ahead of where
the view goes loads before one ahead of where it looks (the axis is the unit axis plus the velocity
in centimetres per second, made unit again). The velocity is measured on the view's eye in the world
and the session's clock, averaged over its last frames — none after a jump of more than 100 m of the
world or an idle of more than 5 s — and carried to the scene's frame as a vector.

**What the view asks of its cells.** `worldStreamingTargetState`: `activated` loads and draws them;
`loaded` loads them and keeps them placed in memory without activating any of them: every cell file,
every HLOD 0 actor and every HLOD actor a cell holds stays loaded, wished and switched as ever, and
draws nothing, and the rows of a scene compiled without HLOD are parked, their place kept; none
holds the images back. The actors always loaded, which no cell holds, stay activated and drawn over
every cell, wished or not.

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

| Field | Meaning | Default |
| --- | --- | --- |
| `worldStreamingMaxLoadingCells` | Cells that may load at once once the first image is shown, a whole number; 0 or less, no limit | `4` |
| `worldStreamingAngleWeight` | How much the angle to the view's heading weighs in a cell's turn, from 0 to 1 | `0.4` |
| `worldStreamingSortByExtent` | The wider cells first by their half side; `false`, by their level | `true` |
| `worldStreamingSortByPriority` | A grid's priority ranks before the distance; `false`, after | `true` |
| `worldStreamingUseGridRange` | The circle takes each grid's range times `worldStreamingRangeScale`; `false`, `worldStreamingRadius` | `true` |
| `worldStreamingRangeScale` | The scale of each grid's loading range, from 0 | `1` |
| `worldStreamingRadius` | The circle's radius for every grid, metres, from 0 | `100` |
| `worldStreamingSector` | Only a sector of the circle around the view's heading streams cells | `false` |
| `worldStreamingSectorAngle` | That sector's angle, degrees, from 0 to 360 | `360` |
| `worldStreamingZCulling` | A square grid's cell (`spatialHash`) is wished only while its content's height range meets the eye's height within the radius | `false` |
| `worldStreamingBlockOnSlowStreaming` | A grid compiled with `blockOnSlowStreaming` holds the images back while a cell near the view is not shown | `true` |
| `worldStreamingBlockOnSlowStreamingRatio` | The ratio under which a cell of a blocking grid not yet shown blocks, from 0 | `0.25` |
| `hlodEnabled` | The HLOD actors load and draw; `false`, the cells of the main grids draw alone | `true` |
| `worldStreamingUpdateOptimization` | The wishes are worked out again only once the view moved or turned enough, or while work is left; `false`, at every frame | `true` |
| `worldStreamingLocationQuantization` | Metres: the squares the view's position is cut into to tell whether it moved enough; 0, its exact position | `4` |
| `worldStreamingRotationQuantization` | Degrees: the steps the view's yaw (and pitch in 3D) is cut into to tell whether it turned enough; 0, its exact angle | `10` |
| `worldStreamingForceUpdateFrameCount` | Every that many frames the wishes are worked out again whatever the view did, a whole number from 0; 0, never | `0` |
| `worldStreamingForce2D` | A loose grid (`hashSet`) that streams in 3D wishes its cells by their footprint on the ground; no effect on a flat or a square grid | `false` |
| `worldStreamingExtraRadius` | Metres added to the radius of the view's circle (a sphere in 3D), from 0 | `0` |
| `worldStreamingExtraAngle` | Degrees added to the angle of the view's sector, from 0, a whole turn at most | `0` |
| `worldStreamingTargetState` | `activated`: the cells the view reaches load and draw; `loaded`: they load and stay placed, none activated | `activated` |
| `worldStreamingPriority` | The view's priority as a streaming source, 0 (highest) to 255 (lowest); with one view it changes no order | `128` |
| `worldStreamingUseVelocity` | The view's average velocity is added to the axis a loose grid's cells are sorted along | `false` |
| `hlodWarmup` | A switch that draws an HLOD actor whose layer asks one waits on its warm-up | `true` |
| `hlodWarmupFrames` | The frames in a row a warm-up lasts, a whole number from 0 | `5` |
| `hlodWarmupGeometry` | A warm-up asks the actor's geometry, ahead of the views' requests | `true` |
| `hlodWarmupTextures` | A warm-up asks the actor's textures | `true` |
| `hlodWarmupTextureScale` | The scale of the size the actor covers on screen its textures are asked at, from 0 | `2` |
| `hlodWarmupTextureClamp` | The most texels asked along a texture's side, a whole number from 1 | `2048` |
