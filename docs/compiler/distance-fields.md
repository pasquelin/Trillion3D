# Distance fields

A mesh whose build sets `distanceField` (`true`, default) gets a signed distance field, built from
level-0 triangles in centimetres, written in `distanceFields.bin` (`distance_field/`) and named by
the manifest's `distanceFields` section.

- The box (half-extent at least 1 an axis) is held by 8 × 8 × 8 bricks (7 voxels own, the eighth
  shared) plus a border voxel. A mesh with a quarter or more triangles two-sided, or with
  `distanceFieldTwoSided`, has its box grown by a texel.
- Mip 0 holds `size × distanceFieldDensity × distanceFieldScale / 7` bricks along an axis, rounded
  and held between 1 and `distanceFieldMaxResolution / 2` over 7 (whole resolution for a scale
  above 1), at most 1023. Mips 1 and 2 halve them, rounding up.
- A voxel is one byte: distance to the surface in a band of four voxels either side, 0 the farthest
  inside, 255 the farthest outside. Inside = more than a quarter of 98 rays (49 per hemisphere,
  fixed seed) hit a back face of a one-sided material. Blended triangles are left out.
- A brick of only 0 or only 255 is not stored: its indirection cell holds `0xffffffff`.
- `distanceFields.bin` also holds one field per HLOD cell whose layer allows one
  (`layers[].allowDistanceField`, [HLOD](hlod.md#hlod)), built from the level-0 triangles of all the
  cell's actors together, in world space. A cell whose sphere exceeds `meshDistanceFieldMaxObjectRadius` (100 000 cm) is
  left out at run time. Version 2 ([FORMAT.md](../format/distancefieldsbin.md#distancefieldsbin)).

```json
{
  "meshBuild": {
    "objects": [
      { "match": { "node": { "regex": "^Hedge" } }, "distanceFieldScale": 0.5 },
      { "match": { "node": { "regex": "^Sign" } }, "distanceField": false },
      { "match": { "node": { "regex": "^Fence" } }, "distanceFieldTwoSided": true }
    ]
  }
}
```

None: `trillion3d-compile '--mesh-build={"distanceField":false}' …`; on a mesh,
`"extras": { "distanceField": false }` or `{ "distanceFieldScale": 2 }`. A setting of the wrong
kind refuses the job (`INVALID_OPTIONS`).
