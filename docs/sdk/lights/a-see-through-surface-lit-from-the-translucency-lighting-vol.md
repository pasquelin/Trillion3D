# A see-through surface lit from the translucency lighting volume

A blended surface takes the light of a **volume** the engine builds round the camera each image, one read for the
pixel in place of every light (`translucencyLighting`):

- `'volumetricNonDirectional'` (the default of a material made in code): the volume's light, as a medium takes it, from
  its constant light alone, the same whatever the surface's normal: no reflection.
- `'volumetric'`: the volume's light, as a medium takes it, weighed by the surface's normal: no reflection.
- `'volume'`: the volume's light, as a surface takes it, and the reflection of the environment kept. A blended
  material imported from a scene file is given this one.
- `'forward'`: every light read for the pixel, its shadow and its highlight included. A material imported from a scene
  file that transmits (`KHR_materials_transmission`) is given this one.

In the three volume modes (a volume is built whenever a blended surface wears one of them, which is the default)
the surface gives back the volume's light on its diffuse colour (none for a metal), in a `normal` or `additive` layer of
the default lit model or the thin subsurface. The mode alone says what lights a layer, whatever its blending mode: a layer
of another blending mode (`alphaComposite`, `alphaHoldout`, `multiply`, `subtractive`), and a layer of any other shading
model (the skin, the subsurface profile, the eye, the hair), is lit by no light of its own in a volume mode: it takes
nothing of the volume and no highlight from the lights, and keeps the light the bounce and the environment give it, as
a forward surface does. Only `'forward'` reads every light. A
shadow catcher and a transmissive (refracting) surface keep their forward lighting whatever the mode. A scene none of
whose surfaces asks for a volume the volume lights makes none, nor does an image that draws no such layer: no pass runs, no texture is made and the programs hold none of its code;
a surface whose mode is changed redraws the session's blended programs, as `cloudFog` does.

## The fog of a see-through surface: per vertex or per pixel

The fog a see-through surface is seen through is worked out for each vertex and interpolated, from the farthest layer to the
nearest: the height fog (or the distance fog) with the haze of the air behind it, the local fog volumes of the
tile the vertex lies in over them, and the clouds over those where the material has `cloudFog`. The fog's volume is
always read for the pixel and laid over it, the local fog volumes of a pixel under it. A scene none of whose see-through surfaces takes its fog per vertex (all
`computeFogPerPixel`, water or `fog: false`) compiles its programs without the vertex fog. A material with
`computeFogPerPixel: true` (`false` by default) works the whole fog out for each pixel instead: exact, and dearer, for
a large triangle or a surface near the fog's start. Single-layer water is always per pixel.

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

A double-sided see-through surface (`side: 'double'`) is drawn in one pass that culls neither face, as every
two-sided surface is. `twoSidedPasses` (boolean, `false` by default) asks two passes instead, its back faces then its front
faces, so a closed shape (a bottle, a bubble) shows its far side through its near one in the right order, for twice the
draws of the surface in the blend pass:

```js
// A bubble drawn back faces first, then front faces.
material.meshStandard({ transparent: true, opacity: 0.3, side: 'double', twoSidedPasses: true })
```

The volume is two nested cascades of cubes of cells that follow the camera: the inner one holds the view to
`translucencyVolumeInnerDistance` metres, the outer one the stretch from there to `translucencyVolumeOuterDistance`; their
centres are snapped to a whole number of cells, so that the light does not crawl as the camera moves. Each image the sun
and every local light that reaches a cascade are injected into its cells, each by its own shadow map read at the cell
(the sun with its light function, the clouds' shade and the air's tint; a local light with its fall-off and its light
function); the light is kept as a two-band spherical harmonic, so a surface reads the light's direction too. A cell whose
shadow no virtual shadow map holds a page for reads its light unshadowed. A surface past the outer cascade reads the sun
unshadowed and no local light. The cells are then blended with the image before (`translucencyVolumeTemporal`) and blurred
(`translucencyVolumeBlur`), and the surfaces read them by eight loads and a blend of the two cascades. The settings are the
reference's, each an option of `createWorld` too, held over the quality preset, changed later from the next frame
(`packages/sdk-core/src/contracts/translucencyVolumeOptions.ts`); a value a setting does not take is refused:

| Field                                    | Meaning                                                                                                                        | Default |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `translucencyVolume`                     | Whether the volume is made; off, a surface that reads it reads black                                                           | `true`  |
| `translucencyVolumeDim`                  | Cells a side of each cascade, 4 to 2048 (held to what the device's 3D textures hold)                                           | `64`    |
| `translucencyVolumeInnerDistance`        | Metres from the camera the inner cascade ends at                                                                               | `15`    |
| `translucencyVolumeOuterDistance`        | Metres from the camera the outer cascade ends at                                                                               | `50`    |
| `translucencyVolumeBlur`                 | The spatial filter: each cell is the mean of eight trilinear reads round it; it runs after the temporal blend where that is on | `true`  |
| `translucencyVolumeTemporal`             | Each cell is blended with the same point of the volume of the image before, ahead of the blur                                  | `false` |
| `translucencyVolumeHistoryWeight`        | The share of that history kept, 0 to 1                                                                                         | `0.9`   |
| `translucencyVolumePositionOffsetRadius` | Cells: the radius of a noise, different for each pixel and image, that moves the point a surface reads the volume at; 0 none   | `0`     |
| `translucencyVolumeAdaptToPerspective`   | The cascades are sized by the camera's own field of view and aspect, not a field of 45 degrees and a square view               | `false` |
| `translucencyVolumeMinFov`               | Degrees: the least field of view the cascades follow while the setting above is on                                             | `45`    |
| `translucencyVolumeFovSnap`              | Degrees: the field is rounded up to a multiple of it, which makes the volume jump in steps as the field animates               | `10`    |
| `translucencyVolumeMarkVoxels`           | Only the cells the surfaces read (8 per fetch, dilated by a cell) are marked, lit and filtered                                 | `false` |
| `translucencyVolumeVisualize`            | A sphere is drawn over the image at the centre of every cell, lit by the volume's light, tested against the scene depth        | `false` |
| `translucencyVolumeVisualizeRadiusScale` | Centimetres: the spheres' radius is this times one more than their cascade's number                                            | `2`     |
| `translucencyVolumeVisualizeCascadeIndex`| The one cascade (`0` inner, `1` outer) whose spheres are drawn; `-1` both                                                      | `-1`    |
| `translucencyVolumeDebug`                | The cascades' boxes (inner green, outer yellow), the marked cells' boxes, and a table of sizes and counts of cells in view and marked written over the image | `false` |
| `translucencyVolumeDebugFreezePosition`  | The cascades stay where the image before left them, whatever the camera does                                                   | `false` |

The quality presets write the cells' count and the blur: `smooth` 24 cells and no blur, `balanced` 32 and no blur, `fine`
and `cinematic` nothing. A volume of the default size holds 16 MiB of textures (two half-float textures of the light as
injected, and the packed volume the surfaces read); with the temporal filter on it holds two more such volumes, 24 MiB
with no blur and 32 with it; the device's memory budget may refuse them, and the surfaces then read black.

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

The explorer takes the same by field (`explorer.setTranslucencyVolume('translucencyVolumeDim', 48)`), and an agent through
`trillion3d_set_translucency_volume`.
