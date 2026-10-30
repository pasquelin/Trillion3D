# Displacement

Two independent options: a material's `extras.displacement` (drawn displaced by the run-time
tessellation, [`ENGINE.md`](../ENGINE.md)); the `meshBuild` settings `displacementMaps`,
`displacementUvChannel`, `displacementEdgeSplit` (baked into a mesh's triangles at compile time).

## A material's displacement

A material is displaced only when it names a height map **and** sets `tessellation` on. Otherwise
its table entry has no `displacement` field and the compiled scene is unchanged.

```json
{
  "materials": [
    {
      "name": "bricks",
      "pbrMetallicRoughness": { "baseColorTexture": { "index": 0 } },
      "extras": {
        "displacement": {
          "texture": { "index": 1 },
          "tessellation": true,
          "magnitude": 4,
          "center": 0.5,
          "fade": { "start": 4, "end": 1 }
        }
      }
    }
  ]
}
```

| Field | Takes | Default |
| - | - | - |
| `texture` | glTF `textureInfo` (`index`, `texCoord`): height map, red channel, 0 to 1 | none |
| `tessellation` | `true` displaces the material | `false` |
| `magnitude` | Finite number, at least 0: object-unit distance between height 0 and 1 | `4` |
| `center` | Number 0 to 1: the height that leaves the surface in place | `0.5` |
| `fade` | `false`, `true` (range 4 to 1), or `{ "start", "end" }`, each at least 0.0001 pixels, a missing end taking its default | `false` |

A point moves along its normal by `(height − center) × magnitude`. `fade`: whole while the
material's largest displacement covers `start` pixels on screen, gone (flat) at `end` pixels.
Unknown fields, a value out of range, or `tessellation: true` with no `texture` refuse the job
(`INVALID_OPTIONS`), naming material and field. The height map is baked as a data texture in the
data atlas. A per-job override is not read.

**Texture-coordinate density.** The compiler measures, per displaced material and per coordinate
set (eight), the object-space units one coordinate unit covers: `sqrt(area / coordinate area)` per
triangle, weighted by `sqrt(area)`, dropping per primitive the lowest and highest tenth. Nothing to
write.

## Baked displacement

The compiler tessellates the mesh where the height maps bend it, moves each vertex along its normal
by the map's displacement, and builds clusters from the result; coarser levels are simplified back to
the requested error. Nothing is baked unless the mesh names a height map **and** a `trimmedError`
above 0.

All triangle primitives are tessellated as one soup. The height map of rank `n` displaces primitive
`n` (index in the glTF mesh's `primitives`); a primitive without a map of its rank stays flat; a map
past the last primitive is not read. A deforming primitive (skin, morph target, soft body) or a part
of an assembly is left out of the soup and built as is.

Settings are `meshBuild` settings with reference defaults: `displacementMaps`,
`displacementUvChannel`, `displacementEdgeSplit`, and the `trimmedError` that holds the mesh to its
error ([Mesh build settings](how-a-mesh-coarsens.md#mesh-build-settings)); from the scene, by
object, or a glTF mesh's `extras`, first that names it winning. Tessellation is a half finer than
`trimmedError`.

```json
{
  "meshBuild": {
    "objects": [
      {
        "match": "Cliff",
        "trimmedError": 0.5,
        "displacementUvChannel": 0,
        "displacementMaps": [{ "texture": { "index": 4 }, "magnitude": 0.8, "center": 0.5 }]
      }
    ]
  }
}
```

The same keys in a glTF mesh's `extras` bake that mesh wherever the job does not name them.
Clusters, collider, HLOD merges and far voxels all read the baked triangles.

**What the RAM budget decides.** Tessellation stops at a triangle count from the room the budget
leaves (a quarter of the remainder for one baking primitive's working set, a quarter for all
records, the rest for texture stages), at most 10 000 000. A small budget bakes a coarser mesh,
never refuses; a mesh starting above the cap is left as it was. Each primitive of a baking mesh is
charged for the whole mesh at that cap, so such primitives compile one at a time. Each height image
is charged once (about 7 bytes a texel); one too large refuses the compile
(`RAM_ADMISSION_BUDGET_EXCEEDED`).