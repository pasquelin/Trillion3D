# Clusters table

`shadowShowStats` (`''`, none) names the sections of the virtual shadow maps' statistics written over the image:
`'all'` or `'1'` every section, `'basic'` the basic ones, else section names separated by commas, case ignored. The
`clusters` section lists, lower left, every shadow map that drew clusters: its id, its light's name and the clusters
it drew (hardware and software raster summed); a map stays listed for 180 images after its last cluster. The raster
counts clusters while the section is shown; they are read a few images late.

```js
world.shadows = { shadowShowStats: 'clusters' } // the clusters each shadow map draws
world.shadows = { shadowShowStats: 'all' }
world.shadows = { shadowShowStats: null } // off
```

The shadow casters view (`virtual-shadow-map-shadow-casters`) paints each pixel in its placement's class colour,
shaded by the angle of its face to the view, with the invalidating placements' boxes over it.

`shadowVisualizeLayout` (`0`), `shadowVisualizeCachedPagesOnly` (`false`), `shadowVisualizeLightName` (`''`) and
`shadowVisualizeOverdrawScale` (`15`) shape the virtual shadow map views above (`virtual-shadow-map-shadow-factor`
and the nine others, which draw what each pixel's last ray read):

- layout `0` over the whole image (in grey), `1` in a thumbnail of a third of the image's width and height at its
  upper left, `2` over its left half;
- `shadowVisualizeCachedPagesOnly`: the cached-page view shows the kept pages for every light and hides the others;
- `shadowVisualizeLightName`: the one light to show, alone and in full colour, the one whose name is exactly that,
  else the first whose name contains it; the empty string, or a name no light bears, shows every light, a quarter of
  each colour added.

Local lights are shown with the one-pass projection (`shadowOnePassProjection`, on by default) and without it.

```js
await engine.setDiagnostic('virtual-shadow-map-cached-page')
world.shadows = { shadowVisualizeLayout: 2 } // the view over the left half of the image
world.shadows = { shadowVisualizeLightName: 'Lamp', shadowVisualizeCachedPagesOnly: true } // the kept pages of the light named Lamp
world.shadows = { shadowVisualizeLayout: null, shadowVisualizeLightName: null } // back to the defaults
```

The overdraw view (`virtual-shadow-map-overdraw`) counts, in a slice of the page pool made for it, how many times
the shadow raster drew each texel this image: the hardware raster for the triangles it draws, the software raster
for the small ones, a draw counted wherever its pixel lands on a drawn page, before any depth test. Each pixel is
coloured by its texel's count, `1 - 2^(-count x scale / 100)` on an inferno colour map, the lights' counts added
when every light is shown. `shadowVisualizeOverdrawScale` is that scale as a percentage (`15` by default, `0` to
`100`): a larger value reaches the bright end with fewer draws. Pixels facing away from their light are kept, as
the counts concern the raster, not the projection. Choosing the view makes the pool again with the extra slice
(leaving it, without), so the cached pages are drawn again once; the software raster counts only on a device that
grants eleven storage buffers a shader stage, the hardware raster on every device.

```js
await engine.setDiagnostic('virtual-shadow-map-overdraw')
world.shadows = { shadowVisualizeOverdrawScale: 40 } // the bright end after fewer draws
world.shadows = { shadowVisualizeOverdrawScale: null } // back to 15
```

The quality levels (the `shadows` group) write the four settings that shape the distance and its edge, the shadow
maps' rows and the shadow quality, as the rules' own rows (`SHADOW_PRESET_LEVELS`,
`packages/sdk-core/src/contracts/shadowOptions.ts`):

| level | `shadowDistanceScale` | `shadowNearLevels` | `shadowOverlapScale` | `shadowFarField` | `shadowQuality` | edge at 400 m |
| --- | --- | --- | --- | --- | --- | --- |
| `smooth` | 0.6 | 1 | 0 | off | 0 | 240.0 m |
| `balanced` | 0.7 | 1 | 0.25 | off | 3 | 280.0 m |
| `fine` | 0.85 | 4 | 0.8 | on | 5 | 358.4 m |
| `max` | nothing (1) | nothing (10) | nothing (1) | nothing (on) | nothing (5) | 427.0 m |
| `cinematic` | 1 | 10 | 1 | on | 5 | 427.0 m |

(Edge at a near plane of 0.05 m.) A value the page set holds over a preset: a `smooth` preset draws no shadow at
all, and a page setting `shadowQuality: 5` brings them back. A value of another kind or out of range is refused by
name. Changing a light's own setting (distance, cascades) makes the light again and its cached pages are redrawn;
changing the view's settings moves the edge the next frame's test reads, and the cached pages are kept.

## The sun's distance-field shadow

With virtual shadow maps a sun's shadow maps draw every cluster at any distance, and every mesh the engine draws is
made of clusters, so the view traces no distance-field shadow of the sun: the cascade past the near levels (from
their end to `distanceFieldShadowDistance`) moves the far-shadow edge and shadows nothing by itself. With classic
shadow maps (`shadowVirtualEnable: false`) the cascade is traced: a ray from each pixel between the last cascade's
end and `distanceFieldShadowDistance` toward the sun through the meshes listed by tile across the view's slice, at
half the image's size, upsampled with the depth as the weight, faded at both ends and laid into the sun's mask by
the minimum. The meshes' distance fields also shade the sun where the maps do not reach: the surface cache's cards,
whose direct light traces a ray through the meshes listed by tile across each sun. These settings act on that list
and on the cascade's edge:

| View option | Default | Meaning |
| --- | --- | --- |
| `distanceFieldShadowing` | `true` | whether a sun may have a distance-field shadow cascade at all: the master switch of the feature; off, none is drawn |
| `distanceFieldShadowQuality` | `3` (0 to 3) | the steps of a ray: 0 none, 1 twenty, 2 thirty-two, 3 sixty-four |
| `distanceFieldShadowTileSize` | `2` m | the side of the tiles across the light the meshes are listed in |
| `distanceFieldShadowTwoSidedBias` | `1` | the factor on the distance a two-sided mesh's surface is expanded by |
| `distanceFieldShadowObjectsPerTile` | `128` | the meshes a tile has room for on average; a tile past it loses meshes (its shadow flickers) |
| `distanceFieldShadowCompactTiles` | `true` | the tiles' lists lie one after the other; `false`: each tile has a place of its own and a tile past it loses meshes |
| `distanceFieldShadowSnapResolution` | `2048` (at least 32) | the texels across the lists' shadow space the origin's snap grid is cut from (4 texels a step, 4 texels off each side): the tile grid moves in steps with the camera |
| `distanceFieldShadowFullResolution` | `false` | the classic cascade is traced at the image's size, else at half of it and upsampled with the depth as the weight |
| `distanceFieldFarTransitionScale` | `1` (0 to 1) | the factor on the length of the cascade's far fade; 0 cuts it sharply at its far end |

The lists are made before the surface cache's lighting, while the scene has a mesh with a distance field and a sun
casts a shadow, for the first four shadowed lights of a frame. A merged shell's field is listed exactly where the
shell is drawn: a cell shown instead of its actor, or an actor not loaded, casts nothing through it.

An object that is not to be in that scene sets **`affectDistanceFieldLighting`** (boolean, `true`), a property of
every object, saved with the world: `false` leaves it out of the distance fields altogether, so the global field the
screen probes march and the distance-field shadows hold nothing of it, and its pixels carry no mark of having a
distance field (the screen probes' traces then treat them as thicker, `screenProbeThicknessScaleWithoutField`). An
object is in the scene only where it also casts a shadow (`castShadow`) and its mesh has a distance field.

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

An agent sets the same through `trillion3d_set_shadows`, and a light's distance and cascades through the fields of
`trillion3d_add_light` (`shadowDistance`, `shadowCascades`, `shadowCascadeExponent`, `shadowCascadeTransition`,
`farShadowCascades`, `farShadowDistance`, `distanceFieldShadows`, `distanceFieldShadowDistance`, with `true` for the
default and `false` for none where a distance). How the far casters are left out of the maps: [SHADOWS.md](../../shadows/far-casters.md#far-casters).
