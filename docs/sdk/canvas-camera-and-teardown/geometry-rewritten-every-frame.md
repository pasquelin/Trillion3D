# Geometry rewritten every frame

A shape rewritten every frame (sea, cloth, procedural mesh, editor handle) declares
`geometry.usage = 'dynamic'`: cut into pages once, index only; a written list
(`attributes.position.needsUpdate = true`) uploads in place the vertices from first to last changed,
next frame, no session reopened, drawn and shadowed like any paged mesh. Geometry changed on two
consecutive frames turns dynamic itself (`geometry-dynamic`). A soft body's geometry is dynamic;
two soft bodies in one geometry are refused with `PHYSICS_FAILED`: give each its own
(`geometry.clone()`).

Culling reads `geometry.maxBounds` if declared, else a box from the first vertices
([ENGINE.md](../../engine/dynamic-geometry.md#dynamic-geometry)). A frame sends at most
`DYNAMIC_UPLOAD_BUDGET_BYTES` (4 MiB), every written buffer counted, reported as
`metrics.dynamicUploadBytes`; a rewrite past it waits for the next frame, in order, never dropped.
Water needs no rewrite: a mesh lying flat on the physics' water is moved by its waves on the GPU
([PHYSICS.md](../../PHYSICS.md)).

```js
const sheet = geometry.plane(28, 20, 112, 80)
sheet.usage = 'dynamic'
world.onFrame(({ metrics }) => {
  for (let v = 0; v < sheet.attributes.position.count; v++)
    sheet.attributes.position.setY(v, wave(v))
  sheet.attributes.position.needsUpdate = true // 9 000 vertices, uploaded in place
  console.log(metrics.dynamicUploadBytes)
})
```
