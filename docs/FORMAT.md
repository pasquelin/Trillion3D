# Cache formats 9 and 10 — produced and read by the SDK

The on-disk contract: what the compiler writes and the SDK reads.

## Layout

| Pointer | Payload |
| --- | --- |
| `native/<scope>/manifest.json` | `native/<scope>/<key>/clusters.json` and its pages, `source.gltf`, `source.bin`; SHA-addressed objects `native/objects/<digest>.bin`, one per index page, geometry page or streaming bundle; baked texture levels `native/textures/v<N>/<digest>/<kind>-<level>.<format>`, a lossless PNG per mip level above the sidecar's tail, plus the cooked block family where the quality gate kept it |

`<scope>` is `slice` or `full`. A pointer or payload with another scope is rejected
(`SCOPE_MISMATCH`).

Every served object is named by the SHA-256 of its content with the `.bin` extension, which static
servers already serve as `application/octet-stream`: no extension mapping, MIME configuration or
rule is needed, and the manifest names each object in full, so the reader depends on no extension.

## Pointer

```json
{
  "status": "ready",
  "formatVersion": 9,
  "compiler": "native-rust",
  "key": "<cache-key>",
  "scope": "slice",
  "url": "<key>/clusters.json"
}
```

`status` must be `ready`; `url` is resolved relative to the pointer. The reader accepts formats 9
and 10 (`FORMAT_VERSION`, `CLUSTERED_BLEND_FORMAT_VERSION`) and refuses every other whole, by its
number, before any field is read; SDK, compiler and cache versions are independent.

| Version | What changed | Why an older folder is refused |
| --- | --- | --- |
| 10 | `formatVersion: 10`, in this pointer and the metadata, required by a cache containing `clustered-blend`; every other cache is 9 | An older reader refuses it instead of treating transparent pages as opaque |
| 9 | Format 9 pages the manifest | An earlier manifest is not paged |
| 7 | `selectedNodes` a count (7 and 8) where 5 and 6 wrote a list | A list gives no count to read |
| 5 | Added the [prepared-scene tables](#prepared-scene-tables), which a reader builds its scene from | An earlier folder has no tables to give; the tables carry a version of their own, refused by name when it is not the one the reader builds from |

## `clusters.json`

`clusters.json` is the manifest's root, one size whatever the world (1 717 bytes at `full` scope for
the grids of 48² and 192² and the open-world cell laid 8 × 8; `compiler_manifest_pages.rs`): the
fields naming the product — `status`, `formatVersion`, `schema`, `scope`, `key`, `compilerVersion`
—, `head`, the head page's slot, and `pages`, eight mesh-page slots, empty ones last, laid out and
paged as the [paged cell index](#world-partition). A page is `manifest-page-<sha256>.json`: the
head, `{ version: 10, …, binary }`, holds every other field below and the texture previews'
column-file descriptor; a mesh page, `{ version: 10, primitives, binary }`, slim primitives and
their columns' descriptor; an index page, `{ version: 10, pages }`, at most eight slots. Mesh pages
are cut by the same pager from the primitives in order, halved: a region page is one primitive, or
the primitives whose page fits 128 KiB (`PAGE_BYTES`), each with its own column file, written before
the scene tables whose region pages name them (#792). What a run reports of itself
(`reusedPages`, every `…Ms` metric, `peakRssBytes`) and of its settings (`threads`, `ramBudgetMb`,
`admissionEstimatedBytes`, `compileWaves`) is in no page, so a rebuild writes the same bytes, on any
threads and under any RAM budget (#1370, #1405); an older head carrying them still reads, the fields
ignored. A reader checks the root (`assertCacheRoot`), reads the pages in parallel,
each against its slot and column-file descriptor, and merges them (`readPagedManifest`). Rewriting a
key folder removes, once the new root is written, every manifest page and column file it no longer
names.

Required fields of the merged manifest, read by the browser adapter:

- `schema` / `formatVersion` — must agree, as in the [pointer](#pointer)
- `status` — `ready`
- `scope` — `slice` or `full`
- `selectedTriangles`, `selectedNodes` — counts of triangles and nodes kept, not lists, so they do
  not grow with the placed objects
- `primitives[]` — `{ mesh, primitive, pass, clusterStrategy, pages, culling, structure, streams,
  dag, topology }`
  - `pass`: `exact-clusters` for opaque/MASK geometry, `clustered-blend` for static BLEND geometry,
    `shared-blend` for unsplit transmissive geometry (`KHR_materials_transmission` with
    `transmissionFactor > 0`).
  - `clusterStrategy`: `dag-groups` on every DAG primitive, `null` on a `shared-blend` one, which
    carries no pages.
  - `errorModel`: `dag-group-qem-v3`, the one model read — absolute group error weighing positions,
    normals and texture coordinates, clamped to the group's extent, never below the sampled
    Hausdorff distance between the group's children and outputs. A `dag-group-qem-v1` (positions
    only) or `dag-group-qem-v2` (quadric error alone, below the geometry on curved surfaces) cache
    is refused with `STALE_CACHE`. Every cluster carries its own screen-error band, so nothing walks
    a tree; a cache whose clusters carry none (the page tree of earlier compilers) is refused by
    `assertCacheIdentity` with `STALE_CACHE`, naming the primitive, so a host recompiles rather than
    half-reads.
  - `simplification`: `true` when compiled with `qem-endpoints`.
- `worstStalls[]` — the stall table, ranked by the compiler: at most ten primitives whose stalled
  group kept level-0 triangles as roots, most `rootTriangles` first, ties in manifest order, each `{
  index, mesh, primitive, rootTriangles, cause, seamVertices, lockedVertices, uvIslands }` (manifest
  rank and `dag` summary). A primitive whose only stall is its coarsest group, above levels that
  climbed, keeps no level-0 root and is not listed (its `dag.stalls[]` names it). The CLI's `stall`
  events and the bench's `resume.md` print it as is
- `worldRoots` — the [world super-roots](#world-super-roots) report, pinned top bytes included; not
  read by the browser.
- `binary` — `{ version, url, sha256, bytes, pageUrl, geometryUrl, bundleUrl, texturePreviews,
  texturePreviewBytes, texturePreviewBc7Bytes, texturePreviewAstcBytes }`, a page's [column
  file](#column-files) descriptor.

For the compiler alone: `files` — `{ "<name>": { sha256, bytes } }`, one entry per other product of
the key folder (`source.gltf`, `source.bin`, `proxy.bin`, `lights.json`, `scene-tables.json`,
`scene.gltf`, `scene.bin`, `world-roots.table`, `world-roots.dag`, `world-roots.bin`; [world
partition](#world-partition) pages and cells and the manifest's pages are proven through their
roots, so the record does not grow with the world), checked by a later job of the same key before
keeping the folder ([COMPILER.md](COMPILER.md#reusing-a-compiled-folder)).

### Column files

Per-cluster numbers — tens of thousands of clusters, a dozen values each — are typed-array columns,
one file per page (`manifest-page-<sha256>.bin`); the page JSON keeps what a human or tool reads —
primitives, materials, passes, reports, and the counts locating each primitive's slice. Emerald
Square falls from 48.4 MB of JSON to 387 KB plus a 17.0 MB sidecar, which the reader maps instead of
tokenizing.

Little-endian: `u32` magic `WGMB` (`0x424d4757`), `u32` version `10`, `u32` column count `29`, `u32`
reserved, one `(byteOffset, byteLength)` `u32` pair per column, then the payloads, each on an 8-byte
boundary. Lengths and spheres stay `f64`: they decide a cut. A digest is its 64 ASCII hexadecimal
characters; object URLs are rebuilt from the `pageUrl` / `geometryUrl` / `bundleUrl` templates by
substituting `{sha}`, texture levels from `textures.url` by substituting `{sha}`, `{kind}`,
`{level}` and `{format}`, so no URL is stored.

Column indices are local to the primitive (a group names its primitive's pages, a page its
primitive's bundle). Each primitive declares its own counts in `primitives[].binary` — `pages`, and
the `culling`, `structure` and `streams` counts — and the reader derives base offsets by prefix sum,
so the JSON holds no offset. A reader refuses a missing magic, an unknown version (before fetching
the columns), another column count, a column out of bounds or contradicting the declared counts, or
a size other than `bytes`.

### Cluster DAG

Level 0 partitions the source triangles into clusters of at most 128 triangles, each triangle once,
in spatial order. Each level above groups 8 to 32 neighbouring clusters, simplifies the group with
the vertices shared with other groups locked, and re-splits it into clusters of that size. A runtime
draws cluster `c` when `parentError > threshold >= lodError`, a cut covering the surface exactly
once since coarsening swaps whole groups.

`pages[]` entries carry, beside `{ id, url, sha256, bytes, count, min, max }`:

- `role` — `exact` at level 0, `coarse` above
- `level` — DAG level, 0 for the source triangles
- `lodError` / `sphere` — object-space error of the group that produced the cluster, and the `[x,
  y, z, radius]` sphere it is projected through: at level 0 the smallest ball of its vertices, above
  it a ball holding every child's sphere, never larger than the box-centre sphere or sequential
  merge it replaces
- `parentError` / `parentSphere` — the same pair for the replacing group; `null` on a root, never
  replaced
- `group` — index in `structure.groups` of the replacing group, `null` on a root
- `source` — index of the producing group, `null` at level 0
- `start` — offset of the earliest source index it descends from, restoring a transparent draw order
- `stream` / `streamOffset` — its streaming bundle and byte offset inside it
- `geometry` — the optional independently decodable geometry page ([Pages](#pages))
- `cone` — `{ axis: [x, y, z], angle }`, the normal cone: every non-degenerate face normal lies
  within `angle` radians of `axis`, `angle` never wider than the runtime's reference `triangleCone`
  on the same triangles by more than a few ulps (`normal_cone.rs` says how and why); `{ axis: [0, 0,
  1], angle: π }`, rejecting nothing, when no face is left or the normals give no axis. Every
  cluster has one, and the WebGPU prepare reads no vertex for it. In a column file it is `pageCone`,
  four `f64` per page; sidecar version 9 added it, and a version-8 reader refuses the file

`structure` — `{ version, roots, groups[] }`: `roots` lists the clusters nothing replaces; a group
is `{ level, error, sphere, children, outputs }`, `children` and `outputs` covering the same
surface, never both drawn.

`culling` — `{ stride, count, nodes }`, a flat BVH over the primitive's clusters, `stride` 15
numbers per node, node 0 the root: `min[3]`, `max[3]`, `sphere[4]`, `maxParentError` (`-1` when the
subtree holds a cluster with no replacement), `firstChild`, `childCount` (0 on a leaf), `firstPage`,
`pageCount`. Pages follow culling order, so a node owns a contiguous page range.

`streams` — `{ version, pinned, bundleBytes, dependencyBound, maxDependencies, pages[] }`. A bundle,
`{ url, sha256, bytes, count, dependencies }`, holds clusters of one level, targeting 128 KiB: root
clusters first, then levels coarsest to finest, each ordered by the first bundle holding a cluster's
parent, then culling rank, so siblings share a bundle. `dependencyBound`, fixed before packing, is
the most parents one cluster has: a bundle closes early rather than need more parent bundles, and a
cluster that alone would is refused (`PAGE_DEPENDENCY_BOUND`, the page named); it bounds direct
parent bundles, not the closed list. `dependencies` lists ascending the bundles holding its
clusters' parents (the outputs of each replacing group), closed transitively to the root cover; a
pinned bundle lists nothing and every other reaches one; `maxDependencies`, the longest closed list,
is a statistic measured after packing. On WebGPU a bundle request brings the missing bundles of its
list, retained with it, so a cluster enters the GPU pool only after its parents
([RESIDENCY.md](RESIDENCY.md#webgpu-admission-and-eviction)); the WebGL2 page path does not read the
lists yet. In the column file a count per bundle (`bundleDependencyCount`) precedes the flat lists
(`bundleDependency`); sidecar version 8 added them, and a version-7 reader refuses the file. The
first `pinned` bundles hold exactly the root clusters, so keeping them resident guarantees a
complete, if coarse, cover; they are concatenated across primitives into shared objects of at most 1
MiB, so a first frame waits on a handful of requests, not one per primitive — each entry names the
shared object, and each cluster keeps its `streamOffset` in it. A cluster stays addressable by its
own `url` and by `streamOffset` in its bundle.

`dag` — a report, not a contract: `{ depth, clusterTriangles, groupMin, groupMax, levels[],
groups[], warnings[], stalls[], rootTriangles, cause, seamVertices, lockedVertices, uvIslands }`.
`groups[]` tallies per level why groups reduced or not (`reduced`, `tooSmall`, `seamLocked`,
`borderLocked`, `unreducible`, `borderLost`, `unusableError`; causes in [COMPILER.md](COMPILER.md),
_The corpus_) and the reductions needing a retry (`relocked`: extra locks to keep the border or a
face lit from its side). `levels[]` gives `{ level, clusters, triangles, roots, rootTriangles,
errorMin, errorMedian, errorMax, normalDeviationMax }`, `rootTriangles` the level's root triangles
(summed, the root cover the smallest budget still draws) and `normalDeviationMax` the largest angle,
in degrees, between a face and the normal shading its centre ([COMPILER.md](COMPILER.md),
_Invocation_). `stalls[]` lists each stalled group as `{ level, cause, triangles, seamVertices,
lockedVertices, uvIslands }`: level built for, cause (`too-small`, `seam-locked`, `border-locked`,
`unreducible`, `border-lost`, `unusable-error`), live triangles, positions written under several
texture coordinates, positions shared with another group of the level, connected texture islands.
Top-level `rootTriangles` is `levels[0].rootTriangles`, the level-0 triangles nothing replaces;
`cause` that of the stalled groups holding the most triangles (`null` without a stall);
`seamVertices`, `lockedVertices` and `uvIslands` summed over stalled groups. No wall-clock time is
cached — a rebuild reproduces the cache byte for byte —; stage timings travel on the `primitive`
progress event ([COMPILER.md](COMPILER.md), _Events_). `warnings[]` names a DAG that did not climb —
`DAG_FLAT` (several clusters, no coarse level) or `DAG_ROOTS` (more than one root per eight pages on
a primitive of eight clusters or more) — with `roots`, `pages`, the `groups` tally over all levels,
and `rootTriangles`, `cause`, `seamVertices`, `lockedVertices`, `uvIslands`; it also rides the
primitive's progress event, and the engine reports it as the `dag-warnings` diagnostic on opening,
with `worstStalls[]` as `stalled[]`.

Static BLEND geometry joins the DAG like opaque geometry but keeps its transparent forward pass,
material flags, vertex attributes and source mesh sorting, `start` restoring the draw order spatial
clustering scrambles. Simplification changes indices only, keeping existing vertices and locking
those shared with other groups, so borders stay watertight; an irreducible group keeps its children.
The positional error does not bound texture-alpha or compositing error: `pixelError=0` is the
exact-geometry comparison, nonzero settings need a visual check. Transmission stays unsplit, its
refraction semantics apart from alpha blending.

The compiler validates selected accessors against their own `bufferView` length, stride and sparse
index/value ranges included, before publishing a ready pointer; sparse indices must be strictly
increasing and within the accessor count. The cache key: [COMPILER.md](COMPILER.md#the-pointer); a
change makes a new key and leaves sources untouched.

## Pages

A page is a tightly packed little-endian `u32` index buffer of at most 128 triangles (384 indices)
of one DAG cluster, its SHA-256 and byte length verified before attaching. A streaming bundle
concatenates its clusters' index buffers in `streamOffset` order.

Static opaque, alpha-mask and clustered BLEND primitives may also carry `pages[].geometry`: an
independently decodable quantized cluster page with URL, SHA-256, byte length, vertex/index counts,
attribute flags and `uncompressedBytes` (the page unpacked to float attributes and 32-bit indices,
what an expanding reader holds; `bytes` is what an in-place decoder keeps resident). The manifest
declares the format once: `geometryPages: { formatVersion: 7, codec: "quantized" }`, independent of
the cache version — the optional fields and `autonomousScene` are additive, while `clustered-blend`
requires cache format 10. A missing `geometryPages` or another format is refused whole, as is a
sidecar of a version other than 10 (it names only this page); every page header opens with the same
version. Index pages stay available for existing backends.

#### Quantized cluster page (`WGP3`)

The published cluster format — positions on an object grid, octahedral normals, integer texture
coordinates, colours on a grid, local indices delta-coded in blocks of triangles, no tangent —
rebuilt from the literature for the web: twenty-five little-endian `u32` header words, then
word-aligned bit streams, nothing else. No field spans more than two words, so a shader reads any
vertex or corner of a resident page in place, in O(1)
(`packages/sdk-browser/src/cluster/decodeWgsl.ts`); the JavaScript and WebAssembly decoders unpack
the same bytes to floats for the autonomous backend.

| Word | Content |
| --- | --- |
| 0, 1 | magic `WGP3` (`0x33504757`), version `7` |
| 2, 3 | vertex count (1 to 65,535), index count (a positive multiple of 3) |
| 4 | attribute flags: `1` NORMAL, `2` TEXCOORD_0, `4` TEXCOORD_1, `8` COLOR_0, `16` joints/weights, `32` morph targets, `64` simulation-source semantics |
| 5–8 | position record and minimum: one `f32` per axis |
| 9–11 | TEXCOORD_0 record and minimum |
| 12–14 | TEXCOORD_1 record and minimum |
| 15–19 | COLOR_0 record and minimum, four channels |
| 20 | `f32` quantization error: the largest distance between a source position and its decoded value, in object units |
| 21 | bits of the corner stream |
| 22 | stored positions: 1 to the vertex count |
| 23 | deformation: joint width in bits 0–5, target count in bits 6–13, joint base in bits 14–29 |
| 24 | skin influences per vertex (0 without skin; 1 to 65,536 with skin) |

A record word holds each component's width in six-bit fields from bit 0 (0 to 24) and the grid
exponent as a signed top byte; a zero-width component is constant, with no stream. Streams follow in
order — block table, corners, position `x`, `y`, `z`, links (if fewer positions than vertices),
normal, `u`, `v` of TEXCOORD_0, `u`, `v` of TEXCOORD_1, `r`, `g`, `b`, `a` (each if flagged) —, each
`ceil(count × bits / 32)` words, field `i` at bit `i × bits`, least significant bit first; a normal
is 16 bits.

Position streams hold word 22's count: a page whose vertices repeat positions (a flat-shaded mesh
repeats each corner under every face normal) stores each position once, in first-use order, plus a
link per vertex, its position's rank on `bits_for(word 22 − 1)` bits (version 5, CMP-10, #960),
decoding to the same floats one field further, still O(1). Compiler and reference encoder do so only
when positions plus links take fewer words than one position per vertex; otherwise word 22 is the
vertex count and there is no link stream. From the same sources the repository's scenes' pages weigh
2.0 % less than in version 4 — the flat-shaded chalet 17.5 %, the crates 19.2 %, the street corner
24.7 % —, smooth ones like the terrains not a byte more, every page decoding to the same vertices.

Triangles are coded in blocks of eight, in page order (version 4, #959): the block table holds per
block its smallest corner (`base`, `ceil(log2(vertexCount))` bits), the width `w` of its corners'
distance to it (5 bits, 0 to 16) and `prefix`, the sum of earlier blocks' widths (`bits_for(word 21
/ 24)` bits), each record `ceil(log2(vertexCount)) + 5 + prefix bits` wide at bit `block × that`;
the corner stream holds `corner − base` for corner `k` at bit `24 × prefix + k × w`. A corner is one
record and one field away, O(1) in a shader, and lossless. Vertices numbered by first use keep
blocks narrow: Sponza's pages weigh 5.5 % less than in version 3, the CMP audit's meshes 3.4 %
(building) to 6.7 % (sphere) less, every page decoding to the same triangles.

Every offset follows from the counts, widths and words 21 and 22, so the header stores no other and
a reader trusts none: the byte length must equal what the streams need; a header field outside the
format (a width above 24, an exponent beyond ±64, a non-finite minimum, an unknown flag, a negative
error, a stored-position count of zero or above the vertex count, a reserved word set) refuses the
page before any stream is read, as does a block record whose base reaches the vertex count, whose
width passes an index's or whose corners leave the corner stream, or a link at or past word 22 — the
gate an in-place reader, the GPU, relies on —; a corner at or past the vertex count refuses it
before any float is produced.

Decoding is one multiply and one add per component in 32-bit floats: `value = min + q × 2^exponent`,
the product exact (a power-of-two step), the sum rounded once, so the three decoders
(`geometryPage.ts` through `Math.fround`, the Rust codec, the WGSL routines) agree, bit for bit on
the graphics card (`tests/browser/probes/cluster-decoding-gpu.ts`). A normal is two bytes, `x` low
and `y` high, `(q × 2/255 − 1)` each, the lower hemisphere folded (`z < 0`) then normalized, `2/255`
rounded to the nearest `f32` in each language. `-0` lands on the cell of `0`.

The position grid is per primitive, the finer of two rules. First `exponent = min(floor(log2(widest
extent)), tile) − 16`: about 2^16 steps across the primitive, or per tile of 2 world metres when
wider — `tile = floor(log2(2 / scale))` in object units, `scale` the largest world scale placing the
primitive (a metre per unit if unknown). A primitive wider than 2 m thus sits on `2^-15` m (30.5
µm), whose worst displacement, √3/2 of a step, is 0.057 px at a metre on the reference display (2234
lines under a 55° vertical field), under the 0.1 px display quantum; a cluster no group produced has
nothing finer to refine to, so the grid bounds it (#959). A primitive under 2 metres keeps its grid
whatever its units; tiles split nothing — a cell rounds the absolute coordinate and each page stores
its own minimum — and cost only the bits a page's box needs on the finer grid. Second,
`floor(log2(finest group error / 8))`, so a cluster's displacement projects below an eighth of the
threshold wherever the cut picks it (the finest error being the smallest non-zero `lodError`). Both
are bounded below by `ceil(log2(widest extent)) − 23`, so a primitive spans at most 2^23 steps and
every page fits the 24-bit field on its exponent — a kilometre terrain, whose root spans it, stops
at `2^-13` m on 1,024 m. The engine's runtime cutter runs this rule (`bits/grid.rs` in the SDK
module) with no error rule and a metre per unit, or the 2^23-step grid without the module; a
compiled primitive whose material moves into or out of blended in the session is re-cut by it on its
own clusters, with its DAG's finest error, placing scale and the compiler's texture grid, giving the
page the compiler writes for the new class (#846). All pages of a primitive share its exponent, so a
vertex two clusters share lands on the same cell in both; each cluster spends only the bits its box
needs, and a page still needing more than 24 bits — a texture coordinate range past 1024, a colour
range past 65,536 — is refused whole (`PAGE_ATTRIBUTE_RANGE`), never re-gridded alone. Texture
coordinates sit on `2^-14`, a quarter texel of a 4096-wide map; the compiler never leaves it, and
the runtime cutter takes the finest coarser grid only for a primitive whose widest cluster spans
past 1024 (a long dashed line's distance along it), the record word carrying the exponent. Colours,
clamped to `[0, 1]`, sit on `2^-8`, with the same per-page minima and widths; a constant channel
costs no bits.

The cost is declared: word 20 carries the page's worst position displacement, rounded up to the
`f32` so no position exceeds it — every decoder returns it and the autonomous backend widens the
page's box by it —, and `primitives[].quantization`, `{ positionExponent, uvExponent,
maxPositionError }` (step `2^positionExponent`), the primitive's, `null` on a primitive without
pages. The cut adds it: a cluster **a group produced** is certified at `lodError +
maxPositionError`, a group at `error + maxPositionError`, and every cluster and culling-node box
grows by it, so the pixel threshold bounds the quantized surface drawn, not the measured source
(spec C4; its colour and texture-coordinate terms remain open). **A cluster no group produced keeps
its band** — the ladder's floor, nothing finer cached; raising it would leave nothing to draw at
zero pixels — but its boxes grow. Both sides of a replacement swap at the same threshold, so the cut
stays a partition. A normal is within 1° of its source, a colour within half a level of 256.

A coarse page may carry vertices matching no source vertex: a seam-locked group reduced with solved
vertices ([COMPILER.md](COMPILER.md)) writes each surviving position at its quadric's minimum, each
copy's normal and texture coordinates solved there. They encode like any other — a unit normal, a
position on the primitive's grid, so the page's cone and the collider bound the faces drawn — and
exist nowhere else.

Two source vertices landing on the same cells decode alike, so the page keeps one and remaps
corners: Whisperwind's FBX import, 2.6 vertices per triangle, comes down to its distinct vertices,
triangles unchanged. Tangents are never written: every lighting pass rebuilds a cotangent frame from
a triangle's normal, two edges and their texture deltas (`cotangentFrame`, in WGSL beside the decode
routines and GLSL for the WebGL2 renderer; a raster passes the edges, a fragment stage its screen
derivatives), as the reference does. A texture coordinate set no texture of the material names in
`texCoord` is not written either — residency follows what the frame reads —, while the DAG still
welds along it, so clusters do not depend on what a material samples.

When every selected primitive has autonomous pages, the compiler also publishes `scene.gltf` and
`scene.bin`: node transforms, material declarations and images, geometry accessors replaced by a
dummy triangle. The `autonomousGeometry: true` backend builds meshes only from verified geometry
pages, which carry the source normals (a surface is flat only where the `source.gltf` primitive of
the same ranks declares none), and never requests `source.bin`. It reads images where the
[prepared-scene tables](#prepared-scene-tables) locate them, sampling `texture.image`, no baked
level. Skipping an image — a one-pixel placeholder at preparation, levels read from the cache on
demand — belongs to a session whose every mounted backend reads those levels (the WebGPU page
raster); the engine resolves `textureSource` against what it draws with (`resolveTextureSource`), so
no machine loses its textures. Transparent autonomous pages are not implemented. The complete root
cover loads before the explorer is ready. `maxResidentPages` counts displayed page instances while
the streamer deduplicates URL transfers; neither measures physical VRAM or total application memory.

## Textures

The compiler bakes the **whole mip chain** of every texture an atlas reads — base colour and
emissive for the colour atlas, metal-roughness, normal and occlusion for the data atlas —, and the
engine reads those levels wherever the cache has them, whatever the host asked of its loader,
regenerating a chain only for a texture without one. The chain is split in two:

- The **tail**, from the first level with no side over `PREVIEW_BASE` (64 px) down to 1×1, lives in
  the head page's column file, on the card before the first frame: raw RGBA8 in
  `texturePreviewPixels` and, for each block family the quality gate kept, the same levels in
  `texturePreviewBc7` (BC family) or `texturePreviewAstc` (ASTC 4×4), one byte per texel, no offset
  written — each kept entry's range follows the previous at the length its dimensions imply. Per
  `(texture, atlas)`, fourteen `u32` in `texturePreviewU32`: `texture`, `image`, `width`, `height`,
  source kind and buffer view, first level, level count, pixel offset and byte length, `atlas` (0
  colour, 1 data, 2 colour weighted by coverage, its cutoff byte `C` in bits 8–15, 0 when a reader
  blends), `bakedLevels`, then each family's **layout word** — `0` lossless (no blocks), `1` RGBA
  blocks, `2` two-channel blocks. Entries strictly increase by `(texture, atlas)`, a coverage chain
  counting as its texture's colour entry (a texture has a plain or a coverage colour chain, never
  both); a reader recomputes each level's geometry from `width`/`height`. A block column ending
  before or after the last kept entry, an unknown layout word, or blocks under a lossless word
  refuse the sidecar whole.
- The **head**, levels `0` to `bakedLevels - 1`, is one file per level and kept format at the
  template `clusters.json` publishes in `textures.url`
  (`../../textures/v<N>/{sha}/{kind}-{level}.{format}`, relative to `clusters.json`): `{sha}` the
  SHA-256 of the source image bytes, `{kind}` `srgb`, `linear`, `srgb-coverage` or
  `srgb-coverage-<C>`, `{level}` the mip rank, `{format}` `png` (lossless, always present), `bc7` /
  `bc5` (BC family, RGBA and two-channel) or `astc` / `astc-la` (ASTC 4×4, same two layouts). A
  block file holds the level's **tile records** (version 6, #962): tile rows top to bottom, tiles
  left to right, each record the 4×4 blocks of its 128×128 tile plus a 4-texel gutter, clipped at
  the level's edge (gutter blocks repeated in both neighbours), block rows top to bottom, a side not
  a multiple of four padded by its edge. No index: offsets and lengths follow from the level's
  dimensions (`texture/tileRecords.ts`), so the WebGPU streamer reads one tile with one HTTP `Range`
  request, or the whole file from a server ignoring `Range`. `textures.version` repeats
  `TEXTURE_PREVIEW_VERSION`; another version is refused whole with `STALE_CACHE`, naming the
  recompile command (`assertCacheIdentity`). Levels are content-addressed, shared by every scene
  sharing the image, never rewritten, pruned like objects when no surviving manifest names their
  digest. `v<N>` is `TEXTURE_PREVIEW_VERSION`: a new reduction rule, codec or gate bar changes the
  path, so stale levels are never served.

**Block layouts and the quality gate.** A cook writes one block family
(`--textures-format=bc7|astc|both|none`, `bc7` by default: a cook runs on a desktop). The layout
follows the role: **RGBA** — BC7 mode 6 (one subset, 7-bit RGBA endpoints with a shared low bit,
4-bit weights) or ASTC single-partition colour endpoint mode 12 at the 192-level range with 3-bit
weights — for base colour, emissive, metal-roughness and occlusion; **two channels** — BC5 (two BC4
channels, eight rungs each) or ASTC luminance-alpha (colour endpoint mode 4, dual plane, quint
weights) — for a texture only `normalTexture` reads, X first, Y second (BC5) or in alpha (ASTC), Z
rebuilt as `sqrt(1 − x² − y²)`. Every chain is read back through an independent decoder
(`texture2ddecoder`) and compared with its RGBA8 levels on the channels materials read (an opaque
base colour's alpha is not; a normal map's three are, Z rebuilt against Z stored), and **kept only
if** its PSNR over the whole chain reaches **48 dB**, no texel moves more than **3 levels** of 255
on a read channel, and no texel of a masked texture crosses its alpha cutoff (alpha times the
material's colour factor alpha, as the engine cuts). That defines "no visible loss" for a block
texture: on a still capture at 1280×720, DPR 1, every channel of every pixel within 3 of 255 (below
what an 8-bit display discriminates) and 0 px of A/A, carried to the texel since filtering only
averages texels, measured on the batch captures. A chain under the bar stays lossless in that family
— no block file or tail, the layout word says so — and is sampled from an RGBA8 pool. The report
(`clusters.json`, `texturePreviews`) publishes the bar (`qualityGate`), counts per family and layout
(`encoded`), the kept chains' PSNR quantiles, and each chain left lossless with its PSNR, largest
gap and flips (`lossless`). The codecs are the compiler's own, pure Rust, one layout each, no mode
search, their blocks proved on the same independent decoder.

Every level follows the rule the card applies when it regenerates a chain
(`packages/sdk-browser/src/texture/mips.ts`): level `k` from the **quantized** level `k - 1`,
colours averaged in the atlas's encoding (sRGB decoded and re-encoded for colour, linear for data),
alpha the **median** of the four texels, an odd side repeating its last texel. Colours are a plain
mean except for a colour texture **every** reader of which takes alpha as coverage — base colour of
non-transmitting `BLEND` materials or of `MASK` ones with a cutoff above 0, only: it gets its own
chain, `atlas` word `2`, `{kind}` `srgb-coverage`, where four texels of differing alpha average
their linear colours weighted by alpha (premultiplied, averaged, divided by the summed alpha, stored
straight), so colour under a transparent texel no longer darkens a cutout's border (#42); when every
reader cuts, each level's median alpha is then scaled to cover level 0's share (#44, below). An
image whose alpha never varies keeps the plain chain, which weighting would not change. One opaque
or transmissive base colour or one emissive among the readers keeps the plain chain byte for byte,
that reader drawing the colour under alpha 0; the data atlas never weighs. Weighted files, named
apart, never share with another scene's plain chain of the image; the card regenerating a hosted
texture decides the same from the same material census. The file's declared transfer is ignored: the
pyramid follows the display. Baking thus keeps the image within rounding — on Emerald at 2496×1404,
0 pixels beyond ±2 per channel on the general view; on the lawn view 1 720 isolated pixels (0,05 %)
where a coarse texel's median alpha crosses the 0,5 cutoff, plus their shadows with the sun on.
Remeasured when the engine stopped regenerating cached chains (#289), at 1280×720, DPR 1, threshold
0, TAA off, lossless pools both sides: the four Emerald views differ by at most 2 of 255 on a
channel (one channel of one frame at 3), mean absolute channel error 0,009 to 0,049 of 255;
Whisperwind by 5 pixels at 1 of 255; A/A witness 0 px on every view.

**Coverage-preserving alpha (#44).** The median alone thins a masked texture at coarse levels —
sponza's masked maps held coverage within ±2.4 % down to 32² texels, then lost 3 to 15 % at level 6,
up to 40 % at level 7 and 57 % at level 8. A coverage chain therefore carries its texture's cutoff
byte `C`: the lowest among the materials reading its alpha as coverage, each the smallest byte `b`
with `b / 255 × f >= alphaCutoff` in `f32`, `f` its `baseColorFactor` alpha — the product itself,
since the cutoff divided by `f` lands a byte off on exact ties; glTF 2.0 cuts sampled alpha times
the factor's against `alphaCutoff`, as both backends do (`maskKeep`, #748; WebGL2's `baseFactor`,
#769). A factor of 0 or below, or a cutoff at or above the factor, keeps at most fully opaque texels
and takes `C = 255`, which the lowest over the readers ignores beside any other; `C` is 0, the
median alone, when one reader blends — it draws the alpha itself, and the scale would move its mean.
Two textures of one image cut at two cutoffs, or one blended, bake a chain each. Coverage is counted
on the bilinearly filtered cut, as the sampler draws it, not on texels (Castaño's practice, #43):
four samples per texel, at the quarter points of the square between its centre and those of its
right, lower and diagonal neighbours (an edge texel its own neighbour), each the byte `(9a + 3b +
3c + d) / 16` of the square's corners rounded half up, `a` the nearest: a filtered alpha passes the
cut
from `C − 0.5` — exactly the engine's cut at `alphaTest` 0.5 —, where the scale puts `t − 0.5`. At
each level `k >= 1`, after the median, with `n0` the level-0 samples `>= C`, `N0` and `Nk` the texel
counts of levels 0 and `k` (four samples a texel both sides), and `above(t)` the level-`k` samples
the scale at `t` lifts to `C` or more — each filed in a 256-bin histogram under the highest such `t`
(0 if none), found by binary search between the square's lowest and highest corners, since the scale
only grows as `t` falls, a corner reaches `C` exactly when `t` is at most its byte and a sample lies
between its corners —, `t` is the byte of `1..=255` minimising `|above(t) × N0 − n0 × Nk|` (ties to
the `t` nearest `C`, then the lower), and every alpha `a` becomes `min(255, (2a(2C − 1) + 2t − 1) /
(4t − 2))` in integers, truncating: `a × (C − 0.5) / (t − 0.5)` rounded half up, so exactly
`above(t)` filtered samples reach `C`. Every level matches level 0, never the previous; `t = C`
leaves a level byte for byte; level `k + 1` reduces from the scaled bytes; colours are untouched.
The compiler (`texture_preview/coverage.rs`) and the card's chains for hosted textures run this
arithmetic, in WGSL and GLSL (`texture/coverageRule.ts`): WebGPU counts each level and picks `t` in
a compute pass (#748, `texture/coverageMips.ts`), WebGL2 counts by additive blending into an RGBA
float target, a channel per sample, and picks `t` in a one-texel draw (#769,
`webgl/cluster/coverageMips.ts`) — without `EXT_color_buffer_float` and `EXT_float_blend`, the
median alone —, once per chain built (a live texture per new picture), never per frame: four samples
a texel and a search of at most eight steps each, the frame nothing. Files are `srgb-coverage-<C>`,
one name per cutoff, so two scenes cutting one image differently never serve each other's levels;
the blended-only chain keeps `srgb-coverage` and its bytes. The filtered cut (#43) moved the
`srgb-coverage-<C>` bytes under their names, and level files are written only when missing, so #43
raised `TEXTURE_PREVIEW_VERSION` to 5, whose folder `textures/v5` serves no level of the texel-count
rule (6 since the tile records of #962).

An image whose decode fails has no entry: its textures load from the source. A texture whose chain
is not whole (`bakedLevels < firstLevel`) also keeps the source path, in the engine's lossless lane,
whatever family the device samples.

## Prepared scene tables

`scene-tables.json`, beside `clusters.json`, says what the prepared scene is made of, and the
runtime builds that scene from it alone: no glTF is parsed in the browser. Its own versions govern
it — `version` 5, `nodeTableVersion` 4, `materialTableVersion` 4, `geometryTableVersion` 1 —, an
unknown one refused rather than half-read (`assertSceneTables`, `UNSUPPORTED_SCENE_TABLES`). Every
value is read from the `source.gltf` the same compilation publishes (and, for its layout,
`scene.gltf` when written): the slice's nodes, cutout answers applied, mesh ranks remapped.

- `scene` — `{ name, nodes }`: the scene the document opens (`scene`, else the first) and its roots.
- `nodes[]` — every node the partition's cells do not place, in glTF order, renumbered without them
  (all nodes at their glTF rank when `partition` is `null`): `{ name, children, mesh, light, camera,
  weights, matrix, translation, rotation, scale, visible }`. `weights` overrides the mesh's morph
  weights; `visible` is `false` under `KHR_node_visibility` `visible: false`, hiding the node and
  its subtree until a page shows it, and such a node stays in this table, not a cell (node table
  version 4). The pose is the LOCAL one as declared, each part `null` when silent, so the runtime
  composes the same world-matrix bits as always. Several nodes naming one mesh is instancing.
- `partition` — `null`, or the world partition (below): the cells placing the other nodes.
- `meshPages` — the slots of the manifest mesh pages holding the meshes of `nodes[]`, sorted, each
  once (version 5, #751): what a runtime holding the manifest by the view reads before its first
  frame, the cells' region pages naming the rest.
- `lights[]` — the `KHR_lights_punctual` lights the nodes hang: `{ name, type, color, intensity,
  range, innerConeAngle, outerConeAngle }`, silent fields `null` (the specification's default).
  `lights.json` stays the radiometric product the engine lights with.
- `cameras[]` — `{ name, type, yfov, aspectRatio, xmag, ymag, znear, zfar }`, silent fields `null`.
- `materials[]` — the surface fields the engine reads: `lit`, `baseColor`, `metalness`,
  `roughness`, `doubleSided`, `backSide`, `alphaTest`, the six map slots (`map`, `metalnessMap`,
  `roughnessMap`, `normalMap`, `aoMap`, `emissiveMap`), `normalScale`, `normalScaleY`,
  `aoIntensity`, `emissive` (factor times `KHR_materials_emissive_strength`), `transmission`, `ior`,
  `thickness`, `attenuationDistance`, `attenuationColor`; and the host surface: `kind` (`unlit`,
  `standard`, or `physical` when a physical extension is declared), `alphaMode` (`OPAQUE`, `MASK`,
  `BLEND`), `opacity` (the colour factor's fourth number), and `extensions` — what clear coat,
  sheen, iridescence, anisotropy, dispersion, specular, bump and the transmission and thickness maps
  add, under the host's parameter names and defaults. A glTF material is one entry **per tangent
  variant** — a host rebuilding the tangent frame from screen derivatives flips `normalScaleY` —, so
  a primitive names a rank in this table, and `derivativeTangents` says which variant an entry is.
  The engine shades every page in its triangle's frame (pages store no tangent), reading a tangent
  entry's `normalScaleY` turned as the other variant writes it, whichever document it opened. A
  primitive with no material wears an entry holding glTF's default.
- `textures[]` — at the glTF texture rank: `{ name, sampler, image, wrapS, wrapT, magFilter,
  minFilter }`, `image` the source `EXT_texture_webp` then `EXT_texture_avif` names before the core
  `source`, as the loader reads it; in the engine's words (`clamp`/`repeat`/`mirror`,
  `linear-mip-linear`…), the specification's defaults where the sampler is silent; `sampler` the
  glTF sampler rank, which with the image's source decides which textures are one. A map slot is `{
  texture, texCoord, slotTexCoord, transform }`: `texCoord` the set sampled (the
  `KHR_texture_transform`'s when it names one), `slotTexCoord` the slot's own, deciding whether the
  host reads the glTF texture or a copy and so the rank kept, and `transform` the declared
  `KHR_texture_transform` — `{ offset, rotation, scale }`, each `null` when silent — or `null`; the
  host composes the matrix.
- `documents` — each published document's geometry layout, keyed by file name (`source.gltf`, and
  `scene.gltf` when written): `{ buffer, views, accessors, meshes, images }`. `buffer` names its one
  binary; a view is `{ offset, length, stride }` into it; an accessor `{ view, offset,
  componentType, normalized, count, type, min, max, sparse }`, `sparse` being `{ count, indices: {
  view, offset, componentType }, values: { view, offset } }` or `null`; a mesh `{ name, weights,
  primitives }`, a primitive `{ attributes, targets, indices, material }` — accessor ranks by glTF
  semantic, morph targets (sets of accessor ranks, `null` for none), and its surface's rank in
  `materials[]` for that document's tangent variant; an image `{ name, uri, view, mimeType }`, an
  address relative to the document or a view of its binary.

### World partition

A **placement** is a node that only places a mesh: a reached leaf with no light, camera, skin or
morph weights, moved by no animation, whose mesh declares its position bounds and does not morph.
When a scene's placements weigh more than one stream unit (`STREAM_BUNDLE_BYTES`, 128 KiB, a
geometry bundle's budget), the compiler moves them from `nodes[]` into spatial cells
(`packages/asset-compiler-rust/src/compiler_tables/partition.rs`), which the runtime reads by
distance to its camera instead of reading every node before its first frame. Placements fitting one
unit stay in `nodes[]` with `partition: null`.

Placements are halved along the widest spread of their centres until a cell's fit the unit. Each
cell has a **record** `{ url, sha256, bytes, parents, meshes }`: its file beside the tables
(`scene-cell-<n>.json`), fingerprint and size (verified like a page); `parents`, `[[rank, box], …]`,
for each core node its placements hang under (`null`, the scene) the box around them **in that
node's frame**; `meshes`, `[[rank, count], …]` in rank order, its placements per mesh. A cell file
is `{ version: 2, nodes }`, each `{ parent, mesh, matrix, translation, rotation, scale }`: the
`nodes[]` rank of its core parent (`null`, the scene), its mesh, its local pose as declared, silent
parts `null`. A placement keeps no name: it is a row, not a host node.

**The paged cell index** (`partition/pages.rs`, #750). Records lie in pages cut from the halving
tree, each node a contiguous cell range. A region page `{ version: 4, first, cells, meshPages }`
holds the records of the highest node under 128 KiB (`PAGE_BYTES`; one cell whatever its size),
`first` its first cell's rank — its `n`-th record is `scene-cell-<first + n>.json`, cell
`cells[first + n]` of the [world roots](#world-super-roots) —, and `meshPages`, sorted, each once,
the manifest mesh-page slots holding a primitive of a mesh its cells place, what a region needs
fetched (#792). An index page `{ version: 4, pages, parents }` lists at most 8 pages (`FAN_OUT`),
its node opened largest first, each with (#575) the core ranks its cells hang nodes under, eight
hexadecimal digits each run together, `""` for none. `partition` is the root `{ version: 4, pages,
parents, meshes, cube }`: the whole tree opened into exactly eight slots, empty last, parents beside
each slot as an index page lists them; then per placed mesh, in rank order, its rank, its node count
and its **rows at each of 32 rungs**, eight hexadecimal digits each; and `cube`, the widest cell's
diagonal, the sixteen hexadecimal digits of its `f64` (`partition/pages/rows.rs`). Rung `k` is a
side `cube·√2^k`; its rows are, summed over the parents, the most nodes of that mesh one parent's
cells place meeting one window of side `1.5·side` at a multiple of `side/2` on every axis — each
cell counted whole, never past every node. Any cube of that side lies in one such window, so a
rung's rows hold every node of the cells meeting any cube of it, a bound set by the side and the
cells' size, the same at 1× and 16× the world once the side is narrower than the world. The slots
take 1 391 bytes for grids of 48² and 192² and the open-world cell laid 8 × 8, the whole root 1 739
for the grids with one mesh under the scene: fixed width, growing with meshes and parents placed,
never with cells. A slot is 168 hexadecimal digits — the page's SHA-256, its size (8) and its box at
the declared poses as six big-endian `f64` bit patterns (16 each) — naming
`scene-page-<sha256>.json`; zeros name no page. `tablePartition` reads the root alone: slots and
parents, `bounds` (their boxes' union), `meshes` (ranks placed), `totals` (node counts), `rows`,
`cube`, `parents` (core ranks). `readCellPage` refuses a page of another version, an index page
without its pages' parents, a page of neither pages nor cells, and a region page without its first
cell's rank or mesh-page list. The runtime numbers a cell by that rank whatever page opens first,
and a placed cell holds the world bundles its roots need by it. Pages and cells are outside the
manifest's `files`: a reused folder proves them through the root.

**The cell index at runtime** (#575). Before its first frame a session sizes its rows for its first
camera (below), reads the index pages on its way and the cells within reach, and places them
(`primePartitions`): the first frame reads the view's bytes, not the world's. Each frame walks the
index from the root (`scene/partition/cellIndex.ts`): a page is boxed at the declared poses, and its
content now lies within that box and those carried by the parents its cells hang under that moved
since (`boxes.ts`); a page whose box meets the reach is read through the session's streamer (files
entering its catalogue), decoded in the decode pool (`cellPage`), opened within the one integration
budget, then its pages walked or cells tested; one past the keep sphere with no cell placed is
closed, its files released. Work follows the reach, not the world's cell count. Cell files are
parsed off the main thread too, by the pool's `cells` task (`scene/partition/cellDecode.ts`), into
each node's ranks and local matrix, the rows placed within the same budget. A page or cell the pool
refuses keeps its code across the thread (another version stays `UNSUPPORTED_SCENE_TABLES`) and
names its file (`PageDecodeFailed.refusal`, `PageDecodeRequest.name`).

**The manifest held by the view** (#751). A WebGL2 world reads the manifest's root, head page and
the mesh pages `meshPages` names (`openPagedManifest`, `loadModel`'s `lazy`); each placed cell holds
its region page's mesh pages, counted once per cell, releasing them as it leaves, and a page no
placed cell holds leaves the manifest with its primitives (`scene/partition/cellPages.ts`). The
session opens on the primitives listed, meshes without one left out, mounts each once its page is
read (`mountPlacements`) and unmounts it when the page leaves (`world/scene/partitionMounts.ts`). A
WebGPU world reads the whole manifest until its session grows in place (#216).

**Reading the cells.** Each placed mesh is one host mesh per primitive, its instance buffer filled
by the cells (`packages/sdk-browser/src/scene/partition/`): a placement takes a row at the world
matrix the engine composes for a child of its parent — a host node's bits, proven against the host
loader on `site/assets/examples/ten-thousand-objects` (`host/prepared/partition.test.ts`) — and
parks it when its cell leaves. A page may move a core parent (`getObjectByName`): its rows are
rewritten, and the cell's boxes are its parents' boxes under their current matrices (`boxes.ts`), so
a cell is read where its placements stand, at its nearest box's distance. A cell is read while the
camera can draw any of it: the **reach** is the far plane on the frustum's diagonal, `far·√w`, `w =
1 + (tan(fov/2)/zoom)²·(1 + aspect²)` its off-axis stretch, not shortened by the error target —
nothing coarser stands for an unread cell (the proxy of #23), so a dropped object would be missing,
not replaced. An orthographic camera reads to the far corner of its zoomed box. Before every frame,
index pages and cells within the reach are requested nearest first, those within `1.25 × reach` at
prefetch priority, and a read cell leaves once its box is past `1.5 × reach` (`AHEAD` and `KEEP` in
`plan.ts`) — margins of the reach, not the cell, so a cell wider than the view is kept only while
its box meets that sphere. Cells go through the session's page streamer (one request queue) and are
placed within the frame's integration budget (`ARRIVAL_BUDGET_MS`, `FrameBudget`), clocked once per
frame: cells first, then page arrivals, then WebGPU row records; a frame's first integration always
goes through.

The rows are sized when a session opens, before its engines read them, for every placement its
camera's view can hold at once **wherever the page moves the core parents** (`sizing.ts`). A held
cell's box lies within `keep = 1.5 × reach` of the eye: under the scene root it meets the cube of
side `2·keep` around it, and under a core parent stretching the root's frame by `least` to `most`,
the cube of side `2·(keep + √3·most·cube/2)/least` in the parent's frame. The rows take the root's
`rows` at the first rung whose side holds the widest cube the parents ask — set by reach, cell size
and parent stretch, not the world —, so parents moved, turned or scaled up never run them short,
reopen the session or leave a placement undrawn (CONTRIBUTING.md §Streaming rule 10). A reach later
outgrowing the rung, or a parent scaled down or stretched more unevenly than at opening, asks a
wider rung — twice the side at least —, grown in place on an engine following the growth contract
(`placement/growth.ts`) that takes it (`growsInPlace`: WebGPU while its page table holds it);
otherwise the rows stay and the session's owner is asked, once, to reopen it sized for that view
(`onPartitionOutgrown`; the world does). A session no owner can reopen (a bare explorer) sizes its
rows for every placement and never asks. A session drawing on demand redraws, camera still, until
the pages and cells asked within reach are read, decoded and opened or placed. A partitioned scene
is not replicated (`UNSUPPORTED_SCENE_UPDATE`).

A far cell's merged, simplified proxy (HLOD) is its [world super-roots](#world-super-roots).

The runtime builds its host scene from these tables alone
(`packages/sdk-browser/src/host/prepared/`) — attributes viewed on the binary, the declared position
box, textures folded on image source and sampler, surfaces with vertex-colour and flat-shading
variants, nodes, meshes, cameras and lights named as the host loader did — proven equal to the
loader's graph, field by field and byte by byte, on every cache `site/assets` publishes
(`packages/sdk-browser/src/host/prepared/build.test.ts`). A layout naming a document the tables
lack, a view outside its binary, or a cell placing a mesh with no rows built is
`PREPARED_SCENE_MISMATCH`.

### World super-roots

Every primitive ends at its own roots, which `streams.pinned` keeps resident, so pinned alone an
open world's root cover grows with the world, not the view. The compiler therefore continues the DAG
above the objects (`packages/asset-compiler-rust/src/compiler_world_roots.rs`, #23): every
placement's primitives' root clusters, placed in world space, their error and published sphere's
radius scaled by the placement's largest axis scale, enter the DAG builder as level 0
(`build_dag_from_roots`), grouped per [world partition](#world-partition) cell and material. The
levels above — the cell's **super-roots** — use a primitive's grouping, simplification and monotone
error (a part leaves only at the error its extent costs). Every cell's roots of a material then
re-enter the builder and climb to the **world top**, a grouped cell root being the very cluster its
group names. A scene fitting one unit is one cell; a node the core keeps (moved, lit, skinned,
hidden) and a primitive without a DAG keep only their roots; `simplification: none` builds no
super-root.

The world DAG is packed and linked as a primitive's (`streams`, above): the top first, pinned, then
each level from the coarsest, one level per bundle, closed `dependencies` reaching a pinned bundle.
Object roots are packed last, only for their lists — their pages are the objects' own, not rewritten
— save an object root no world group takes, which stays a root of the top and is written with it.
The primitive's list check refuses the world's too (`INVALID_PAGE_DEPENDENCIES`): every page, object
roots included, reaches the world top.

Three products lie beside the tables. `world-roots.bin` holds the written bundles end to end; a
page is `u32` vertex count, `u32` triangle count, its vertices as three `f32` in world space and its
triangles as `u16` local indices, padded to four bytes. `world-roots.table` and `world-roots.dag`
(version 2, #1232) are **fixed-size little-endian records**, read at their rank straight from their
bytes (`packages/sdk-core/src/manifest/worldRootsTable.ts`), never one string of the whole world:
the open world's table weighed 866 MiB as JSON, past the 512 MiB a JavaScript string holds. Each
record names a variable list — a bundle's or an object's dependencies, an object's roots, a group's
children and outputs — by its first word and its length in a `u32` **pool** after the records.

- `world-roots.table`, what a load reads: an 80-byte header — `WRTB`, version, `budgetBytes`,
  `pinned`, `pinnedTopBytes`, the counts of bundles, pages, cells and objects, the pool's length in
  words, the bin's length as two words (low first), then the bin's SHA-256 as 32 bytes —; a 56-byte
  **bundle** — its offset in the bin as two words, its length, its page count, its dependencies,
  then its SHA-256 —; a 24-byte **page** of a super-root — its bundle, its offset inside it, its
  level, zero, its error as `f64` —; an 8-byte **cell**, the cell of `scene-cell-<n>.json` (an
  unpartitioned scene has one cell, no file) — its first object and its object count —; a 24-byte
  **object**, one per placement primitive — its published node, its manifest primitive, the
  `streams` bundles holding its roots, and every world bundle those roots need, ascending, up to the
  top: the **cross-primitive dependencies** of its root bundles —; then the pool.
- `world-roots.dag`, what the world stream reads on its first use (#1238): a 24-byte header —
  `WRTD`, version, the counts of clusters and groups, the pool's length, zero —; a 152-byte
  **cluster** for every world cluster, object roots included, at its world rank — the rank the
  groups use —: its level, its triangles, its material, its page's `bundle` and `offset` in the bin
  (a super-root) and its `origin`, the rank among the table's objects of the placed object whose
  own stream holds its page (an object root), each `0xffffffff` for none; then as `f64` its error, its parent's error (NaN for a root),
  its sphere, its parent's sphere (NaN for a root), its minimum and its maximum —; a 64-byte
  **group** — its level, its children and outputs, zero, then as `f64` its error and sphere —, the
  relation the runtime flattens into its cluster structure; then the pool.

All three are in the manifest's `files`; a reader refuses a file whose records do not fill it
exactly, whose bundles are not the bin's ranges end to end or whose lists leave its pool or name
a bundle or cluster it does not hold (`INVALID_CACHE`). A cache cooked before #1232 publishes
`world-roots.json` instead, which the runtime no longer reads: its image is unchanged, the
super-roots being drawn by nothing yet.

The first `pinned` bundles are the **pinned top**, their bytes `pinnedTopBytes` in the cook report
(`clusters.json`, `worldRoots`: `{ version, file, cells, superRoots, topPages, pinnedBundles,
pinnedTopBytes, budgetBytes, dependencyBound }`, `null` when nothing is placed). It is bounded by
the materials, not the world: one tile or 64 tiles of the same objects publish the same top, down to
one page per material. A top over `budgetBytes` (`WORLD_TOP_BUDGET_BYTES`, 4 MiB) is refused at
cook, `WORLD_TOP_OVER_BUDGET`, naming the cell pinning most of it.

The runtime reads the table as a model loads and pins the top alone (#1237,
`packages/sdk-browser/src/scene/worldRoots.ts`): its bundles, the binary's first, in one ranged
read, each checked against its `sha256`. The DAG file is read once the world stream opens, never by
a load. Object roots are no longer pinned: held with the placements
the view holds, a placed cell holding the bundles past the top its objects' `dependencies` name,
each once, until the last cell needing it leaves ([RESIDENCY.md](RESIDENCY.md#the-geometry-pool),
Pinned bytes). The super-roots are not drawn yet (#1238): the image is unchanged.

Packed last in the one cut, the world DAG reads a mirror of the scene's residency
(`packages/sdk-browser/src/gpu/dag/worldMirror.ts`, #1332), which the cut that packs it builds and
feeds the rows' flags through: a super-root resident while its bundle is held, an object root while
its placed object (`origin`) is placed and its root cover resident, so the cut keeps a cell's
super-root until its objects are drawable. A partition's plan reads the cut's own choice
(`scene/partition/superRoots.ts`, `farCells.ts`), each cell's bound read once the world stream
opens (an object root's cell is its object's, `cells.cellOf`): a cell is held by its super-roots,
its object pages unread, until their largest `parentError` projects past the pixel target on the
frustum's diagonal; a placed cell gives its objects back once that error is within the target over
`1 + KEEP`. Both wait for a cut that packs the world DAG (#1333): until then no cell is held far
and the rows' flags go up as they are.

## `physics.json` — cooked colliders

Written beside `clusters.json` by the `physics-cook` stage
([COMPILER.md](COMPILER.md#physicsjson--the-cooked-colliders-stage-physics-cook)), with its own
`formatVersion` (2, or 3 when a body carries `pieces`); any other is refused (`PHYSICS_FORMAT`,
recompile the model) — format 1 had another bodies shape and no matter on an instance. Its shapes
are Jolt's binary state (`Shape::SaveWithChildren`), readable only by the Jolt that wrote them:
`jolt` names that commit, and the engine refuses another's. `stage` names the stage and its version.

| Field | Content |
| --- | --- |
| `colliders` | One per compiled primitive with a DAG: `primitive`, `material` (glTF index), `kind` (`mesh` or `heightField`), `tolerance` (the object's DAG error the level holds), `hausdorff` (measured to level 0, at or under `tolerance`), `triangles`, `tiles` |
| `tiles` | One Jolt shape each, a SHA-addressed object like a page: `url`, `sha256`, `bytes`, `triangles`, `bounds` (min and max in the primitive's frame); every triangle is of the collider's `material`, which an exact hit reports. A tile of small triangles is a `MeshShape` cooked a power of two larger inside a `ScaledShape` of the inverse |
| `instances` | Static placements: `node`, `collider`, `position`, `rotation` (x, y, z, w), `scale`, and the `friction` and `restitution` of the `physicsMaterial` the node's `KHR_physics_rigid_bodies` collider names, if any. A shearing node matrix is no body pose: counted in `report.unplaced` |
| `report` | Counts, the largest tolerance and measured distance, and `refused`: each primitive whose collider Jolt refused (`primitive`, `mesh`, `meshPrimitive`, `reason`, Jolt's error), drawn without a collider; a refusal never fails the compile |

The manifest's `physics` names the file, format, Jolt commit, report and every object cited
(`objects[].sha256`), so a prune keeps them.

### `bodies` — declared rigid bodies

Stage version 6 adds `bodies` (additive: older files have none, format 2 reads it), one per rendered
node whose `KHR_physics_rigid_bodies` declares a `motion`
([COMPILER.md](COMPILER.md#physicsjson--the-cooked-colliders-stage-physics-cook)). The node, and
another node its collider names (`colliderNode`), keep their `instances` entries, which the page
leaves out once it has restored the body (`packages/sdk-browser/src/physics/cookedBodies.ts`) and
falls back on if it refuses it. Each entry:

- `node`: the declaring node.
- `motion`: the motion as the node declares it (`isKinematic`, `mass`, `gravityFactor`, …).
- `shape`: the `KHR_implicit_shapes` shape the collider names, as declared, or `cooked`: one
  `ConvexHullShape` for contact, a SHA-addressed object like a tile (`url`, `sha256`, `bytes`), in
  the body's frame at unit scale; for a dynamic body also `mass`, the cook's exact weighing at the
  body's `scale`: `mass` (kg), `centerOfMass` and `inertia` about it (nine numbers, column-major),
  in the body's frame. The page hands Jolt this mass, turning the hull about `centerOfMass` rather
  than its own centre, reweighed at the model's placed world scale; what `motion` declares (`mass`,
  `centerOfMass`, `inertiaDiagonal` turned by `inertiaOrientation`) wins, the cooked inertia scaled
  to a declared mass and moved to a declared `centerOfMass` by the parallel axis theorem.
- `colliderNode` (stage version 9, additive): the other node whose mesh the hull is cooked from,
  when the collider names one; absent otherwise and in older files (that node then stays static
  ground beside the body).
- `position`, `rotation`, `scale`: the node's world placement in the model, as an instance's.
- `friction`, `restitution`: as an instance's.

`report.bodies` counts them; `report.bodiesRefused` lists refused nodes (`node`, `reason`), which
stay static ground.

Stage version 8: a body whose `extras.physics` declares `breakable` also carries that threshold and
`pieces`, convex non-overlapping pieces of its mesh
([COMPILER.md](COMPILER.md#physicsjson--the-cooked-colliders-stage-physics-cook)), each a `cooked`
shape in the body's frame with its own `mass` at the body's `scale`. Such a file is format 3,
refused by name by a format-2 reader; without pieces it stays format 2. The runtime reads format 3
and leaves pieces unused: nothing breaks yet (#519).

### `softBodies` — cooked soft bodies

Stage version 5 adds `softBodies` (additive: older files have none, format 2 reads it), one per
drawn node whose `extras.physics` declares a cloth, a rope or a volume
([COMPILER.md](COMPILER.md#soft-bodies-a-model-declares)). Each entry:

- `node`: the declaring node, with no `instances` entry (a soft body is no static ground).
- `physics`: the declared options, as `obj.physics` takes them; the page reads matter, pull and
  damping from them.
- `settings`: the body's `SoftBodySharedSettings` in Jolt's binary state (`SaveWithMaterials`), a
  SHA-addressed object like a tile (`url`, `sha256`, `bytes`); its vertices are already at `scale`,
  its compliances in it.
- `vertices`: simulated vertices, counted against `budget.physics.softVertices`.
- `pressure`: the gas's gauge pressure at rest, Pa; 0 for a cloth or a rope.
- `position`, `rotation`, `scale`: the node's world placement in the model, as an instance's.
- `friction`, `restitution`: as an instance's (its collider's `physicsMaterial`, if any),
  overridden by those in `physics` as `obj.physics` overrides its material; neither, the engine's
  default matter.

`report.softBodies` counts them; `report.softRefused` lists refused nodes (`node`, `reason`, in the
page's own refusal words), drawn all the same with no body or static collider. The page copies the
restored settings into one SOFT command (`packages/sdk-core/src/physics/softLayout.ts`), building
nothing. A moved model carries its soft bodies along (TELEPORT), simulation kept; placed or rescaled
at another scale than cooked, they are released and refused (`PHYSICS_FAILED`) — Jolt scales no soft
body once made — and made again back at that scale. Each takes a page-built one's flags, its model's
visibility for its own.

## Source glTF

A compacted `source.gltf` + `source.bin` of the selected nodes, relative image URIs rewritten
against the host `resourceBaseUrl`; `images` may be omitted. A `bufferView` image (no `uri`) keeps
its view, copied into `source.bin`. Sparse accessors (`accessor.sparse`) are decoded, their
bufferViews compacted and remapped. Skins (`skin`, `JOINTS_0`, `WEIGHTS_0`), morph targets
(`targets`) and animations are kept in `source.gltf` and its prepared tables; opaque and
alpha-blended deformation rides the clustered pages.

## Source files

Input: a directory with `manifest.json`, a directory with exactly one `.gltf`/`.glb`, or a
`.gltf`/`.glb` file. `manifest.runtime.file` names the glTF JSON or GLB; for `.gltf` the first
buffer URI names the sidecar binary; both must be one relative path segment (no `/`, `\\`, or `..`).
The glTF's SHA-256 is verified against `runtime.sha256`, the sidecar's against its
`runtime.sidecars[]` entry (a GLB carries its BIN chunk, no sidecar hash); without a manifest,
hashes come from the files. Several glTF buffers are concatenated into one `source.bin` (4-byte
padded), `bufferView.buffer` remapped to 0. Unknown layouts, data URIs as buffer URIs and path
escapes are rejected. Unindexed triangle lists (`POSITION` count a multiple of three, no `indices`)
are indexed during clustering. In `slice` scope, if no mesh instance fits the triangle budget, the
smallest overflowing instance is kept.

## Resident lighting proxy

`proxy.bin` version 5 losslessly shares world-space simplified triangle runs; simplification,
triangle order, albedo, wide BVH and provenance are unchanged, and the reader expands sharing once
at load to the canonical flat columns, shaders untouched. Little-endian; eleven `u32` header words:
`WGPX`, version, triangle count, node count, owner-group count, owner-record count, source-node
count, reserved zero, shape count, stored shape-triangle count and shared-placement count. The first
eight keep version 3's ownership header. Payload columns, in order:

- One `u32` triangle count per shape; all shapes' nine `f32` coordinates per triangle, then all
  shapes' `u32` linear RGBA8 albedos.
- One `u32` shape rank per shared placement, then twelve `f32` values per placement (three
  row-major affine rows). Placement counts derive from their shape counts.
- One `u32` canonical destination per placed triangle, in placement order, unique and in range.
- All loose triangles' nine `f32` coordinates, then their `u32` albedos, filling unassigned
  canonical slots in order. Loose count is canonical count minus placed count.
- Six `f32` bounds and twelve `u32` child words per wide BVH node.
- One `u32` owner-group rank per triangle, followed by `groups + 1` owner offsets.
- Owner records: source-node rank and linear RGBA8 colour, both `u32`.
- One `i32` parent rank per source node (`-1` for roots), then one `i32` compiled mesh rank per
  source node (`-1` when it places none; version 5, #966), then sixteen `f64` bind-world values per
  node.

The manifest publishes `groups`, `owners` and `instances` beside the sizes and counts. Identical
owner lists are interned; subdivision shares a group and BVH permutation moves its rank with the
canonical triangle. Group offsets are monotonic, groups nonempty, ranks in range, the source
hierarchy acyclic; unknown proxy versions are rejected. These modules are in the compiler's
implementation hash, so a version's products never reuse an older version's keys. The mesh column
names what a partition's cell node draws, which no core node carries: the far sun's ray lets its
triangles through when every host mesh of that placed mesh says `castShadow = false`.

Sharing is computed after world simplification, beside provenance, from its bind-world matrices. A
placement shares only when every transformed coordinate, signed zero included, round-trips to
exactly the canonical f32 bits and every albedo matches; candidate maps use f64 products and sums,
left to right, rounded once to f32, in writer and reader alike. Nonfinite maps are refused;
unrelated runs and failed round-trips stay flat. At most eight prototypes of a matching triangle
count are tried, and a run is stored shared only when its tables save serialized bytes. This saves
disk and transfer bytes, not GPU geometry. The browser caches decoded columns with their verified
buffer across device sessions, charging expansion and matrix bytes to the CPU cache. `cargo run
--manifest-path packages/asset-compiler-rust/Cargo.toml --example proxy_sharing` regenerates the
paired Rust/TS fixtures and reports exact v3/v5 serialized bytes for the 1,000-instance case;
runtime memory and image acceptance are the post-merge measurement session's evidence.

The node table's optional `sourceNode` carries the original unsigned 32-bit document rank through
partition renumbering as exactly eight lowercase hexadecimal digits, a fixed width keeping the core
table's size independent of the world's node count; the runtime decodes it, rejecting malformed
values, and uses the table rank when absent. A proxy owner whose leaf is not instantiated follows
its nearest loaded ancestor. Each session keeps its mutable refit and transforms apart from the
shared cache bytes. Geometry simplification removed at cook is not rebuilt when an object later
grows.

## Impostor atlases

`clusters.json` carries `impostors` (version 1, #817): the compiler's verdict on every drawn mesh
and, for each eligible one, an octahedral atlas standing in for it far away. The runtime switch and
card are #1239, the crossfade and shadow casting #1240; this section fixes what the cache holds.

**Capture.** In object space, pivot at the bounding-sphere centre (`centre`, `objectRadius` R, the
DAG's `bounding_sphere`), +Y up, from `frames`×`frames` = 12×12 directions: frame `(i, j)` looks
back along `d = decode((i, j) / (frames − 1))`. The full octahedron decodes `f` through `p = (u, 1
− |u| − |v|, v)` with `(u, v) = 2f − 1`, the lower half folded as `p.xz ← side(p.xz) · (1 − |p.zx|)`
—
`side` is ±1, never 0, so a direction on an axis keeps its face —; the hemi-octahedron (`hemi`)
decodes `p = (f.x − f.y, 0, f.x + f.y − 1)`, `p.y = 1 − |p.x| − |p.z|`. `hemi` is chosen when every
placement keeps the mesh's +Y up and stands on the scene's floor within one probe texel; otherwise
the full octahedron. A frame is an orthographic view of side 2R onto the pivot's plane, axes `x =
normalize(cross(up, d))`, `y = cross(d, x)` (`up` = +Y, or +Z when `|d.y| > 0.999`); texel `(px,
py)` of a `frameSide`-texel frame sits at `((px + ½) / frameSide − ½) · 2R` along `x` and `(½ −
(py + ½) / frameSide) · 2R` along `y`: rows top to bottom, row 0 at `+y`. Frame `(i, j)` fills
texels
`[i · frameSide, (i + 1) · frameSide) × [j · frameSide, (j + 1) · frameSide)` of an `atlasSide =
frames · frameSide` square.

**Texels.** Four rotated-grid rays a texel go from `2R` along `d` towards the pivot, through the
compiler's one CPU tracer over the proxy's BVH constructor (`proxy/tracer.rs`), hitting only where
the material covers, cut as the texture chains take coverage: a `MASK` material with `alphaCutoff`
above 0 at that cutoff times its `baseColorFactor` alpha, a non-transmitting `BLEND` one at 0.5 (the
cutout threshold); a `MASK` at 0 and a transmissive `BLEND`, drawn opaque, keep every texel. The
test reads the base colour texel at the hit — the finest level of the baked tail, the coverage chain
when the material cuts — times the vertex colour's alpha (`COLOR_0`), at the set and under the
`KHR_texture_transform` the engine applies. Three RGBA8 maps: `colourCoverage`, the base colour
(sRGB, `baseColorFactor` times texel times `COLOR_0`) averaged over hitting rays, alpha their share;
`normalDepth`, the object-space normal (declared vertex normals interpolated, turned to face the
ray) as `n · ½ + ½`, alpha the depth `D = ½ + height / 2R`, `height` the signed distance above the
frame plane towards the capture; `orm`, occlusion, roughness and metallic (factors times textures),
alpha 255. An empty texel takes the maps of its frame's nearest covered texel, coverage staying 0,
so silhouette filtering blends no black fringe.

**Levels.** Each map carries its mip chain under the texture rule of [Textures](#textures), down to
four texels a frame side (`frameSide / 4`, three levels at least): below, a bilinear tap reads
neighbouring frames (other directions) and the coverage rule breaks; a smaller card samples the last
level. `colourCoverage` is the coverage chain at `C = 128` (the 0.5 cut), keeping level 0's filtered
coverage; `normalDepth` and `orm` are data chains. Each level is a lossless PNG content-addressed
object (`../../objects/<sha256>.bin`, spelled as physics objects), listed in `maps.<name>.levels[k]`
with `url`, `sha256`, `bytes`, `width` and `height`; `bytes` sums them.

**Eligibility.** With `f = focalPixels` (1117 lines at DPR 2 under the engine's 55° field), R the
bounding radius times the placements' largest world scale, T the DAG's `rootTriangles` over the
mesh's primitives and `c` the frames' mean coverage of their bounding disc (a first bake at 16
texels a frame), the atlas is sharp from `z_tex = 2R·f / frameSide` and the root outnumbers its
pixels from `z_tri = R·f·√(cπ/T)` (`switchDepth.texel`, `switchDepth.triangles`, in metres at `f`).
`frameSide` is the smallest power of two, at least 16, with `frameSide ≥ 2√(T/(cπ))`, so `z_tex ≤
z_tri`. Each `meshes` entry names its compiled `mesh`, `sourceMesh`, `name`, `placements`, `masked`,
`rootTriangles`, `radius` and `status`: `baked`, with `coverage`, `hemi`, `frames`, `frameSide`,
`atlasSide`, `maps` and `bytes`, or `refused`, with `reason`, a `detail` sentence giving the
deciding numbers, and the probe's `coverage` if one ran. Reasons, in trial order: `skinned` (a skin,
joint weights or morph targets: the mesh deforms); `single-opaque-placement` (one placement and no
masked material); `no-coverage`; `root-cheaper-than-impostor` (`z_tri` beyond the drawn scene's
bounds diagonal, the farthest a placement is seen from); `atlas-over-texture-limit` (`atlasSide`
above `textureLimit`, 8192, the side any WebGPU card holds). `baked` and `refused` count them.

## Deformation in geometry page format 7

After the ordinary attributes, flag 16 adds word 24's number of joint streams at word 23's base and
bit width, then as many weight streams of exact source float32 bits: every glTF JOINTS_n/WEIGHTS_n
pair and FBX influence in source order, with no ranking, pruning, renormalization or weight
quantization. Flag 32 adds nine words per target after the 25-word fixed header — its stream start,
then two records with widths 32/32/32, exponent zero and zero minima —; the six target streams are
exact float32 position and normal deltas, decoding to the source displacement used for conservative
reach, zero codec error. Readers reject non-finite deltas/weights, negative weights and inconsistent
counts or bytes. The JavaScript, native, WASM, WGSL and GLSL consumers share the influence width.

Flag 64 requires flag 16 and explicitly changes its IDs' meaning: they index the cooked simulation's
compacted vertices, not a skeleton, the weights interpolating displacements from those vertices'
recorded rest positions. Geometry page format 7 is required, so an older reader refuses it instead
of rendering a skin. The physics sidecar's optional `render: { version: 1, positions, indices }`
stores those rest positions (xyz per vertex) and triangle indices, in the order simulation and
renderer share; an unsupported mapping version or inconsistent lengths are rejected.

`primitives[].deformation` holds flattened joint rest balls (`x,y,z,radius`), one maximum
displacement per morph target and optional `softVertices`, bounding deformation whatever page is
selected, so the cut expands bounds and refines conservative error.

For material-driven whole-mesh transmission, `primitive.deformation.softSourceIds` (version 7) maps
each original render vertex to its compact simulation vertex in `softVertices`, as integers within
that array; clustered copies carry the same IDs in the flagged soft-source stream, both using one
simulation record.
