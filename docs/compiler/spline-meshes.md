# Spline meshes

A node whose glTF `extras.splineMesh` names a curve is drawn bent along it: the reference's spline mesh component (a start and an end,
each with a position and a tangent, scale, roll and offset across the curve, along a cubic Hermite curve). It is how a road, a rail, a
pipe or a fence is made of one mesh and a curve each. The mesh is bent once, by the compiler, before anything else reads it: each vertex
goes where the curve's slice at its distance puts it, its normal and tangent turn with the slice, and the node takes the bent copy; the
levels of detail, the pages and the collider are built of the bent mesh. The reference's renderer bends the mesh on the GPU every
frame, so a spline can move: this one is fixed when the scene is compiled.

```json
{
  "nodes": [
    {
      "name": "Rail",
      "mesh": 3,
      "extras": {
        "splineMesh": {
          "startPos": [0, 0, 0],
          "startTangent": [4, 0, 0],
          "endPos": [4, 0, 4],
          "endTangent": [0, 0, 4],
          "endRoll": 0.35,
          "endScale": [1.5, 1],
          "smoothInterpRollScale": true
        }
      }
    }
  ]
}
```

This lays mesh 3, whose length runs along x, on a curve from the origin heading along x to the point (4, 0, 4) heading along z, rolling by
0.35 radians and widening to one and a half times across by the end, the scale and the roll easing in and out.

| Field | Meaning | Default |
| --- | --- | --- |
| `startPos`, `endPos` | The curve's two ends, in the node's own space, in metres | `[0, 0, 0]`, `[1, 0, 0]` |
| `startTangent`, `endTangent` | The curve's tangent at each end | `[1, 0, 0]`, `[1, 0, 0]` |
| `startScale`, `endScale` | The scale across the curve at each end, on the mesh's second and third axes after the forward one (y and z for x, z and x for y, x and y for z); a negative scale mirrors that axis | `[1, 1]`, `[1, 1]` |
| `startRoll`, `endRoll` | The roll about the curve at each end, in radians | `0`, `0` |
| `startOffset`, `endOffset` | The offset of the mesh from the curve across it, in the same two axes | `[0, 0]`, `[0, 0]` |
| `splineUpDir` | The direction the curve's frame leans on, each component held within [-1, 1] | `[0, 0, 1]` |
| `smoothInterpRollScale` | Whether scale, roll and offset ease in and out along the curve instead of changing at a constant pace | `false` |
| `forwardAxis` | The mesh's axis laid along the curve: `x`, `y` or `z` | `x` |
| `boundaryMin`, `boundaryMax` | The range on the forward axis that maps to the curve; when they are equal, the mesh's own extent is the range | `0`, `0` |

The defaults are the reference's, its lengths in metres (its default curve is a hundred centimetres long). The curve's frame is the one
the reference builds: the up direction crossed with the curve's direction gives the first axis across it, the direction crossed with that
the second, then both rolled about the direction. With the default curve (a line along x) and the default up direction the mesh is left as
it is; for a mesh whose length runs along z with y up, set `"forwardAxis": "z"`, `"splineUpDir": [0, 1, 0]` and a curve along z.
A start scale of mixed signs mirrors the mesh, its triangles turned over and its tangents' sign reversed. A field outside the table, or of
the wrong kind, refuses the job naming it (`INVALID_SPLINE_MESH`). A node whose mesh is skinned or morphed, or that names an assembly the job
builds, cannot be bent; one that places no mesh bends nothing.

A mesh bent by several nodes is copied once for each (a rail of five hundred segments is five hundred meshes, their pages and their
builds, where the reference keeps one and bends it as it draws); the source mesh they share is decoded once. The pass appends the bent
arrays to the document's binary, which it copies once, within the job's memory budget (`RAM_ADMISSION_BUDGET_EXCEEDED` past it).

Not read: the reference's bounds scale and its mesh deform scale only widen the bounds of its GPU culling, which a mesh built after the
bend does not need; the reference's scene texture of 64 slices a spline (a project setting, on by default) is a speed up of the exact
curve this evaluates, and its half-float packing of the roll and the scales is not repeated. A bend that sends a vertex to a point that is
not a number is refused at the bend, naming the node (`nodes[N].extras.splineMesh`) and what is not finite: a position
(`NONFINITE_POSITION`) or another attribute, a normal or a tangent (`NONFINITE_ATTRIBUTE`).
