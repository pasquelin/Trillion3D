# Rectangle lights' pictures

A `rect` light may name a picture mapped on its face, which its colour is multiplied by wherever it lights (a
window, a screen, a gobo):

- `sourceTexture`: the id the picture was registered under.
- `sourceTextureScale` (`[1, 1]`, each above 0 to 1): the share of the picture shown.
- `sourceTextureOffset` (`[0, 0]`, each 0 to 1): where the share starts.

Seen from the front of the light, the picture runs left to right along `right`, its top edge toward
`cross(direction, right)`. Any other kind refuses the three fields; a scale or offset without a
`sourceTexture` is refused (`INVALID_SCENE_LIGHT`). The host registers the picture (an `ImageBitmap` or any image
the engine can copy to a texture) with `world.setRectLightTexture(id, image)` (`null` forgets it; a light whose
picture is not registered lights as a plain rectangle) and says it changed in place with
`world.refreshRectLightTexture(id)`. All the lights' pictures live in one square atlas, a slot each (a picture
named by several lights with the same share is one slot), packed without overlap, freed slots reused first, with
a mip chain read by the solid angle the rectangle covers.

Who reads the picture:

- the diffuse light, the specular lobe (also under a clear coat, a cloth's fuzz or a subsurface profile), the thin
  surfaces' transmission, the surface cache's cards and the sampled lighting;
- the volumetric fog, while `volumetricFogRectLightTexture` (`false` by default, a volumetric fog setting,
  `world.volumetricFog…`) is on: each cell reads the picture along the mean direction of the rectangle's light (the
  direction of its form factor with no normal), at the level the solid angle it covers asks;
- the translucent surfaces' forward programs (the blends), where the device grants 17 sampled textures a shader
  stage, which the session asks of an adapter that offers them; on an adapter that stops at 16 they light the
  rectangle plain (declared fallback: the widest blend program, with display layers, already binds the sixteen
  guaranteed);
- not the translucency lighting volume, which lights the rectangle plain; the reflections' and the bounce's rays
  take the surface cache's light, which holds the picture.

`world.rectLightAtlas` holds the atlas settings, each also an option of `createWorld`, with the reference's
default:

- `rectLightAtlasMaxResolution` (`4096`, 64 to 16384): most texels a side; past it the pictures are packed a mip
  level smaller until they fit.
- `rectLightAtlasFilterQuality`: `0` a box of 2 by 2 texels, `1` a Gaussian approximation.
- `rectLightAtlasMaxTextureRatio` (`2`, 1 to 16): most a picture may be wider than high, or higher than wide,
  before its short side is stretched.
- `rectLightAtlasFormat`: `0` 11, 11 and 10 bits, faster, the hue may shift, kept as 16-bit floats on a device that
  cannot draw into it; `1` four 16-bit floats.
- `sampledLightsTexturedRectLights` (`true`).
- Switches, all off or 0: `rectLightAtlasForceUpdate`, `rectLightAtlasResetOnChange`, `rectLightAtlasClear`,
  `rectLightAtlasDebugClear` (magenta in a new atlas), `rectLightAtlasDebug` and `rectLightAtlasDebugMipLevel` (the
  debug view, below).

```js
world.setRectLightTexture('window', await createImageBitmap(blob))
world.addLight({
  id: 'window-light',
  kind: 'rect',
  position: [0, 2.5, 0],
  direction: [0, -1, 0],
  right: [1, 0, 0],
  size: [2, 1],
  range: 12,
  intensity: 8,
  sourceTexture: 'window', // the picture registered above
  sourceTextureScale: [0.5, 1], // the left half of it
  sourceTextureOffset: [0, 0],
})
world.rectLightAtlas = { rectLightAtlasMaxResolution: 2048, rectLightAtlasFilterQuality: 1 }
world.rectLightAtlas = { rectLightAtlasDebug: true } // draws the atlas over the image
world.volumetricFogRectLightTexture = true // the fog's cells tint a rectangle's light by its picture
```

`transmission` (default `false`) makes a light shine through the subsurface-profile surfaces it shadows (the light
that crosses the thickness behind the lit side: ears, fingers, wax). It acts only on a light that is `movable` and
casts a shadow: a stationary or static light has its shadow baked or held still, without the thickness it needs.
A saved world keeps a `transmission` that is on.

```js
const lamp = light.point({
  intensity: 20,
  position: [0, 3, 0],
  distance: 12,
  castShadow: true,
  mobility: 'movable',
})
lamp.transmission = true // the profile surfaces it shadows glow where its light goes through them
```

The same in the declared form: `world.addLight({ id: 'lamp', kind: 'point', ..., mobility: 'movable', castsShadow: true, transmission: true })`;
a `transmission` that is not a boolean is refused (`INVALID_SCENE_LIGHT`).

Every light has a `mobility`: `'static'` (baked into the lightmaps: neither moves nor changes, no dynamic shadow),
`'stationary'` (does not move; colour and intensity may change; **the default of every light kind**) or `'movable'`
(fully dynamic). Any other value is refused (`INVALID_SCENE_LIGHT`); a saved world keeps a non-default mobility.
The volumetric lightmap reads it to know which directional light's shadowing it holds (`mobilityOf(light)`,
`scene/light/fields.ts`).

```js
const lamp = light.point({ intensity: 20, position: [0, 3, 0], distance: 12 })
lamp.mobility = 'movable' // 'static' | 'stationary' (the default) | 'movable'
world.addLight({
  id: 'lamp2',
  kind: 'point',
  color: [1, 1, 1],
  intensity: 20,
  castsShadow: false,
  position: [0, 3, 0],
  range: 12,
  mobility: 'static',
})
```

A rectangle light casts a shadow like a point light: one cube of six faces centred on it, as far as its `range`. A
surface behind the rectangle's plane is outside its shadow region (one exactly in the plane is in front: the
rectangle lights it), and a surface turned away from it is not shadowed by it. Its penumbra is traced toward its
centre through a cone whose radius is half its width; `shadowRayCountLocal` and `shadowSamplesPerRayLocal` set its
rays and steps, as for any local light. The two forms below are the same panel, 2 m by 1 m, three metres up, facing
down, shadow as deep as 12 metres (the node form's `distance` is the declared one's `range`):

```js
const panel = light.rectArea({
  width: 2,
  height: 1,
  intensity: 30,
  position: [0, 3, 0],
  distance: 12,
  castShadow: true,
})
panel.rotation.x = -Math.PI / 2 // a node's face looks down its −z: turned to look down −y
panel.shadowsFog = true // its shadow map also shadows the fog volume
world.addLight({
  id: 'panel',
  kind: 'rect',
  position: [0, 3, 0],
  range: 12,
  direction: [0, -1, 0],
  right: [1, 0, 0],
  size: [2, 1],
  color: [1, 1, 1],
  intensity: 30,
  castsShadow: true,
  shadowsFog: true,
})
```

`shadowResolutionScale` (`1`, 0 or more; a point, spot or rect; refused on a sun) is the factor on the resolution
the light's shadow is given. It decides whether the light takes a shadow and how it fades with its size on screen
(see [Local lights' shadow gates](../../shadows/local-lights-shadow-gates-and-distant-lights.md#local-lights-shadow-gates-and-distant-lights)):
`0` takes the shadow away, above 1 keeps a far light's shadow longer, below 1 lets it go sooner. A saved scene
keeps it when not 1.

```js
const lamp = light.point({ intensity: 20, position: [0, 3, 0], distance: 12, castShadow: true })
lamp.shadowResolutionScale = 2 // keeps its shadow farther than a lamp left at 1
world.addLight({
  id: 'far',
  kind: 'point',
  position: [0, 3, 90],
  range: 12,
  color: [1, 1, 1],
  intensity: 20,
  castsShadow: true,
  shadowResolutionScale: 0.5,
})
```

Of a scene's directional lights, one is the forward light: the one the volumetric fog is lit by and the clouds'
shade on translucent surfaces follows ([ENGINE.md](../../engine/transparent-surfaces.md#transparent-surfaces)). It is
the light of the highest `forwardShadingPriority` (a whole number of at least `0`, `0` by default); among equal
priorities, the greatest colour times intensity, the first added of equals. A priority that is not a whole number
of at least `0` is refused (`INVALID_SCENE_LIGHT`), and so is one on a non-directional light. A saved world keeps
it, and the sky's sun part takes it as a field.

```js
const sun = light.directional({ intensity: 10, position: [-50, 70, 0] })
const lamp = light.directional({ intensity: 30, position: [20, 40, 0] }) // brighter: the fog follows it
world.scene.add(sun, lamp)
sun.forwardShadingPriority = 1 // the sun now, whatever the lamp's brightness; a write reaches the world at once
world.scene.sky = { clouds: true, sun: { forwardShadingPriority: 1 } } // the sky's own sun, the same field
```

No bound on the light count: a 16×16 screen tile lists up to 64 lights reaching it, past that exactly those
reaching it. Past 64 shadow slices a caster lights without a shadow (`shadowCastersUnsliced`). The shadow pool and
its metrics: [SHADOWS.md](../../shadows/memory.md#memory).
