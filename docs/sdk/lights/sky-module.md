# Sky module

The sky is one module: the air, the sun, the sky light, the height fog and the clouds of a new
world's level, each a part. It is off by default and then costs nothing: no part is resolved, no
light is held, nothing is allocated and no pass is drawn. One word switches it on, `scene.sky` for a
scene (it is saved with it) or `world.modules` for a page; both take `true` (every part at its
default), `false`, or an object naming the parts, each `true`, `false` or its settings — a part the
object does not name stays on, at its default (`mergeModuleParts`): an object switches off only the
parts it sets to `false`:

```js
world.scene.sky = true // the whole level: air, sun, sky light, height fog, clouds
world.scene.sky = { clouds: false } // all but the clouds
world.scene.sky = { sun: { intensity: 8, rotation: [-30, 90, 0] }, heightFog: true, clouds: false }
world.scene.sky = { heightFog: { baseDensity: 0.004, falloff: 0.03, volumetric: true } }
world.scene.sky = null // no word: the page's, else off

world.modules.set('sky', false) // the page switches it off, over the scene's word
world.modules.set('sky', { sun: { shaftBloom: true } }) // and sets a field, over the scene's
world.modules.clear('sky') // the scene's word is back
world.modules.state('sky') // { enabled, by: 'scene', parts: { sun: { … }, clouds: false, … } }
```

Per field the strongest word wins: the editor's, then the page's, then a quality preset's (none switches the sky on),
then the scene's, then the default; a part a stronger word switched off stays off. A part or a field the
module does not have, or a value out of range, is refused (`INVALID_MODULE_OPTION`,
`INVALID_SCENE_ENVIRONMENT`) and nothing changes. The stats overlay is the second module
(`world.modules.set('stats', true)`, its panel in the canvas's parent; its tabs and the panel are
its parts).

| Part         | What it is                                                                                                  | Defaults, the level's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atmosphere` | The planet's air: the sky, the haze, the sun's light tinted by it ([Atmosphere part](atmosphere-part.md#atmosphere-part)).    | The component's: Earth-like.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `sun`        | One directional light, the air's first light, with its shadows, light shafts and cloud shadow map.          | `intensity` 6 lux, `useTemperature` on at `temperatureKelvin` 6500, `angle` 0.7357° (the disk's diameter), `rotation` `[-16.2856, 43.7319, 112.3607]` (pitch, yaw, roll in degrees; the yaw turns about +y, a negative pitch shines down), `shadowDistance` 200 m, `castShadow`, `shadowsAir` and `shadowsClouds` on, `shaftOcclusion` on. These are the values of the sun the level's template places, not the directional light's own defaults (10 lux, a disk of 0.5357°, shadows to 400 m, no temperature, no shadow on the air or the clouds); a field the template leaves alone has the light's default. A directional light you add yourself (`light.directional(...)`) has the light's own defaults, so its disk is 0.5357° wide, the sun part's 0.7357°. |
| `skyLight`   | The sky's light on the scene, captured from the air and the clouds.                                         | `realTimeCapture` on, `mobility: 'movable'`, `lowerHemisphereIsSolidColor` off; the other fields the component's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `heightFog`  | Fog thinning out with height ([Height fog part](height-fog-part.md#height-fog-part)); its volume is its `volumetric` setting. | `baseDensity` 0.00436 per metre (0.0436 in the reference's centimetre numbers) at `baseHeight` −68.5 m; the other fields as below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `clouds`     | One layer of clouds, ray marched from the eye ([Clouds part](clouds-part.md#clouds-part)).                                | The layer's and the material's defaults. The four sample scales are 1 (`viewSamplesScale`, `reflectionSamplesScale`, `shadowSamplesScale`, `reflectionShadowSamplesScale`): at a scale of 1 a view ray takes 96 samples and a shadow ray 10, held to the sky quality's most (`cloudViewSamplesMax` 768, `cloudReflectionSamplesMax` 80, `cloudShadowSamplesMax` 80, `cloudReflectionShadowSamplesMax` 24).                                                                                                                                                                                                                                                                                                                                                        |

The sun's own fields are a light's (`intensity`, `color`, `useTemperature`, `temperatureKelvin`,
`angle`, `rotation`, `shadowDistance`, `castShadow`, `distanceFieldShadows` (off, as the level's sun has
it, the light's own is on) at `distanceFieldShadowDistance` 300 m (the light's own is 512), `shadowsAir`, `shadowsFog`, `fogScattering`,
`atmosphereSunIndex`, `forwardShadingPriority`, `transmittancePerPixel`, `sunDiskTint`), its light shafts' (`shaftOcclusion`,
`shaftOcclusionDarkness`, `shaftOcclusionDepthRange`, `shaftOverrideDirection`, `shaftBloom`,
`shaftBloomScale`, `shaftBloomThreshold`, `shaftBloomMaxBrightness`, `shaftBloomTint`) and its cloud
shadow map's (`shadowsClouds`: the cloud march reads the sun's opaque shadow map, only for the air's
first light; `castCloudShadows`, `cloudShadowStrength`, `cloudShadowOnAtmosphereStrength`,
`cloudShadowOnSurfaceStrength`, `cloudShadowDepthBiasKm`, `cloudShadowExtentKm`,
`cloudShadowResolutionScale`, `cloudShadowRaySamplesScale`, `cloudScatteredLuminanceScale`). The
module's lights hang from no scene and are never saved: a directional light of the scene competes
with the sun by the air's rule (the brightest of each index is held). There is one sky light, the
part's: where a scene is made to hold more, the last shown lights it, the others give nothing.

**Cloud ambient occlusion.** Under thick clouds the sky's multiple scattering (the light the air scatters more than once, which lights the sky and the haze from every side) fades out. The sky light part asks for it with five fields: `cloudAmbientOcclusion` (default `false`: nothing is built), `cloudAmbientOcclusionStrength` (default 1, at least 0: how much light the clouds block), `cloudAmbientOcclusionExtentKm` (default 150, at least 1: the radius round the camera the map covers), `cloudAmbientOcclusionMapResolutionScale` (default 1, at least 0.25: the factor on a map of 512 texels a side) and `cloudAmbientOcclusionApertureScale` (default 0.05, from 0 to 1: the cone round the vertical over which the occlusion is integrated, 0 one direction and a sharp occlusion, 1 the whole hemisphere and a blurry one). A map is built from above along the planet's vertical, round the point under the camera, and the air reads it wherever it marches the sky: the sky, the haze over the distance, the haze marched on the opaque surfaces and on the clouds, and the sky light's own capture; it dims the multiple scattering of the air's first light there (the second light's is not dimmed). It does not dim the sky light's own diffuse and specular light on the surfaces: the capture is of the sky as the air makes it, the occlusion is in the air.

The sky quality settings that shape the map are `cloudSkyAO` (default on: the switch of the pass), `cloudSkyAOResolutionMax` (2048: the largest side), `cloudSkyAOTraceSamples` (10: the samples a ray of the map takes through the layer), `cloudSkyAOFiltering` (on: the map is dilated and smoothed, integrated over the hemisphere above each texel) and `cloudSkyAOSnapKm` (20: the length, in kilometres, its position is snapped to, so that it does not flicker; 0 or less is read as 0.1 m, the map then following every step of the camera). No quality level writes any of them. The map is made only while a clouds part is followed and the sky light asks; a scene with no clouds, or whose sky light leaves the flag off, pays nothing. `cloudSkyAODebug` (off) draws the map over the image: its frustum in blue and a quad for each texel that holds cloud; `cloudShadowMapDebug` (off) does the same for the first light's cloud shadow map, its frustum in orange, with the map's sample count written over the image.

```js
world.scene.sky = {
  atmosphere: true,
  sun: { castCloudShadows: true },
  skyLight: { cloudAmbientOcclusion: true, cloudAmbientOcclusionStrength: 0.8 },
  clouds: true,
}
world.skyQuality = { cloudSkyAOResolutionMax: 1024, cloudSkyAOFiltering: false } // a smaller, unfiltered map
world.skyQuality = { cloudSkyAO: false } // the pass off, whatever the sky light asks
world.skyQuality = { cloudSkyAOSnapKm: 5 } // the map's place snapped to 5 km
world.skyQuality = { cloudSkyAODebug: true } // the sky occlusion map drawn over the image
```

The sun's light shafts are the light's own: `shaftOcclusion` is on for the sun and off for any other
light, and the same nine fields are a light's below. For the sun they are written the same way:

```js
world.modules.set('sky', {
  sun: {
    shaftOcclusionDarkness: 0.2, // the occluded fog keeps a fifth of its inscattering
    shaftOcclusionDepthRange: 2000, // whatever is nearer than 2 km occludes
    shaftBloom: true,
    shaftBloomTint: [1, 0.9, 0.7], // a warm bloom
  },
})
```

**The presets.** `world.quality.preset` is one of `smooth`, `balanced`, `fine`, `max` and `cinematic`, or
`auto`, and a group is set to a level of the same names (`world.quality.set(group, level)`). `auto` is
the default: the hardware benchmark picks each group's level for the machine, and a preset or a group the
page names wins. `max`, the top level, writes nothing: the settings' defaults are the reference's fourth level. `cinematic` is the fifth,
above it: each group writes the reference's fifth-row values for the settings the engine has. A value the
page sets holds over any preset.

**The hardware benchmark.** `world.quality.benchmark(options)`
runs the benchmark, keeps its result in the origin's local storage (in the page's memory where it grants none) for this GPU
adapter, and draws it: the preset becomes `auto`. A world under `auto` (the default, or `quality: { preset: 'auto' }`, or set
to it later) draws the result kept for its adapter when there is one; where none is kept it runs the benchmark once
when the world opens, before its first image (never inside a frame), keeps the result for the adapter and
draws every image at it. A page that names a preset runs nothing. A
result kept for another adapter, or by an older engine, is not read. The run first waits for the world's
device to finish its work; the processor tests run in a worker (where the page refuses it they are left out
and `cpuIndex` is `null`, which no level reads), the graphics tests on a WebGPU device of their own; a frame
the world draws meanwhile shares the GPU with them, so a page asks it while the view is still. Disposing the
world stops a run. It measures two processor tests (segments against a triangle, a fractal) and seven
graphics tests (arithmetic, texture reads, dependent reads, fill, bandwidth, two vertex tests) timed by the
GPU timestamps, each against the time of the machine whose index is 100, into a processor index and a
graphics index. A browser that rounds its timestamps (to 100 µs without a developer switch) is found by the
step of its stamps, and the graphics work is multiplied by that step in microseconds (at most 1000), so a
step weighs on each pass as the reference's microsecond does. A group reads the graphics index against
three thresholds; the groups marked `min` read the lower of the processor and graphics indices
(a run with no processor index reads the graphics one):

| Group           | Index    | Thresholds of levels 1, 2 and 3 |
| --------------- | -------- | ------------------------------- |
| `viewDistance`  | min      | 18, 42, 105                     |
| `shadows`       | min      | 18, 42, 105                     |
| `effects`       | min      | 18, 42, 105                     |
| `edgeSmoothing` | graphics | 18, 42, 115                     |
| `indirectLight` | graphics | 18, 42, 115                     |
| `imageEffects`  | graphics | 18, 42, 115                     |
| `textures`      | graphics | 18, 42, 115                     |

Levels 0 to 3 are `smooth` to `max`: the benchmark never chooses `cinematic`. The benchmark gives levels only: the resolution stays the page's
`renderScale` or `quality.resolution`, else the display-based default. A device
without GPU timestamps, or a test left unmeasured, gives no graphics index: every group stays at `max`. A
preset or a group the page names after wins over the benchmark's levels.

`world.quality.hardware` reads the result (`null` before one): `cpuIndex`, `gpuIndex`, each test's own
index (`cpuSteps`, `gpuSteps`), `workScale`, `gpuWorkScale` (the work the graphics tests ran at),
`gpuMultiplier`, and what they give, `groups`. The `options` of `benchmark` are `workScale`,
a whole number from 1 to 1000 (10: ten runs of each processor test, the graphics passes at ten times their
base work, a few seconds of the device's work), `cpuMultiplier` and `gpuMultiplier` (1: factors of the two
indices).

```js
const world = createWorld('viewer') // auto: the result kept, else one run before the first image
const found = await world.quality.benchmark() // measured now, kept for this adapter, drawn
console.log(found.groups) // { viewDistance: 'fine', edgeSmoothing: 'max', … }
world.quality.preset = 'max' // the page's preset wins
```

- `viewDistance`: `cutViewDistanceScale` 10.
- `edgeSmoothing`: `antialiasing: 'max'`.
- `shadows`: `shadowDistanceScale` 1, `shadowNearLevels` 10, `shadowOverlapScale` 1, `shadowFarField` on,
  `shadowMaxResolution` 4096, `shadowResolutionLodBiasLocalMoving` 0,
  `shadowRayCountDirectional` and `shadowRayCountLocal` 16 (the most a lane holds),
  `shadowSamplesPerRayDirectional` and `shadowSamplesPerRayLocal` 8, `shadowMaxPhysicalPages` 8192 (a pool
  of 8192 pages needs a device whose binding holds 512 MiB; a device that holds less draws the largest pool that fits), `volumetricFogQuality` `'ultra'`.
- `imageEffects`: `motionBlurQuality` `'veryHigh'` with the full-size gather, `bloomQuality` `'highest'` and
  `bloomScreenPercentage` 100, `gaussianFastBlurThreshold` 100, the depth of field's gather at the full size
  with 5 rings and the diaphragm's shape, `depthOfFieldScatterMaxRatio` 0.25, `depthOfFieldRecombine`
  `'high'` with `depthOfFieldRecombineBokeh`, `ambientOcclusionHorizonAngles` 4, `lutSize` 64, `lutShaper`
  `'pq'`, `lightShafts` on.
- `indirectLight`: `screenProbes` `'cinematic'`, `reflectionQuality` `'cinematic'`, `skyLightIntensityScale` 1.
- `effects`: the atmosphere's eleven settings, the sky and the haze on the surfaces marched (the table of
  the air's settings below).
- `textures`: nothing, as at every level: the group has no wired setting.

The quality presets and the sky's quality settings reach the module through the effects and shadows
groups, as they reach the rest of the image:

```js
world.quality.preset = 'fine' // the effects' and shadows' level 2: fewer samples, smaller tables
world.skyQuality = { cloudShadowMap: false, lightShafts: false } // switch two passes off
world.skyQuality = { cloudShadowMap: null } // given back to the preset
```

The settings are read again at each image: a change reaches the sky light's capture, the clouds and their shadow maps in the image that follows, and rebuilds only what it needs (a program, a target's size). `cloudsOn: false` takes the clouds out of the view, of the sky light's capture and of their shadow maps; `cloudShadowMap: false` stops the shadow map passes; a preset writes the settings its level names and leaves the others as the page wrote them. The sky settings the levels write, besides the atmosphere's eleven (`SKY_PRESET_LEVELS.effects`):

| Preset      | `lightShafts`    | `skyLightIntensityScale` |
| ----------- | ---------------- | ------------------------ |
| `smooth`    | off              | 0.8                      |
| `balanced`  | off              | 1                        |
| `fine`      | on               | 1                        |
| `max`       | the default (on) | 1                        |
| `cinematic` | on               | 1                        |

No quality level writes a cloud setting.

```js
world.skyQuality = { cloudsOn: false } // no clouds in the view, the capture or the shadow maps
world.skyQuality = { cloudsOn: null } // given back to the preset
world.skyQuality = { skyLightIntensityScale: 0.5 } // a dimmer sky light, at once
```

A scene saved before the module (`formatVersion` 2) moves its `atmosphere`, its `fog` and its sky
light node into the module's parts once, when it is read; each part keeps the fields it had, the
fog the numbers it had by default and not the level's, and the sun and the clouds, which that scene
never had, are off. A scene is saved with its `sky` word (`formatVersion` 3 and after).
