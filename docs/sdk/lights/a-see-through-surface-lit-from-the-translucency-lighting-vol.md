# A see-through surface lit from the translucency lighting volume

A blended surface takes the light of a **volume** built round the camera each image, one read per
pixel instead of every light (`translucencyLighting`):

- `'volumetricNonDirectional'` (default of a material made in code): the volume's light as a medium
  takes it, from its constant light alone, same for any normal; no reflection.
- `'volumetric'`: as a medium, weighed by the surface's normal; no reflection.
- `'volume'`: as a surface, reflection of the environment kept. Default for a blended material
  imported from a scene file.
- `'forward'`: every light read per pixel, shadow and highlight included. Default for an imported
  material that transmits (`KHR_materials_transmission`).

In the three volume modes the surface gives back the volume's light on its diffuse colour (none for
a metal), in a `normal` or `additive` layer of the default lit model or the thin subsurface. A layer
of another blending mode (`alphaComposite`, `alphaHoldout`, `multiply`, `subtractive`) or shading
model (skin, subsurface profile, eye, hair) takes nothing of the volume and no highlight, only the
bounce and environment light. A shadow catcher and a transmissive (refracting) surface keep forward
lighting in any mode. With no volume-mode surface no volume is made.

## The fog of a see-through surface: per vertex or per pixel

Fog is worked out per vertex and interpolated, farthest layer to nearest: height fog (or distance
fog) with the air's haze behind it, the local fog volumes of the vertex's tile, then the clouds where
the material has `cloudFog`. The fog's volume is read per pixel and laid over it, the local fog
volumes of a pixel under it. `computeFogPerPixel: true` (`false` by default) works the whole fog out
per pixel: exact, dearer, for a large triangle or a surface near the fog's start. Single-layer water
is always per pixel.

```js
material.meshStandard({ transparent: true, opacity: 0.3, computeFogPerPixel: true }) // a large pane, fogged exactly
```

```js
material.meshStandard({ transparent: true, opacity: 0.4, translucencyLighting: 'forward' }) // every light read for the pixel
material.meshStandard({ transparent: true, opacity: 0.4, translucencyLighting: 'volume' }) // a pane lit by the volume
material.meshStandard({ transparent: true, opacity: 0.2, translucencyLighting: 'volumetric' }) // smoke or a veil
material.meshStandard({
  transparent: true,
  opacity: 0.2,
  translucencyLighting: 'volumetricNonDirectional',
}) // a glow lit the same on every side
```

A double-sided see-through surface (`side: 'double'`) is drawn in one pass culling neither face.
`twoSidedPasses` (boolean, `false`) asks two passes, back faces then front, so a closed shape (bottle,
bubble) shows its far side in order, for twice the blend-pass draws:

```js
// A bubble drawn back faces first, then front faces.
material.meshStandard({ transparent: true, opacity: 0.3, side: 'double', twoSidedPasses: true })
```

The volume is two nested cascades of cells following the camera: inner to
`translucencyVolumeInnerDistance` metres, outer to `translucencyVolumeOuterDistance`. Each image the
sun and every local light reaching a cascade are injected into its cells, each by its shadow map
read at the cell (sun with light function, clouds' shade, air's tint; local light with fall-off and
light function), as a two-band spherical harmonic. A cell with no virtual shadow map page reads its
light unshadowed. A surface past the outer cascade reads the sun unshadowed and no local light.
Cells are blended with the previous image (`translucencyVolumeTemporal`) and blurred
(`translucencyVolumeBlur`). Settings are `createWorld` options too, over the quality preset, changed
from the next frame (`packages/sdk-core/src/contracts/translucencyVolumeOptions.ts`); a value not
taken is refused:

| Field | Meaning | Default |
| - | - | - |
| `translucencyVolume` | Whether the volume is made; off, a reading surface reads black | `true` |
| `translucencyVolumeDim` | Cells a side of each cascade, 4 to 2048 (held to the device's 3D texture limit) | `64` |
| `translucencyVolumeInnerDistance` | Metres the inner cascade ends at | `15` |
| `translucencyVolumeOuterDistance` | Metres the outer cascade ends at | `50` |
| `translucencyVolumeBlur` | Each cell is the mean of eight trilinear reads round it; after the temporal blend | `true` |
| `translucencyVolumeTemporal` | Each cell blended with the same point of the previous volume, before the blur | `false` |
| `translucencyVolumeHistoryWeight` | Share of history kept, 0 to 1 | `0.9` |
| `translucencyVolumePositionOffsetRadius` | Cells: radius of per-pixel, per-image noise on the read point; 0 none | `0` |
| `translucencyVolumeAdaptToPerspective` | Cascades sized by the camera's field of view and aspect, not 45 degrees and square | `false` |
| `translucencyVolumeMinFov` | Degrees: least field the cascades follow while the setting above is on | `45` |
| `translucencyVolumeFovSnap` | Degrees: field rounded up to a multiple of it (volume jumps in steps) | `10` |
| `translucencyVolumeMarkVoxels` | Only cells the surfaces read (8 per fetch, dilated a cell) are marked, lit, filtered | `false` |
| `translucencyVolumeVisualize` | A sphere at every cell centre, lit by the volume, depth-tested | `false` |
| `translucencyVolumeVisualizeRadiusScale` | Centimetres: sphere radius is this times (cascade number + 1) | `2` |
| `translucencyVolumeVisualizeCascadeIndex` | Cascade whose spheres are drawn (`0` inner, `1` outer); `-1` both | `-1` |
| `translucencyVolumeDebug` | Cascade boxes (inner green, outer yellow), marked cells' boxes, a table of sizes and counts | `false` |
| `translucencyVolumeDebugFreezePosition` | Cascades stay where the previous image left them | `false` |

Presets write the cell count and blur: `smooth` 24 cells, no blur; `balanced` 32, no blur; `fine`
and `cinematic` nothing. A default-size volume holds 16 MiB (two half-float injected-light textures
and the packed volume); the temporal filter adds two volumes, 24 MiB with no blur, 32 with it. If the
device's memory budget refuses them, surfaces read black.

```js
const world = createWorld('viewer', { translucencyVolumeDim: 32 }) // a coarser volume
world.translucencyVolume = {
  translucencyVolumeInnerDistance: 30,
  translucencyVolumeOuterDistance: 120,
} // a larger reach, from the next frame
world.translucencyVolume = {
  translucencyVolumeTemporal: true,
  translucencyVolumeHistoryWeight: 0.8,
} // blend with the image before
world.translucencyVolume = { translucencyVolumeDim: null } // given back to the preset
world.translucencyVolume = { translucencyVolumeMarkVoxels: true } // light only the cells the surfaces read
world.translucencyVolume = { translucencyVolume: false } // off: no pass, no texture, no byte
world.translucencyVolume = { translucencyVolumeVisualize: true, translucencyVolumeVisualizeCascadeIndex: 0 } // spheres in the inner cascade's cells
world.translucencyVolume = { translucencyVolumeDebug: true, translucencyVolumeDebugFreezePosition: true } // boxes and table, the cascades held in place to look at them
```

The explorer takes the same by field (`explorer.setTranslucencyVolume('translucencyVolumeDim', 48)`),
an agent through `trillion3d_set_translucency_volume`.
