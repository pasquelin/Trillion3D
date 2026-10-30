# Assignment and marks

An object is assigned once, before any work, to one layer at most: the mark its glTF node carries —
`"extras": { "hlod": "hlod0" }`, a layer's name, written where the code that makes the object writes
it —, else the first rule that matches it, else the `default` layer (the simple form's `hlod0`). An
object none names has no HLOD: it is streamed and drawn in its cell as any other, and nothing stands
for it beyond its cell's range; it costs the HLOD nothing. Where a mark and a rule name different
layers, the mark wins and the compile report tells it (`worldRoots.assignmentWarnings`), as it tells
each marked object no HLOD takes — it moves, itself or through a node above it, stays in the core,
or is turned away by its layer's size filter — and each object its settings make an instanced
skinned one that stays a plain skinned one, with why. A mark naming no layer, a mark in a job naming
no HLOD, and an HLOD assigning a layer to no placed object that may take one refuse the job. An
object whose node carries `"extras": { "hlodInstance": true }` stands as itself in every actor its
chain builds: its layer's builder leaves it out, and the actor names it as a row — its source mesh
and its world matrix, in the rows bundle its HLOD cell holds with its actor's root pages
(`hlod/chain/builds/instanced.rs`), streamed with the actor — that the runtime places on that mesh's
own rows while the actor is loaded and draws while the cell draws the actor, its own pages cut by
its own error as any row of its mesh, never merged with another object, no page copied per actor or
level; a value other than a boolean fails the job. An `instanced` layer's actor above HLOD 0 is all
rows: every object of its cell standing as itself, nothing built. An instanced skinned object marked
so stands in the actors above too, as a row at its skin frame's world naming the item of the
animation banks it plays; unmarked, it has its own cell rows alone, no actor above it. An
`instanced` layer's `disallowClusterDag: true` takes its objects out of their cluster DAG: each is
drawn at the last LOD of its mesh — for a source whose LODs are a cluster DAG, its fallback, as a
`merge` layer's `lodSelection: 'lowest'` takes it. The layer stays an `instanced` layer: the
compiler makes the fallback of each source mesh once, a mesh of exact clusters drawn whole,
published beside the scene's meshes (its `extras.hlodFallbackOf` names the source) and listed by the
partition with no node, and the layer's actors above HLOD 0 are rows of it at the objects' matrices
— nothing is copied per object or per cell. A skinned, morphing or simulated object, and one an
assembly builds or takes as a part, has no fallback: its rows stand on its own mesh. The fallback
carries no stored tangents: its normal map is read in the frame the engine rebuilds from each
triangle.

An object whose node carries `"extras": { "hlodInclude": false }` enters no layer, whatever its
mark, a rule or the `default` names: it is streamed and drawn in its cell as any object with no
HLOD, nothing standing for it beyond. The default is `true`; a value other than a boolean fails the
job. Leaving one object out of the HLOD this way leaves its layer's other objects alone:

```json
{ "name": "Lamp_Prop", "mesh": 12, "extras": { "hlod": "hlod0", "hlodInclude": false } }
```
