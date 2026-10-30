# Tessellation settings

`world.tessellation`: run-time tessellation settings, each also a `createWorld` option. A write
names changed settings, `null` one's default; a value of another kind is refused by name. The
page's value holds over the quality preset; a write applies next frame.

| Setting | Takes | Default |
| - | - | - |
| `tessellation` | `true` / `false`: `false` draws displaced materials flat | `true` |
| `tessellationDicingRate` | Pixels above 0: micro-triangle size | `2` |
| `tessellationMaxPatchesPerGroup` | Whole, at least 1: patches per dicing group (held to 21) | `5` |
| `tessellationMaxCandidatePatches` | Whole, 1 to 134217727: splitting queue, 16 bytes each | `2097152` |
| `tessellationMaxVisiblePatches` | Whole, 1 to 134217727: a pass's visible list, 16 bytes each | `2097152` |
| `tessellationShadowsDirectional` | `true` / `false`: suns' shadow maps take the displaced shape | `true` |
| `tessellationShadowsLocal` | `true` / `false`: points' and spots' shadow maps take it | `true` |

A patch past either capacity is lost for the image; capacities beyond one storage buffer binding
are scaled down. Shadow settings do nothing while `tessellation` is off or no material is displaced.

```js
const world = createWorld('viewer', { tessellationDicingRate: 2 })
world.tessellation = { tessellationDicingRate: 4 } // coarser micro-triangles, from the next frame
world.tessellation = { tessellationShadowsLocal: false } // lamps cast the flat surface
world.tessellation = { tessellation: false } // every displaced material drawn flat
world.tessellation = { tessellation: null, tessellationDicingRate: null } // back to the defaults
```

Tool `trillion3d_set_tessellation` writes one setting at a time (`field`, `value`). Nothing is
allocated while the setting is off or no displaced material is in the scene.

Limits:

- Passes not reading the visibility buffer (rays' scene, reflections' traced scene) see the flat
  surface. Motion vector: flat point's motion plus this image's displacement
  ([ENGINE.md](../../engine/tessellation-of-displaced-rows.md#motion-of-a-displaced-pixel)); a
  time-varying height map gets no velocity.
- A masked displaced surface casts a tessellated shadow, cut out at patch vertices on a device
  granting nine storage buffers to a vertex stage, per pixel on one granting eight
  ([ENGINE.md](../../engine/tessellation-of-displaced-rows.md#masked-casters-in-the-shadow-maps)).
- A per-job override of displacement fields is not read. Displacement baked into a mesh
  ([COMPILER.md](../../compiler/displacement.md#baked-displacement)) is read for rigid triangle
  primitives; a deforming primitive, or one standing for an assembly part, bakes none.
- A scene compiled before the texture-coordinate density existed reads density 1; recompile it.
