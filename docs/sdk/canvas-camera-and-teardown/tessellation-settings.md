# Tessellation settings

`world.tessellation` holds the settings of the run-time tessellation, each also a `createWorld`
option. A write names the settings it changes, `null` one's default; a value of another kind is
refused by name. They are render settings: the page's value holds over the quality preset (no preset
level writes them), and a write applies next frame.

| Setting | Takes | Default |
| --- | --- | --- |
| `tessellation` | `true` / `false`: displaced materials are tessellated and displaced; `false` draws every one flat and runs nothing of the tessellation | `true` |
| `tessellationDicingRate` | A finite number of pixels above 0: the size a micro-triangle is diced to; smaller cuts finer and costs more | `2` |
| `tessellationMaxPatchesPerGroup` | A whole number of at least 1: the patches one group of the dicing takes (held to 21) | `5` |
| `tessellationMaxCandidatePatches` | A whole number from 1 to 134217727: the patches the splitting queue holds, 16 bytes each | `2097152` |
| `tessellationMaxVisiblePatches` | A whole number from 1 to 134217727: the patches a pass's visible list holds, 16 bytes each | `2097152` |
| `tessellationShadowsDirectional` | `true` / `false`: the shadow maps of the suns take a displaced surface's displaced shape | `true` |
| `tessellationShadowsLocal` | `true` / `false`: the shadow maps of the local lights (points and spots) take it | `true` |

A patch past either capacity is lost for the image. The buffers hold what the device lets one
storage buffer bind: capacities that would not fit are brought down in proportion. Neither shadow
setting does anything while `tessellation` is off or the scene holds no displaced material.

```js
const world = createWorld('viewer', { tessellationDicingRate: 2 })
world.tessellation = { tessellationDicingRate: 4 } // coarser micro-triangles, from the next frame
world.tessellation = { tessellationShadowsLocal: false } // lamps cast the flat surface
world.tessellation = { tessellation: false } // every displaced material drawn flat
world.tessellation = { tessellation: null, tessellationDicingRate: null } // back to the defaults
```

The explorer's tool `trillion3d_set_tessellation` writes one setting at a time (`field`, `value`).
Nothing of the tessellation is allocated while the setting is off or no displaced material is in the
scene; turning it off gives the buffers back.

What tessellation does not do:

- A displaced surface is drawn flat by the passes that do not read the visibility buffer's pixels:
  the rays' scene and the reflections' traced scene see the surface its triangles describe. Its
  motion vector is the flat surface's point moved as the surface moves, plus this image's
  displacement, whole ([ENGINE.md](../../engine/tessellation-of-displaced-rows.md#motion-of-a-displaced-pixel)).
  The displacement itself is not tracked from image to image, so a height map that changes in time
  gets no velocity from its change.
- A masked displaced surface casts a tessellated shadow, cut out at the vertices of its patches on a
  device that grants nine storage buffers to a vertex stage and per pixel on a device that grants
  eight, which every WebGPU device does ([ENGINE.md](../../engine/tessellation-of-displaced-rows.md#masked-casters-in-the-shadow-maps)).
  A shadow patch is judged by the frustum of the map and the page it casts into, not by the depth the
  page has already seen.
- A per-job override of a material's displacement fields is not read. The displacement baked into a
  mesh ([COMPILER.md](../../compiler/displacement.md#baked-displacement)) is read for the rigid triangle
  primitives of a mesh, tessellated together; a primitive that deforms, or stands for a part of an
  assembly, bakes none.
- A scene compiled before the texture-coordinate density existed reads a density of 1 for every set;
  recompile it to measure it.
