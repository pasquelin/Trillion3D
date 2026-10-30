# Light functions

A light can wear a light function: a material that gives, at each point the light reaches, a factor
on its colour, to cast the shape of a window, a leaf canopy or a moving cloud. It is a material of
the engine's one material system, made as `material.lightFunction`; the colour it gives is its
emission: `emissive` times `emissiveIntensity`, times `emissiveMap` read at the coordinate of the
light's projection across its tile (0 to 1), with the map's own wrap, filters, repeat, offset and
rotation. White, no effect, by default. It has no world position and no depth: it is drawn once,
whatever the lights that wear it, into one atlas the lighting, the volumetric fog and the
translucent layers read. The map joins the materials' colour atlas, within the texture budget, and
the slot is drawn again until the map is read at the detail the slot shows. A material made by
another member is refused (`TypeError`), and a mesh refuses a light function material (`INVALID_MATERIAL`). A [material graph](../material-graph.md#material-graph) wired to its `emissive` output replaces the parameters.

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

How a light projects it: a spot maps its cone to the tile (the edge of the cone is the edge of the
tile at any distance); a point light maps the tile around itself by longitude and latitude; a
rectangle by its face's plane, or through `lightFunctionConeAngle` (at most 89 degrees) like a spot;
a sun by its axes, the tile repeating every `lightFunctionScale`. The function fades to
`lightFunctionDisabledBrightness` over the last fifth of `lightFunctionFadeDistance` from the eye.
The declared form is `world.addLight({ id, kind, ..., lightFunction: id,
lightFunctionScale: [4, 4, 4] })`; a scale of three numbers above 0, a fade distance above 0, a
brightness of 0 or more and, for a `rect`, a cone angle of 0 or more are checked, and any of these
beside no `lightFunction` is refused (`INVALID_SCENE_LIGHT`).

`world.lightFunction` holds the settings of the atlas, each an option of `createWorld` too, with
the reference's default: `lightFunctionAtlas` (`true`, the whole system), `lightFunctionSlotResolution`
(128 texels a side of a slot, at least 32), `lightFunctionAtlasSize` (4 slots a side, from 2 to 16:
16 materials at the default; a light whose material has no slot left has none),
`lightFunctionMaxLights` (`-1`, no limit: the most lights that read the atlas, the nearest to the
eye, suns first, kept), `lightFunctionFormat` (`'grey'`, the mean of the colour; or `'colour'`), and
which passes read the atlas: `lightFunctionDeferred` (`true`, the lighting of the opaque image and
the translucency volume's injection), `lightFunctionFog` (`true`, the volumetric fog's lights read the atlas; where the atlas does not hold the sun's function, the sun's is drawn into a texture of the fog's own), `lightFunctionFogSupersample` (`2`, above 0: that texture's side over the volume's cells along the axis the sun faces most, cut to a multiple of 32),
`lightFunctionBounce` (`true`, the lights of the bounce: the probes' rays and the screen probes' scene
traces) and `lightFunctionTranslucent` (`false`, the translucent layers).

```js
world.lightFunction = { lightFunctionAtlasSize: 8, lightFunctionSlotResolution: 256 } // 64 sharper slots
world.lightFunction = { lightFunctionTranslucent: true, lightFunctionFormat: 'colour' } // glass, coloured
world.lightFunction = { lightFunctionFog: false } // the fog's lamps shine plain; its sun keeps its function, from its own texture
world.lightFunction = { lightFunctionFogSupersample: 4 } // a finer texture of the sun's function in the fog
world.lightFunction = { lightFunctionBounce: false } // the bounce lights its surfaces with plain lamps
```

The bounce reads the function at the surface a probe's ray hits: a lamp whose function dims that point
gives it less light, and one that dims it wholly casts no shadow ray there. A function that moves (a
material that reads `time`) or changes makes the probes trace again, at each image it does.
