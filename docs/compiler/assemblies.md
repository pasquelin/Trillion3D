# Assemblies

An assembly is one mesh made of other meshes, its parts, placed by nodes: the reference's assembly (a mesh whose settings hold a
list of parts and a list of nodes, a part and a transform each). It is how a mesh holds many copies of a part — the windows of a facade,
the leaf cards of a tree — whose far levels of detail merge the copies into one surface. Nothing is built unless the mesh allows it
(`allowAssemblies`, `false` by default, like the reference's project switch): a scene without the setting compiles as before, its cache key
kept, and the import report counts the meshes whose assembly was left unbuilt (`assembly-not-built`) and the groups of nodes left out of the levels above (`assembly-group-not-merged`, below).

A mesh names its assembly in its glTF `extras`:

```json
{
  "meshes": [
    {
      "name": "Window",
      "primitives": [{ "attributes": { "POSITION": 0, "NORMAL": 1 }, "indices": 2, "material": 0 }]
    },
    {
      "name": "Facade",
      "primitives": [{ "attributes": { "POSITION": 3, "NORMAL": 4 }, "indices": 5, "material": 1 }],
      "extras": {
        "assembly": {
          "parts": [{ "mesh": 0, "materialRemap": [2] }],
          "nodes": [
            { "part": 0, "translation": [1.5, 3.0, 0.0] },
            { "part": 0, "translation": [4.5, 3.0, 0.0] },
            { "part": 0, "translation": [7.5, 3.0, 0.0], "scale": [-1, 1, 1] }
          ]
        }
      }
    }
  ],
  "nodes": [{ "name": "Facade", "mesh": 1 }]
}
```

- `parts`: the meshes the assembly draws, by their rank in `meshes`, each with an optional `materialRemap`: for each primitive of the part,
  in order, the glTF material the assembly draws it with (`null` for none; a primitive past the end of the list takes the first slot of the
  assembly mesh, its first primitive's material; a part that leaves the list out takes the assembly's slot of the same rank). A part is
  built with the ten settings the assembly mesh resolves — its shape, stored tangents, texture hold, edge bound and the six voxel settings —
  wherever they come from (a rule by object, the scene, the mesh's own `extras`) and whatever a rule or the `extras` of the part itself say. A part is a static mesh: no bones, no morph
  targets; and no assembly of its own (the reference refuses assemblies of assemblies, so does the compiler, for a part some node names).
- `nodes`: one instance of a part each — its `part` rank and a glTF node's transform, `matrix` or `translation`, `rotation` and `scale`, in
  the assembly mesh's own space. A part no node names is not built. An assembly holds at most 65 535 nodes, the reference's limit. An
  assembly naming no part or no node is none.
- The mesh keeps its own primitives: they are its own triangles, which join the assembly (the Facade's wall above). The assembly mesh is
  placed by nodes like any mesh.

Allowing it, for the whole scene, a mesh, or an object, as every mesh build setting:

```json
{
  "meshBuild": {
    "objects": [{ "match": { "node": { "regex": "^Facade" } }, "allowAssemblies": true }]
  }
}
```

or on the command line `trillion3d-compile '--mesh-build={"allowAssemblies":true}' …`, from Node
`prepare(source, cache, 'slice', budget, { resourceBaseUrl, meshBuild: { allowAssemblies: true } })`, or on the mesh itself,
`"extras": { "allowAssemblies": true, "assembly": { … } }`.

How it is built, as the reference builds it. Each part is a mesh like any, built once whatever the number of nodes that name it and of
placements of the assembly: its pages are written once. Each node of the assembly becomes a node of the scene under every node that places
the assembly's mesh, drawing the part's mesh at the node's transform (so a scene document gains one node a placement). The levels of
detail above the nodes are then built as the reference builds them: the mesh's own triangles are level-0 clusters, the root of every node's
part — the one cluster the part's own DAG ends in — enters that level through the node's transform, and the levels above are built over
them all like any DAG's (groups of up to 32 clusters, simplified, re-split, until one cluster is left). The merged clusters are pages of
the assembly's primitive. Each node keeps, in the scene's tables, the error and the ball of the group that replaces its part's root
(`rootParents`); the cut opens a node only while that error shows at the ball's distance: near the camera each node draws its part's
clusters, far away the group's merged clusters draw in its stead — one surface for the copies, the same comparison on both sides. While the assembly's own pages stream in, the merged
cluster stands in for them, and for the nodes with them, beside the nodes that are open: a short transient, as the reference's own streaming has.

Notes:

- The merged clusters hold one material and one set of attributes, so the levels are built for each material of the parts (after their
  remap) and each set of attributes (normals, stored tangents, texture sets, a colour — three or four wide, as its accessor says; a colour white at every vertex is no colour, and a part with a colour joins a primitive with none, white there): the nodes of one such group climb into the assembly
  mesh's primitive that wears the material, or, when it has none, into a primitive the compiler adds to the mesh (its one placeholder
  triangle is never read). A material of one node alone, with no triangle of the mesh's own of that material, climbs nowhere: that node
  draws its part down to its own root, as the reference's level of one cluster ends, and the import report counts such groups
  (`assembly-group-not-merged`). A node whose part primitive carries other attributes than the primitive it would join is left out of the
  climb the same way, told in the report of the DAG of the primitive that was to carry it (`clusters.json`, which a warm run replays) and
  in its progress event; a primitive the compiler added for nodes that all turn out unable to join it, or that fewer than two can join,
  has nothing to climb over and no triangle of its own: the compiler builds no job for it — it has no pages, no collider, no place in a
  merged layer, no point in its mesh's bounds —, its nodes draw down to their own roots, and only its progress event tells it.
- `simplification: none` builds no level above level 0 at all: the nodes draw down to their parts' roots.
- The assembly mesh's own primitives that carry levels are built with no trim of the finest detail, no voxels and no merged HLOD level; their
  collider is cooked over the mesh's own triangles (the nodes collide as their parts do).
- The reference has one switch that turns assemblies and voxels on together; here each is its own setting (`allowAssemblies`, the voxel settings).
- A node's bone influences (a skinned assembly) have no glTF form: a node naming `boneInfluences` is refused by name; a spline-bent
  assembly mesh is refused (the curve would bend the mesh's own triangles and not its parts).
- A node's error scale: an instance's error is carried through its transform's smallest axis scale (and its ball's radius through the
  largest), the same the cut applies to a placement, so the node and the merged cluster decide alike; the reference carries both through
  the largest. The two agree for a translation, a rotation and a uniform scale.
- Ray tracing and shadows: the rays' scene and the sun's shadow maps still hold each node beside the merged clusters far away (a second
  surface at the same place, harmless to the image).
- An assembly that does not read refuses the job, naming the field (`INVALID_ASSEMBLY`): where the reference logs a warning and builds the
  mesh without its parts.
- Cost: the part's pages once; the merged clusters of the assembly's primitive grow with the nodes (about the triangles of the parts' roots,
  twice over the levels); each node carries `[error, x, y, z, radius]` a primitive of its part in the tables; and every placement of a scene
  holds one word (4 bytes) more in the cut's frame words than a scene without assemblies, whether it is an assembly's node or not (see below).
