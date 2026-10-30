# `meshCards.bin`

The cards of the meshes that kept some, and of the HLOD cells whose layer allowed a distance field
(`rust/card_representation/encode.rs`, read by `sdk-core/src/lighting/meshCardsFile.ts`; settings in
[COMPILER.md](../compiler/mesh-cards.md#mesh-cards)). A card is a box looking at the mesh along one of
the six axis directions; a mesh's cards cover its surface. Words are little-endian, lengths are metres
in the mesh's object space (the world's for an HLOD cell's).

- Head, 16 bytes: magic `T3MC`, version (1), number of meshes, number of cards.
- A 40-byte record per mesh: two words (owner, flags), the low and high corners of the box the cards
  were fitted in (six `f32`), the rank of the mesh's first card in the card table and its card count
  (`u32` each).
- Then the card table, 64 bytes a card, each mesh's cards in the records' order: the box centre (three
  `f32`), its half-extents along its own axes (three `f32`), its three axes (three `f32` each: unit
  vectors, the third facing out of the mesh) and the direction it looks along (`u32`).

| Direction | Faces out along | Direction | Faces out along |
| - | - | - | - |
| 0 | `-x` | 3 | `+y` |
| 1 | `+x` | 4 | `-z` |
| 2 | `-y` | 5 | `+z` |

The record's third word holds flags:

| Bit | Name | Meaning |
| - | - | - |
| 0 (`1`) | `MESH_CARDS_FLAG_TWO_SIDED` | a quarter of the triangles or more are two-sided (or the build asked for all): the mesh was covered as foliage is, by its outer cards alone |
| 1 (`2`) | `MESH_CARDS_FLAG_HLOD_CELL` | an HLOD cell's cards: the first word names a cell of the world's chain of HLOD cells ([World HLOD](prepared-scene-tables.md#world-hlod)), not a compiled mesh, and lengths are in the world's space, not the mesh's object space |

A mesh whose build keeps no card (`maxMeshCards` 0) has no record; a mesh the cards found none for has
a record of no card. The manifest's `meshCards` section names the file and lists, per record,
`{ "mesh": <mesh or cell>, "twoSided": <bool>, "cards": <count> }`, with `"hlodCell": true` on an HLOD
cell's:

```json
{
  "meshCards": {
    "version": 1,
    "file": "meshCards.bin",
    "cards": 14,
    "meshes": [
      { "mesh": 0, "twoSided": false, "cards": 6 },
      { "mesh": 5, "twoSided": false, "hlodCell": true, "cards": 8 }
    ]
  }
}
```

The section also carries `bytes`, `headBytes`, `meshBytes` and `cardBytes`. A scene whose meshes keep
no card writes neither file nor section. Constants: `MESH_CARDS_VERSION`, `MESH_CARDS_MAGIC`,
`MESH_CARDS_HEAD_BYTES`, `MESH_CARDS_MESH_BYTES`, `MESH_CARDS_CARD_BYTES`, `MESH_CARDS_DIRECTIONS`,
`MESH_CARDS_FLAG_*` (`packages/sdk-core/src/contracts/meshCardsAbi.ts`).
