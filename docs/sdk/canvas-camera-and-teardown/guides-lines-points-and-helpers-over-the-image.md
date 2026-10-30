# Guides: lines, points and helpers over the image

`world.guides` draws what a page shows _about_ its scene — an axis, a grid, a box, a measured
segment, a light's cone — without adding it to the scene: its own pass after the image is composed,
quads of a fixed CSS-pixel width, hidden by what stands in front, outside temporal accumulation.

```js
const grid = world.guides.add(helper.grid(20, 20), { width: 1.5 }) // any helper; it follows it
const cone = world.guides.add(helper.spotLight(spot)) // follows the light, no update() needed
const ruler = world.guides.lines({ positions: [0, 0, 0, 4, 0, 0], color: '#ffd24a', width: 3 })
const marks = world.guides.points({ positions: [0, 0, 0, 4, 0, 0], color: '#ffd24a', size: 8 })
ruler.setVisible(false) // kept, not drawn
grid.setTransform(model.matrixWorld) // placed by the page: it stops following its node
marks.remove()
```

- `add(object, { width, size })` reads an object's line and point meshes (every `helper` builds
  them) in their colours, triangles excluded, and follows its world transform (a light's or
  camera's helper: that light's or camera's) until `setTransform` hands it to the page. `lines`
  takes two ends per segment, `points` one position per dot.
- Each call answers a handle: `setVisible(on)`, `setTransform(matrix)` (sixteen column-major
  numbers or a matrix), `remove()`; `world.guides.clear()` removes all. Re-placing a guide at its
  pose changes nothing, so a still view stays held.
- At most `GUIDE_VERTEX_CEILING` (65,536) vertices a world, hidden ones included; a call beyond
  throws `GUIDE_CEILING` and adds nothing. `world.guides.vertexCount` reads what is held.
- With no guide shown the pass is neither built nor encoded. Positions are packed relative to the
  first guide in double precision, so a guide far from the origin keeps its detail. Text labels are
  not drawn.
