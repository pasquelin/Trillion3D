# Atmosphere part

The `atmosphere` part fills the sky, hazes the distance and tints the sun's light through the
air of a planet whose ground is the scene's plane `y = 0`. `true` is an Earth-like atmosphere, an
object sets any field over those defaults — planet radius and air thickness in kilometres,
scattering and absorption coefficients per kilometre, the ground's height in scene metres
(`groundHeight`) and where its top stands on that plane (`groundPosition`, `[x, z]` in metres, `[0, 0]`
by default):

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

`inMainView` (on) says whether the sky, the sun's disk and the haze on the surfaces and the clouds are
drawn in the view the camera sees. Off, none is: the sky is black, the fog alone over it, and nothing is
hazed, while the sun's light tinted by the air and what the sky light captures of the air are as they
are.
`holdout` (off) makes the air hold its light out where the alpha holdout is in effect (the film settings
`primitiveAlphaHoldout` and `propagateAlpha`): the sky draws black with the coverage of its air, which is laid on
the image's alpha as a hole, and the haze on the surfaces and the clouds adds no light, dimming what lies behind it all the same.

The sun is the brightest directional light of index 0 (the second light is below), its colour times
its intensity weighed by the eye's sensitivity to each channel, held as lights are added and removed (with an atmosphere or none): a
light added replaces it only if brighter, and the sun removed gives its place to the brightest of
the others, the first added of equals; `atmosphereSun: false` leaves one out. Where it is on,
`background` is not shown, and the `skyLight` part lights the scene from the sky (without an
atmosphere, from the background colour; below the horizon the sky itself, unless `lowerHemisphereIsSolidColor` is `true` (off by default, as in a new level's sky light): then `lowerHemisphereColor`, black, replaces it, `lowerHemisphereCoverage`, 1 by default, from 0 to 1, being the colour's alpha: how much of the colour replaces the sky and the clouds below the horizon, the rest of them showing through). The bounce is on by default
(`world.bounce`, `false` turns it off): the sky light then reaches a surface only where the scene
lets it — the street lit from above, the arcade dark — and a reflection that leaves the scene
shows the sky; with the bounce off, the sky light lights every surface with the sky nothing hides.

The sky light can also light the scene with the scene itself: with `realTimeCapture` off and
`sourceType: 'capturedScene'` it draws the scene once from its position into its cube, the six faces
of a cube seen from there, the distance `skyDistanceThreshold` (150000 cm, the reference's default)
the nearest it shows, and `captureEmissiveOnly` keeping only what the surfaces emit. It is captured
when the light is created, when its cubemap or its angle changes and when `realTimeCapture` is
switched; not when its colour, its intensity or its lower hemisphere changes, nor when it moves. A
host that changed the world asks for the sky again by writing the part again:

```js
world.scene.sky = {
  skyLight: { realTimeCapture: false, sourceType: 'capturedScene', cubemapResolution: 128 },
}
```

Its quality settings: `skyLightCaptureSupersample` (1, from 1 to 8) draws the faces larger and
averages them down, `skyLightCaptureLodDistanceScale` (1) asks more detail of the scene in the faces.
The faces trace no reflection of the scene. The model:
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

A sky light whose source is a specified cubemap (`realTimeCapture: false`, `sourceType: 'specifiedCubemap'`)
lights the scene with a picture the part holds as data: `cubemap`, `{ size, texels }` — `size` texels
across one face, from 1 to 1024, and `texels` the six faces in the order +x, −x, +y, −y, +z, −z of a cube
texture looked up by the scene's own direction (+y up), each row by row from its top-left corner, three
linear numbers ≥ 0 a texel (`6 · size² · 3` numbers; a typed array or an array). The data is not copied:
it must not be written after it is set. A host that moves between two pictures (two times of the day)
adds `cubemapBlend`, `{ destination: { size, texels }, fraction }`: the light reads the source mixed with
the destination by `fraction`, 0 the source alone, 1 the destination alone, a value beyond held to them;
write the part again to move the fraction. Saved worlds keep both (a typed array is saved as an array of
its numbers). A malformed field is refused with `TypeError` naming it (`skyLight: cubemap.texels expects
72 numbers, six faces of 2² texels`).

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

Nothing is clamped: where the brightest texel of a picture passes what a half float holds (65504), the
engine writes the whole picture times the scale that brings that texel to 65504 and gives the light the
inverse, so a sun texel of 1e6 lights the scene as 1e6, on any device; the two cubes of a blend share one
scale, the brighter one's, so that the mix is of two lights in one unit. A cube of a large side is written
face by face over several images from one buffer, and is the light's once its six faces are written. The
part's data is the one source of the cube: the engine has no second entry for a texture the host makes.

The air holds two lights, a sun and a second one: a moon, or a second sun. Every directional light
has an `atmosphereSunIndex`, `0` by default (`1` for the second light); of the lights that may light
the air (`atmosphereSun` not `false`) the brightest of each index is held, as the sun is: a light
added takes the place of its index only if brighter, the light removed gives it to the brightest of
the others of its index, the first added of equals, and a light moved to the other index is removed
and added again. The sky, the haze over the distance, the sun disks and the sky light all take both
lights. Index 1 held with none of index 0 is not moved to index 0: the second light shines alone.
Any index other than 0 or 1 is refused (`INVALID_SCENE_LIGHT`). `SceneLight.atmosphereSunIndex`
carries the same value in a declared light (directional lights only).

```js
world.scene.sky = { atmosphere: true, sun: false } // the scene's own lights are the air's
world.scene.add(light.directional({ intensity: 10, position: [-50, 70, 0] })) // the sun, index 0
const moon = light.directional({ intensity: 0.3, position: [60, 40, 20], atmosphereSunIndex: 1 })
world.scene.add(moon) // the second light of the air: its own sky, haze, disk and tint on what it lights
moon.atmosphereSunIndex = 0 // a write reaches the world at once; 0 is the default
```

A light's colour can follow a temperature: with `useTemperature` on, its colour is multiplied by
that of a black body at `temperatureKelvin` (6500 by default, white; read between 1000 and 15000),
and the sun, the sky and the fog take that colour. Three options say more of how a directional light
meets the air: `sunDiskTint` (white, a linear colour) multiplies the sun's disk in the sky and never
the light it gives; `shadowsAir` (off) lets the light's shadow shade the air — the haze and the sky's
march read its shadow map along their rays, so that a mountain's shadow reaches into the haze, as
`atmosphereSampleLightShadowMap` (on) allows; `transmittancePerPixel` (off) reads the air's
transmittance toward the light for each surface point and not once at the ground, so that a low sun
reddens a valley and not the summit above it. A saved world keeps each of them.

A light draws light shafts through nine fields, each written to its record and to a saved world
only when it differs from its default. `shaftOcclusion` (off) lets the light darken the fog's
inscattering where the scene hides it: `shaftOcclusionDarkness` (0.05) is what a full occlusion
maps to, 1 darkening nothing, and everything nearer the eye than `shaftOcclusionDepthRange` (1000
metres) occludes; `shaftOverrideDirection` (`[0, 0, 0]`, a vector) names, when it is not zero, the
direction the shafts come from instead of the light's own. These four belong to a directional light
alone. `shaftBloom` (off) adds a bloom around any light: `shaftBloomScale` (0.2) is the factor on
the colour it adds, `shaftBloomThreshold` (0) the brightness the image must pass after exposure to
bloom, `shaftBloomMaxBrightness` (100) the brightness above which it is brought down, and
`shaftBloomTint` (white, a linear colour) the factor on its colour. A vector is changed in place with
`set`, as `sunDiskTint` is.

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

The air's samples are scaled by `sampleCountScale` (1, from 0.25): the caps its quality settings
give the marches (below) are no more than 32 times it, and the haze volume's samples a slice no more
than twice it. The air's quality is the sky's quality settings of `world.skyQuality` — `atmosphereOn`
(on), the samples of a march through the air (`atmosphereSamplesMin`, `atmosphereSamplesMax`,
`atmosphereDistanceToMaxSamplesKm`), of the sky table (`skyTableSamplesMin`, `skyTableSamplesMax`,
`skyTableDistanceToMaxSamplesKm`) and of a slice of the haze volume (`aerialSamplesPerSlice`), the
sizes of the tables (`transmittanceWidth`, `transmittanceHeight`, `multiScatterWidth`,
`multiScatterHeight`, `skyTableWidth`, `skyTableHeight`) and of the haze volume (`aerialWidth`,
`aerialDepthSlices`, `aerialDepthKm`), the samples that build the transmittance and the
multiple-scattering tables (`transmittanceSamples`, `multiScatterSamples`), and the switches
`skyTableFast` (the sky read from its table, else every sky pixel marched), `aerialFastOnOpaque` (on; off, a pass over the lit image marches the haze of each opaque pixel from the eye to its depth, jittered by the blue noise and shaded by the shadow maps and the clouds, the translucent surfaces reading the volume either way), `aerialDepthTest`,
`transmittanceTable`, `transmittanceSmallFormat` (the table in four 8-bit channels),
`distantSkyLightTable` and `distantSkyLightAltitudeKm` (the fog's sky, made every image),
`multiScatterHighQuality` (8 directions over the sphere), `skyTablesFullPrecision` (the haze
volume in 32-bit floats) and `atmosphereSampleLightShadowMap` —, whose defaults are the reference's
fourth level (`max`) and which the `smooth`, `balanced` and `fine` presets set to its lower three and the
`cinematic` preset to its fifth:

```js
world.quality.preset = 'fine' // the effects' level 2: 2 samples a slice, 64 samples at most
world.skyQuality = { skyTableFast: false, atmosphereSamplesMax: 256 } // every sky pixel marched
world.scene.sky = { atmosphere: { sampleCountScale: 2 } } // twice the samples, within those caps
world.skyQuality = { skyTableFast: null } // given back to the preset
```

The `cinematic` preset is the fifth level of the effects group (`smooth`, `balanced`, `fine` and `max` are
its levels 0 to 3): it marches every sky pixel and the haze on the opaque surfaces instead of reading their
tables, and writes these values (`SKY_PRESET_LEVELS.effects.cinematic`):

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

**Ranges.** `planetRadius`, `height`, `rayleighScaleHeight` and `mieScaleHeight` are above 0 (a `height`
under 0.1 km is read as 0.1 km, the thinnest air), `mieAnisotropy` is between −1 and 1 (the bounds
themselves are refused: at ±1 the phase function's denominator is 0 straight along the ray, so the open
range is kept), `aerialPerspectiveStartDepth` is 0 or more, `multiScatteringFactor` is from 0 to 100 and
`minSunElevation` from −90° to 90°. A value outside refuses with the range in its message; a world saved
with an anisotropy of −0.3 or a radius of 12000 km loads and draws.

**The planet's place.** The planet is a sphere under the plane `y = groundHeight`, its top at
`groundPosition`; a planet that is to have its _centre_ at a place is given that place with a
`groundHeight` its radius (in metres) over it. The three ways to place a planet (its top at the world's
origin, its top at a place, its centre at a place) are this one setting.

**The view from above the air.** An eye above the air (higher than `planetRadius + height`) is not
brought down into it: the air is seen from outside, the planet's limb with its blue edge, the sun's disk
through the air at the limb, the haze and the clouds along a ray from where it enters the air; a ray that
never enters it sees black. An eye under the ground is held five metres over it. Under an orthographic
camera the sky, the haze and the clouds are drawn as well, each pixel's ray starting at the pixel's own
point ([the air under an orthographic camera](../../engine/atmosphere-and-sky-light.md#atmosphere-and-sky-light)).

A field out of range is refused
(`INVALID_SCENE_ENVIRONMENT`); to change a field, write `scene.sky` again.
`SceneEnvironment.atmosphere` carries the same fields. The model:
[atmosphere and sky light](../../engine/atmosphere-and-sky-light.md#atmosphere-and-sky-light).
