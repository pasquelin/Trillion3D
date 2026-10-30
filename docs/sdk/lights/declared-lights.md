# Declared lights

Lights are added, changed and removed like any object. Each is a `SceneLight` (version 4): `point`
and `spot` carry `position` and `range` in metres, `spot` also `direction`, an `outerConeAngle` and an
`innerConeAngle`, half-angles in radians; `rect` carries `position`, `range`, the `direction` of its face's normal, its width axis
`right` and its `size` (width, height; a side under 1 cm lights and casts as one of 1 cm, the light
keeping what you declared); `directional` only `direction` (of propagation), refused with a
`position`, `range` or a cone angle. All carry linear `color`, an `intensity` and
`castsShadow`, a rectangle too. A `directional` may
also carry `shadowDistance` ([A sun's shadow distance](a-suns-shadow-distance-and-its-far-casters.md#a-suns-shadow-distance-and-its-far-casters))
`atmosphereSunIndex` ([Atmosphere part](atmosphere-part.md#atmosphere-part)) and `forwardShadingPriority` (below), refused
on any other kind.

**Intensity and its unit.** A `directional` light's `intensity` is in lux, `10` when it names none.
A `point`, a `spot` and a `rect` write theirs in `intensityUnits` (the node form's `intensityUnits`,
refused on a `directional`), one of five, `'unitless'` by default:

| `intensityUnits` | What the number is                               | The light it gives                                                                                                                                                     |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'candelas'`     | A luminous intensity.                            | The number, in candelas.                                                                                                                                               |
| `'lumens'`       | A luminous flux.                                 | Spread over the solid angle it fills: a point's sphere (4π), a spot's cone (2π (1 − cos of its outer cone)), a rect's cosine lobe (π).                                 |
| `'nits'`         | A luminance.                                     | Times the source's area: a point or spot's sphere or capsule, 4π r (r + length / 2) of its `emitterRadius` and `emitterLength` (none without a radius); a rect's face. |
| `'ev'`           | An exposure value at ISO 100, any finite number. | 2 to that power, in candelas (a luminance over an implicit square metre).                                                                                              |
| `'unitless'`     | The default scale.                               | 16 candelas for every 10 000.                                                                                                                                          |

A lamp that names no `intensity` is the light a new one is placed with, `5000` unitless, written in
its unit: 8 candelas, 8 × 4π ≈ 100.5 lumens for a point (8 × π ≈ 25.1 for a rect), an EV of
`3` (log2 8) and 8 candelas over the source's area in nits. A `rect` lights by the radiance of its
candelas over half its face's area; the node form's rectangle is 64 cm a side by default. A point or
a spot taken off the inverse square (`inverseSquared: false`) takes its `intensity` as it is, a
brightness in no unit: there it is at least 0 in any unit, and a default in EV or nits is `8`.
Elsewhere the intensity is at least 0, but any number in EV. A point or spot in nits under the inverse
square needs an `emitterRadius`: with no source it would give no light, and is refused
(`INVALID_SCENE_LIGHT`). The node form (`light.point(…)`, `light.spot(…)`, `light.rectArea(…)`,
`light.directional(…)`) has the same defaults; an ambient, hemisphere or probe light's `intensity`
is `1`. A version-2 rect's intensity was its radiance: a radiance `L` is `L / 2` nits, which a saved
scene of before version 4 is read as (one with no radiance is refused, `UNSUPPORTED_SCENE_FORMAT`).
A lamp saved before version 5 that named no unit was in candelas, and is read as such.

```js
light.point({ position: [0, 3, 0] }) // 5000 unitless, 8 candelas
light.spot({ intensity: 800, intensityUnits: 'lumens', position: [0, 3, 0] }) // 800 lumens through its cone
world.addLight({
  id: 'sun',
  kind: 'directional',
  color: [1, 1, 1],
  direction: [0, -1, 0],
  castsShadow: true,
}) // 10 lux
```

Two options of every light say how the volumetric fog and the clouds take it, over the light on
surfaces, which they never change: `fogScattering` (default `1`, `0` or more) is the factor on its
colour in the fog volume and in the clouds' local lights, and a light of `0` is left out of both;
`shadowsFog` (default `true` for a `directional` light, `false` for any other) lets a light that
casts a shadow shadow the fog too. The sky light has the same factor, its part's `volumetricScatteringIntensity`
(`1` by default): the factor on the sky the fog scatters. A saved world
keeps a `shadowsFog` set against its kind's default; `fogScattering` is among the light's numbers.

```js
const lamp = light.point({ intensity: 20, position: [0, 3, 0], distance: 12, castShadow: true })
lamp.fogScattering = 0.5 // half of it in the fog and the clouds; 0 leaves it out of both
lamp.shadowsFog = true // its shadow map also shadows the fog volume (a sun's does by default)
world.scene.sky = { skyLight: { volumetricScatteringIntensity: 0 } } // the fog scatters none of the sky light
```

The same in the declared form: `world.addLight({ id: 'lamp', kind: 'point', ..., fogScattering: 0.5,
shadowsFog: true })`; a negative `fogScattering` or a `shadowsFog` that is not a boolean is refused
(`INVALID_SCENE_LIGHT`). A `rect` takes `shadowsFog` as a point does, and refuses `emitterRadius`,
`emitterLength`, `emitterSoftRadius` and `emitterAxis` (`INVALID_SCENE_LIGHT`): they describe the source
of a point or a spot, a rectangle's source is its `size`.

A directional light takes `softAngle` (degrees, from 0 up to, not including, 180; default 0), the soft angle of its disk: it widens the
highlight the sun leaves on a glossy surface without lighting more of the surface, as `emitterSoftRadius` does for a point or a
spot. A point, a spot or a rect refuses it (`INVALID_SCENE_LIGHT`).

```js
const sun = light.directional({ intensity: 6, softAngle: 2 }) // a broader highlight on polished surfaces
```

A point or a spot takes a light profile, the shape of the light a lamp gives as a photometric file measured it (an IES file the
compiler turned into a profile, a lamp of an imported scene that names one has it already): `iesProfile` is the profile's id,
`useIesBrightness` (default `false`) makes the light's intensity the profile's brightness (its greatest candela, `iesBrightness`:
a finite number above 0 that the compiler writes with the profile, and only beside `iesProfile`) times
`iesBrightnessScale` (default `1`, from 0) in place of `intensity`, written in the light's unit; a light that carries no
`iesBrightness` keeps its `intensity`. The colour of the light is
multiplied, for each direction it leaves in, by the profile's share of its greatest candela there, so a profiled light lights nothing
a profile says it does not. The profile is read in the light's own frame: its vertical axis is the `direction` of the light, its 0
degree vertical angle (the nadir) straight ahead along the way the light shines, and its horizontal angles run round that axis, laid out from
`emitterAxis`, the light's own up, which is also the axis of its tube where it has an `emitterLength`. A light that names a profile
therefore needs both a `direction` and an `emitterAxis`, and the axis may not be parallel to the direction
(`INVALID_SCENE_LIGHT`); a sun or a rect refuses the profile's fields. The profiles are held in one atlas (`world.lightProfile`, below)
of at most `lightProfileAtlasMaxProfiles` (32) of them at once; a light whose profile is not among them, or not loaded yet, lights as a
lamp with none. A scene with no profiled light compiles no profile code and binds no
atlas. The translucent surfaces do not read the profile: they are lit as by a lamp with none.

```js
world.addLight({
  id: 'downlight',
  kind: 'spot',
  position: [0, 3, 0],
  direction: [0, -1, 0],
  emitterAxis: [1, 0, 0], // the light's own up: the profile's horizontal angles are laid round the direction from it
  iesProfile: 'downlight.ies', // a profile the compiler wrote from the file
  useIesBrightness: true, // the intensity is the profile's greatest candela...
  iesBrightnessScale: 0.5, // ...times 0.5
})
```

`world.lightProfile` holds the settings of the profiles' atlas, each an option of `createWorld` too, with the reference's default:
`lightProfileAtlasResolution` (`256`, from 16 to 4096: the texels a side of a slice; a profile of another side is resampled to it, bilinear,
when it is written) and `lightProfileAtlasMaxProfiles` (`32`, from 1 to 32: the most profiles the atlas holds). The atlas is made with
the slices the lights ask (one per distinct profile, up to that most) and no more, made again, with every profile written into it
again, when more are asked than it was made with or a setting moves, and handed back when no light names a profile any more. An
agent sets them through `trillion3d_set_light_profile`.

```js
world.lightProfile = { lightProfileAtlasResolution: 128 } // lighter slices, a softer profile
world.lightProfile = { lightProfileAtlasMaxProfiles: 8 } // at most 8 profiles; a ninth lights as a lamp with none
```

Two more switches, both off by default: `lightProfileAtlasForceUpdate` writes every profile into the atlas again at every image, and
`lightProfileAtlasDebug` draws the atlas over the image (also the diagnostic view `light-profile-atlas`): its slices as a grid at the top left,
each slice a profile is in showing the profile (its values in red) with a green border and each free slice with a grey one, and above it the
figures as text (resolution, slices used out of the slices made, occupancy, profiles held, the over-budget count when more profiles are held
than slices, the force-update switch, the format).

```js
world.lightProfile = { lightProfileAtlasDebug: true } // the atlas and its figures over the image
world.lightProfile = { lightProfileAtlasForceUpdate: true } // every profile written again at every image
```
