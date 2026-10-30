# Rectangle lights' pictures

A `rect` light may map a picture on its face (colour multiplied by it):

- `sourceTexture`: registered picture id.
- `sourceTextureScale` (`[1, 1]`, each above 0 to 1): share shown.
- `sourceTextureOffset` (`[0, 0]`, each 0 to 1): share start.

Picture runs along `right`, top edge toward `cross(direction, right)`. Other kinds, or scale/offset
without `sourceTexture`: `INVALID_SCENE_LIGHT`. `world.setRectLightTexture(id, image)` registers an
`ImageBitmap` or image (`null` forgets it; unregistered = plain rectangle);
`world.refreshRectLightTexture(id)` flags in-place change. One square atlas, slot per picture and
share.

Read by: diffuse, specular, thin transmission, surface cache cards, sampled lighting; fog with
`volumetricFogRectLightTexture` on (`false`); translucent forward programs with 17 sampled textures
a stage (16: plain). Not the translucency lighting volume; reflection and bounce rays use surface
cache light.

`world.rectLightAtlas` settings (also `createWorld` options), reference defaults:

- `rectLightAtlasMaxResolution` (`4096`, 64 to 16384): texels a side; past it, mips pack smaller.
- `rectLightAtlasFilterQuality`: `0` 2 by 2 box, `1` Gaussian.
- `rectLightAtlasMaxTextureRatio` (`2`, 1 to 16): most aspect ratio unstretched.
- `rectLightAtlasFormat`: `0` 11/11/10 bits (16-bit floats if undrawable); `1` four 16-bit floats.
- `sampledLightsTexturedRectLights` (`true`).
- Off/0 switches: `rectLightAtlasForceUpdate`, `rectLightAtlasResetOnChange`, `rectLightAtlasClear`,
  `rectLightAtlasDebugClear`, `rectLightAtlasDebug`, `rectLightAtlasDebugMipLevel`.

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

`transmission` (`false`): light shines through subsurface-profile surfaces it shadows; `movable`
shadow-casting only. Non-boolean: `INVALID_SCENE_LIGHT`.

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

Declared: `addLight({ ..., mobility: 'movable', transmission: true })`.

`mobility`: `'static'` (baked; no dynamic shadow), `'stationary'` (**default**; colour and intensity
may change) or `'movable'`. Other: `INVALID_SCENE_LIGHT`. Read by the volumetric lightmap
(`mobilityOf(light)`, `scene/light/fields.ts`).

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

A rect light shadows like a point light (cube out to `range`); none behind its plane. Penumbra: cone
toward its centre, radius half its width (`shadowRayCountLocal`, `shadowSamplesPerRayLocal`). Node
`distance` = declared `range`:

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

`shadowResolutionScale` (`1`, 0 or more; point, spot, rect; refused on a sun) scales shadow
resolution, gating shadow and fade (see [Local lights' shadow
gates](../../shadows/local-lights-shadow-gates-and-distant-lights.md#local-lights-shadow-gates-and-distant-lights)):
`0` none, above 1 keeps far shadows longer, below 1 drops them sooner.

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

Forward light (volumetric fog, clouds' shade on translucent surfaces,
[ENGINE.md](../../engine/transparent-surfaces.md#transparent-surfaces)) = the directional light of
highest `forwardShadingPriority` (whole, at least `0`, default `0`); ties: greatest colour times
intensity, then first added. Invalid or non-directional: `INVALID_SCENE_LIGHT`. The sky's sun part
takes it.

```js
const sun = light.directional({ intensity: 10, position: [-50, 70, 0] })
const lamp = light.directional({ intensity: 30, position: [20, 40, 0] }) // brighter: the fog follows it
world.scene.add(sun, lamp)
sun.forwardShadingPriority = 1 // the sun now, whatever the lamp's brightness; a write reaches the world at once
world.scene.sky = { clouds: true, sun: { forwardShadingPriority: 1 } } // the sky's own sun, the same field
```

A 16×16 screen tile lists up to 64 lights. Past 64 shadow slices a caster is unshadowed
(`shadowCastersUnsliced`). Pool: [SHADOWS.md](../../shadows/memory.md#memory).