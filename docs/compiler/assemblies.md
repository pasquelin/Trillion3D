# Assemblies

An assembly is one mesh made of other meshes (parts) placed by nodes; far levels merge the copies into
one surface. Built only if allowed (`allowAssemblies`, `false` by default; cache key unchanged
without it). The import report counts meshes left unbuilt (`assembly-not-built`) and node groups
left out of the upper levels (`assembly-group-not-merged`).

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

- `parts`: meshes by rank in `meshes`, each with optional `materialRemap`: per primitive of the part,
  in order, the glTF material to draw with (`null` for none; a primitive past the list takes the
  assembly mesh's first slot; no list takes the assembly's slot of the same rank). A part is built
  with the ten settings the assembly mesh resolves (shape, stored tangents, texture hold, edge bound,
  six voxel settings), whatever a rule or the part's `extras` say. A part is static: no bones, no
  morph targets, no assembly of its own (refused for a part some node names; the reference
  refuses assemblies of assemblies too).
- `nodes`: one instance each: `part` rank and a transform (`matrix`, or `translation`, `rotation`,
  `scale`) in the assembly mesh's space. A part no node names is not built. At most 65 535 nodes. An
  assembly naming no part or no node is none.
- The mesh keeps its own primitives; its triangles join the assembly.

Allow it per scene, mesh or object, like any mesh build setting:

```json
{
  "meshBuild": {
    "objects": [{ "match": { "node": { "regex": "^Facade" } }, "allowAssemblies": true }]
  }
}
```

or on the command line `trillion3d-compile '--mesh-build={"allowAssemblies":true}' …`, from Node
`prepare(source, cache, 'slice', budget, { resourceBaseUrl, meshBuild: { allowAssemblies: true } })`,
or on the mesh itself, `"extras": { "allowAssemblies": true, "assembly": { … } }`.

Build: each part once. Each node becomes a scene node under every node placing the assembly's
mesh, drawing the part at the node's transform. Upper levels: the mesh's own triangles are
level-0 clusters; each node's part root (the one cluster ending the part's DAG) enters that level
through the node's transform; levels above are built like any DAG (groups of up to 32 clusters,
simplified, re-split, until one cluster is left). Merged clusters are pages of the assembly's
primitive. Each node keeps in the scene tables the error and ball of the group replacing its part's
root (`rootParents`); the cut opens a node only while that error shows at the ball's distance: near,
each node draws its part's clusters; far, the merged clusters draw. While the assembly's pages stream
in, the merged cluster stands in.

Notes:

- Levels are built per material (after remap) and per attribute set (normals, stored tangents,
  texture sets, colour three or four wide as its accessor says; an all-white colour is none, and a
  part with a colour joins a primitive with none, white there). Nodes of one group climb into the
  assembly primitive wearing the material, or into a primitive the compiler adds (one placeholder
  triangle, never read).
  - A material of one node alone, with no own triangle of that material, climbs nowhere: the node
    draws down to its part's root; counted as `assembly-group-not-merged`.
  - A node whose part primitive has other attributes than the primitive it would join is left out
    the same way, told in that primitive's DAG report (`clusters.json`) and its progress event.
  - A compiler-added primitive that fewer than two nodes can join gets no job (no pages, collider,
    merged-layer place, bounds); its nodes draw down to their roots.
- `simplification: none` builds no level above level 0: nodes draw down to their parts' roots.
- Assembly primitives carrying levels get no finest-detail trim, no voxels, no merged HLOD level; the
  collider covers the mesh's own triangles (nodes collide as their parts do).
- A node naming `boneInfluences` is refused by name; a spline-bent assembly mesh is refused.
- A node's error scales by its transform's smallest axis scale, its ball's radius by the largest.
- Ray tracing and the sun's shadow maps still hold each node beside the merged clusters far away.
- The reference has one switch for assemblies and voxels together; here each is its own setting
  (`allowAssemblies`, the voxel settings).
- An assembly that does not read refuses the job, naming the field (`INVALID_ASSEMBLY`); the
  reference logs a warning and builds the mesh without its parts.
- Cost: the part's pages once; merged clusters grow with the nodes (about the triangles of the parts'
  roots, twice over the levels); each node carries `[error, x, y, z, radius]` per primitive of its
  part in the tables; every placement holds one more word (4 bytes) in the cut's frame words.
