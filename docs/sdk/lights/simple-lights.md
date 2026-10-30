# Simple lights

A simple light is host-supplied per image, not held by the scene (particles, effects): a point light
with no shadow, light function, profile or source size, in all channels. It lights opaque and
see-through surfaces, the volumetric fog and, with `affectsTranslucency`, the translucency lighting
volume; no shadow map, bounce or ray traced pass.

`world.setSimpleLights(entries)` replaces the list; entry:

- `position`, `radius`: metres.
- `color`: linear RGB times strength; at inverse square 1 = 1e-4 candela.
- `exponent` (`0`): inverse square windowed by radius; above 0, (1 - d²/radius²) to that power.
- `inverseExposureBlend` (`0`, 0 to 1); `volumetricScatteringIntensity` (`0`); `specularScale`,
  `diffuseScale` (`1`, unbounded).
- `affectsTranslucency` (`false`); `allowSampledLighting` (`false`, see below).
- `sampledCastsShadow` (`false`): sampled lighting traces a shadow ray against scene geometry.
- `lightId` (`{ localId, sourcePrimitiveId }`, whole numbers, absent by default): sampled-lighting
  history identity; none = no history; unique per list.

Radius and colour both nothing: dropped. An equal list changes nothing; a list changing every image
invalidates no cache, shadow map or reflection capture.

`world.simpleLight` (also `createWorld` options), reference defaults:

- `allowSimpleLights` (`true`); `hairSimpleLights` (`true`): lights hair.
- `sampledSimpleLights` (`1`): in sampled views, `0` none, `1` entries with `allowSampledLighting`,
  `2` all go sampled; the rest use the classic local pass.

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
