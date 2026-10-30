# The partition's grids

Every object (visible node placing a mesh) is spatially loaded unless its settings say otherwise
([Object settings](#object-settings)): drawn while the view is within its main grid's loading range
of its cell ([ENGINE.md](../engine/a-partitioned-scene.md#a-partitioned-scene)).

- Static leaf: written in its cell under its nearest core node.
- Static object with nodes under it: stays in the core, meshless; its cell draws the mesh.
- Animated object (skinned, morphed, clip-moved, or a skin's joint): stays in the core; its cell
  draws a row of its mesh at its node.
- Instanced skinned object: written in its cell at its skin's frame, playing its track of the
  [animation banks](#animation-banks).
- Object moved by an animation, itself or via a parent: no HLOD layer.
- Bounds: mesh's; instanced skinned: sampled; plain skinned: over every clip moving its skin;
  morphed: mesh grown by its targets' extents.

Attached objects stream together: topmost object plus all under it form one batch, placed in one
cell by their bounds' box; a non-spatially-loaded object makes it load whole with the scene. A node
drawing no mesh joins no batch.

Scheme: `partitionScheme`, `--partition-scheme=`, `jobs[].partitionScheme`:

- `hashSet` (default): loose hierarchical grid, no top, on main grid's origin, flat on the ground
  unless `flat` says otherwise.
  - Batch goes to the level whose cell equals its widest side (ground side if flat), one finer while
    it overruns that cell by under a quarter finest cell (whole cm), in the cell under its centre.
  - Cell loads while view is within its grid's range of its streamed bounds: finest level, job's
    `streamBounds`; coarser levels, content's box.
  - HLOD level `i`: loose grid with cell side and range from `hlodGrids`, else `2 << i` times main
    grid's, same origin and flatness, priority 0. A layer's `cellSize`/`loadingRange` set nothing.
- `spatialHash` (older): square over the world centred on origin, `cellSize` cells a side, count =
  twice the farthest ground distance of object bounds from origin, rounded up to a power of two.
  - Each level doubles cell, halves cells per side, up to one cell over the square; each level below
    top has one more cell per side, centred, unless `nestedLevels`.
  - Batch no larger than a finest cell on the ground: finest cell under its centre
    (`smallByCentre`); else the first level, from the one matching its widest ground side, where
    its ground bounds meet one cell alone.
  - Top level's one cell is always loaded: a batch only it holds stays in the core, no HLOD.
  - `pullCoarser`: a wished cell pulls in the coarser cells its square overlaps, and those in turn.
  - HLOD layers stream on the grid their `cellSize` and `loadingRange` name
    ([HLOD](hlod.md#hlod)), centred on world origin, priority 100 plus level.

`false` as scheme is refused. Flat grids are 2D: glTF up axis (`+Y`) never places an object and
keeps a cell out of range only if the session culls square cells by height
(`worldStreamingZCulling`, [ENGINE.md](../ENGINE.md)).

Main grid: `partitionGrid`, `--partition-grid=`, `jobs[].partitionGrid`; omitted settings take
defaults; `partitionGrid: false`: streaming off (no cells, no HLOD). Several main grids:
[below](#several-streaming-grids-partitiongrids).

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/city/',
  partitionScheme: 'hashSet',
  partitionGrid: { cellSize: 64, loadingRange: 192 },
})
```

Command line: `trillion3d-compile --partition-scheme=spatialHash '--partition-grid={"cellSize":64,"loadingRange":192}'`,
or `'--partition-grid=false'` for a scene loaded whole.

| Field | Meaning | Default |
| - | - | - |
| `cellSize` | Finest cell side, metres, above 0 | `128` |
| `loadingRange` | Distance from view, metres, above 0, within which a cell loads | `256` |
| `priority` | Load priority among grids, whole 0 to 4294967295, lower sooner | `0` |
| `origin` | Metres: `[x, z]`; `hashSet`: `[x, y, z]` | `[0, 0]` |
| `blockOnSlowStreaming` | A wished, near, unshown cell holds images back, while `worldStreamingBlockOnSlowStreaming` is on; HLOD grids never | `false` |
| `streamBounds` | `hashSet`: finest cell's streamed bounds, `"content"`, `"cell"` or `"clipped"` (content box clipped to cell's) | `"clipped"` |
| `flat` | `hashSet`: flat on ground; `false`: cut height too, test in 3D | `true` |
| `hlodGrids` | `hashSet`: per HLOD level from 0, `{ "cellSize", "loadingRange" }` or `null` (omitted: `2 << level` times main grid's) | none |
| `nestedLevels` | `spatialHash`: each level's cells nest in next's | `false` |
| `pullCoarser` | `spatialHash`: wished cell pulls in overlapping coarser cells, levels not nested | `false` |
| `smallByCentre` | `spatialHash`: batch no larger than a finest cell goes to the one under its centre | `true` |

A loose grid off the ground with separately sized HLOD grids:

```ts
partitionGrid: { flat: false, origin: [0, -50, 0], streamBounds: 'clipped', hlodGrids: [{ cellSize: 512 }, null, { loadingRange: 4096 }] }
```

and a square grid with nested levels, big objects placed by bounds alone:

```ts
partitionScheme: 'spatialHash',
partitionGrid: { nestedLevels: true, smallByCentre: false },
```

A main cell's objects of one layer make that layer's HLOD 0 actor in that layer's grid; under
`spatialHash`, an instanced layer's actor no cell below the top holds keeps its objects in the core;
any other layer's is always loaded.

Recorded in the partition root and cell files
([FORMAT.md](../format/prepared-scene-tables.md#world-partition)). Naming a scheme or grid moves the
cache key. Refused (`INVALID_OPTIONS`): unknown scheme; grid of no known form; unknown field; other
scheme's setting; size or range not above 0; priority out of range; unknown `streamBounds`; HLOD
level grid neither a two-size object nor `null`; origin not two finite numbers (three under
`hashSet`).

## Several streaming grids (`partitionGrids`)

`partitionGrids` (`--partition-grids=`, `jobs[].partitionGrids`): list of `partitionGrid` entries
plus a `name`. First grid is the default for objects naming no grid or an unlisted one. An object
picks its grid by `runtimeGrid` ([Object settings](#object-settings)); attached objects use the
topmost object's grid.

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/city/',
  partitionGrids: [
    { cellSize: 128, loadingRange: 256 }, // the default grid, named MainPartition
    { name: 'towers', cellSize: 1024, loadingRange: 4096, priority: 1 },
  ],
  objectSettings: { objects: [{ match: /^tower/, runtimeGrid: 'towers' }] },
})
```

Command line:
`trillion3d-compile '--partition-grids=[{},{"name":"towers","cellSize":1024,"loadingRange":4096}]' '--object-settings={"objects":[{"match":{"regex":"^tower"},"runtimeGrid":"towers"}]}'`.

| Entry field | Meaning | Default |
| - | - | - |
| `name` | Non-empty text, no `:` or `.`, case-insensitive; required except first grid | `"MainPartition"` (first grid) |
| every `partitionGrid` setting | `cellSize`, `loadingRange`, `priority`, `origin`, `blockOnSlowStreaming`, each scheme's own | as `partitionGrid` |

Each grid has own cells, range, priority, flatness and, under `hashSet`, own HLOD grid chain (level =
grid's `hlodGrids` or its cell and range times `2 << i`), built only for a grid owning an object.
Under `spatialHash` HLOD layers keep the grids their `cellSize` and `loadingRange` name, shared by
all main grids; `nestedLevels`, `pullCoarser`, `smallByCentre` are the first grid's.

Refused (`INVALID_OPTIONS`): `partitionGrids` not a list, empty, or beside `partitionGrid`; entry not
an object or with unknown field; other scheme's setting; name missing (past first grid), not text,
duplicated, or holding `:` or `.`; square setting a later grid names unlike the first's; bad
`runtimeGrid`. `runtimeGrid` naming no job grid streams on the first grid (compile warns).

## Object settings

`objectSettings` (`--object-settings=` JSON, `jobs[].objectSettings`, `resolveObjectSettings`): scene
settings plus `objects` rules `{ match, …settings }` naming objects as `voxelize` does. Per setting
the first source wins: first matching rule, `objectSettings`' own, node glTF `extras` under the
setting name, default.

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/crowd/',
  objectSettings: {
    objects: [
      { match: '^Walker', skinnedInstance: { clip: 'Walk', mobility: 'static' } },
      { match: 'Lighthouse', spatiallyLoaded: false },
    ],
  },
})
```

Command line: `trillion3d-compile '--object-settings={"skinnedInstance":true}'`. glTF node:
`"extras": { "spatiallyLoaded": false }` or `"extras": { "skinnedInstance": { "playRate": 0.5 } }`.

| Setting | Meaning | Default |
| - | - | - |
| `spatiallyLoaded` | `true`: streams on its main grid; `false`: loaded with scene, always drawn | `true` |
| `skinnedInstance` | Skinned object plays a clip from the [animation banks](#animation-banks): `true` defaults, `false` none, or settings below | `false` |
| `drawDistance` | Scene units from eye: `false` none, or `{ min, max, perInstance }`, each finite, at least 0 (0 = none of that end). Skips the object while its bounds' sphere is wholly nearer than `min` or wholly farther than `max`. `perInstance: true` (object is one instance of an `EXT_mesh_gpu_instancing` mesh): tests bounds' centre; drawn at every distance without `max`; lone `min` is none | `false` |
| `runtimeGrid` | Streaming grid name ([Several streaming grids](#several-streaming-grids-partitiongrids)): text without `:` or `.`; none or unknown: first grid | first grid |
| `farField` | Whether a view's primed depth draws the object (`hizPrime`): `true`/`false` | `false` |

Instanced skinned object settings:

| Setting | Meaning | Default |
| - | - | - |
| `clip` | Animation played: document rank or name | first animation moving a joint of its skin |
| `looping` | Track wraps at end; `false`: holds last pose | `true` |
| `playRate` | Clip seconds per second | `1` |
| `position` | Start second, held within clip | `0` |
| `boundsScale` | Scale of sampled bounds about their centre, above 0 | `1` |
| `animationMinScreenSize` | Screen size (bounds' diameter over view height) below which it draws in rest pose; 0: run-time `animationMinScreenSize` (0.1, [ENGINE.md](../engine/animation-banks.md#animation-banks)); negative: never | `0` |
| `mobility` | `static` or `stationary`: its cell's HLOD 0 actor plays it past main range; `movable`: no HLOD | `movable` |

Run-time settings `cutDrawDistanceCulling`, `cutDistanceCullToSphereEdge`, `cutViewDistanceScale`
and the field-of-view scales ([ENGINE.md](../engine/webgpu-page-raster.md#webgpu-page-raster)) switch
instance culling, measure to the centre, and scale distances. Distances are written to
`nodes[].drawDistance` and, for streaming objects, the cell's node row.

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/meadow/',
  objectSettings: {
    // Every object of the scene is drawn at every distance, unless a rule below says otherwise.
    drawDistance: false,
    objects: [
      // A tower is not drawn nearer than 5 m (its whole sphere), at any distance past it.
      { match: 'Tower', drawDistance: { min: 5 } },
      // Each blade of an instanced grass is drawn up to 80 m, by its centre.
      { match: /^Grass/, drawDistance: { max: 80, perInstance: true } },
      // A lamp post is drawn between 5 m and 400 m.
      { match: 'LampPost', drawDistance: { min: 5, max: 400 } },
    ],
  },
})
```

Command line:
`trillion3d-compile '--object-settings={"objects":[{"match":{"regex":"^Grass"},"drawDistance":{"max":80,"perInstance":true}}]}'`;
glTF node: `"extras": { "drawDistance": { "min": 5, "max": 400 } }`.

Naming `objectSettings` moves the cache key. Refused (`INVALID_OPTIONS`): unknown field; wrong value
type; clip naming no animation; negative position; bounds scale not above 0; other mobility; bad
`drawDistance`; `runtimeGrid` not a text without `:` or `.`.

## Animation banks

Clips instanced skinned objects play, baked once into `animation-banks.bin`
([FORMAT.md](../format/animation-banksbin.md#animation-banksbin)): per skin and clip, at the rate the
clip's duration fits (30 frames/s when none), each joint's translation and rotation in the skin's
frame plus inverse bind matrix; identical bakes written once. Item (bake on a mesh, with looping,
start, play rate, rest screen size, bounds) = one track, shared by all objects playing it. A skin
whose joints scale in its frame can't be baked: its objects stay plain skinned objects (compile
warns). Instanced skinned objects must be leaves with no morph target. HLOD 0 actor = its own cell
rows playing its track; no HLOD layer above HLOD 0 builds anything of it.
