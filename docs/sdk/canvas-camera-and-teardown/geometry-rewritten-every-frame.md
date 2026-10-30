# Geometry rewritten every frame

A shape rewritten every frame — a sea, a cloth, a procedural mesh, an editor handle — declares
`geometry.usage = 'dynamic'`: cut into pages once, index alone, a written list
(`attributes.position.needsUpdate = true`) uploads in place the vertices from the first changed to
the last, the frame after, no session reopened, drawn and shadowed like every paged mesh. A geometry
changed on two consecutive frames turns dynamic by itself (`geometry-dynamic`). A soft body's
geometry is dynamic; two soft bodies in one geometry are refused with `PHYSICS_FAILED` — give each
its own (`geometry.clone()`).

Culling reads `geometry.maxBounds` if declared, else a box derived from the first vertices
([ENGINE.md](../../engine/dynamic-geometry.md#dynamic-geometry)). A frame sends at most `DYNAMIC_UPLOAD_BUDGET_BYTES`
(4 MiB), every buffer written counted, as `metrics.dynamicUploadBytes` reports; a rewrite past it
waits for the next frame, in order, never dropped. Water need not be rewritten: a mesh lying
flat on the physics' water is moved by its waves on the GPU ([PHYSICS.md](../../PHYSICS.md)).

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
