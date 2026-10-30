# Simple lights

A simple light is one the host hands to an image and the scene does not hold: a particle's, an effect's. It is
a point light with no shadow, light function, profile or source size, in every lighting channel. It lights the
opaque and see-through surfaces, the volumetric fog (by `volumetricScatteringIntensity`) and, where
`affectsTranslucency` is on, the translucency lighting volume; it feeds no shadow map, indirect bounce or ray
traced pass, and the list changes at every image without staling any cache of the scene's lights. A scene that
holds only simple lights is lit, not shown unlit.

`world.setSimpleLights(entries)` replaces the list until another is given. Each entry:

- `position`, `radius`: metres.
- `color`: linear RGB times the strength; under the inverse square a colour of 1 is 1e-4 candela (the scale the
  reference writes particle lights in, distances in centimetres).
- `exponent` (`0`): the inverse square windowed by the radius; above 0, one less the squared distance over the
  squared radius to that power.
- `inverseExposureBlend` (`0`, 0 to 1); `volumetricScatteringIntensity` (`0`); `specularScale` and
  `diffuseScale` (`1`, not bounded above).
- `affectsTranslucency` (`false`): the light is injected into the translucency lighting volume, on the classic
  and the sampled paths alike.
- `allowSampledLighting` (`false`): see `sampledSimpleLights` below.
- `sampledCastsShadow` (`false`): where the sampled lighting takes the light, it traces a shadow ray for it
  against the scene's geometry; the light holds no shadow map.
- `lightId` (`{ localId, sourcePrimitiveId }`, two whole numbers of at least 0, absent by default): the identity
  the sampled lighting follows the light by across images, through changes of order and count, to read the
  history of the same light; a light with none has no history. Two lights of a list may not share one; each
  view follows the lights by it on its own.

An entry whose radius and colour are both nothing is left out. A list equal to the one held changes nothing: the
images held stay. A list that changes at every image draws the next image again and nothing else: no cache of
the scene's lights, shadow map or reflection capture is invalidated, and only the simple lights' slots go to the
GPU.

`world.simpleLight` holds the settings, each also an option of `createWorld`, with the reference's default:

- `allowSimpleLights` (`true`): off, an image lights nothing by them.
- `hairSimpleLights` (`true`): the hair strands are lit by them.
- `sampledSimpleLights` (`1`): where a view lights with the sampled lighting, `0` leaves every simple light to
  the classic pass, `1` hands it the ones whose entry sets `allowSampledLighting` (none unless an entry does),
  `2` hands it all; a simple light the sampled lighting does not take is lit by the classic local lights' pass.

```js
world.setSimpleLights(
  sparks.map((p, i) => ({
    position: p.position,
    radius: 2,
    color: [4, 2, 0.5],
    exponent: 0,
    affectsTranslucency: true,
    allowSampledLighting: true, // the sampled lighting takes it (with the default sampledSimpleLights 1)
    sampledCastsShadow: true, // and traces a shadow ray for it
    lightId: { localId: i, sourcePrimitiveId: emitter }, // its history follows it as the list reorders
  })),
)
world.simpleLight = { hairSimpleLights: false } // the strands ignore them
world.simpleLight = { allowSimpleLights: false } // none are lit
world.simpleLight = { sampledSimpleLights: 2 } // the sampled lighting takes every simple light
```
