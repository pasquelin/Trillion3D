# Exposure settings

`world.exposureSettings`: automatic exposure settings, each also a `createWorld` option:

- `exposureBias` (`1`): stops added to the target; mean lands at 0.18 · 2^bias.
- `exposureMinBrightness` (`-10`), `exposureMaxBrightness` (`20`): mean's EV100 range (equal values
  fix the exposure).
- `exposureHistogramLogMin` (`-10`), `exposureHistogramLogMax` (`20`): stops the histogram spans.
- `exposureLowPercent` (`10`), `exposureHighPercent` (`90`), 1 to 99: pixel shares, darkest first,
  excluded from the mean.
- `exposureSpeedUp` (`3`), `exposureSpeedDown` (`1`): stops a second (0 holds).
- `exposureTransitionDistance` (`1.5` stops; past it the exposure moves linearly).
- `exposureBlackBucketWeight` (`0`, 0 to 1): weight of no-light pixels.
- `exposureLuminanceMethod` (`'uniform'`: channel mean; `'ntsc'`; `'workingSpace'`).
- `exposureMethod` (`'histogram'`; `'basic'`: weighted mean of cells' log luminance, cheaper;
  `'manual'`: no measure, camera exposure).
- `exposureApplyPhysicalCamera` (`true`): with manual method, aperture (depth of field's, f/4
  default), `exposureCameraShutterSpeed` (`60`, 1/s, 0.01 to 8000) and `exposureCameraIso` (`100`,
  from 1) set EV100 = `log2(aperture² · shutter speed · 100 / ISO)`; `false`: camera reads as
  EV100 0, bias alone sets it.
- `exposureLensAttenuation` (`0.78`, from 0.01): 0.78 makes lighting unitless (luminance 1 = EV100
  0).

Apply where `world.exposure` is `'auto'`, from next frame; exposure adapts on world time.
`exposureMeterMask` (`ImageBitmap`, read at opening; `explorer.setExposureMeterMask(image)` changes
it, `null` restores) weighs measurement location by its red channel.

Three pre-exposure settings apply to a lit view whatever its exposure:

- `preExposure` (`true`): lights written multiplied by the previous image's exposure; `false`
  writes them as is.
- `preExposureOverride` (`0`): above 0, the multiplier instead of the previous exposure.
- `cachedLightingPreExposure` (`4`, −16 to 16): stops the sky light's real-time capture is
  pre-exposed by (1/16 at 4); written times 2 to the minus that number, read back times its inverse: half-float
  range about −8 to +12 stops at 4, −4 to +16 at 8.

`localExposure…` settings also apply whatever the exposure. A write names changed settings, `null`
restores a default; a value a setting rejects is refused by name.

## Compensation curve

`exposureCurve` (option of `createWorld` and explorer, read at opening;
`explorer.setExposureCurve(curve)` changes it, `null` or `false` restores) adds stops by scene
brightness: keys `[ev, compensation]`, EV100 and stops added (0 none, -1 twice as dark, 1 twice as
bright), linear between keys. Or `{ keys, before, after }` for extrapolations (`'constant'`
default; `'cycle'`, `'cycleWithOffset'`, `'oscillate'`, `'linear'`, `'none'`), a key an object
`{ ev, compensation, interpolation, tangentMode, arriveTangent, leaveTangent, … }` for a
`'constant'` or `'cubic'` run. Baked into 64 samples over EV100 -10 to +20. None by default. A
curve is replaced, not edited; a non-curve is refused by name.

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
explorer.setExposureCurve([{ ev: 0, compensation: 0.5, interpolation: 'cubic' }, [10, -0.5]])
explorer.setExposureCurve(null) // no compensation
```

Local exposure contrast curves `localExposureHighlightContrastCurve` and
`localExposureShadowContrastCurve` (options of `createWorld` and explorer;
`explorer.setLocalExposureHighlightContrastCurve(curve)` and
`explorer.setLocalExposureShadowContrastCurve(curve)` change them, `null` or `false` restores) take
`[ev, scale]` keys; the value scales `localExposureHighlightContrast` or
`localExposureShadowContrast` at the frame's mean EV100. A set curve makes local exposure run
whatever the contrasts. None by default.

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
world.exposureSettings = { preExposureOverride: 0.25 } // lights written multiplied by 0.25
world.exposureSettings = { cachedLightingPreExposure: 8 } // the sky light's capture kept for -4 to +16 stops
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
// The same multiplier 0.25, as a manual bias with the camera off.
world.exposureSettings = {
  exposureMethod: 'manual',
  exposureApplyPhysicalCamera: false,
  exposureBias: Math.log2(0.25),
}
```
