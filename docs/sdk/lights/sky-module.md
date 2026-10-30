# Sky module

The sky is one module: air, sun, sky light, height fog and clouds of a new world's level, each a
part. Off by default, then free. `scene.sky` (saved with the scene) or `world.modules` (page)
switches it on; both take `true` (every part default), `false`, or an object naming parts, each
`true`, `false` or its settings. Unnamed parts stay on at default (`mergeModuleParts`):

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

Per field the strongest word wins: editor, page, quality preset (none switches the sky on), scene,
default; a part a stronger word switched off stays off. A part or field the module lacks, or an
out-of-range value, is refused (`INVALID_MODULE_OPTION`, `INVALID_SCENE_ENVIRONMENT`), nothing
changes. The stats overlay is the second module (`world.modules.set('stats', true)`; tabs and panel
are its parts).

| Part | What it is | Defaults, the level's |
| - | - | - |
| `atmosphere` | Planet's air ([Atmosphere part](atmosphere-part.md#atmosphere-part)). | Component's: Earth-like. |
| `sun` | Directional light, the air's first, with shadows, light shafts, cloud shadow map. | `intensity` 6 lux, `useTemperature` on at `temperatureKelvin` 6500, `angle` 0.7357°, `rotation` `[-16.2856, 43.7319, 112.3607]` (pitch, yaw, roll degrees; negative pitch shines down), `shadowDistance` 200 m, `castShadow`, `shadowsAir`, `shadowsClouds`, `shaftOcclusion` on. A `light.directional(...)` you add has the light's defaults (10 lux, disk 0.5357°, shadows to 400 m, no temperature, no shadow on air or clouds). |
| `skyLight` | Sky light captured from air and clouds. | `realTimeCapture` on, `mobility: 'movable'`, `lowerHemisphereIsSolidColor` off. |
| `heightFog` | Fog thinning with height ([Height fog part](height-fog-part.md#height-fog-part)); volume = `volumetric`. | `baseDensity` 0.00436 per metre at `baseHeight` −68.5 m. |
| `clouds` | One cloud layer ([Clouds part](clouds-part.md#clouds-part)). | Layer and material defaults. Four sample scales 1 (`viewSamplesScale`, `reflectionSamplesScale`, `shadowSamplesScale`, `reflectionShadowSamplesScale`): a view ray takes 96 samples, a shadow ray 10, capped by sky quality (`cloudViewSamplesMax` 768, `cloudReflectionSamplesMax` 80, `cloudShadowSamplesMax` 80, `cloudReflectionShadowSamplesMax` 24). |

The sun's fields:

- light's: `intensity`, `color`, `useTemperature`, `temperatureKelvin`, `angle`, `rotation`,
  `shadowDistance`, `castShadow`, `distanceFieldShadows` (off for the level's sun, on for a
  light's own) at `distanceFieldShadowDistance` 300 m (light's own 512), `shadowsAir`,
  `shadowsFog`, `fogScattering`, `atmosphereSunIndex`, `forwardShadingPriority`,
  `transmittancePerPixel`, `sunDiskTint`;
- light shafts': `shaftOcclusion`, `shaftOcclusionDarkness`, `shaftOcclusionDepthRange`,
  `shaftOverrideDirection`, `shaftBloom`, `shaftBloomScale`, `shaftBloomThreshold`,
  `shaftBloomMaxBrightness`, `shaftBloomTint`;
- cloud shadow map's: `shadowsClouds` (the cloud march reads the sun's opaque shadow map; air's
  first light only; on for the level's sun), `castCloudShadows`,
  `cloudShadowStrength`, `cloudShadowOnAtmosphereStrength`, `cloudShadowOnSurfaceStrength`,
  `cloudShadowDepthBiasKm`, `cloudShadowExtentKm`, `cloudShadowResolutionScale`,
  `cloudShadowRaySamplesScale`, `cloudScatteredLuminanceScale`.

Module lights hang from no scene and are never saved: a scene's directional light competes with the
sun by the air's rule (brightest of each index held). One sky light, the part's: where a scene
holds more, the last shown lights it, others give nothing.

**Cloud ambient occlusion.** Under thick clouds the sky's multiple scattering fades out. The sky
light part asks for it with five fields:

- `cloudAmbientOcclusion` (default `false`: nothing built);
- `cloudAmbientOcclusionStrength` (1, at least 0): how much light clouds block;
- `cloudAmbientOcclusionExtentKm` (150, at least 1): map radius round the camera;
- `cloudAmbientOcclusionMapResolutionScale` (1, at least 0.25): factor on a 512-texel-a-side map;
- `cloudAmbientOcclusionApertureScale` (0.05, 0 to 1): cone round the vertical; 0 sharp, 1 whole
  hemisphere, blurry.

The map is built from above along the planet's vertical; it dims the first light's multiple
scattering wherever the air marches the sky (not the second light's, not surface sky light).

Sky quality settings (no level writes them): `cloudSkyAO` (on: pass switch),
`cloudSkyAOResolutionMax` (2048: largest side), `cloudSkyAOTraceSamples` (10: samples per map ray),
`cloudSkyAOFiltering` (on), `cloudSkyAOSnapKm` (20: km its position snaps to; 0 or less reads as
0.1 m). Made only while a clouds part is followed and the sky light asks. `cloudSkyAODebug` (off)
draws the map over the image (frustum blue, a quad per cloud-holding texel); `cloudShadowMapDebug`
(off) the first light's cloud shadow map (frustum orange, sample count).

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

`shaftOcclusion` is on for the sun, off for other lights; the same nine fields are a light's.

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

**The presets.** `world.quality.preset`: `smooth`, `balanced`, `fine`, `max`, `cinematic` or `auto`;
a group takes a level of the same names (`world.quality.set(group, level)`). `auto` (default): the
hardware benchmark picks each group's level; a page-named preset or group wins. `max` writes
nothing (setting defaults are reference's fourth level); `cinematic` writes reference fifth-row
values. Page-set values hold over any preset.

**The hardware benchmark.** `world.quality.benchmark(options)` runs it, keeps the result in the
origin's local storage (page memory where none) for this GPU adapter, and draws it: preset becomes
`auto`. A world under `auto` draws the result kept for its adapter; with none, it runs the
benchmark once at world open, before the first image, keeps it and draws at it. A page naming a
preset runs nothing. A result kept for another adapter or older engine is not read.

Processor tests run in a worker (page refuses it: `cpuIndex` `null`, which no level reads);
graphics tests on a device of their own. Disposing the world stops a run. Two processor and seven
graphics tests (GPU timestamps), each against the machine whose index is 100, give a processor and
a graphics index. Rounded browser timestamps (100 µs) are detected by their step; graphics work is
multiplied by that step in microseconds (at most 1000). A group reads the graphics index against
three thresholds; `min` groups read the lower of the two (no processor index: graphics):

| Group | Index | Thresholds of levels 1, 2 and 3 |
| - | - | - |
| `viewDistance` | min | 18, 42, 105 |
| `shadows` | min | 18, 42, 105 |
| `effects` | min | 18, 42, 105 |
| `edgeSmoothing` | graphics | 18, 42, 115 |
| `indirectLight` | graphics | 18, 42, 115 |
| `imageEffects` | graphics | 18, 42, 115 |
| `textures` | graphics | 18, 42, 115 |

Levels 0 to 3 are `smooth` to `max`: the benchmark never chooses `cinematic`. Resolution stays the
page's `renderScale` or `quality.resolution`, else the display-based default. No GPU timestamps, or
a test left unmeasured: no graphics index, every group stays `max`.

`world.quality.hardware` reads the result (`null` before one): `cpuIndex`, `gpuIndex`, `cpuSteps`,
`gpuSteps`, `workScale`, `gpuWorkScale`, `gpuMultiplier`, `groups`. `benchmark` `options`:
`workScale`, whole number 1 to 1000 (10: ten runs per processor test, graphics at ten times base
work, a few seconds), `cpuMultiplier` and `gpuMultiplier` (1: factors of the two indices).

```js
const world = createWorld('viewer') // auto: the result kept, else one run before the first image
const found = await world.quality.benchmark() // measured now, kept for this adapter, drawn
console.log(found.groups) // { viewDistance: 'fine', edgeSmoothing: 'max', … }
world.quality.preset = 'max' // the page's preset wins
```

Group settings at `max`:

- `viewDistance`: `cutViewDistanceScale` 10.
- `edgeSmoothing`: `antialiasing: 'max'`.
- `shadows`: `shadowDistanceScale` 1, `shadowNearLevels` 10, `shadowOverlapScale` 1,
  `shadowFarField` on, `shadowMaxResolution` 4096, `shadowResolutionLodBiasLocalMoving` 0,
  `shadowRayCountDirectional` and `shadowRayCountLocal` 16, `shadowSamplesPerRayDirectional` and
  `shadowSamplesPerRayLocal` 8, `shadowMaxPhysicalPages` 8192 (needs a 512 MiB binding; a device
  holding less draws the largest pool that fits), `volumetricFogQuality` `'ultra'`.
- `imageEffects`: `motionBlurQuality` `'veryHigh'`, `bloomQuality` `'highest'`,
  `bloomScreenPercentage` 100, `gaussianFastBlurThreshold` 100, depth of field's gather at full
  size with 5 rings and the diaphragm's shape, `depthOfFieldScatterMaxRatio` 0.25,
  `depthOfFieldRecombine` `'high'` with `depthOfFieldRecombineBokeh`,
  `ambientOcclusionHorizonAngles` 4, `lutSize` 64, `lutShaper` `'pq'`, `lightShafts` on.
- `indirectLight`: `screenProbes` `'cinematic'`, `reflectionQuality` `'cinematic'`,
  `skyLightIntensityScale` 1.
- `effects`: the atmosphere's eleven settings, the sky and the haze on the surfaces marched.
- `textures`: nothing; no wired setting.

```js
world.quality.preset = 'fine' // the effects' and shadows' level 2: fewer samples, smaller tables
world.skyQuality = { cloudShadowMap: false, lightShafts: false } // switch two passes off
world.skyQuality = { cloudShadowMap: null } // given back to the preset
```

Settings are re-read each image; a change rebuilds only what it needs (a program, a target size).
`cloudsOn: false` removes clouds from the view, sky light capture and shadow maps;
`cloudShadowMap: false` stops the shadow map passes; a preset writes only the settings its level
names. Sky settings the levels write, besides the atmosphere's eleven (`SKY_PRESET_LEVELS.effects`):

| Preset | `lightShafts` | `skyLightIntensityScale` |
| - | - | - |
| `smooth` | off | 0.8 |
| `balanced` | off | 1 |
| `fine` | on | 1 |
| `max` | the default (on) | 1 |
| `cinematic` | on | 1 |

No quality level writes a cloud setting.

```js
world.skyQuality = { cloudsOn: false } // no clouds in the view, the capture or the shadow maps
world.skyQuality = { cloudsOn: null } // given back to the preset
world.skyQuality = { skyLightIntensityScale: 0.5 } // a dimmer sky light, at once
```

A scene saved before the module (`formatVersion` 2) moves its `atmosphere`, `fog` and sky light
node into the module's parts once, when read; fog keeps its own default numbers; sun and clouds are
off. A scene is saved with its `sky` word (`formatVersion` 3 and after).
