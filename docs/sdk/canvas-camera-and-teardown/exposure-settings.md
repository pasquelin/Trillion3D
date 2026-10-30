# Exposure settings

`world.exposureSettings` holds the automatic exposure's settings, each also a `createWorld` option:

- `exposureBias` (`1`): stops added to the target; the mean lands at 0.18 · 2^bias before the curve.
- `exposureMinBrightness` (`-10`) and `exposureMaxBrightness` (`20`): the range of the mean in EV100
  (the same value for both fixes the exposure).
- `exposureHistogramLogMin` (`-10`) and `exposureHistogramLogMax` (`20`): the stops of luminance the
  histogram spans.
- `exposureLowPercent` (`10`) and `exposureHighPercent` (`90`), from 1 to 99: the shares of the
  pixels, darkest first, left out of the mean.
- `exposureSpeedUp` (`3`) and `exposureSpeedDown` (`1`), in stops a second (0 holds).
- `exposureTransitionDistance` (`1.5` stops, past which the exposure moves linearly).
- `exposureBlackBucketWeight` (`0`, from 0 to 1): how much the pixels of no light count.
- `exposureLuminanceMethod` (`'uniform'`, the mean of the channels; `'ntsc'`; `'workingSpace'`).
- `exposureMethod` (`'histogram'`, the default; `'basic'`, the weighted mean of the log luminance of
  the image's cells, a cheaper measure; `'manual'`, no measure: the camera's exposure).
- `exposureApplyPhysicalCamera` (`true`): where the method is manual, the aperture (the depth of
  field's, f/4 by default), `exposureCameraShutterSpeed` (`60`, in 1/s, from 0.01 to 8000) and
  `exposureCameraIso` (`100`, from 1) set the exposure, EV100 =
  `log2(aperture² · shutter speed · 100 / ISO)`; `false` reads the camera as EV100 0 and the bias
  alone sets it.
- `exposureLensAttenuation` (`0.78`, from 0.01): 0.78 makes lighting unitless, a luminance of 1
  being EV100 0; a lower one raises the luminance every EV100 is read from.

They apply where `world.exposure` is `'auto'`, from the next frame; the exposure adapts on the
world's time, so a world that holds still does not move it. The metering mask, `exposureMeterMask`
(an `ImageBitmap`, read at the opening; `explorer.setExposureMeterMask(image)` changes it, `null`
gives it back), weighs where the image is measured by its red channel. A manual exposure that does
not change costs the GPU nothing.

The same object holds the pre-exposure's three settings, which apply to a lit view whatever its
exposure:

- `preExposure` (`true`): every light is written to the image already multiplied by the exposure of
  the image before, and the composition multiplies the image by the exposure over that number, so the
  picture is the same and the half floats keep their range at any exposure; `false` writes every
  light as it is.
- `preExposureOverride` (`0`): above 0, the number every light is multiplied by, in place of the
  exposure of the image before.
- `cachedLightingPreExposure` (`4`, from −16 to 16): the stops the sky light's real-time capture is
  pre-exposed by, whatever the exposure. It is written multiplied by 2 to the minus that number and
  read back multiplied by its inverse, so its half floats keep their range from about −8 to +12 stops
  of exposure at 4, −4 to +16 at 8; read with `preExposure` on or off.

It also holds the local exposure's settings, `localExposure…`, which apply to a lit view whatever its
exposure (the effect chain, below). A write names the settings it changes, `null` one's default; a
value a setting does not take is refused by name.

## Compensation curve

The exposure's compensation curve, `exposureCurve` (an option of `createWorld` and of the explorer,
read at the opening; `explorer.setExposureCurve(curve)` changes it, `null` or `false` gives it back),
adds stops to the target by how bright the scene is: a list of keys `[ev, compensation]`, an EV100
(the mean luminance over middle grey, one stop a doubling) and the stops added there (0 none, -1 twice
as dark, 1 twice as bright), linear between keys. Or `{ keys, before, after }` for the extrapolations
(`'constant'` by default; `'cycle'`, `'cycleWithOffset'`, `'oscillate'`, `'linear'`, `'none'`), a key
an object `{ ev, compensation, interpolation, tangentMode, arriveTangent,
leaveTangent, … }` for a `'constant'` or `'cubic'` run. It is baked into 64 samples over EV100 -10 to +20. None by default: the
image is the same. A curve is replaced, not edited in place, and one that is not a curve is refused by
name.

```js
const world = createWorld('viewer', {
  exposureCurve: [
    [-4, 1],
    [0, 0],
    [8, -1],
  ],
})
explorer.setExposureCurve({
  keys: [
    [0, 0.5],
    [10, -0.5],
  ],
  after: 'linear',
})
explorer.setExposureCurve(null) // no compensation
```

The local exposure's contrast curves, `localExposureHighlightContrastCurve` and
`localExposureShadowContrastCurve` (options of `createWorld` and of the explorer;
`explorer.setLocalExposureHighlightContrastCurve(curve)` and
`explorer.setLocalExposureShadowContrastCurve(curve)` change them, `null` or `false` gives them back),
take the same keys `[ev, scale]` as the compensation curve, but the value of a key is a scale the
highlights' or the shadows' contrast (`localExposureHighlightContrast`,
`localExposureShadowContrast`) is multiplied by, read at the EV100 of the frame's mean luminance as the
compensation curve is. A curve set makes the local exposure run whatever the contrasts. None by
default: the contrasts are used as they are.

```js
const world = createWorld('viewer', {
  localExposureHighlightContrastCurve: [
    [0, 1],
    [8, 0.5], // a bright scene gets half the highlight contrast
  ],
})
explorer.setLocalExposureShadowContrastCurve({
  keys: [
    [-2, 1.5],
    [6, 1],
  ],
})
explorer.setLocalExposureShadowContrastCurve(null) // back to the setting alone
```

```js
const world = createWorld('viewer', { exposureBias: 0.5 })
world.exposure = 'auto' // the default: measured each frame
world.exposureSettings = { exposureSpeedUp: 8, exposureSpeedDown: 4 } // adapts faster, next frame
world.exposureSettings = { preExposure: false } // every light written as it is, the same picture
world.exposure = 1.5 // a fixed exposure, whatever the image holds
```

```js
const world = createWorld('viewer', {
  exposureMeterMask: await loader.imageBitmap('centre-weighted.png'),
})
world.exposureSettings = { exposureMethod: 'basic' } // the cheaper measure, weighed by the mask
explorer.setExposureMeterMask(null) // every pixel counts the same again
// The camera's exposure: no measure — f/2.8, 1/125 s, ISO 400, no bias.
world.effects.add(effect.depthOfField({ aperture: 2.8 }))
world.exposureSettings = {
  exposureMethod: 'manual',
  exposureCameraShutterSpeed: 125,
  exposureCameraIso: 400,
  exposureBias: 0,
}
world.exposure = 0.25 // a fixed exposure: the radiance multiplied by it, the bias and the camera ignored
```
