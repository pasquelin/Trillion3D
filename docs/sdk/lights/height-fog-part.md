# Height fog part

The `heightFog` part places height fog over opaque and transparent surfaces; its `color` is a
linear-RGB array, and `false` takes it off. A part naming a linear or an extinction law
(`near`/`far`, `density`/`heightFalloff`) is that law alone and takes none of the level's numbers.
Distance is from the camera; height uses the scene's positive Y:

```js
const color = [0.35, 0.45, 0.6]
world.scene.sky = { heightFog: { color, near: 10, far: 100 } } // Linear: clear before 10, all fog after 100.
world.scene.sky = { heightFog: { color, density: 0.02 } } // Exponential: uniform medium.
world.scene.sky = { heightFog: { color, density: 0.02, heightFalloff: 0.15, baseHeight: 0 } } // Extinction form.
world.scene.sky = { heightFog: true } // Height fog at the level's numbers.
world.scene.sky = { heightFog: { baseDensity: 0.004, falloff: 0.03, maxOpacity: 0.8 } } // Height fog.
world.scene.sky = { heightFog: false } // Every part but the height fog: no fog.
```

The height fog's own fields are the reference's numbers in metres, each with its default, those of the
table: the defaults of a fog a scene declares itself (`SceneEnvironment.fog`), where `{}` is that fog.
Inside the sky word, `heightFog: true` and `{}` are another object, the fog the level places: a
`baseDensity` of 0.00436 per metre (0.0436 in the reference's centimetre numbers) at a `baseHeight` of
−68.5 m, over the table's defaults for every other field. A part that names a field keeps the level's
others, as the fog placed keeps its place when its density is edited: `{ baseDensity: 0.002 }` is the
table's density at the level's base height, not the fog `{}` of a scene's own declaration. The law
is [ENGINE.md](../../engine/fog.md#fog). A reference number in centimetres converts exactly: a density or
falloff is divided by 10 (they are per 1000 centimetres), a distance by 100.

| Field                  | Default                                                 | Meaning (the reference's number → ours)                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color`                | black                                                   | The light the fog scatters by itself, linear RGB. With an atmosphere the sky's light is added to it.                                                                                          |
| `baseDensity`          | `0.002`                                                 | Density at `baseHeight`, per metre, ≥ 0 (its `0.02` ÷ 10).                                                                                                                                    |
| `falloff`              | `0.02`                                                  | Per metre, ≥ 0: the density halves every `1 / falloff` metres up, 50 m (its `0.2` ÷ 10).                                                                                                      |
| `baseHeight`           | `0`                                                     | The height the density is `baseDensity` at, metres.                                                                                                                                           |
| `maxOpacity`           | `1`                                                     | The most of a surface's light the fog may hide, in [0, 1].                                                                                                                                    |
| `startDistance`        | `0`                                                     | Metres from the eye where the fog starts, ≥ 0.                                                                                                                                                |
| `cutoffDistance`       | `0`                                                     | Metres from the eye past which there is no fog, ≥ 0; 0 none.                                                                                                                                  |
| `directional`          | `{ exponent: 4, startDistance: 100, color: [0, 0, 0] }` | The sun's lobe: sharpness `exponent` > 0, metres before the sun's light is scattered (its `10 000` ÷ 100), the luminance scattered toward the sun times the sun's own.                        |
| `skyContribution`      | `[1, 1, 1]`                                             | The factor of the atmosphere's sky radiance the fog takes on, per channel, ≥ 0.                                                                                                               |
| `inMainView`           | `true`                                                  | Whether the views the page draws show the fog.                                                                                                                                                |
| `inSkyCapture`         | `true`                                                  | Whether the distant fog is laid over the sky of the sky light's real-time capture, and so lights the scene through it.                                                                        |
| `inReflectionCaptures` | `true`                                                  | Whether the scene the sky light captures from its own place (its `capturedScene` source) shows the fog.                                                                                       |
| `holdout`              | `false`                                                 | Whether the fog holds its light out: it draws black and punches a hole in the image's alpha by its coverage. Takes effect with the alpha holdout (`primitiveAlphaHoldout`, `propagateAlpha`). |
| `skyLightScattering`   | `{ strength: 0, roughness: 0.15 }`                      | The sky light's capture as a light of the fog's in-scattering: `strength` from 0, `roughness` in [0, 1]. Read only where the run's `fogReadsSkyLight` is on.                                  |
| `screenSpaceScattering` | `false`                                                | The fog blurred in the plane of the screen to stand for its multiple scattering (see below): `true` for the defaults, or an object.                                                        |

Three switches say where the fog is drawn, each on by default: `inMainView` the views the page draws (the camera's
and the extra views of the page), `inSkyCapture` the sky light's real-time capture, `inReflectionCaptures` the scene
the sky light captures from its own place. A view that does not show the fog draws none of it — the analytic fog, its
volume and the reflections' rays are all unfogged — while the atmosphere's haze and the local fog volumes, other
components, stay (the atmosphere has its own `inMainView`). A fog that holds out (`holdout`) adds no light and lays its
coverage on the image's alpha instead (the film settings `primitiveAlphaHoldout` and `propagateAlpha`).

```js
world.scene.sky = { heightFog: { inMainView: false } } // the fog lights the scene through the sky light's capture, but is not seen
world.scene.sky = { heightFog: { inSkyCapture: false } } // the distant fog does not reach the sky light
world.scene.sky = { heightFog: { holdout: true } } // with the alpha holdout on: the fog is a hole in the alpha
```

`skyLightScattering` lets the sky light's capture light the fog: the fog's in-scattering colour is mixed toward the
filtered cube read along the ray, at the mip the `roughness` names, times the light's colour, by the `strength`; the
sun's lobe fades by the same share, and the fog's own cubemap is not read while the strength is above 0. It applies in
a view with sky lighting and a ready cube, never in the capture itself (it would read what it writes), and only where
the project switch `fogReadsSkyLight` (off by default, a setting of the volumetric fog, `world.volumetricFog…`) is on; with the
strength at 0 nothing is read. The local fog volumes and the fog's volume are not lit this way.

```js
world.fogReadsSkyLight = true // the project switch, off by default
world.scene.sky = {
  skyLight: true,
  heightFog: { skyLightScattering: { strength: 0.5, roughness: 0.15 } },
}
```

`screenSpaceScattering` draws the fog into textures of its own, blurs them in the plane of the screen, and lays them over
the lit image with the width of the blur set per pixel by the fog's thickness there: a thick fog over a surface looks
fuzzier, as light scattered several times would. It is off by default. The fields, each with its default:
`sceneColorScatteringAmountScale` `1` (from 0: the share of the lit image injected into the blur — 0 scatters the fog's
light alone, above 1 more of the image where the fog is thin), `sceneColorScatteringAmountPower` `1` (from 0: below 1
scatters more where the fog is thin), `spreadScale` `0.1` (from 0: scales the blur level a pixel reads; too high leaves halos at
depth edges) and `blurControl` `0.5` (in [0, 1]: how much of the blurrier levels is injected back into the sharper ones; 1
gives one average colour). The clouds are composed into the same textures, so they are not blurred by it, and the fog's
`holdout` does not apply to a fog drawn this way. The run settings `fogSeparateComposition` (`'auto'`: draw the fog this way
where the scene's fog asks for the scattering; `'off'` never; `'on'` always, without the blur),
`fogScreenSpaceScattering` (`true`: the scattering is allowed; `false` draws a fog that asks for it plainly) and
`fogScreenSpaceScatteringMaxLuminance` (`10`, held to 0.1 or more: the most luminance a texel holds in the blur, so the
sun's disc does not saturate it), `fogScreenSpaceScatteringTemporal` (`true`: the blur chain's second level is the first level
filtered in time, with a history of its own, instead of a box of it, so the blurred fog does not flicker; `false` takes the box)
and `fogScreenSpaceScatteringTemporalWeight` (`0.04`, from 0 to 1: the weight of the new image in that filter; low values blur
and ghost, high ones leave the jitter showing) are set as the other volumetric fog settings are.

```js
world.scene.sky = { heightFog: { screenSpaceScattering: true } } // the defaults
world.scene.sky = { heightFog: { screenSpaceScattering: { spreadScale: 0.3, blurControl: 0.7 } } }
world.fogScreenSpaceScatteringMaxLuminance = 4 // a darker cap on what the blur holds
world.fogSeparateComposition = 'off' // draw the fog plainly whatever the scene asks
world.fogScreenSpaceScatteringTemporal = false // the blur chain's second level by the box, not the temporal filter
world.fogScreenSpaceScatteringTemporalWeight = 0.1 // more of the new image in the filter
```

With the atmosphere part on, the default fog is coloured by the sky and scatters the sun's light: a
`heightFog` over the `atmosphere` part and a sun is the reference's default fog. A
height fog lies over the atmosphere's sky too: from the horizon down, where the scene draws no
ground, a pixel is the fog's colour alone (a distance fog leaves the sky as it is); with no
atmosphere it lies over the background colour the same way. Without an
atmosphere, the fog is its declared `color` and, if the lobe's colour is not black, the sun's: the
one the scene holds (the brightest directional light, below), else the first directional light
added. The extinction form `{ color, density, heightFalloff?, baseHeight? }` stays: a medium of `density` per metre (`T = exp(−density · d)` where nothing falls off) divided by e every
`1 / heightFalloff` metres up; it is mapped exactly to the height law (`baseDensity = density /
(ln 2)²`, `falloff = heightFalloff / ln 2`) and shows the image it always showed.

`near` and `far` are finite with `0 ≤ near < far`; `density`, `heightFalloff` and the colour
components finite and nonnegative; `baseHeight` finite; the height fog's numbers in the ranges
above; otherwise `INVALID_SCENE_ENVIRONMENT`. To change a field, write `scene.sky` again. A
`fog: false` material stays unfogged. `SceneEnvironment.fog` carries the same fields. The law:
[fog lighting law](../../engine/fog.md#fog).

## Objects in the fog's volume

A mesh whose material is of the volume domain draws no surface: the box its geometry fills, placed
by its pose, is voxelised into the volume of the `heightFog` part's `volumetric` setting (the scene needs that volume,
with a `volumetricFogQuality` other than `off`), where it adds to the medium of every cell it
covers. `material.volume` takes the three outputs of the domain; each is per metre, linear:

| Output         | Default | Meaning                                                                                                                            |
| -------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `albedo`       | white   | The share of the light each channel scatters, in [0, 1] (held to it).                                                              |
| `extinction`   | `0`     | The fraction of light a metre of the object takes away, ≥ 0 (held to 65 000): 0 adds no medium.                                    |
| `emissive`     | black   | The light the object gives off, ≥ 0 per channel (held to 65 000), times `emissiveIntensity`; read where `volumetricFogGlow` is on. |
| `emissiveOnly` | `false` | True: the albedo and the extinction count as zero, only the emissive light is added (the unlit model of the domain).               |

A cell adds `albedo · extinction` of scattering, `extinction` and the emissive light, each times a
fade that is 1 up to 0.6 of the fog's distance and falls to 0 at it, and only where its centre lies
in the object's box. Overlaps add. An object farther from the eye than the fog's distance plus its
radius is left out.

```js
const smoke = new Mesh(
  new BoxGeometry(4, 3, 4),
  material.volume({ albedo: [0.8, 0.8, 0.8], extinction: 0.4 }),
)
smoke.position.set(0, 1.5, -8)
world.scene.add(smoke) // a box of smoke in the fog; it draws no surface
const lamp = material.volume({ emissive: [2, 1, 0.5], emissiveOnly: true })
smoke.material = lamp // an emissive glow in the same box, from the next frame
```

A page without a mesh declares an object directly: `addFogVolume({ id, shape, matrix, boundsMin,
boundsMax, material })` (`shape` `'box'`, the default, covers the oriented box `boundsMin`…
`boundsMax` of its own space placed by `matrix`; `'sphere'` covers the sphere around that box, as a
particle does; `material` the outputs above), `setFogVolume(id, patch)`, `removeFogVolume(id)` and
`fogVolumes()`. A name already held is refused (`DUPLICATE_SCENE_FOG_VOLUME`), an unknown one
(`UNKNOWN_SCENE_FOG_VOLUME`), a field out of its range (`INVALID_SCENE_FOG_VOLUME`, or
`INVALID_MATERIAL` for an output). A mesh drawn at several placements (`InstancedMesh`) is drawn
as it is, not voxelised.

```js
session.addFogVolume({
  id: 'beam',
  shape: 'sphere',
  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, -6, 1],
  boundsMin: [-1, -1, -1],
  boundsMax: [1, 1, 1],
  material: { extinction: 1.5, emissive: [0.2, 0.4, 1] },
})
```

Two run-time settings pick the passes an object is voxelised in, as settings of the volume
(`volumetricFog…`): `volumetricFogVoxelizationSlicesPerPass` (default `8`, at least 1) is how many
of the slices an object reaches make one pass, and `volumetricFogVoxelizationShowOnlyPass`
(default `-1`) keeps one pass of each object, from `0`, to see where the passes lie; `-1` keeps
them all. The passes only divide the slices: the sum is the same.

```js
world.volumetricFogVoxelizationSlicesPerPass = 4 // passes of four slices
world.volumetricFogVoxelizationShowOnlyPass = 1 // only the second pass of each object, to look
world.volumetricFogVoxelizationShowOnlyPass = -1 // back to all of them
```

## Local fog volumes

A local fog volume is a sphere of fog placed in the scene, the way a light is: the fog an author puts
in a doorway, a valley or a room. It is not the object of the section above (`addFogVolume`, a box or
a sphere voxelised into the fog's volume with a material of its own): a local fog volume is a medium
with its own law, drawn over the scene's fog whether the scene has a fog or not, and, where the scene's
fog has a volume, voxelised into it too.

Its medium thins out two ways at once: radially, densest at the sphere's centre and nothing at its
surface, and with height along the sphere's own up. What a ray crosses of it is the two laws'
coverages multiplied (one minus the transmittance of each), so that the soft edge of the sphere and
the layering of the height show together; a volume with either extinction at 0 shows nothing. It is
lit by the sun (the directional light the forward readers take) and by the sky light, scatters by its
albedo, and gives off its own emissive light.

```js
session.addLocalFogVolume({
  id: 'valley',
  // Its place: sixteen numbers, column-major, metres. The origin is the sphere's centre, the second
  // column its up, the largest column's length its scale (a radius of 5 m times it).
  matrix: [3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, 40, 1, -25, 1],
  radialDensity: 0.6,
  heightDensity: 1.2,
  heightFalloff: 300,
  albedo: [0.9, 0.95, 1],
  emissive: [0.02, 0.03, 0.05],
  startDistance: 20,
  sortPriority: 1,
})
session.setLocalFogVolume('valley', { radialDensity: 0.9 }) // the fields named replace the volume's own
session.localFogVolumes() // detached copies, in the order they were added
session.removeLocalFogVolume('valley')
```

| Field                    | Default  | Meaning                                                                                                                                                                                                                                                            |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                     | —        | Its name, unique among the local fog volumes.                                                                                                                                                                                                                      |
| `matrix`                 | identity | Sixteen numbers, column-major, its own space to the world's, metres. The sphere's radius is 5 m times the largest of the columns' lengths; its second column is the up the height law is measured along (the world's up is +y); shear and reflection are left out. |
| `radialDensity`          | `1`      | The extinction of the radial fog at the sphere's centre, per metre, ≥ 0 (held to it).                                                                                                                                                                              |
| `heightDensity`          | `1`      | The extinction of the height fog at the sphere's height 0, per metre, ≥ 0 (held to it).                                                                                                                                                                            |
| `heightFalloff`          | `1000`   | How fast the height fog thins out, ≥ 1 (held to it): the density is `heightDensity · e^(−falloff / 100 · h)`, `h` the height in the sphere's radii.                                                                                                                |
| `heightOffset`           | `0`      | The height, in radii, the height fog's density is `heightDensity` at.                                                                                                                                                                                              |
| `scatteringDistribution` | `0.2`    | The phase function's `g`, in [0, 0.999] (held to it): 0 scatters equally every way, nearer 1 toward where the light goes.                                                                                                                                          |
| `albedo`                 | white    | The share of the light each channel scatters, in [0, 1] (held to it).                                                                                                                                                                                              |
| `emissive`               | black    | The light the medium gives off, a luminance, ≥ 0 per channel (held to it); it follows the medium's coverage.                                                                                                                                                       |
| `startDistance`          | `0`      | Metres from the eye before which the volume does not show, ≥ 0 (held to it); the run's `localFogVolumeStartDistance` holds it above that.                                                                                                                          |
| `sortPriority`           | `0`      | A whole number in [-127, 127] (held to it): a volume of a lower priority is drawn behind one of a higher, whatever their distance; equal priorities go farthest first.                                                                                             |

The numbers are the reference's, in this engine's units: the reference writes distances in
centimetres and densities per centimetre, here a start distance, the radius (5 m times the scale), the
density cap and every extinction are metres and per metre, and the height axis is the matrix's second
column in a world whose up is +y. A name already held is refused (`DUPLICATE_SCENE_LOCAL_FOG_VOLUME`),
an unknown one (`UNKNOWN_SCENE_LOCAL_FOG_VOLUME`), a field that is `null` or not a finite number, a
colour of three or a matrix of sixteen whose columns have a length (`INVALID_SCENE_LOCAL_FOG_VOLUME`).
Like the lights and the objects of the volume, local fog volumes are declared at run time and are not
part of a saved world; they can be declared whatever the settings below say, even with the project
switch off, and then are never drawn.

Nine settings, those of the volumetric fog (`world.volumetricFog…`, `setVolumetricFog`), say how they are
drawn; the first is the project's, read once when the session opens:

| Setting                          | Default | Meaning                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localFogVolumeSupport`          | `true`  | The project switch of the local fog volumes, read once when the session opens (changing it later changes nothing). Off, no program holds any of their code, not the sky light's capture's either, and no pass, buffer or block is made for them; they can still be declared, and are never drawn. |
| `localFogVolumes`                | `true`  | Whether the local fog volumes are drawn.                                                                                                                                                                                                                                                          |
| `localFogVolumeInVolume`         | `true`  | Whether they are voxelised into the fog's volume where the scene's fog has one — the analytic law then draws only what lies past the volume's far end, and they lie under the volume's light. Off, the analytic law draws them whole, over the finished fog, the volume's light too.              |
| `localFogVolumeMaxVolumeDensity` | `1`     | The most extinction, per metre, a volume gives a cell of the fog's volume: its height law grows steepest at its bottom, and a dense cell makes the volume's history leak. 0 or more (held to it).                                                                                                 |
| `localFogVolumeStartDistance`    | `10`    | Metres from the eye before which no local fog volume shows, whatever its own start distance; held to at least 0.1.                                                                                                                                                                                |
| `localFogVolumeMaxCount`         | `32`    | The most volumes a view draws, the farthest and the lowest in priority dropped; held to 1…256.                                                                                                                                                                                                    |
| `localFogVolumeTileSize`         | `128`   | The side, in pixels, of the tiles of the screen the volumes are culled by: each tile keeps the list of the volumes over it, and a pixel or a cell of the fog's volume walks its tile's list alone. Held to 8…512; the lists are made for the tile grid the view cuts, whatever its size.          |
| `localFogVolumeUsesDepthPyramid` | `true`  | Whether a tile's list drops a volume that lies wholly behind the surfaces the depth pyramid holds over it, so that no pixel walks a volume it cannot show. Off, or where the image has no pyramid, the tile's frustum alone culls.                                                                |
| `localFogVolumeOnTranslucent`    | `false` | Whether translucent surfaces are fogged by them too; off, they are fogged by the scene's fog alone.                                                                                                                                                                                               |

```js
world.localFogVolumes = false // draw none of them, whatever the scene declares
world.localFogVolumeInVolume = false // keep them out of the fog's volume: drawn whole, over its light
world.localFogVolumeMaxVolumeDensity = 0.5 // no cell of the fog's volume takes more than 0.5 per metre of them
world.localFogVolumeStartDistance = 5 // the volumes show from five metres
world.localFogVolumeMaxCount = 64 // a view draws up to 64, the nearest and the highest in priority
world.localFogVolumeOnTranslucent = true // glass in the valley's fog is fogged by it too
world.localFogVolumeTileSize = 64 // smaller tiles: shorter lists, more tiles to cull (never fewer than 8 pixels)
world.localFogVolumeUsesDepthPyramid = false // cull by the tile's frustum alone
```

```js
// The project switch is the session's, read once when it opens: off, no program holds any of the
// local fog volumes' code. A session that draws none of them is made so.
const world = createWorld('viewer', { localFogVolumeSupport: false }) // the project switch, at the session's opening
```

The tiles and their lists are the engine's: the view is cut into square tiles, and before the fog is
laid one pass writes, for each, the volumes that can show over it (the sphere not wholly outside the
tile's frustum, and, with `localFogVolumeUsesDepthPyramid`, not wholly behind the surfaces of the depth
pyramid over its footprint). The image is the same as without the lists; the cost is per volume over a
pixel's tile, not per volume the view draws. The lists live in a buffer made for the tile grid, only
while a view draws a volume, and it counts in the bytes of that view's targets (`metrics.views`). The
culling runs with the frame's other passes — it has no queue of its own to set — and no view of each
tile's count of volumes is offered. The tile side asked for is never changed. Three diagnostics tell
what the engine could not do, none of them stops the volumes being drawn:

| Diagnostic                  | Meaning and what to do                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fog-local-tiles-too-large` | The lists for the tile grid would not fit a storage buffer of the device, so the view is not tiled and every pixel walks every volume of the view. Raise `localFogVolumeTileSize`; said once for a size. |
| `fog-local-cull-failed`     | The culling pass did not compile: the same, untiled, until it does.                                                                                                                                      |
| `fog-local-sky-failed`      | The pass that gives the volumes the sky light's term did not compile: the term stays black, the sun and the volume's own light are drawn.                                                                |
