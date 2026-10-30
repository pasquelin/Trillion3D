# Spline meshes

A node whose glTF `extras.splineMesh` names a curve is bent along it (UE spline mesh component:
start and end each with position, tangent, scale, roll and offset across the curve, cubic Hermite).
The compiler bends the mesh once, before anything reads it: each vertex goes where the curve's
slice at its distance puts it, normal and tangent turning with it; the node takes the bent copy, and
levels of detail, pages and collider are built of it. The spline is fixed at compile time.

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

| Field | Meaning | Default |
| --- | --- | --- |
| `startPos`, `endPos` | Curve ends, node space, metres | `[0, 0, 0]`, `[1, 0, 0]` |
| `startTangent`, `endTangent` | Tangent at each end | `[1, 0, 0]`, `[1, 0, 0]` |
| `startScale`, `endScale` | Scale across the curve at each end, on the mesh's second and third axes after the forward one (y,z for x; z,x for y; x,y for z); negative mirrors | `[1, 1]`, `[1, 1]` |
| `startRoll`, `endRoll` | Roll about the curve, radians | `0`, `0` |
| `startOffset`, `endOffset` | Offset across the curve, same two axes | `[0, 0]`, `[0, 0]` |
| `splineUpDir` | Direction the frame leans on, components within [-1, 1] | `[0, 0, 1]` |
| `smoothInterpRollScale` | Scale, roll, offset ease in and out | `false` |
| `forwardAxis` | Mesh axis along the curve: `x`, `y` or `z` | `x` |
| `boundaryMin`, `boundaryMax` | Forward-axis range mapped to the curve; equal means the mesh's extent | `0`, `0` |

Defaults are UE's, in metres. Frame: up direction crossed with the curve direction is the first axis
across, the direction crossed with that the second, both rolled about the direction. The default
curve and up leave the mesh as is; for a mesh lengthwise on z with y up, set `"forwardAxis": "z"`,
`"splineUpDir": [0, 1, 0]` and a curve along z. Mixed-sign start scale mirrors the mesh (triangles
turned over, tangent sign reversed). A field outside the table or of the wrong kind refuses the job
naming it (`INVALID_SPLINE_MESH`). A skinned or morphed node, or one naming a job-built assembly,
cannot be bent.

A mesh bent by several nodes is copied once per node. The bent arrays are appended to the
document's binary within the job's memory budget (`RAM_ADMISSION_BUDGET_EXCEEDED` past it). A bend
sending a vertex to a non-finite point is refused, naming `nodes[N].extras.splineMesh`: a position
(`NONFINITE_POSITION`), a normal or tangent (`NONFINITE_ATTRIBUTE`).
