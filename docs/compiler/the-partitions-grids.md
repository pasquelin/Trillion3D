# The partition's grids

Every object — a visible node that places a mesh, no camera — is spatially loaded unless its
settings say otherwise ([Object settings](#object-settings)): it is drawn while the view lies within
its main grid's loading range of its cell
([ENGINE.md](../engine/a-partitioned-scene.md#a-partitioned-scene)). A static leaf leaves the table
the runtime reads first and is written in its cell, under its nearest core node, even one an
animation moves: its row follows it. A static object with nodes under it stays in the core for them,
without its mesh, and its cell draws that mesh under it; its mesh enters its layer's HLOD as a
leaf's does. An animated object — skinned, morphed, moved by a clip itself, or a skin's joint —
stays in the core, where its clips, its skin and the page's own code name it, and its cell draws it:
a row of its mesh at its node, its node's host mesh that row's animation source. An instanced
skinned object is written in its cell at its skin's frame — the node its top joints hang under —,
playing its track of the scene's [animation banks](#animation-banks). An object an animation moves,
itself or through a parent, takes no HLOD layer: past its cell's range nothing stands for it. An
object's bounds are its mesh's, an instanced skinned object's sampled bounds, a plain skinned
object's bounds over every clip moving its skin, a morphed object's mesh grown by its targets'
extents.

Objects attached under one another stream together: the topmost object above a node and every object
under it make one batch, placed in one cell by the box around their bounds. A batch one object of
which is not spatially loaded is loaded whole with the scene. A node that draws no mesh is a frame,
not an object: it joins no batch, so a scene root over everything never makes the whole scene one
cell.

The job picks the scheme the objects are cut into cells by (`partitionScheme`,
`--partition-scheme=`, `jobs[].partitionScheme`):

- `hashSet`, the default, the reference's: a loose hierarchical grid with no top, on the main grid's
  origin, flat on the ground unless the job says otherwise (`flat`). A batch goes to the level whose
  cell is as wide as its widest side — on the ground for a flat grid —, one finer while it overruns
  that finer cell by less than a quarter of the finest cell, counted in whole centimetres, and to
  the cell under its centre there. A cell loads while the view comes within its grid's range of the
  bounds it streams by: on the finest level those the job names (`streamBounds`: its content's box
  clipped to its cell's box by default, its content's box alone, or its cell's box), on a coarser
  one its content's box. HLOD level `i` streams on a loose grid of the cell side and loading range
  the job names it (`hlodGrids`), each else `2 << i` times the main grid's, on its origin and flat
  as it is, its cells loaded at priority 0; a cell on its finest level streams by its content
  clipped to its cell. A layer's own `cellSize` and `loadingRange` set nothing under this scheme, as
  the reference deprecates them.
- `spatialHash`, the older one: a square over the world, centred on its origin, as many cells of its
  `cellSize` a side as twice the farthest the objects' bounds lie from the origin on the ground,
  rounded up to a power of two; each level doubles the cell and halves the cells per side, up to one
  cell over the whole square, and each level below the top holds one cell more per side, centred
  too, its edges between those of the levels around it, unless the job nests the levels
  (`nestedLevels`). A batch whose ground box is no larger than a finest cell goes to the finest cell
  under its centre (`smallByCentre`); any other to the first level, from the one whose cell is as
  wide as its widest side on the ground, where its bounds on the ground meet one cell alone; the top
  level's one cell is the always loaded one: a batch it alone holds stays in the core, and no HLOD
  is built of it. A cell loads by its square; with `pullCoarser`, a wished cell pulls in every cell
  of the levels above it, below the top, that its square overlaps, and those in turn. Each HLOD
  layer streams on the grid its `cellSize` and `loadingRange` name ([HLOD](hlod.md#hlod)), centred
  on the world's origin under the main grid's settings of the scheme, its cells loaded at priority
  100 plus its level — after the main grid's.

`true` names the default; `false` is refused: `partitionGrid: false` is what turns the streaming
off. A flat grid — a square one always — is 2D: glTF's up axis (`+Y`) never places an object, and
keeps a cell out of range only when the session culls square cells by height
(`worldStreamingZCulling`, [ENGINE.md](../ENGINE.md)).

The job sets the main grid (`partitionGrid`, `--partition-grid=`, `jobs[].partitionGrid`), each
setting the reference's main grid's when left out; `true` names every default, and `false` turns the
streaming off: every object is loaded with the scene, no cell is cut and no HLOD is built. Several
main grids are `partitionGrids`, [below](#several-streaming-grids-partitiongrids).

```ts
await prepare(source, cache, 'full', 150000, {
  resourceBaseUrl: '/assets/city/',
  partitionScheme: 'hashSet',
  partitionGrid: { cellSize: 64, loadingRange: 192 },
})
```

`trillion3d-compile --partition-scheme=spatialHash '--partition-grid={"cellSize":64,"loadingRange":192}' …`,
or `'--partition-grid=false'` for a scene loaded whole.

| Field | Meaning | Default |
| --- | --- | --- |
| `cellSize` | The side of the finest cell, metres, above 0 | `128` |
| `loadingRange` | The distance from the view, metres, above 0, within which a cell loads | `256` |
| `priority` | The grid's load priority among the grids, a whole number from 0 to 4294967295, the lower the sooner | `0` |
| `origin` | The grid's origin, `[x, z]` on the ground, or under `hashSet` `[x, y, z]`, metres | `[0, 0]` |
| `blockOnSlowStreaming` | Once the first image is shown, a cell of the grid wished and not yet shown near the view holds the images back till it shows, while the session's `worldStreamingBlockOnSlowStreaming` is on ([ENGINE.md](../engine/a-partitioned-scene.md#a-partitioned-scene)); the HLOD grids never do | `false` |
| `streamBounds` | `hashSet` alone: what a finest cell streams by, `"content"`, `"cell"` or `"clipped"` (the content's box clipped to the cell's) | `"clipped"` |
| `flat` | `hashSet` alone: the grids lie flat on the ground; `false`, they cut height too and test in 3D | `true` |
| `hlodGrids` | `hashSet` alone: per HLOD level from 0, `{ "cellSize", "loadingRange" }` or `null`, each left out `2 << level` times the main grid's | none |
| `nestedLevels` | `spatialHash` alone: each level's cells nest in the next one's | `false` |
| `pullCoarser` | `spatialHash` alone: a wished cell pulls in the coarser cells overlapping it, levels not nested | `false` |
| `smallByCentre` | `spatialHash` alone: a batch no larger than a finest cell on the ground goes to the one under its centre | `true` |

The defaults are those of a world the reference creates. A loose grid placed off the ground and its
HLOD grids sized apart:

```ts
partitionGrid: { flat: false, origin: [0, -50, 0], streamBounds: 'clipped', hlodGrids: [{ cellSize: 512 }, null, { loadingRange: 4096 }] }
```

and a square grid whose levels nest, big objects placed by their bounds alone:

```ts
partitionScheme: 'spatialHash',
partitionGrid: { nestedLevels: true, smallByCentre: false },
```

Each main cell's objects of one layer make that layer's HLOD 0 actor, which lies in the cell of its
layer's grid the scheme gives it; under `spatialHash`, an instanced layer's actor no cell below its
grid's top holds keeps its objects in the core, any other layer's is then always loaded. The
partition's root names its scheme, whether its grids lie flat, every grid — its cell side, loading
range, priority, HLOD level, whether a load blocks on its slow streaming and whether cell files
stream on it: the main grids, and each grid an HLOD 0 cell lies on — and what each square grid that
pulls coarser cells finds them by; each cell file names the bounds it streams by and its HLOD 0 cell
with the level of its cell on its grid, and the main grid it lies on when that is not the first
([FORMAT.md](../format/prepared-scene-tables.md#world-partition)). A job naming a scheme, a grid or
grids moves the cache key; one naming none keeps it. A scheme that is none of the names, a grid
value that is none of the forms, a field the grid does not hold, a setting of the other scheme, a
size or range not above 0, a priority out of its range, a `streamBounds` none of its names, an HLOD
level's grid that is neither an object of its two sizes nor `null`, or an origin that is not two
finite numbers — or three under `hashSet` — refuses the job (`INVALID_OPTIONS`).

## Several streaming grids (`partitionGrids`)

A scene streams on one grid by default (`partitionGrid`). A job that wants objects on grids of
different cell sides, loading ranges or priorities — a fine grid for small props, a coarse one for
towers — names several: `partitionGrids` (`--partition-grids=`, `jobs[].partitionGrids`), a list
whose entries take the settings of `partitionGrid` under a `name`. The first grid is the default:
every object that names no grid, or names one the list does not hold, streams on it. A job names
`partitionGrid` or `partitionGrids`, not both.

An object picks its grid with the `runtimeGrid` setting of `objectSettings` (a rule by object, the
scene's setting, or the node's own glTF `extras`, like every object setting). An object attached
under another streams on the grid of the topmost object above it, as a batch is placed in one cell.

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

`trillion3d-compile '--partition-grids=[{},{"name":"towers","cellSize":1024,"loadingRange":4096}]' '--object-settings={"objects":[{"match":{"regex":"^tower"},"runtimeGrid":"towers"}]}' …`

| Entry field | Meaning | Default |
| --- | --- | --- |
| `name` | The grid's name: a text, not empty, holding neither `:` nor `.`, told from another's without regard to case; required but of the first grid | `"MainPartition"` (first grid) |
| every setting of `partitionGrid` | `cellSize`, `loadingRange`, `priority`, `origin`, `blockOnSlowStreaming`, and each scheme's own | as `partitionGrid` |

Each grid has its own cells, its own loading range and priority, whether it lies flat (`flat`: a
flat grid and a grid cut in space may live side by side) and — under `hashSet` — its own chain of
HLOD grids, each level the grid's `hlodGrids` or its cell and range times `2 << i`, built only for a
grid that owns an object. Under `spatialHash` the HLOD layers keep the grids their `cellSize` and
`loadingRange` name, shared by the objects of every main grid, and the three square settings
(`nestedLevels`, `pullCoarser`, `smallByCentre`) are the whole partition's: the first grid's, which
a later grid may name alike or not at all. A `partitionGrids` that is no list, is empty or comes
beside `partitionGrid`, an entry that is no object or holds a field no entry holds, a setting of the
other scheme, a name that is missing (past the first grid), not a text, held by two grids or holding
`:` or `.`, a square setting a later grid names unlike the first's, and a `runtimeGrid` that is no
grid name (it holds `:` or `.`) refuse the job (`INVALID_OPTIONS`); a `runtimeGrid` that names no
grid of the job streams on the first grid, and the compile tells it in its assignment warnings. A
job naming no `partitionGrids` compiles, and writes, as before.

## Object settings

`objectSettings` (`--object-settings=` JSON, `jobs[].objectSettings`, `resolveObjectSettings`) sets
each object's settings: the scene's, and under `objects` rules `{ match, …settings }` naming objects
as `voxelize` does. For each setting of an object the first that names it wins: the first rule
matching it, `objectSettings`' own setting, its node's glTF `extras` under the setting's name, the
default — the reference's.

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

`trillion3d-compile '--object-settings={"skinnedInstance":true}' …`; in the glTF,
`"extras": { "spatiallyLoaded": false }` or `"extras": { "skinnedInstance": { "playRate": 0.5 } }`
on a node.

| Setting | Meaning | Default |
| --- | --- | --- |
| `spatiallyLoaded` | `true`: the object streams on its main grid; `false`: it is loaded with the scene and always drawn | `true` |
| `skinnedInstance` | A skinned object plays a clip baked into the [animation banks](#animation-banks) on the GPU: `true` every default, `false` none, or the settings below | `false` |
| `drawDistance` | The distances an object is drawn at, from the eye, in the scene's units: `false` none, or `{ min, max, perInstance }`. The cut does not draw the object while the sphere of its bounds lies wholly nearer than `min` or wholly farther than `max`. A `min` or a `max` of 0 names none of its end, and an object naming no distance at all is `false` too (one form for none). `perInstance: true` says the object is one instance of an instanced mesh (a node `EXT_mesh_gpu_instancing` expands into): its bounds' centre is tested instead of the sphere, it is drawn at every distance without a `max`, and a `min` alone is none. Each a finite number of at least 0 | `false` |
| `runtimeGrid` | The name of the streaming grid the object streams on ([Several streaming grids](#several-streaming-grids-partitiongrids)): a text holding neither `:` nor `.`; none, or a name no grid of the job holds, the first grid. An object attached under another streams on the grid of the topmost object above it | the first grid |
| `farField` | Whether a view's primed depth draws the object (`hizPrime`, a small coarse draw its Hi-Z pyramid is built from before its cut): `true` or `false` | `false` |

An instanced skinned object's settings:

| Setting | Meaning | Default |
| --- | --- | --- |
| `clip` | The animation it plays: its rank in the document, or its name | the first animation moving a joint of its skin |
| `looping` | Whether its track wraps at its end; `false`, it holds its last pose | `true` |
| `playRate` | The seconds of the clip one second plays | `1` |
| `position` | The second it starts from, held within the clip | `0` |
| `boundsScale` | The scale of its sampled bounds about their centre, above 0 | `1` |
| `animationMinScreenSize` | The screen size — its bounds' diameter over the view's height — under which it is drawn in its rest pose; 0 the run-time setting `animationMinScreenSize` (0.1, [ENGINE.md](../engine/animation-banks.md#animation-banks)), a negative value never | `0` |
| `mobility` | `static` or `stationary`: its cell's HLOD 0 actor plays it on past the main range; `movable`: no HLOD stands for it | `movable` |

The run-time settings `cutDrawDistanceCulling`, `cutDistanceCullToSphereEdge`,
`cutViewDistanceScale` and the field-of-view scales
([ENGINE.md](../engine/webgpu-page-raster.md#webgpu-page-raster)) turn the cull of the instances
off, measure it to the centre, and scale the distances at run time; they change no byte of the
compiled scene. The compiler writes the distances of each object that names one into the scene's
node table (`nodes[].drawDistance`, `{ min, max, perInstance }`) and, for an object that streams,
into its cell's node row; a scene naming none carries no byte of it.

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

On the command line:
`trillion3d-compile '--object-settings={"objects":[{"match":{"regex":"^Grass"},"drawDistance":{"max":80,"perInstance":true}}]}' …`;
in the glTF, on the node: `"extras": { "drawDistance": { "min": 5, "max": 400 } }`.

A job naming `objectSettings` moves the cache key; one naming none keeps it. A field it does not
hold, a value of another type, a clip naming no animation, a negative position, a bounds scale not
above 0, another mobility, a draw distance that is neither `false` nor an object of `min`, `max` and
`perInstance` (each distance a finite number of at least 0, `perInstance` true or false), or a
`runtimeGrid` that is no text without `:` or `.` refuses the job (`INVALID_OPTIONS`).

## Animation banks

The clips the instanced skinned objects play, baked once into `animation-banks.bin`
([FORMAT.md](../format/animation-banksbin.md#animation-banksbin)): per skin and clip, at the rate
the clip's own duration fits (30 frames a second when it fits none of the usual rates), each joint's
translation and rotation in the skin's frame and its inverse bind matrix; identical bakes written
once. An item — a bake on a mesh, with its looping, start, play rate, rest screen size and bounds —
is one track: every object playing one item is in one pose. A skin whose joints scale in its frame
cannot be baked (a bank keeps no scale): its objects stay skinned objects their host's clips move,
and the compile names them in its warnings. An instanced skinned object must be a leaf with no morph
target. Its HLOD 0 actor is its own cell rows, playing its track while its cell is held to the HLOD
0 range; no HLOD layer above HLOD 0 builds anything of it — the merge, the shell and the voxels take
no skinned object.
