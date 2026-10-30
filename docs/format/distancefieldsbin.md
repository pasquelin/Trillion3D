# `distanceFields.bin`

The signed distance fields of the meshes that built one, and of the HLOD cells whose layer allowed one
(`rust/distance_field/encode.rs`, read by `sdk-core/src/lighting/distanceFieldFile.ts`; the settings are in
[COMPILER.md](../compiler/distance-fields.md#distance-fields)). Words are little-endian. The head, 16 bytes: the magic `T3DF`, the version (3), the
number of fields and a reserved word. Then a record of 200 bytes for each field: two words, the owner
and the flags, the box's low and high corners in metres (six `f32`), then three mip records of 56 bytes,
finest first: the bricks along each axis (three `u32`), the distance scale and bias, the
volume-to-virtual-coordinate scale and add (three `f32` each), the bricks stored, and where the mip's
data starts in its object — its first byte, zero — and how long it is (`u32` each). The file ends with the
records: each mip's data is an object of the cache of its own (`objects/<sha256>.bin`, like a geometry
container), which the section names: the indirection table (a `u32` for each cell of bricks, `0xffffffff`
where none is stored) and the bricks stored, 512 bytes each (8 × 8 × 8 voxels, a byte the distance to the
surface over the band).

The record's third word holds flags:

| Bit     | Name                            | Meaning                                                                                                                                                                                                        |
| ------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 (`1`) | `DISTANCE_FIELD_FLAG_TWO_SIDED` | a quarter of the triangles or more are two-sided (or the build asked for all): the field's hits are less accurate                                                                                              |
| 1 (`2`) | `DISTANCE_FIELD_FLAG_HLOD_CELL` | the field is an HLOD cell's: the first word names a cell of the world's chain of HLOD cells ([World HLOD](prepared-scene-tables.md#world-hlod)), not a compiled mesh, and the box is in the world's space, not the mesh's object space |

Version 2 added the flags (a file of version 1 is refused: `UNSUPPORTED_FORMAT`). The manifest's
`distanceFields` section names the file and lists, for each field, `{ "mesh": <mesh or cell>, "twoSided":
<bool>, "mips": [...] }`, with `"hlodCell": true` on an HLOD cell's:

```json
{
  "distanceFields": {
    "version": 3,
    "file": "distanceFields.bin",
    "meshes": [
      { "mesh": 0, "twoSided": false, "mips": [{ "bricks": [4, 4, 1], "stored": 11 }] },
      {
        "mesh": 5,
        "twoSided": false,
        "hlodCell": true,
        "mips": [{ "bricks": [18, 18, 3], "stored": 240 }]
      }
    ],
    "mips": [{ "url": "../../objects/<sha256>.bin", "sha256": "<sha256>", "bytes": 12544 }]
  }
}
```

(The section also carries `bytes`, `headBytes`, `meshBytes`, `mipBytes` and the `bricks` total.) Its `mips` lists
the objects holding the mips' data, `{ "url", "sha256", "bytes" }` each, in the records' order, a field's mips
finest first: the bricks are megabytes the view mostly never asks for, so the file is read once beside the
manifest and each mip's object whole when the atlas takes the mip in, checked against its size and digest, sent
compressed like every object. The reader still reads version 2, whose mips' data follow the records in the file
(each field's coarsest first), read by parts: the head and the records, `baseBytes` long, once, checked against
`baseSha256`, then each mip's data at the offset and length its record gives by a Range, checked against its entry
of `mipSha256`; a section of version 2 without them has its file read whole. A scene whose meshes build none writes
neither the file nor the section. Constants: `DISTANCE_FIELD_VERSION`, `DISTANCE_FIELD_PARTS_VERSION`,
`DISTANCE_FIELD_MAGIC`, `DISTANCE_FIELD_HEAD_BYTES`, `DISTANCE_FIELD_MESH_BYTES`, `DISTANCE_FIELD_MIP_BYTES`,
`DISTANCE_FIELD_FLAG_*` (`packages/sdk-core/src/contracts/distanceFieldAbi.ts`).
