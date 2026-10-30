# Atmosphere part

The `atmosphere` part fills the sky, hazes distance and tints sun light through the air of a planet
whose ground is plane `y = 0`. `true` is Earth-like; an object overrides defaults: planet radius and
air thickness (km), scattering and absorption coefficients (per km), `groundHeight` (scene metres),
`groundPosition` (`[x, z]` metres, `[0, 0]` default; where the planet's top stands on that plane):

```js
world.scene.sky = { atmosphere: true } // the whole level: a part not named stays on
world.scene.sky = { sun: false, skyLight: false, heightFog: false, clouds: false } // the air alone
world.scene.sky = {
  atmosphere: { planetRadius: 6360, height: 60, mieAnisotropy: 0.8, groundHeight: 0 },
}
// A city 50 km from the world's origin: the planet's top under it, so the horizon curves from there
world.scene.sky = {
  atmosphere: { groundHeight: 120, groundPosition: [50_000, -12_000] },
}
world.scene.sky = { sun: { intensity: 10 }, heightFog: false, clouds: false } // the air, a sun, the sky's light
world.scene.sky = { atmosphere: false } // every part but the air
world.scene.sky = { atmosphere: { inMainView: false } } // the air lights the world but is not drawn in the view
world.scene.sky = { atmosphere: { holdout: true } } // with the alpha holdout on: the sky and its haze draw black and are a hole in the alpha
```

- `inMainView` (on): sky, sun disk and haze on surfaces and clouds drawn in the camera's view. Off:
  sky black, fog alone over it, nothing hazed; air-tinted sun light and the sky light's capture of
  the air unchanged.
- `holdout` (off): where the alpha holdout applies (film settings `primitiveAlphaHoldout`,
  `propagateAlpha`) sky draws black with its air coverage on alpha as a hole; haze on surfaces and
  clouds adds no light but still dims what lies behind.

The sun is the brightest index-0 directional light (colour times intensity weighed by eye
sensitivity). An added light replaces it only if brighter; removing the sun gives its place to the
brightest other, first added among equals; `atmosphereSun: false` excludes a light. With the
atmosphere on, `background` is not shown and the `skyLight` part lights the scene from the sky (off:
background colour). Below the horizon it is the sky, unless `lowerHemisphereIsSolidColor` is `true`
(off): then `lowerHemisphereColor` (black) replaces it, `lowerHemisphereCoverage` (1, 0 to 1) being
its alpha. Bounce is on by default (`world.bounce`, `false` turns it off): the sky light reaches a
surface only where the scene lets it; bounce off, it lights every surface the sky is not hidden from.

With `realTimeCapture` off and `sourceType: 'capturedScene'` the sky light draws the scene once into
its six-face cube; `skyDistanceThreshold` (150000 cm) is the nearest distance shown,
`captureEmissiveOnly` keeps only emission. Captured on light creation, on cubemap or angle change and
on `realTimeCapture` switch; not on colour, intensity, lower-hemisphere change or move. To recapture,
write the part again:

```js
world.scene.sky = {
  skyLight: { realTimeCapture: false, sourceType: 'capturedScene', cubemapResolution: 128 },
}
```

Quality: `skyLightCaptureSupersample` (1, 1 to 8) draws faces larger and averages down,
`skyLightCaptureLodDistanceScale` (1) asks more scene detail. Faces trace no scene reflection. Model:
[sky light, captured scene](../../engine/atmosphere-and-sky-light.md#atmosphere-and-sky-light).

```js
world.scene.sky = {
  skyLight: {
    lowerHemisphereIsSolidColor: true,
    lowerHemisphereColor: [0.05, 0.04, 0.03],
    lowerHemisphereCoverage: 0.6,
  }, // a ground that lets 40% of the sky's light through
}
```

A sky light with a specified cubemap (`realTimeCapture: false`, `sourceType: 'specifiedCubemap'`) is
lit by data in the part: `cubemap`, `{ size, texels }`. `size`: texels across a face, 1 to 1024.
`texels`: six faces in order +x, −x, +y, −y, +z, −z (looked up by scene direction, +y up), each row by
row from top-left, three linear numbers ≥ 0 per texel (`6 · size² · 3` numbers; typed array or
array). Data is not copied: do not write it after setting. `cubemapBlend`,
`{ destination: { size, texels }, fraction }`, mixes source and destination by `fraction` (0 source,
1 destination, beyond held to them); write the part again to move it. Saved worlds keep both (typed
array saved as array of numbers). A malformed field is refused with `TypeError` naming it
(`skyLight: cubemap.texels expects 72 numbers, six faces of 2² texels`).

```js
const sky = new Float32Array(6 * 2 * 2 * 3).fill(0.4) // a 2×2 cube of one grey: the sky's radiance
world.scene.sky = {
  skyLight: {
    realTimeCapture: false,
    sourceType: 'specifiedCubemap',
    sourceCubemapAngle: 90, // degrees about the vertical
    cubemap: { size: 2, texels: sky },
  },
}
// later, toward the evening cube
world.scene.sky = {
  skyLight: {
    realTimeCapture: false,
    sourceType: 'specifiedCubemap',
    cubemap: { size: 2, texels: sky },
    cubemapBlend: { destination: { size: 2, texels: evening }, fraction: 0.25 },
  },
}
```

Nothing is clamped: texels past the half-float maximum (65504) are rescaled and the light gets the
inverse. A large cube is written over several images and used once all six faces are written.

The air holds two lights: a sun and a second (a moon, or second sun). Each directional light has
`atmosphereSunIndex`, `0` default (`1` for the second); the brightest per index (`atmosphereSun` not
`false`) is held, by the sun's rules. Sky, haze, sun disks and sky light take both; index 1 alone
shines alone. Any other index is refused (`INVALID_SCENE_LIGHT`). Declared lights carry
`SceneLight.atmosphereSunIndex` (directional only).

```js
world.scene.sky = { atmosphere: true, sun: false } // the scene's own lights are the air's
world.scene.add(light.directional({ intensity: 10, position: [-50, 70, 0] })) // the sun, index 0
const moon = light.directional({ intensity: 0.3, position: [60, 40, 20], atmosphereSunIndex: 1 })
world.scene.add(moon) // the second light of the air: its own sky, haze, disk and tint on what it lights
moon.atmosphereSunIndex = 0 // a write reaches the world at once; 0 is the default
```

With `useTemperature` on, a light's colour is multiplied by a black body's at `temperatureKelvin`
(6500 default, white; read 1000 to 15000); sun, sky and fog take it. Three more directional-light
options in the air (saved with the world):

- `sunDiskTint` (white, linear colour): multiplies the sun's disk in the sky, not the light it gives.
- `shadowsAir` (off): the light's shadow shades the air; haze and sky march read its shadow map
  along rays (as `atmosphereSampleLightShadowMap`, on, allows).
- `transmittancePerPixel` (off): air transmittance toward the light read per surface point, not once
  at the ground (a low sun reddens a valley, not the summit above it).

A light draws shafts through nine fields, written to its record and saved world only when not
default:

- `shaftOcclusion` (off): the light darkens fog inscattering where the scene hides it.
  `shaftOcclusionDarkness` (0.05): what full occlusion maps to (1 darkens nothing); everything nearer
  than `shaftOcclusionDepthRange` (1000 metres) occludes. `shaftOverrideDirection` (`[0, 0, 0]`,
  vector): when not zero, the direction shafts come from. These four: directional light only.
- `shaftBloom` (off): bloom around any light. `shaftBloomScale` (0.2): factor on added colour.
  `shaftBloomThreshold` (0): brightness the image must pass after exposure to bloom.
  `shaftBloomMaxBrightness` (100): brightness above which it is brought down. `shaftBloomTint` (white,
  linear colour): factor on its colour.

Vectors change in place with `set`, as `sunDiskTint` does.

```js
const sun = light.directional({ intensity: 10, position: [-50, 70, 0], castShadow: true })
sun.shaftOcclusion = true
sun.shaftOcclusionDepthRange = 2000 // metres
sun.shaftOverrideDirection.set(-0.3, 0.4, 0.1) // the shafts come from there
sun.shaftBloom = true
sun.shaftBloomTint.set([1, 0.85, 0.6])
world.addLight({ id: 'lamp', kind: 'point', intensity: 50, position: [0, 3, 0], shaftBloom: true })
```

```js
const sun = light.directional({ intensity: 10, position: [-50, 70, 0], castShadow: true })
sun.useTemperature = true
sun.temperatureKelvin = 5200 // a warmer white
sun.sunDiskTint.set([1, 0.8, 0.6]) // the disk redder than the light it gives
sun.shadowsAir = true // the mountains' shadows in the haze
world.addLight({
  id: 'moon',
  kind: 'directional',
  direction: [0.2, -1, 0.1],
  color: [0.7, 0.8, 1],
  intensity: 0.3,
  atmosphereSunIndex: 1,
  temperatureKelvin: 4100,
  useTemperature: true,
})
```

`sampleCountScale` (1, from 0.25) scales the air's samples: marches' quality caps are at most 32
times it, haze volume samples per slice at most twice it. Air quality is `world.skyQuality`'s sky
settings:

- `atmosphereOn` (on).
- Samples: air march (`atmosphereSamplesMin`, `atmosphereSamplesMax`,
  `atmosphereDistanceToMaxSamplesKm`), sky table (`skyTableSamplesMin`, `skyTableSamplesMax`,
  `skyTableDistanceToMaxSamplesKm`), haze volume slice (`aerialSamplesPerSlice`).
- Table sizes (`transmittanceWidth`, `transmittanceHeight`, `multiScatterWidth`, `multiScatterHeight`,
  `skyTableWidth`, `skyTableHeight`) and haze volume (`aerialWidth`, `aerialDepthSlices`,
  `aerialDepthKm`).
- Samples building the transmittance and multiple-scattering tables (`transmittanceSamples`,
  `multiScatterSamples`).
- Switches: `skyTableFast` (sky read from table, else every sky pixel marched); `aerialFastOnOpaque`
  (on; off: opaque pixels' haze marched in a pass over the lit image; translucent surfaces read the
  volume either way); `aerialDepthTest`; `transmittanceTable`; `transmittanceSmallFormat` (four
  8-bit channels); `distantSkyLightTable` and `distantSkyLightAltitudeKm` (fog's sky);
  `multiScatterHighQuality` (8 directions); `skyTablesFullPrecision` (haze volume in 32-bit floats);
  `atmosphereSampleLightShadowMap`.

Defaults are the reference's fourth level (`max`); presets `smooth`, `balanced`, `fine` set its lower
three, `cinematic` its fifth:

```js
world.quality.preset = 'fine' // the effects' level 2: 2 samples a slice, 64 samples at most
world.skyQuality = { skyTableFast: false, atmosphereSamplesMax: 256 } // every sky pixel marched
world.scene.sky = { atmosphere: { sampleCountScale: 2 } } // twice the samples, within those caps
world.skyQuality = { skyTableFast: null } // given back to the preset
```

`cinematic` (effects level 4; `smooth`, `balanced`, `fine`, `max` are 0 to 3) marches every sky pixel
and opaque-surface haze, writing these values (`SKY_PRESET_LEVELS.effects.cinematic`):

```js
world.quality.preset = 'cinematic' // the same values, written by the level
world.skyQuality = {
  aerialSamplesPerSlice: 8,
  aerialDepthSlices: 32,
  skyTableFast: false, // every sky pixel is marched
  aerialFastOnOpaque: false,
  skyTableSamplesMin: 4,
  skyTableSamplesMax: 256,
  atmosphereSamplesMin: 8,
  atmosphereSamplesMax: 256,
  transmittanceSmallFormat: false,
  transmittanceSamples: 30,
  multiScatterSamples: 20,
}
```

**Ranges.** `planetRadius`, `height`, `rayleighScaleHeight`, `mieScaleHeight` above 0 (`height` under
0.1 km reads as 0.1 km); `mieAnisotropy` strictly between −1 and 1; `aerialPerspectiveStartDepth` 0
or more; `multiScatteringFactor` 0 to 100; `minSunElevation` −90° to 90°. Out of range is refused
(`INVALID_SCENE_ENVIRONMENT`) with the range in its message; a world saved with anisotropy −0.3 or
radius 12000 km loads and draws. To change a field, write `scene.sky` again.

**The planet's place.** A sphere under plane `y = groundHeight`, top at `groundPosition`; to put its
_centre_ at a place, give that place with a `groundHeight` of its radius (metres) over it.

**The view from above the air.** An eye above `planetRadius + height` sees the air from outside
(planet limb, sun disk through limb air, haze and clouds from where a ray enters the air; a ray
missing it sees black). An eye under ground is held five metres over it. An orthographic camera also
draws sky, haze and clouds
([the air under an orthographic camera](../../engine/atmosphere-and-sky-light.md#atmosphere-and-sky-light)).

`SceneEnvironment.atmosphere` carries the same fields. Model:
[atmosphere and sky light](../../engine/atmosphere-and-sky-light.md#atmosphere-and-sky-light).
