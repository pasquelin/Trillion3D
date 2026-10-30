# Assignment and marks

An object is assigned once, before any work, to at most one layer: the mark on its glTF node
(`"extras": { "hlod": "hlod0" }`, a layer's name), else the first matching rule, else the `default`
layer (the simple form's `hlod0`). An object none names has no HLOD: streamed and drawn in its cell.
Where a mark and a rule differ, the mark wins and the report says so
(`worldRoots.assignmentWarnings`), as for each marked object no HLOD takes (it moves, stays in the
core, or fails its layer's size filter) and each instanced skinned object that stays plain. A mark naming no layer, a mark in a job naming no
HLOD, and an HLOD assigning a layer to no placed object that may take one refuse the job.

A node with `"extras": { "hlodInstance": true }` stands as itself in every actor its chain builds:
its layer's builder leaves it out, and the actor names it as a row (source mesh, world matrix) in
the rows bundle its HLOD cell holds with the actor's root pages (`hlod/chain/builds/instanced.rs`),
streamed with the actor. A non-boolean
value fails the job. An `instanced` layer's actor above HLOD 0 is all rows. A marked instanced
skinned object stands in the actors above too, as a row at its skin frame's world naming the
animation-banks item it plays; unmarked, it has its own cell rows alone.

An `instanced` layer's `disallowClusterDag: true` draws each object at its mesh's last LOD (for a
cluster-DAG source, its fallback, as a `merge` layer's `lodSelection: 'lowest'`). The layer stays
`instanced`: one fallback is made per source mesh, exact clusters drawn whole, published
beside the scene's meshes (`extras.hlodFallbackOf` names the source) and listed by the partition with
no node; the layer's actors above HLOD 0 are rows of it at the objects' matrices. A skinned,
morphing or simulated object, or one an assembly builds or takes as a part, has no fallback: its rows
stand on its own mesh.
A node with `"extras": { "hlodInclude": false }` enters no layer whatever its mark, a rule or
`default` names. Default `true`; a non-boolean value fails the job:

```json
{ "name": "Lamp_Prop", "mesh": 12, "extras": { "hlod": "hlod0", "hlodInclude": false } }
```
