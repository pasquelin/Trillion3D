# Clusters table

`shadowShowStats` (`''`, none) names the virtual shadow map statistics sections written over the
image: `'all'` or `'1'` every section, `'basic'` the basic ones, else section names comma-separated,
case ignored. The `clusters` section lists, lower left, every shadow map that drew clusters: id,
light's name, clusters drawn (hardware and software raster summed); a map stays listed 180 images
after its last cluster. Counted while the section is shown, read a few images late.

```js
world.shadows = { shadowShowStats: 'clusters' } // the clusters each shadow map draws
world.shadows = { shadowShowStats: 'all' }
world.shadows = { shadowShowStats: null } // off
```

The shadow casters view (`virtual-shadow-map-shadow-casters`) paints each pixel in its placement's
class colour, shaded by its face's angle to the view, with the invalidating placements' boxes over it.

`shadowVisualizeLayout` (`0`), `shadowVisualizeCachedPagesOnly` (`false`), `shadowVisualizeLightName`
(`''`) and `shadowVisualizeOverdrawScale` (`15`) shape the virtual shadow map views
(`virtual-shadow-map-shadow-factor` and the nine others):

- layout `0` over the whole image (grey), `1` in a thumbnail of a third of the image's size at its
  upper left, `2` over its left half;
- `shadowVisualizeCachedPagesOnly`: the cached-page view shows the kept pages for every light and
  hides the others;
- `shadowVisualizeLightName`: the one light to show, alone in full colour: the light named exactly
  that, else the first whose name contains it; empty or unmatched shows every light, a quarter of
  each colour added.

Local lights are shown with the one-pass projection (`shadowOnePassProjection`, on) and without.

```js
await engine.setDiagnostic('virtual-shadow-map-cached-page')
world.shadows = { shadowVisualizeLayout: 2 } // the view over the left half of the image
world.shadows = { shadowVisualizeLightName: 'Lamp', shadowVisualizeCachedPagesOnly: true } // the kept pages of the light named Lamp
world.shadows = { shadowVisualizeLayout: null, shadowVisualizeLightName: null } // back to the defaults
```

The overdraw view (`virtual-shadow-map-overdraw`) counts, in an extra page pool slice, how many
times the shadow raster drew each texel this image (hardware raster for triangles it draws,
software raster for small ones; counted wherever the pixel lands on a drawn page, before any depth
test). Pixel colour is `1 - 2^(-count x scale / 100)` on an inferno map; counts of every light are
added when all are shown. `shadowVisualizeOverdrawScale` is the scale as a percentage (`15`, `0` to
`100`). Pixels facing away from their light are kept. Choosing the view remakes the pool with the
extra slice (leaving it, without) and redraws the cached pages once; the software raster counts
only on a device granting eleven storage buffers per shader stage, the hardware raster on all.

```js
await engine.setDiagnostic('virtual-shadow-map-overdraw')
world.shadows = { shadowVisualizeOverdrawScale: 40 } // the bright end after fewer draws
world.shadows = { shadowVisualizeOverdrawScale: null } // back to 15
```

The quality levels (the `shadows` group) write the four settings shaping the distance and its edge,
the shadow maps' rows and the shadow quality, as rules' rows (`SHADOW_PRESET_LEVELS`,
`packages/sdk-core/src/contracts/shadowOptions.ts`):

| level | `shadowDistanceScale` | `shadowNearLevels` | `shadowOverlapScale` | `shadowFarField` | `shadowQuality` | edge at 400 m |
| - | - | - | - | - | - | - |
| `smooth` | 0.6 | 1 | 0 | off | 0 | 240.0 m |
| `balanced` | 0.7 | 1 | 0.25 | off | 3 | 280.0 m |
| `fine` | 0.85 | 4 | 0.8 | on | 5 | 358.4 m |
| `max` | nothing (1) | nothing (10) | nothing (1) | nothing (on) | nothing (5) | 427.0 m |
| `cinematic` | 1 | 10 | 1 | on | 5 | 427.0 m |

(Edge at a near plane of 0.05 m.) A value the page set holds over a preset: `smooth` draws no
shadow, and a page setting `shadowQuality: 5` brings them back. A value of another kind or out of
range is refused by name. Changing a light's own setting (distance, cascades) remakes the light and
redraws its cached pages; changing the view's settings moves the edge the next frame tests, keeping
cached pages.

## The sun's distance-field shadow

With virtual shadow maps a sun's maps draw every cluster at any distance, so the view traces no
distance-field shadow of the sun: the cascade past the near levels (their end to
`distanceFieldShadowDistance`) moves the far-shadow edge and shadows nothing itself. With classic
shadow maps (`shadowVirtualEnable: false`) the cascade is traced: a ray from each pixel between the
last cascade's end and `distanceFieldShadowDistance` toward the sun through the meshes listed by
tile across the view's slice, at half image size, upsampled with depth as weight, faded at both
ends and laid into the sun's mask by minimum. Meshes' distance fields also shade the sun where the
maps do not reach: the surface cache's cards, whose direct light traces a ray through the meshes
listed by tile across each sun. These settings act on that list and the cascade's edge:

| View option | Default | Meaning |
| - | - | - |
| `distanceFieldShadowing` | `true` | master switch: a sun may have a distance-field shadow cascade; off, none |
| `distanceFieldShadowQuality` | `3` (0 to 3) | steps of a ray: 0 none, 1 twenty, 2 thirty-two, 3 sixty-four |
| `distanceFieldShadowTileSize` | `2` m | side of the tiles across the light the meshes are listed in |
| `distanceFieldShadowTwoSidedBias` | `1` | factor on the distance a two-sided mesh's surface is expanded by |
| `distanceFieldShadowObjectsPerTile` | `128` | meshes a tile has room for on average; past it a tile loses meshes (flicker) |
| `distanceFieldShadowCompactTiles` | `true` | tile lists lie one after another; `false`: each tile has its own place and a tile past it loses meshes |
| `distanceFieldShadowSnapResolution` | `2048` (at least 32) | texels across the lists' shadow space the origin's snap grid is cut from (4 texels a step, 4 off each side) |
| `distanceFieldShadowFullResolution` | `false` | classic cascade traced at image size, else half and upsampled |
| `distanceFieldFarTransitionScale` | `1` (0 to 1) | factor on the cascade's far fade length; 0 cuts sharply |

The lists are made before the surface cache's lighting, while the scene has a mesh with a distance
field and a sun casts a shadow, for the first four shadowed lights of a frame. A merged shell's
field is listed where the shell is drawn: a cell shown instead of its actor, or an actor not
loaded, casts nothing through it.

**`affectDistanceFieldLighting`** (boolean, `true`), a property of every object saved with the
world: `false` leaves it out of the distance fields, so the global field the screen probes march
and the distance-field shadows hold nothing of it, and its pixels carry no distance-field mark (the
probes' traces treat them as thicker, `screenProbeThicknessScaleWithoutField`). An object is in the
scene only where it also casts a shadow (`castShadow`) and its mesh has a distance field.

```js
// A decal-thin sign that must not stand in the distance fields: it neither shadows nor blocks the probes' rays.
sign.affectDistanceFieldLighting = false
```

```js
const world = createWorld('viewer', {
  distanceFieldShadowQuality: 2, // 32 steps a ray
})
world.shadows = { distanceFieldShadowTileSize: 4 } // fewer, larger tiles: cheaper lists, more meshes a tile
world.shadows = { distanceFieldShadowCompactTiles: false } // each tile has a place of its own in the lists
world.shadows = { shadowVirtualEnable: false, distanceFieldShadowFullResolution: true } // classic maps, the far cascade traced at full size
```

An agent sets the same through `trillion3d_set_shadows`, and a light's distance and cascades through
`trillion3d_add_light` fields (`shadowDistance`, `shadowCascades`, `shadowCascadeExponent`,
`shadowCascadeTransition`, `farShadowCascades`, `farShadowDistance`, `distanceFieldShadows`,
`distanceFieldShadowDistance`; `true` for the default and `false` for none where a distance).
How far casters are left out of the maps: [SHADOWS.md](../../shadows/far-casters.md#far-casters).
