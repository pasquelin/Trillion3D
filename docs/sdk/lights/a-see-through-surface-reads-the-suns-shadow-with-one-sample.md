# A see-through surface reads the sun's shadow, with one sample

A blended or transmissive surface reads each light's shadow map in its own fragment. Three shadow
settings (`createWorld` options, `world.shadows`, `trillion3d_set_shadows`) are read once at session
open (later changes do nothing); no quality level writes them:

- `shadowTranslucentQuality` (`0`, or `1`): `0` is one sample of the light's map at the surface's
  point, no ray. `1` is the opaque surfaces' full trace (rays across the light, screen contact ray,
  penumbra dither), costly per translucent pixel; the sun's pages it reads are also marked for the
  nearest translucent surface of the previous image.
- `shadowTranslucentLocalLights` (`false`): whether a point, spot or rectangle light's shadow
  reaches the surface. Off, a local light lights it unshadowed; the sun's shadow always reaches it.
- `translucentRectLights` (`false`): whether a rectangle light lights the surface as a rectangle.
  Off, as a point light at its centre; opaque surfaces always take the rectangle.

```js
// Glass under a lamp is shadowed by what stands between them: one sample of each light's map.
const world = createWorld('viewer', { shadowTranslucentLocalLights: true })
// And with the penumbra the opaque surfaces get, for every translucent pixel.
const fine = createWorld('viewer', {
  shadowTranslucentQuality: 1,
  shadowTranslucentLocalLights: true,
})
// A rectangle light lights glass as the rectangle it is.
const panels = createWorld('viewer', { translucentRectLights: true })
```

A material can ask for more, whatever the switches say (defaults `false` and `0`):
`translucentDirectionalLightShadowQuality` above 0 takes the full trace for the sun's shadow,
`translucentLocalLightShadow` shadows the local lights, `translucentLocalLightShadowQuality` above 0
takes the full trace for those lights. A scene asking nothing compiles no such code.

```js
// One pane of glass reads the sun's shadow with the full trace, the rest of the scene with one sample.
material.meshStandard({
  transparent: true,
  opacity: 0.3,
  translucentDirectionalLightShadowQuality: 1,
})
// A lantern's glass is shadowed by the lamps around it, one sample of each map.
material.meshStandard({ transparent: true, translucentLocalLightShadow: true })
// And with the full trace for those lamps.
material.meshStandard({
  transparent: true,
  translucentLocalLightShadow: true,
  translucentLocalLightShadowQuality: 1,
})
```

A light shadows a translucent surface only while it casts (`castsShadow`) and `shadowQuality` is
past 0. Fog and air shadows are separate reads, untouched by these switches. The read:
[SHADOWS.md](../../shadows/reading-the-shadow.md#reading-the-shadow).
