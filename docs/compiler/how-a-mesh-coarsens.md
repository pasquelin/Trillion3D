# How a mesh coarsens

Every primitive's coarser levels are built by one cluster DAG (`asset-compiler-rust/src/dag`),
carrying every page attribute (normal, stored tangent, texture sets, colour) and a skinned
primitive's bones. The source is read as a mesh build reads it (`dag/input.rs`):

1. Vertices are built (`dag/input/built.rs`): colour RGB sRGB to linear; non-finite position is the
   origin, non-finite normal or stored tangent is nothing, texture coordinates (0, 0), colour
   white; a triangle with two corners at one vertex is dropped.
2. Frames are rebuilt per the mesh's settings (`dag/input/frames.rs`): by default every normal, and
   every stored tangent by MikkTSpace (`dag/input/mikk.rs`); with `recomputeNormals` and
   `recomputeTangents` off, only a normal that is nothing and stored tangents of a vertex whose
   frame is not whole.
   - Triangles around a vertex form groups joined by shared edges (every edge soft); each group
     sums its triangles' normals, weighed by area times vertex angle with `computeWeightedNormals`.
   - A MikkTSpace tangent is the angle-weighted mean of the first texture set's derivatives of the
     triangles sharing the vertex's normal, texture coordinates and mapping orientation.
   - A vertex whose corners take different frames is cut in one vertex per frame.
   - A skinned mesh keeps its source's frames, rebuilding only those not whole.
3. Normal, tangent direction and bitangent are made unit; sign 1 unless the unit frame turns the
   other way. Colour channels become the byte of their sRGB encoding, alpha of its linear value.
4. Without bones, a triangle with two corners at one point is dropped, also one with two corners
   within 200 nanometres per axis when `dropNearCollapsed` is on. Each corner points at the first
   earlier vertex at its position whose normal, tangent and bitangent lie within 2·10⁻⁵ per axis,
   texture coordinates within 1/1024, and colour bytes and bones equal; else it lays a vertex.
5. With bones, a corner points at the first earlier vertex within `skinnedWeldPosition` per axis
   matching within `skinnedWeldNormal` and `skinnedWeldTexture` (`dag/input/skinned.rs`); else it
   lays a vertex; a triangle with two corners then at one vertex is dropped.
6. A colour white at every vertex is dropped. Once level 0 is cut, values are held in range:
   position within ±10¹⁰ metres, texture coordinate within ±10¹² (a page holds ±2.1·10⁹ at most),
   colour within [0, 1]; normals and stored tangents made unit, tangent sign `±1`.

Level 0 partitions its triangles into clusters of 124 to 128 triangles (at most 128: one
cluster, Morton order); each later level groups 8 to 32 neighbouring clusters,
simplifies the group with edges shared with other groups locked, and re-splits it (multilevel
recursive bisection, `page-codec-wasm/src/partition`). Vertices equal in every float are one vertex
to a group. Bones weigh nothing in the error; a placed vertex takes the nearest vertex's.

Locked edges carry from level to level (`dag/clusters.rs`, `dag/border.rs`):

- Every edge of a level-0 cluster counts its links to triangles of other clusters.
- A level of more than 32 clusters joins clusters into groups by counted edges that other clusters'
  counted edges run back; 32 or fewer is one group.
- A group drops the edges its other children run and locks the ends of what is left; each edge its
  simplification leaves end to end as it was takes its count back, each re-split cluster adding its
  links to the group's other new clusters. An uncounted edge laid along a neighbour's stays free.
- A cluster whose strips lay more than 256 vertices is halved (both halves use the whole box).

A group no target size re-splits (practically never) keeps its children and error and makes no
coarser cluster: past that error its surface is not drawn, and the `stall` event names it; its
`rootTriangles` are the level-0 triangles no coarser level replaces.

A mesh's glTF `extras` set how it keeps its shape as it coarsens:

| Key | Values | Default |
| - | - | - |
| `shapePreservation` | `none`; `area`: each simplification pushes the open border of the material that lost the most area outwards by what it lost; `voxelize`: ([Voxels far away](voxels-far-away.md#voxels-far-away)) | `none` |
| `edgeLengthBound` | Number >= 0: a collapse costs at least the square of each edge it makes over this bound (unit: group's mean triangle is 1/4 to 1/2 across); 0 bounds nothing | `0` |
| `holdTextureCoordinates` | `true`: a collapse keeps its vertices' texture coordinates instead of solving them; they count nothing in the error | `false` |

```json
{ "meshes": [{ "name": "fern", "extras": { "shapePreservation": "area", "edgeLengthBound": 4 } }] }
```

An unknown shape preservation, a bound that is not a number >= 0, or a hold that is not boolean
refuses the job (`INVALID_OPTIONS`). Extras change the cache key.

## Mesh build settings

`meshBuild` (`--mesh-build=` JSON, `jobs[].meshBuild`, `resolveMeshBuild`) sets how each mesh is
built (`compiler/args/mesh_build.rs`):

| Setting | Values | Default |
| - | - | - |
| `storedTangents` | `true`: pages store tangents (source `TANGENT` unless rebuilt; rebuilt where absent; +X sign 1 for a primitive without them in a mesh where another has some), weighted 1/16 of a normal in simplification, sign 1/2 ([FORMAT.md](../format/pages.md#pages)). A primitive without normals stores none | `false` |
| `recomputeNormals` | `true`: every normal and stored tangent is rebuilt; a primitive without `NORMAL` gets them. `false`: source's kept, only a nothing-normal rebuilt. A skinned mesh keeps its source's frames either way | `true` |
| `recomputeTangents` | `true`: every stored tangent is rebuilt. `false`: the source's kept while the normals are, only a tangent whose frame is not whole rebuilt. Only with `storedTangents` | `true` |
| `useMikkTSpace` | `true`: rebuilt tangents are MikkTSpace's. `false`: sum of the group's triangle tangents, orthonormalised around the normal | `true` |
| `computeWeightedNormals` | `true`: rebuilt normals weigh each triangle by area times its angle at the vertex | `false` |
| `skinnedWeldPosition` | Number >= 0, metres: per-axis distance within which skinned corners weld | `2e-7` |
| `skinnedWeldNormal` | Number >= 0: per-axis normal/tangent/bitangent difference within which skinned corners weld | `2e-5` |
| `skinnedWeldTexture` | Number >= 0: texture coordinate difference within which skinned corners weld | `1/1024` |
| `voxelRays` | Whole number >= 0: rays per voxel; at most 1024; past 1 rounded up to a multiple of 16 (17 casts 32); 0 or 1 casts one ray (voxel covered whole or not at all) | `64` |
| `voxelLevel` | Whole number: DAG level from which every group is voxels, whatever its triangles' error. 0: only where voxels are finer than the triangles; below 0 acts as 1 | `0` |
| `voxelBackUp` | Number, voxel sides: how far back each ray starts; a hit in that stretch counts as neither hit nor miss. Not read with `voxelSeparable` or by a one-ray voxel | `0` |
| `voxelSeparable` | `true`: rays run along the voxel's three axes only, each through one face, one side before it and three long; only a hit within the voxel's depth counts; a voxel whose rays along one axis all hit is covered whole if a ray through its centre along an axis hits; a one-ray voxel is covered if the first of the three hits. `false`: rays in every direction | `false` |
| `voxelNdf` | `true`: a voxel keeps its hit normals' distribution fitted to a lobe about an axis (the record carries the ratio of the lobe's two widths). `false`: the mean normal's direction | `true` |
| `voxelOpacity` | `true`: a dropped voxel hands no coverage to its neighbours. `false`: it hands it over until no more voxels remain than it sums to | `false` |
| `allowAssemblies` | `true`: glTF `extras.assembly` is built ([Assemblies](assemblies.md#assemblies)) | `false` |
| `distanceField` | `true`: the signed distance field is built ([Distance fields](distance-fields.md#distance-fields)) | `true` |
| `distanceFieldScale` | Number >= 0: voxels per unit of size = `distanceFieldDensity` x it. 0 builds no field | `1` |
| `distanceFieldTwoSided` | `true`: every triangle counts as two-sided (double-sided materials always do) | `false` |
| `distanceFieldDensity` | Finite number: voxels per centimetre of a scale-1 mesh; bricks per axis rounded, held within 1 and the max resolution. Changing it rebuilds every field | `0.2` |
| `distanceFieldMaxResolution` | Whole number >= 1: most voxels along one axis; a mesh of scale 1 or less holds half | `256` |
| `maxMeshCards` | Whole number 0 to 32: most cards kept ([Mesh cards](mesh-cards.md#mesh-cards)). 0 builds none | `12` |
| `meshCardMinDensity` | Number 0 to 1: share of its box's face the covered surfaces must fill to keep the card. Changing it rebuilds every mesh's cards | `0.2` |
| `meshCardNormalThreshold` | Number 0 to 1: cosine between a surface's facing and a card's direction needed to be covered. Changing it rebuilds every mesh's cards | `0.25` |
| `keptTriangles` | Number 0 to 1: under 1, the DAG's finest detail is cut away; the cut grows from the roots, replacing the cluster of largest error by its group's clusters, until it holds more than this share of the source's triangles and the next replacement would lower its error further; clusters under the cut are dropped | `1` |
| `trimmedError` | Number >= 0, percent of the mesh's size (sqrt of min(2 x area, box surface / 4)): above 0, the same cut, grown until its error is under this share | `0` |
| `displacementMaps` | List `{ "texture": { "index": n }, "magnitude", "center" }`: with `trimmedError` above 0, triangles are tessellated where the maps bend them and moved along their normals ([Baked displacement](displacement.md#baked-displacement)); map `n` displaces primitive `n`. `texture`: an `index` alone (set `displacementUvChannel`) of an image whose first channel is the height (8/16 bits or float, at most 8192 texels a side). `magnitude`: scene units from height `center` to height 1 along the normal; `center`: height on the surface; finite 32-bit floats (default 0) | `[]` |
| `displacementUvChannel` | Whole number 0 to 7: coordinate set the maps read | `0` |
| `displacementEdgeSplit` | Vertex added on an edge: `seams`, shared unless a material or texture coordinate differs across it; `always-duplicate`, one a side | `seams` |
| `dropNearCollapsed` | `true`: a triangle with two corners within 200 nanometres per axis is dropped before the build. `false`: only two corners at one point | `false` |
| `alwaysResidentKib` | Whole number 0 to 4294967295 KiB: pinned resident root pages (32 KiB, 64 clusters each), as many as that size fills rounded up, one at least ([FORMAT.md](../format/clustersjson.md#cluster-dag)). 0 keeps one; past the mesh keeps all | `0` |
| `positionPrecision` | Whole number −20 to 43: page position cells are `2^-n` centimetre. Left out: 7 less the finest clusters' mean log2 of box half-diagonal in centimetres, rounded, at least 4. Lowered until every cluster's box spans at most 21 bits an axis; a cluster too wide for −20 refuses the compile (`PAGE_ATTRIBUTE_RANGE`) ([FORMAT.md](../format/pages.md#pages)) | mesh density |
| `normalPrecision` | Whole number 1 to 15: bits an axis of each stored normal, on the octahedron | `8` |
| `tangentPrecision` | Whole number 0 to 12: bits of each stored tangent's angle around its normal. Only with `storedTangents` | `7` |

`objects` are rules `{ match, …settings }`, `match` naming objects as `voxelize` does (node name,
`{ regex, flags }` on it, or a match object). Per setting, first hit wins: the first rule matching
one of the mesh's objects, `meshBuild`'s own setting, the mesh's glTF `extras` of that name, the
default:

```json
{
  "meshBuild": {
    "keptTriangles": 0.5,
    "objects": [{ "match": { "node": { "regex": "^Rock" } }, "storedTangents": true }]
  }
}
```

Precisions follow the same rules (normals 10 bits an axis for every mesh, positions on 2⁻⁹ cm
cells for objects named `Cable…`):

```json
{
  "meshBuild": {
    "normalPrecision": 10,
    "objects": [{ "match": { "node": { "regex": "^Cable" } }, "positionPrecision": 9 }]
  }
}
```

Node: `prepare(source, cache, 'slice', budget, { resourceBaseUrl, meshBuild: { trimmedError:
0.5, objects: [{ match: /^Rock/, storedTangents: true }] } })`; on the command line,
`trillion3d-compile '--mesh-build={"storedTangents":true}' …`; on a mesh, `"extras": {
"storedTangents": true, "keptTriangles": 0.25 }`.

The world's HLOD merges each object's level 0 as built (before detail is cut away) without stored
tangents; an HLOD actor's mesh, and an object standing as itself, keeps its normals and tangents
whatever `meshBuild` names. A job naming no `meshBuild` keeps its cache
key; a setting out of range refuses the job (`INVALID_OPTIONS`), a mesh's `extras` one too. A
primitive with every triangle dropped is refused (`INVALID_TRIANGLES`).
