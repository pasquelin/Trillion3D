# Distance fields

A mesh whose build sets `distanceField` (`true`, the default: the reference's gameplay templates, third
person, first person and top down, turn the generation on in a new project) gets a signed distance
field, read by the distance-field occlusion of the sky light and the software ray tracing. It is built from the mesh's level-0
triangles, in the reference's own unit, the centimetre (a metre is 100 of them), and written in
`distanceFields.bin` (`distance_field/`), which the manifest's `distanceFields` section names; a scene
whose meshes build none writes neither.

- The mesh's box, at least a unit of half-extent an axis, is held by bricks of 8 × 8 × 8 voxels, 7 of
  which are the brick's own and the eighth shared with the next brick for the trilinear filter, and a
  voxel of border all round the box for the gradient. A mesh with a quarter of its triangles
  two-sided or more, or built with `distanceFieldTwoSided`, has its box grown by a texel first.
- Mip 0 holds `size × distanceFieldDensity × distanceFieldScale / 7` bricks along an axis, rounded
  and held between 1 and `distanceFieldMaxResolution / 2` over 7 (the whole resolution over 7 for a
  scale above 1), at most 1023. Mips 1 and 2 halve them, rounding up.
- A voxel is one byte: its distance to the surface in the band of four voxels either side, 0 the
  farthest inside, 255 the farthest outside. The distance is the nearest triangle's; the voxel is
  inside when more than a quarter of the 98 rays it casts over the sphere (49 stratified over each
  hemisphere, drawn from a fixed seed) hit a back face of a one-sided material. The triangles of a
  blended material are left out.
- A brick holding only voxels at 0 or only at 255 is not stored: its cell of the mip's indirection
  table holds `0xffffffff`.
- Besides each compiled mesh's field, `distanceFields.bin` holds the field of each HLOD cell whose
  layer allows one (`layers[].allowDistanceField`, [HLOD](hlod.md#hlod)): one field per cell,
  built from the level-0 triangles of all the cell's actors together (a merged layer keeping its
  materials makes one actor per material, and the field is of the merged mesh, its sections together).
  Its box and its voxels are in the world's space. A cell whose bounding sphere is larger than
  `meshDistanceFieldMaxObjectRadius` (100 000 cm by default) is left out by the scene at run time, as a
  mesh's placement is. The file is of version 2 ([FORMAT.md](../format/distancefieldsbin.md#distancefieldsbin)).

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

Here every mesh builds a field as the default says, the hedges at half the voxels, the signs none and
the fences as if two-sided. To build none at all: `trillion3d-compile '--mesh-build={"distanceField":false}' …`;
on a mesh, `"extras": { "distanceField": false }` or `{ "distanceFieldScale": 2 }`. A setting of the wrong kind
refuses the job (`INVALID_OPTIONS`).
