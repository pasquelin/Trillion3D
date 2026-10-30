# A partitioned scene

A compiled scene's spatially loaded objects lie in cells of its partition scheme's grids
([COMPILER.md](../compiler/the-partitions-grids.md#the-partitions-grids)): main grids (one, or one per
job `partitionGrids` entry) and each HLOD level's. A cell places objects on rows of their meshes:

- static object under its core node;
- instanced skinned object at its skin's frame playing its track
  ([Animation banks](animation-banks.md#animation-banks));
- animated core object at its node, host mesh = row's animation source.

The camera is the scene's one streaming source (`geometry/partition/source.ts`): at its eye, seen
from above, a circle of each grid's loading range (scaled, or one radius for all grids), or a sector
of it around the view axis. A cell is wished while that shape meets its bounds
(`geometry/partition/plan.ts`, `geometry/hlod/hlodCells.ts`):

- `hashSet`, default: bounds within or on the radius, sector around the view axis; on non-flat grids
  a sphere, sector = cone that the box's bounding sphere meets. Load order: higher level, lower grid
  priority (main grid's, each HLOD grid's 0), lower distance ratio: squared eye-to-box distance over
  squared radius, at most 1, times half the cosine of view axis with box-to-eye way, plus a half
  (0 from within). `sortByExtent`, `sortByPriority`, `angleWeight` rank nothing here.
- `spatialHash`: square strictly within the radius, sector around view ground heading, and, under
  `worldStreamingZCulling`, content height range meeting eye's within radius; on a `pullCoarser` grid
  a wished cell pulls in overlapping coarser cells, transitively (`geometry/partition/coarser.ts`,
  `geometry/hlod/hlodPulls.ts`). Load order: wider first (half side, or level), lower grid priority
  (main grid's, each HLOD grid's 100 plus level), nearer: squared distance to cell centre times
  turn angle to it over a half turn, raised to the angle weight.

At most `worldStreamingMaxLoadingCells` load at once. Always-loaded actors (no cell) make one unit
per level; it ranks after every reached cell, starts only while room is left, takes none
(`geometry/hlod/hlodTops.ts`). A starting cell's reads ask the session queue in a lane ahead of cut
pages (`geometry/streaming/priority.ts`, `geometry/partition/loadOrder.ts`, `geometry/partition/loadSlots.ts`). Unstarted cells are
re-ranked every frame. Initial load holds none back; the first image waits for it: every cell wished
visible, content placed, roots resident (`frame/loop/firstImage.ts`).

A cell is visible once wished and loaded (`geometry/dag/worlds/worldFollow.ts`); an HLOD actor draws
while its cell is visible and the cell it stands for is not.

- Cell file = a main grid cell's part of an HLOD 0 cell: rows draw while its main cell is visible
  (`geometry/dag/worlds/worldFiles.ts`) or while its HLOD 0 cell is, all its files loaded.
- HLOD 0 cell of a non-instanced layer = its main cell's own.
- Actor whose layer asks no cluster DAG (`clusterDag`, off by default for merged, approximated or
  simplified mesh) = level 0 alone, drawn whole, no error cut (`geometry/hlod/worldHlod.ts`).
- Objects standing as themselves in an actor (every `instanced` layer object, any other's marked
  `hlodInstance`) = its rows (`geometry/hlod/hlodRows.ts`): linked to its cell (`ACTOR_ROW`,
  `geometry/dag/worlds/worldLinks.ts`), drawn while that cell draws the actor, counted in readiness.
- A switch drawing an actor whose layer asks a warm-up (every builder's but `instanced`'s) waits
  `hlodWarmupFrames` frames (`frame/prepare/hlodWarm.ts`), counted once a frame (main view's image);
  meanwhile the actor asks its geometry (pages of its first 16 bundles past root page) and its
  textures at the size it covers in the drawn view × `hlodWarmupTextureScale`, at most
  `hlodWarmupTextureClamp` texels a side. Initial load waits on none.
- A see-through item draws while its row's cell file or HLOD 0 cell draws its placements
  (`blend/verdict/verdictWgsl.ts`).

A main grid compiled to block on slow streaming (`blockOnSlowStreaming`,
[COMPILER.md](../COMPILER.md)) waits for near cells after the first image
(`geometry/partition/slowStreaming.ts`): a wished unshown cell file blocks when its ratio (square
grid: content distance from eye less half side over grid loading range; loose grid: distance to
streamed bounds over view radius) is at most 0 or under `worldStreamingBlockOnSlowStreamingRatio`; a
view radius under 10⁻¹⁰ m blocks nothing. While one blocks, no image is presented; every wished cell
loads at once, no HLOD cell turns visible, no other file shows, no switch waits on a warm-up. HLOD
grids never block. With `hlodEnabled` off: no HLOD cell held or told, none draws its actor or HLOD
0 actor, every cell file streams on its own main grid alone.

**Several main grids.** A scene compiled with `partitionGrids`
([COMPILER.md](../compiler/the-partitions-grids.md#several-streaming-grids-partitiongrids)) has a
main grid per entry. A cell file streams within the loading range of the main grid its record names
(`main`), ranks by its priority, is tested flat or in space as it is, and blocks first images if it
was compiled to block.

**When wishes are recomputed**
(`packages/sdk-browser/src/geometry/partition/streamingUpdate.ts`). Each frame the view reduces to a
key: camera world position (before the scene root's frame) cut into squares of
`worldStreamingLocationQuantization` (two ground axes; height too when the key is 3D: `hashSet`, or
`spatialHash` under `worldStreamingZCulling`); yaw (and 3D pitch; no roll) cut into steps of
`worldStreamingRotationQuantization`; the settings shaping wishes. Wishes are replanned when the key
changed, or the scene root's world or a core parent moved, and every frame while:

- `worldStreamingUpdateOptimization` is off (or both quantizations 0);
- last frame left work (wished cell loading or unshown, index page left over, placed file waiting
  for its HLOD 0 cell to hide);
- a load blocks on slow streaming, or the initial load runs;
- every `worldStreamingForceUpdateFrameCount`th frame (0: never).

**View shape.** `worldStreamingExtraAngle` has no effect without a sector. A shape with radius under
1e-8 centimetres or angle under 1e-8 degrees wishes no cell. `worldStreamingForce2D` has no effect on
a flat or square grid (`spatialHash`).

**Load order.** `worldStreamingPriority` changes no order (one view). `worldStreamingUseVelocity`:
sort axis = unit axis plus velocity in cm/s, re-normalised; velocity is averaged over the view's last
frames (none after a jump over 100 m of world or an idle over 5 s).

**What the view asks of cells.** `worldStreamingTargetState` `loaded`: every cell file, HLOD 0 actor
and cell-held HLOD actor stays loaded and draws nothing; none holds images back. Always-loaded actors
(no cell) stay activated and drawn.

Defaults are reference's. Each setting is a world option by its field, held over the quality preset,
changed later by `world.worldStreaming` (`packages/sdk-core/src/contracts/worldStreamingOptions.ts`);
unaccepted values are refused:

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
| - | - | - |
| `worldStreamingMaxLoadingCells` | Whole; 0 or less: no limit | `4` |
| `worldStreamingAngleWeight` | 0 to 1 | `0.4` |
| `worldStreamingSortByExtent` | Wider first; `false`: by level | `true` |
| `worldStreamingSortByPriority` | Grid priority before distance | `true` |
| `worldStreamingUseGridRange` | Radius = grid range × `worldStreamingRangeScale`; `false`: `worldStreamingRadius` | `true` |
| `worldStreamingRangeScale` | From 0 | `1` |
| `worldStreamingRadius` | Metres, from 0 | `100` |
| `worldStreamingSector` | Only a sector around view heading streams | `false` |
| `worldStreamingSectorAngle` | Degrees, 0 to 360 | `360` |
| `worldStreamingZCulling` | `spatialHash` height culling | `false` |
| `worldStreamingBlockOnSlowStreaming` | Grids compiled to block hold images back | `true` |
| `worldStreamingBlockOnSlowStreamingRatio` | Ratio under which an unshown cell blocks, from 0 | `0.25` |
| `hlodEnabled` | HLOD actors load and draw | `true` |
| `worldStreamingUpdateOptimization` | `false`: recompute wishes every frame | `true` |
| `worldStreamingLocationQuantization` | Metres; 0: exact | `4` |
| `worldStreamingRotationQuantization` | Degrees; 0: exact | `10` |
| `worldStreamingForceUpdateFrameCount` | Whole from 0; 0: never | `0` |
| `worldStreamingForce2D` | `hashSet` 3D grid wishes by ground footprint | `false` |
| `worldStreamingExtraRadius` | Metres, from 0 | `0` |
| `worldStreamingExtraAngle` | Degrees, from 0, whole turn at most | `0` |
| `worldStreamingTargetState` | `activated` or `loaded` | `activated` |
| `worldStreamingPriority` | 0 (highest) to 255 (lowest) | `128` |
| `worldStreamingUseVelocity` | Velocity added to loose-grid sort axis | `false` |
| `hlodWarmup` | Switch waits on warm-up | `true` |
| `hlodWarmupFrames` | Whole from 0 | `5` |
| `hlodWarmupGeometry` | Asks geometry | `true` |
| `hlodWarmupTextures` | Asks textures | `true` |
| `hlodWarmupTextureScale` | From 0 | `2` |
| `hlodWarmupTextureClamp` | Whole from 1 | `2048` |
