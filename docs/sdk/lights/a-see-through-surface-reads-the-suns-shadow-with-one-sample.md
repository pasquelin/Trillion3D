# A see-through surface reads the sun's shadow, with one sample

A blended or transmissive surface is lit light by light in its own fragment: no mask holds it, so it
reads each light's shadow map itself. Three project switches say how. They are shadow settings
(`createWorld` options, `world.shadows`, `trillion3d_set_shadows`), read once when the session opens
(changing them later changes nothing, as for `cloudShadowOnTranslucent`), and no quality level
writes them:

- `shadowTranslucentQuality` (`0`, or `1`): at `0`, one sample of the light's map at the surface's
  point, with no ray, the cheap read every layer of a blend can pay; at `1`, the full trace the
  opaque surfaces get (rays across the light, a screen ray for contact, a dither on the share in a
  penumbra), at a high cost for every translucent pixel, and the sun's pages the trace reads are
  also marked for the nearest translucent surface the image before drew in front of each pixel.
- `shadowTranslucentLocalLights` (`false`): whether a point, spot or rectangle light's shadow reaches
  the surface. Off, a shadowed local light lights it unshadowed and the translucent programs hold
  none of the local lights' shadow code; the sun's shadow always reaches it. On, the local lights are
  read as `shadowTranslucentQuality` says.
- `translucentRectLights` (`false`): whether a rectangle light lights the surface as a rectangle.
  Off, it lights it as a point light at its centre and the translucent programs hold none of the
  rectangle shading; opaque surfaces always take the rectangle.

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

A material can ask more of its own, whatever the switches say, at their defaults of `false` and `0`:
`translucentDirectionalLightShadowQuality` above 0 takes the full trace for the sun's shadow on its
surfaces, `translucentLocalLightShadow` shadows the local lights on them, and
`translucentLocalLightShadowQuality` above 0 takes the full trace for those lights. A scene whose
surfaces ask nothing pays nothing: the translucent programs hold none of that code.

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

A light shadows a translucent surface only while it casts (`castsShadow`) and the shadows are on
(`shadowQuality` past 0). The shadows of the fog and of the air are their own reads: these switches do
not touch them. How the read is made: [SHADOWS.md](../../shadows/reading-the-shadow.md#reading-the-shadow).
