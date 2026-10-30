# `volumetric-lightmap.bin`

Precomputed indirect light of a baked scene: a sparse grid of bricks of third-order spherical
harmonics (`rust/volumetric_lightmap`, read by `sdk-core/src/lighting/volumetricLightmapFile.ts`).
Little-endian `u32` words.

- Head, 35 words: magic `T3VL`, version (2; 1 still read), brick size (4), world box (lower then upper
  corner, `f32` × 3 each), indirection volume size in texels and atlas size (`u32` × 3 each), then for
  each of ten layers its texel format (1 `rgba8uint`, 2 `rg11b10ufloat`, 3 `rgba8unorm`, 4 `r8unorm`)
  and byte length.
- Layers follow, each on a four-byte boundary, texels in x, y, z order.
- Version 2 adds two words after the head (side of a streaming cell in finest bricks; number of cells,
  0 when all bricks are in the layers, as in version 1) and, after the layers, a record of 14 words per
  cell: three coordinates in the cell grid, its bricks, where its bytes start in the file, their
  length, then their SHA-256 (32 bytes). Cells' bytes follow the records.
- A cell holds, in order, each part brick after brick: the three coordinates of every brick in the
  indirection volume (`u32`), then the 5 × 5 × 5 texels of its ambient, six coefficient layers, bent
  normal (where the file has one) and sun shadowing, in the layers' formats.
- With cells, the layers hold the coarser bricks alone and the indirection volume names, for a finest
  brick's place, the coarser brick over it; a loaded cell takes atlas slots past the layers' and points
  its indirection texels at them.
- The part always read, head to end of records, is `baseBytes` long in the manifest's section, with
  `baseSha256`; a cell is read by a Range and checked against its own digest.

| Layer | Format | Volume | Holds |
| - | - | - | - |
| 0 | `rgba8uint` | indirection | per finest-level texel: the brick's atlas place (three bytes) and how many finest bricks it spans |
| 1 | `rg11b10ufloat` | atlas | ambient colour (zeroth coefficient) |
| 2 to 7 | `rgba8unorm` | atlas | other coefficients, red low and high, green low and high, blue low and high: each divided by the ambient and its basis function's scale, mapped from [-1, 1] to [0, 1] |
| 8 | `rgba8unorm` | atlas | sky's bent normal mapped to [0, 1] (alpha a half), its length the sky's visibility; empty (0 bytes) where the job names no sky light or the sky casts no shadows |
| 9 | `r8unorm` | atlas | stationary sun's unshadowed fraction |

The atlas is a layout of up to 256 bricks a side, each `brickSize + 1` texels wide: `brickSize`³
samples plus one row of padding on the three upper faces. A brick of a coarser level spans several
indirection texels. A file of another version is refused whole.

Written by the compiler when the job names `lightmapBake`
([COMPILER.md](../compiler/volumetric-lightmap.md#volumetric-lightmap)):
`rust/volumetric_lightmap/bake.rs` fills the layers, `writer.rs` lays them out. The manifest's
`volumetricLightmap` section: `{ version, file, bytes, bounds, bricks, levels, indirection, passes,
sky }`: file version, name, size, world box (lower then upper corner, metres), bricks and levels,
indirection volume size, passes per probe, whether the job named a sky light (`sky`).

- Versions: `VOLUMETRIC_LIGHTMAP_VERSION` (`rust/volumetric_lightmap/format.rs`); head constants
  `VOLUMETRIC_LIGHTMAP_MAGIC`, `VOLUMETRIC_LIGHTMAP_LAYERS`, `VOLUMETRIC_LIGHTMAP_FIXED_WORDS`,
  `VOLUMETRIC_LIGHTMAP_LAYER_WORDS`, `VOLUMETRIC_LIGHTMAP_HEADER_WORDS`,
  `VOLUMETRIC_LIGHTMAP_MAX_LAYOUT`.
