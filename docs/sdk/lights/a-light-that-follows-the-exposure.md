# A light that follows the exposure

A point, spot or rectangle light holds `inverseExposureBlend` (`0`, from 0 to 1): how much its strength
is divided by the image's exposure. At `0` the light keeps its strength whatever the exposure; at `1`
it is divided by it, so it looks the same in a dark scene as in a bright one, as a lit sign does under
automatic exposure; between, the geometric blend (exposure to the power of minus the number). A
directional light has none (setting one is refused, `INVALID_SCENE_LIGHT`). The value is saved with the
world. The buffer keeps the light's own strength; every pass that reads it (lights, fog, translucent
surfaces, surface cache) applies the blend with the exposure of the view it draws, so two views at two
exposures each see their own.

```js
const sign = light.point({ intensity: 800, inverseExposureBlend: 1 }) // looks as bright in the dark as in the day
sign.inverseExposureBlend = 0.5 // half-way, the next frame
```
