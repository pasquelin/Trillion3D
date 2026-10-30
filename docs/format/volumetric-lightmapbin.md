# `volumetric-lightmap.bin`

The precomputed indirect light of a baked scene: a sparse grid of bricks of third-order spherical
harmonics (`rust/volumetric_lightmap`, read by `sdk-core/src/lighting/volumetricLightmapFile.ts`).
Words are little-endian `u32`. The head, 35 words: the magic `T3VL`, the version (2; a file of
version 1 is still read), the brick size (4), the world box the grid covers (lower then upper
corner, `f32` × 3 each), the indirection volume's size in texels and the atlas's (`u32` × 3 each),
then for each of the ten layers its texel format (1 `rgba8uint`, 2 `rg11b10ufloat`, 3 `rgba8unorm`,
4 `r8unorm`) and its byte length. The layers follow, each on a four-byte boundary, texels in x, then
y, then z order. Version 2 adds two words after the head, the side of a streaming cell in finest
bricks and the number of cells (0 for a file whose bricks are all in its layers, as in version 1),
and, after the layers, a record of 14 words for each cell: its three coordinates in the grid of
cells, its bricks, where its bytes start in the file and their length, then their SHA-256 (32
bytes). The cells' bytes follow the records. A cell holds, in this order, each part brick after
brick: the three coordinates of every brick in the indirection volume (`u32`), then the 5 × 5 × 5
texels of its ambient, of its six coefficient layers, of its bent normal (where the file has one)
and of its sun's shadowing, in the formats of the layers. With cells, the layers hold the coarser
bricks alone and the indirection volume names, for a finest brick's place, the coarser brick over
it; a cell loaded takes slots of the atlas past the layers' and points its indirection texels at
them. The part always read, from the head to the end of the records, is `baseBytes` long in the
manifest's section, with `baseSha256`; a cell is read by a Range and checked against its own digest.

| Layer | Format | Volume | Holds |
| --- | --- | --- | --- |
| 0 | `rgba8uint` | indirection | per texel of the finest level: the brick's place in the atlas layout (three bytes) and how many finest bricks it spans |
| 1 | `rg11b10ufloat` | atlas | the ambient colour (the zeroth coefficient) |
| 2 to 7 | `rgba8unorm` | atlas | the other coefficients, red low and high, green low and high, blue low and high: each divided by the ambient and by its basis function's scale, mapped from [-1, 1] to [0, 1] |
| 8 | `rgba8unorm` | atlas | the sky's bent normal mapped to [0, 1] (alpha a half), its length the sky's visibility; empty (0 bytes) where the job names no sky light or the sky does not cast shadows |
| 9 | `r8unorm` | atlas | the stationary sun's unshadowed fraction |

The atlas is a layout of up to 256 bricks a side, each brick `brickSize + 1` texels wide: the
`brickSize`³ unique samples and one row of padding on the three upper faces, so that a trilinear
read never leaves its brick. The indirection volume names, for a position, the brick holding it; a
brick of a coarser level spans several texels of it. A file of another version is refused whole.

Written by the compiler when the job names `lightmapBake`
([COMPILER.md](../compiler/volumetric-lightmap.md#volumetric-lightmap)):
`rust/volumetric_lightmap/bake.rs` fills the layers, `writer.rs` lays them out. The manifest's
`volumetricLightmap` section names it: `{ version, file, bytes, bounds, bricks, levels, indirection,
passes, sky }` — the version of the file, its name, its size, the world box the volume covers (lower
then upper corner, metres), the bricks it holds and the levels they come in, the indirection
volume's size, the passes each probe took, and whether the job named a sky light (`sky`); the bent
normal layer is written only where that sky casts shadows.

- Versions: `VOLUMETRIC_LIGHTMAP_VERSION` (`rust/volumetric_lightmap/format.rs`); the head's
  constants `VOLUMETRIC_LIGHTMAP_MAGIC`, `VOLUMETRIC_LIGHTMAP_LAYERS`,
  `VOLUMETRIC_LIGHTMAP_FIXED_WORDS`, `VOLUMETRIC_LIGHTMAP_LAYER_WORDS`,
  `VOLUMETRIC_LIGHTMAP_HEADER_WORDS`, `VOLUMETRIC_LIGHTMAP_MAX_LAYOUT`.
