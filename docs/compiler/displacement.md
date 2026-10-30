# Displacement

Two options move a surface by a height map. A material's `extras.displacement` has the surface drawn
displaced, by the run-time tessellation ([`ENGINE.md`](../ENGINE.md)); the `meshBuild` settings
`displacementMaps`, `displacementUvChannel` and `displacementEdgeSplit` bake the displacement into a
mesh's own triangles when the scene is compiled. The two do not depend on one another.

## A material's displacement

glTF has no displacement map, so a material names its displacement in its `extras`. A material is
displaced only when it names a height map **and** switches its tessellation on: a material that does
neither — the default — is the flat surface its triangles describe, its table entry has no
`displacement` field and the compiled scene is byte for byte what it was before the option existed.

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

| Field          | Takes                                                                                                                                                | Default |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `texture`      | A glTF `textureInfo` (`index`, `texCoord`): the height map, its red channel, from 0 to 1                                                             | none    |
| `tessellation` | `true` to displace the material: nothing is displaced without it                                                                                     | `false` |
| `magnitude`    | A finite number of at least 0: the distance, in the object's units, between height 0 and height 1                                                    | `4`     |
| `center`       | A number from 0 to 1: the height that leaves the surface where it is                                                                                 | `0.5`   |
| `fade`         | `false` (never fades), `true` (the range 4 to 1), or `{ "start", "end" }`, each a number of at least 0.0001 pixels, a missing end taking its default | `false` |

A point is moved along its surface normal by `(height − center) × magnitude`. `fade` shrinks that
distance as the object recedes: it is whole while the largest displacement the material makes covers
`start` pixels on screen and gone at `end` pixels, where the surface is drawn flat. Unknown fields,
a value out of its range, or `tessellation: true` with no `texture` refuse the job
(`INVALID_OPTIONS`), naming the material and the field.

The height map is baked as a data texture beside the metallic-roughness and normal maps, in the one
data atlas. A per-job override of these fields is not read.

**The texture-coordinate density.** The compiler also measures, for a displaced material, how many
units of the object's space one unit of each of its eight texture-coordinate sets covers: over
every triangle that wears the material — the `sqrt(area / coordinate area)` of each triangle, weighted
by `sqrt(area)`, the tenth of the triangles that say the least and the tenth that say the most of each
primitive left out — and the weighted means of every primitive that wears the material added before
the division. The run-time tessellation reads the height map at the level that density asks, one
level for the whole material, so that the micro-triangles of two triangles of different stretch meet
without a crack. Nothing to write: a scene with no displaced material reads no triangle for it.

## Baked displacement

A material's displacement above moves the surface when it is drawn. A mesh can also have it **baked
into its triangles when the scene is compiled**: the compiler tessellates the mesh where the height
maps bend it, moves each vertex along its normal by the map's displacement, and builds the mesh's
clusters from the displaced result; the coarser levels are then simplified back to the error you
ask. Nothing is baked unless the mesh names a height map **and** a `trimmedError` above 0.

All the triangle primitives of the mesh are tessellated as one soup, so two primitives that meet
along an edge move together and no crack opens between them. The height map of rank `n` displaces the
triangles of the mesh's primitive `n` (its index among the glTF mesh's `primitives`); a primitive
with no map of its rank stays flat, and a map past the last primitive is not read. A primitive that
deforms — a skin, a morph target, a soft body — or that stands for a part of an assembly is left out
of the soup and built as it was. A scene that names no map is byte for byte what it was before.

The settings are `meshBuild` settings, with the reference's defaults: `displacementMaps`,
`displacementUvChannel`, `displacementEdgeSplit` and the `trimmedError` that holds the mesh to its error
([Mesh build settings](how-a-mesh-coarsens.md#mesh-build-settings)); the scene's, by object, or a glTF mesh's own `extras`,
the first that names it winning. The baked displacement is tessellated to a half finer than the
`trimmedError` the mesh is held to.

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

Everything that reads the mesh's triangles reads the baked ones: the mesh's clusters, the collider
cooked from them, the layers of the HLOD that merge the mesh, and the voxels it draws far away
(sampled from the baked mesh, not from the glTF). The normals the tessellation blended are kept, not
rebuilt from the displaced triangles.

**What the RAM budget decides.** The tessellation stops at a number of triangles that follows the
room the job's budget leaves: a quarter of what remains for the working set of one primitive that
bakes and a quarter for the records of all of them together, the other half kept for the textures'
stages, and at most 10 000 000 triangles. A job with a small budget bakes a coarser mesh, never a
refused one, and a mesh that begins above the cap is left as it was. The plan charges each
primitive of a mesh that bakes for the whole mesh at that cap — the soup, the baked arrays (which a
mesh that is voxelized keeps until its voxels are sampled), and the clusters and pages built from
them — so such primitives compile one at a time. Each height image is charged once however many
meshes name it, as held (a float and the chain of least and most heights a texel, about seven bytes
a texel); an image too large for the budget refuses the compile by name
(`RAM_ADMISSION_BUDGET_EXCEEDED`). A height image is read when the first primitive that bakes with
it asks, and shared by every map that names it; the first primitive of a mesh to ask bakes the whole
mesh, and the others take their triangles from it.
