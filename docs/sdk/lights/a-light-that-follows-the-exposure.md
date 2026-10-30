# A light that follows the exposure

Point, spot or rectangle lights hold `inverseExposureBlend` (`0`, 0 to 1): how much their strength
is divided by the image's exposure. `0`: strength kept whatever the exposure; `1`: divided by it, so
it looks the same in dark and bright scenes, like a lit sign under automatic exposure; between:
geometric blend (exposure to the power of minus the number). Directional lights have none (setting
one is refused, `INVALID_SCENE_LIGHT`). Saved with the world. The buffer keeps the light's own
strength; every pass reading it (lights, fog, translucent surfaces, surface cache) applies the blend
with the exposure of the view it draws, so two views at two exposures each see their own.

```js
const sign = light.point({ intensity: 800, inverseExposureBlend: 1 }) // looks as bright in the dark as in the day
sign.inverseExposureBlend = 0.5 // half-way, the next frame
```
