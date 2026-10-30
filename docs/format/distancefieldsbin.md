# `distanceFields.bin`

Signed distance fields of meshes that built one and HLOD cells whose layer allowed one
(`rust/distance_field/encode.rs`, read by `sdk-core/src/lighting/distanceFieldFile.ts`; settings in
[COMPILER.md](../compiler/distance-fields.md#distance-fields)). Little-endian.

- Head, 16 bytes: magic `T3DF`, version (3), field count, a reserved word.
- 200-byte record per field: owner, flags, box low and high corners in metres (six `f32`), three
  56-byte mip records, finest first: bricks per axis (three `u32`), distance scale and bias,
  volume-to-virtual-coordinate scale and add (three `f32` each), bricks stored, data start in its
  object (first byte, zero) and length (`u32` each).
- Each mip's data is a cache object (`objects/<sha256>.bin`): indirection table (a `u32` per brick
  cell, `0xffffffff` where none stored), then stored bricks of 512 bytes (8 × 8 × 8 voxels, a byte the
  distance over the band).

Flags (third word of the record):

| Bit | Name | Meaning |
| - | - | - |
| 0 (`1`) | `DISTANCE_FIELD_FLAG_TWO_SIDED` | a quarter of triangles or more two-sided (or build asked for all): hits less accurate |
| 1 (`2`) | `DISTANCE_FIELD_FLAG_HLOD_CELL` | first word names a cell of the world's HLOD chain ([World HLOD](prepared-scene-tables.md#world-hlod)); box in world space |

Version 1 is refused (`UNSUPPORTED_FORMAT`). The manifest's `distanceFields` section names the file and
lists per field `{ "mesh": <mesh or cell>, "twoSided": <bool>, "mips": [...] }`, `"hlodCell": true` on
an HLOD cell's:

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

Also `bytes`, `headBytes`, `meshBytes`, `mipBytes`, `bricks`. `mips` lists data objects
`{ "url", "sha256", "bytes" }` in record order.
The file is read once beside the manifest; a mip's object whole when the atlas takes it in, checked
against size and digest.

Version 2 is still read: mips' data follow the records (coarsest first per field), read by parts: head
and records (`baseBytes`) checked against `baseSha256`, each mip by Range checked against `mipSha256`;
without them the file is read whole.

No fields: neither file nor section. Constants: `DISTANCE_FIELD_VERSION`,
`DISTANCE_FIELD_PARTS_VERSION`, `DISTANCE_FIELD_MAGIC`, `DISTANCE_FIELD_HEAD_BYTES`,
`DISTANCE_FIELD_MESH_BYTES`, `DISTANCE_FIELD_MIP_BYTES`, `DISTANCE_FIELD_FLAG_*`
(`packages/sdk-core/src/contracts/distanceFieldAbi.ts`).
