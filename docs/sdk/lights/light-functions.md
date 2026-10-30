# Light functions

A light wears a light function: a material giving a factor on its colour at each point reached.
Made as `material.lightFunction`; colour is `emissive` times `emissiveIntensity`, times `emissiveMap`
read at the light's projection coordinate across its tile (0 to 1), with the map's own wrap,
filters, repeat, offset, rotation. Default white. No world position or depth; drawn once into one
atlas read by lighting, volumetric fog and translucent layers. The map joins the colour atlas, within
the texture budget. Another member's material: `TypeError`; a mesh refuses it (`INVALID_MATERIAL`). A
[material graph](../material-graph.md#material-graph) wired to `emissive` replaces the parameters.

```js
import { material, light, Texture } from 'trillion3d'

const window = material.lightFunction({ emissiveMap: new Texture(frameImage) }) // a window's panes
const lamp = light.spot({ intensity: 60, position: [0, 4, 0], distance: 20, outerConeAngle: 0.6 })
lamp.lightFunction = window // the light now shines through it
lamp.lightFunctionScale.set(4, 4, 4) // metres a tile: up, right, along the light (10.24 each by default)
lamp.lightFunctionFadeDistance = 200 // metres from the eye past which it fades (1000 by default)
lamp.lightFunctionDisabledBrightness = 0.5 // what the light is where it is faded out (0.5 by default)
window.emissive = 0xffcc66 // a warm tint, written to every light that wears it
sun.lightFunction = window // a sun projects it along its direction
rectLamp.lightFunctionConeAngle = 30 // a rectangle: through a cone of 30 degrees (0, flat, by default)
```

Projection: spot maps its cone to the tile; point by longitude/latitude; rectangle by its face plane,
or `lightFunctionConeAngle` (≤ 89 degrees) like a spot; sun by its axes, tile repeating every
`lightFunctionScale`. Fades to `lightFunctionDisabledBrightness` over the last fifth of
`lightFunctionFadeDistance`. Declared: `world.addLight({ id, kind, ..., lightFunction: id,
lightFunctionScale: [4, 4, 4] })`; scale of three numbers > 0, fade distance > 0, brightness ≥ 0,
`rect` cone angle ≥ 0; any beside no `lightFunction` is `INVALID_SCENE_LIGHT`.

`world.lightFunction` atlas settings (also `createWorld` options; reference defaults):

- `lightFunctionAtlas` (`true`): whole system.
- `lightFunctionSlotResolution` (128 texels a side, ≥ 32).
- `lightFunctionAtlasSize` (4 slots a side, 2 to 16; a light whose material has no slot has none).
- `lightFunctionMaxLights` (`-1`, no limit): nearest to the eye kept, suns first.
- `lightFunctionFormat` (`'grey'`, the colour's mean; or `'colour'`).
- `lightFunctionDeferred` (`true`): opaque lighting and translucency volume injection.
- `lightFunctionFog` (`true`): fog lights; a sun function absent from the atlas is drawn into a fog
  texture.
- `lightFunctionFogSupersample` (`2`, > 0): that texture's side over the volume's cells along the
  sun's most-facing axis, cut to a multiple of 32.
- `lightFunctionBounce` (`true`): probes' rays and screen probes' scene traces.
- `lightFunctionTranslucent` (`false`): translucent layers.

```js
world.lightFunction = { lightFunctionAtlasSize: 8, lightFunctionSlotResolution: 256 } // 64 sharper slots
world.lightFunction = { lightFunctionTranslucent: true, lightFunctionFormat: 'colour' } // glass, coloured
world.lightFunction = { lightFunctionFog: false } // the fog's lamps shine plain; its sun keeps its function, from its own texture
world.lightFunction = { lightFunctionFogSupersample: 4 } // a finer texture of the sun's function in the fog
world.lightFunction = { lightFunctionBounce: false } // the bounce lights its surfaces with plain lamps
```

The bounce reads the function at the hit surface: a dimming function gives less light, a fully dimming
one casts no shadow ray. A moving (`time`) or changed function re-traces the probes each image.
