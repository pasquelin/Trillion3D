# Declared lights

Lights are added, changed and removed like any object. Each is a `SceneLight` (version 4):

- `point` and `spot` carry `position` and `range` in metres; `spot` also `direction`, an
  `outerConeAngle` and an `innerConeAngle` (half-angles in radians);
- `rect` carries `position`, `range`, face-normal `direction`, width axis `right` and `size` (width,
  height; a side under 1 cm lights and casts as 1 cm, the declared value kept);
- `directional` carries only `direction` (of propagation); `position`, `range` or cone angle is
  refused.

All kinds carry linear `color`, `intensity` and `castsShadow`. Only a `directional` may add
`shadowDistance`
([A sun's shadow distance](a-suns-shadow-distance-and-its-far-casters.md#a-suns-shadow-distance-and-its-far-casters)),
`atmosphereSunIndex` ([Atmosphere part](atmosphere-part.md#atmosphere-part)) and
`forwardShadingPriority` (below); other kinds refuse them.

**Intensity and its unit.** A `directional` light's `intensity` is in lux, `10` when unnamed. A
`point`, `spot` and `rect` write theirs in `intensityUnits` (node form too; refused on a
`directional`), default `'unitless'`:

| `intensityUnits` | What the number is | The light it gives |
| - | - | - |
| `'candelas'` | Luminous intensity. | The number, in candelas. |
| `'lumens'` | Luminous flux. | Spread over the solid angle it fills: point sphere (4π), spot cone (2π (1 − cos outer cone)), rect cosine lobe (π). |
| `'nits'` | Luminance. | Times source area: point/spot sphere or capsule, 4π r (r + length / 2) of `emitterRadius` and `emitterLength` (none without a radius); rect face. |
| `'ev'` | Exposure value at ISO 100, any finite number. | 2 to that power, in candelas. |
| `'unitless'` | Default scale. | 16 candelas per 10 000. |

A lamp naming no `intensity` is `5000` unitless, in its unit: 8 candelas, 8 × 4π ≈ 100.5 lumens for a
point (8 × π ≈ 25.1 for a rect), EV `3`, and 8 candelas over the source's area in nits. A `rect`
lights by the radiance of its candelas over half its face's area; the node form's rectangle is 64 cm
a side by default. A point or spot off the inverse square (`inverseSquared: false`) takes `intensity`
as a brightness in no unit: at least 0 in any unit, default `8` in EV or nits. Elsewhere intensity is
at least 0, any number in EV. A point or spot in nits under the inverse square needs an
`emitterRadius`, else it is refused (`INVALID_SCENE_LIGHT`). The node form (`light.point(…)`,
`light.spot(…)`, `light.rectArea(…)`, `light.directional(…)`) has the same defaults; an ambient,
hemisphere or probe light's `intensity` is `1`. A version-2 rect's intensity was its radiance: `L`
is `L / 2` nits, how a pre-version-4 scene is read (no radiance: refused, `UNSUPPORTED_SCENE_FORMAT`).
A lamp saved before version 5 naming no unit was in candelas and is read as such.

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

Two options of every light for the volumetric fog and the clouds, never changing the light on
surfaces:

- `fogScattering` (`1`, `0` or more): factor on its colour in the fog volume and the clouds' local
  lights; `0` leaves it out of both.
- `shadowsFog` (`true` for `directional`, `false` otherwise): a light that casts a shadow shadows
  the fog too.

The sky light's factor is its part's `volumetricScatteringIntensity` (`1`): factor on the sky the
fog scatters. A saved world keeps a `shadowsFog` set against its kind's default.

```js
const lamp = light.point({ intensity: 20, position: [0, 3, 0], distance: 12, castShadow: true })
lamp.fogScattering = 0.5 // half of it in the fog and the clouds; 0 leaves it out of both
lamp.shadowsFog = true // its shadow map also shadows the fog volume (a sun's does by default)
world.scene.sky = { skyLight: { volumetricScatteringIntensity: 0 } } // the fog scatters none of the sky light
```

Declared form: `world.addLight({ id: 'lamp', kind: 'point', ..., fogScattering: 0.5,
shadowsFog: true })`; a negative `fogScattering` or non-boolean `shadowsFog` is refused
(`INVALID_SCENE_LIGHT`). A `rect` takes `shadowsFog` and refuses `emitterRadius`, `emitterLength`,
`emitterSoftRadius` and `emitterAxis` (`INVALID_SCENE_LIGHT`).

A directional light takes `softAngle` (degrees, 0 up to but excluding 180; default 0): widens the sun's
highlight on a glossy surface without lighting more, as `emitterSoftRadius` does for a point or spot.
A point, spot or rect refuses it (`INVALID_SCENE_LIGHT`).

```js
const sun = light.directional({ intensity: 6, softAngle: 2 }) // a broader highlight on polished surfaces
```

A point or spot takes a light profile (an IES file the compiler turned into a profile; an imported
lamp that names one has it already):

- `iesProfile`: the profile's id.
- `useIesBrightness` (`false`): intensity becomes the profile's brightness (greatest candela,
  `iesBrightness`, finite above 0, written by the compiler, only beside `iesProfile`) times
  `iesBrightnessScale` (`1`, from 0), in the light's unit; a light with no `iesBrightness` keeps
  its `intensity`.

The light's colour is multiplied per direction by the profile's share of its greatest candela. The
profile is read in the light's frame: vertical axis is `direction`, 0 degree vertical angle (nadir)
straight ahead along the shine, horizontal angles round that axis from `emitterAxis` (the light's up,
also its tube's axis with an `emitterLength`). A profiled light needs both `direction` and
`emitterAxis`, not parallel (`INVALID_SCENE_LIGHT`); a sun or rect refuses the profile fields.
Profiles live in one atlas (`world.lightProfile`) of at most `lightProfileAtlasMaxProfiles` (32); a
light whose profile is not among them or not loaded lights as a lamp with none. A scene with no
profiled light compiles no profile code and binds no atlas. Translucent surfaces do not read the
profile.

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

`world.lightProfile` holds the atlas settings, each also a `createWorld` option, with the
reference's default: `lightProfileAtlasResolution` (`256`, 16 to 4096: texels a side of a slice; other
profile sides are bilinearly resampled) and `lightProfileAtlasMaxProfiles` (`32`, 1 to 32). The
atlas has one slice per distinct profile up to that most; it is remade, every profile rewritten, when
more are asked or a setting moves, and released when no light names a profile. An agent sets them
through `trillion3d_set_light_profile`.

```js
world.lightProfile = { lightProfileAtlasResolution: 128 } // lighter slices, a softer profile
world.lightProfile = { lightProfileAtlasMaxProfiles: 8 } // at most 8 profiles; a ninth lights as a lamp with none
```

Two switches, off by default: `lightProfileAtlasForceUpdate` rewrites every profile every image;
`lightProfileAtlasDebug` draws the atlas over the image (also diagnostic view `light-profile-atlas`):
slices as a grid at top left (profile slices show values in red with a green border, free slices a
grey one) and above it the figures as text (resolution, slices used of made, occupancy, profiles held,
over-budget count, force-update switch, format).

```js
world.lightProfile = { lightProfileAtlasDebug: true } // the atlas and its figures over the image
world.lightProfile = { lightProfileAtlasForceUpdate: true } // every profile written again at every image
```
