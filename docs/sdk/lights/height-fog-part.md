# Height fog part

The `heightFog` part places height fog over opaque and transparent surfaces; `color` is linear RGB,
`false` removes it. A part naming a linear or extinction law (`near`/`far`,
`density`/`heightFalloff`) is that law alone, taking none of the level's numbers. Distance from
camera; height along scene +Y:

```js
const color = [0.35, 0.45, 0.6]
world.scene.sky = { heightFog: { color, near: 10, far: 100 } } // Linear: clear before 10, all fog after 100.
world.scene.sky = { heightFog: { color, density: 0.02 } } // Exponential: uniform medium.
world.scene.sky = { heightFog: { color, density: 0.02, heightFalloff: 0.15, baseHeight: 0 } } // Extinction form.
world.scene.sky = { heightFog: true } // Height fog at the level's numbers.
world.scene.sky = { heightFog: { baseDensity: 0.004, falloff: 0.03, maxOpacity: 0.8 } } // Height fog.
world.scene.sky = { heightFog: false } // Every part but the height fog: no fog.
```

Fields are reference numbers in metres; defaults below are those of a fog a scene declares
(`SceneEnvironment.fog`, where `{}` is that fog). In the sky word, `heightFog: true` and `{}` are the
level's fog: `baseDensity` 0.00436 per metre at `baseHeight` −68.5 m, table defaults for the rest. A
part naming a field keeps the level's others. Law: [ENGINE.md](../../engine/fog.md#fog). Reference
centimetres: density or falloff ÷ 10, distance ÷ 100.

| Field | Default | Meaning |
| - | - | - |
| `color` | black | Light the fog scatters itself, linear RGB; with an atmosphere the sky's light is added. |
| `baseDensity` | `0.002` | Density at `baseHeight`, per metre, ≥ 0. |
| `falloff` | `0.02` | Per metre, ≥ 0: density halves every `1 / falloff` m up. |
| `baseHeight` | `0` | Height of `baseDensity`, metres. |
| `maxOpacity` | `1` | Most of a surface's light the fog may hide, [0, 1]. |
| `startDistance` | `0` | Metres from the eye where fog starts, ≥ 0. |
| `cutoffDistance` | `0` | Metres from the eye past which no fog, ≥ 0; 0 none. |
| `directional` | `{ exponent: 4, startDistance: 100, color: [0, 0, 0] }` | Sun lobe: `exponent` > 0, metres before sun light scatters, luminance scattered toward the sun times the sun's own. |
| `skyContribution` | `[1, 1, 1]` | Factor of the atmosphere's sky radiance the fog takes, per channel, ≥ 0. |
| `inMainView` | `true` | Views the page draws show the fog. |
| `inSkyCapture` | `true` | Distant fog laid over the sky light's real-time capture. |
| `inReflectionCaptures` | `true` | Scene captured by the sky light (`capturedScene`) shows the fog. |
| `holdout` | `false` | Fog draws black, punches a hole in alpha by its coverage; needs `primitiveAlphaHoldout`, `propagateAlpha`. |
| `skyLightScattering` | `{ strength: 0, roughness: 0.15 }` | Sky light capture lights the fog's in-scattering: `strength` ≥ 0, `roughness` [0, 1]. Read only where `fogReadsSkyLight` is on. |
| `screenSpaceScattering` | `false` | Fog blurred in screen plane (below): `true` for defaults, or an object. |

A view without the fog draws none of it; atmosphere haze and local fog volumes stay.

```js
world.scene.sky = { heightFog: { inMainView: false } } // the fog lights the scene through the sky light's capture, but is not seen
world.scene.sky = { heightFog: { inSkyCapture: false } } // the distant fog does not reach the sky light
world.scene.sky = { heightFog: { holdout: true } } // with the alpha holdout on: the fog is a hole in the alpha
```

`skyLightScattering`: in-scattering mixes, by `strength`, toward the filtered cube read along the ray
at mip `roughness`, times light colour; the sun lobe fades by the same share. Only in a view with sky
lighting and a ready cube, never in the capture, and only with project switch `fogReadsSkyLight`
(off; volumetric fog setting). Local fog volumes and the fog's volume are not lit this way.

```js
world.fogReadsSkyLight = true // the project switch, off by default
world.scene.sky = {
  skyLight: true,
  heightFog: { skyLightScattering: { strength: 0.5, roughness: 0.15 } },
}
```

`screenSpaceScattering` (off): fog drawn into own textures, blurred in screen plane, laid over the
lit image. Fields:

- `sceneColorScatteringAmountScale` `1` (≥ 0): share of the lit image injected into the blur.
- `sceneColorScatteringAmountPower` `1` (≥ 0): below 1 scatters more where fog is thin.
- `spreadScale` `0.1` (≥ 0): blur level a pixel reads; too high leaves halos at depth edges.
- `blurControl` `0.5` ([0, 1]): share of blurrier levels injected into sharper ones; 1 one average colour.

Clouds compose into the same textures (not blurred); `holdout` does not apply. Run settings:

- `fogSeparateComposition` (`'auto'`: where the scene's fog asks; `'off'` never; `'on'` always, no blur);
- `fogScreenSpaceScattering` (`true` allowed; `false` draws plainly);
- `fogScreenSpaceScatteringMaxLuminance` (`10`, ≥ 0.1): most luminance a texel holds in the blur;
- `fogScreenSpaceScatteringTemporal` (`true`): blur chain's second level filtered in time with its own
  history; `false` a box;
- `fogScreenSpaceScatteringTemporalWeight` (`0.04`, 0 to 1): weight of the new image; low blurs and
  ghosts, high shows jitter.

```js
world.scene.sky = { heightFog: { screenSpaceScattering: true } } // the defaults
world.scene.sky = { heightFog: { screenSpaceScattering: { spreadScale: 0.3, blurControl: 0.7 } } }
world.fogScreenSpaceScatteringMaxLuminance = 4 // a darker cap on what the blur holds
world.fogSeparateComposition = 'off' // draw the fog plainly whatever the scene asks
world.fogScreenSpaceScatteringTemporal = false // the blur chain's second level by the box, not the temporal filter
world.fogScreenSpaceScatteringTemporalWeight = 0.1 // more of the new image in the filter
```

With the `atmosphere` part, the default fog is sky-coloured and scatters the sun (reference default).
Height fog also covers the atmosphere's sky: below the horizon with no ground a pixel is fog colour
alone (distance fog leaves the sky); with no atmosphere, over the background colour. Without an
atmosphere the fog is its `color` and, if the lobe colour is not black, the sun's (brightest
directional, else first added). Extinction form `{ color, density, heightFalloff?, baseHeight? }`:
`T = exp(−density · d)` where nothing falls off, divided by e every `1 / heightFalloff` m up; maps to
the height law (`baseDensity = density / (ln 2)²`, `falloff = heightFalloff / ln 2`).

Valid: `near`, `far` finite with `0 ≤ near < far`; `density`, `heightFalloff`, colour components finite
and ≥ 0; `baseHeight` finite; height fog numbers in range; else `INVALID_SCENE_ENVIRONMENT`. To change
a field, write `scene.sky` again. A `fog: false` material stays unfogged. Law:
[fog lighting law](../../engine/fog.md#fog).

## Objects in the fog's volume

A mesh with a volume-domain material draws no surface: the box its geometry fills, placed by its pose,
is voxelised into the `heightFog` part's `volumetric` volume (needs it, with `volumetricFogQuality`
other than `off`), adding to every cell it covers. `material.volume` outputs, per metre, linear:

| Output | Default | Meaning |
| - | - | - |
| `albedo` | white | Share scattered per channel, [0, 1] (held). |
| `extinction` | `0` | Fraction of light taken per metre, ≥ 0 (held to 65 000); 0 adds no medium. |
| `emissive` | black | Light given off, ≥ 0 per channel (held to 65 000), times `emissiveIntensity`; read where `volumetricFogGlow` is on. |
| `emissiveOnly` | `false` | True: albedo and extinction count as zero, only emissive is added. |

A cell adds `albedo · extinction`, `extinction` and emissive, times a fade (1 up to 0.6 of fog
distance, 0 at it), where its centre lies in the box. Overlaps add. Beyond fog distance plus radius:
left out.

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

Without a mesh: `addFogVolume({ id, shape, matrix, boundsMin, boundsMax, material })` (`shape` `'box'`
default: oriented box `boundsMin`…`boundsMax` in own space placed by `matrix`; `'sphere'`: sphere
around that box), `setFogVolume(id, patch)`, `removeFogVolume(id)`, `fogVolumes()`. Refused: held name
`DUPLICATE_SCENE_FOG_VOLUME`; unknown `UNKNOWN_SCENE_FOG_VOLUME`; out-of-range field
`INVALID_SCENE_FOG_VOLUME` (`INVALID_MATERIAL` for an output). An `InstancedMesh` is drawn as is, not
voxelised.

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

Voxelisation settings: `volumetricFogVoxelizationSlicesPerPass` (`8`, ≥ 1): slices per pass;
`volumetricFogVoxelizationShowOnlyPass` (`-1`): keeps one pass (from `0`) of each object; `-1` all.

```js
world.volumetricFogVoxelizationSlicesPerPass = 4 // passes of four slices
world.volumetricFogVoxelizationShowOnlyPass = 1 // only the second pass of each object, to look
world.volumetricFogVoxelizationShowOnlyPass = -1 // back to all of them
```

## Local fog volumes

A sphere of fog placed like a light, drawn over the scene's fog and, where that has a volume,
voxelised into it too. Thins radially and with height along its up; ray coverage is the two laws'
coverages multiplied (either extinction 0 shows nothing). Lit by the sun and sky light.

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

| Field | Default | Meaning |
| - | - | - |
| `id` | — | Unique name. |
| `matrix` | identity | 16 numbers, column-major, own space to world, metres. Radius 5 m times largest column length; second column is the height law's up (world up +y); shear, reflection dropped. |
| `radialDensity` | `1` | Radial extinction at centre, per metre, ≥ 0 (held). |
| `heightDensity` | `1` | Height extinction at height 0, per metre, ≥ 0 (held). |
| `heightFalloff` | `1000` | ≥ 1 (held): density `heightDensity · e^(−falloff / 100 · h)`, `h` height in radii. |
| `heightOffset` | `0` | Height, in radii, of `heightDensity`. |
| `scatteringDistribution` | `0.2` | Phase `g`, [0, 0.999] (held): 0 isotropic, near 1 forward. |
| `albedo` | white | Share scattered per channel, [0, 1] (held). |
| `emissive` | black | Luminance given off, ≥ 0 per channel (held); follows coverage. |
| `startDistance` | `0` | Metres from the eye before which it does not show, ≥ 0 (held); `localFogVolumeStartDistance` floors it. |
| `sortPriority` | `0` | Integer [-127, 127] (held): lower drawn behind higher; equal go farthest first. |

Units: metres and per metre (reference: centimetres). Refused: held name
`DUPLICATE_SCENE_LOCAL_FOG_VOLUME`; unknown `UNKNOWN_SCENE_LOCAL_FOG_VOLUME`; `null` or non-finite
field, a colour not of three, a matrix not of sixteen with columns of length: `INVALID_SCENE_LOCAL_FOG_VOLUME`.
Declared at run time, not saved with a world; declarable whatever the settings say (project switch off:
never drawn).

Nine volumetric fog settings (`world.volumetricFog…`, `setVolumetricFog`):

| Setting | Default | Meaning |
| - | - | - |
| `localFogVolumeSupport` | `true` | Project switch, read once at session open. Off: no program holds their code (sky light capture's either), no pass, buffer or block; declarable, never drawn. |
| `localFogVolumes` | `true` | Whether drawn. |
| `localFogVolumeInVolume` | `true` | Voxelised into the fog's volume where it has one: analytic law then draws only past the volume's far end, under the volume's light. Off: analytic law draws them whole, over the finished fog. |
| `localFogVolumeMaxVolumeDensity` | `1` | Most extinction per metre a volume gives a fog-volume cell, ≥ 0 (held). |
| `localFogVolumeStartDistance` | `10` | Metres before which none shows, whatever its own start; ≥ 0.1. |
| `localFogVolumeMaxCount` | `32` | Most volumes a view draws (farthest, lowest priority dropped); 1…256. |
| `localFogVolumeTileSize` | `128` | Pixel side of the screen tiles volumes are culled by (per-tile lists); 8…512. |
| `localFogVolumeUsesDepthPyramid` | `true` | A tile's list drops a volume wholly behind the depth pyramid's surfaces. Off, or no pyramid: frustum culls alone. |
| `localFogVolumeOnTranslucent` | `false` | Translucent surfaces fogged by them too; off, scene fog alone. |

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

`createWorld('viewer', { localFogVolumeSupport: false })` sets the project switch at opening.

One pass before the fog writes per tile the volumes that can show (sphere not wholly outside the
tile's frustum; with `localFogVolumeUsesDepthPyramid` not wholly behind the pyramid). Lists live in a
tile-grid buffer while a view draws a volume, counted in `metrics.views` bytes. Diagnostics (none
stops drawing):

| Diagnostic | Meaning and what to do |
| - | - |
| `fog-local-tiles-too-large` | Lists would not fit a device storage buffer: view untiled, every pixel walks every volume. Raise `localFogVolumeTileSize`; said once per size. |
| `fog-local-cull-failed` | Culling pass did not compile: untiled until it does. |
| `fog-local-sky-failed` | Sky light term pass did not compile: term black, sun and own light drawn. |
