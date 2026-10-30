# Temporal anti-aliasing settings

`world.temporalAntialiasing` (also a `createWorld` option, `true` by default) jitters each image by
a sub-pixel offset and accumulates; `false` draws pixel centres with no history, as a pixel-exact
capture needs. A write applies next frame, no session reopened; a read says what the image carries.

`world.temporal` holds the pass's settings beside its level, each also a `createWorld` option. A
write names the settings it changes, `null` one's default; a value of another kind is refused by
name.

## Main switches

- `temporalThinGeometry` (`false`) looks for geometry thinner than a pixel (a wire, a rail, which
  the pixels it crosses see on some images and not on others) and relaxes the history there, at any
  level but `'off'`, for the cost of the finding in every image.
- `temporalShadingRejectionMode` (`'stability'` or `'responsive'`, `'stability'` by default) sets
  how the shading rejection widens its clamp. `'stability'` is steadier and controls the rejection
  better but ghosts more; `'responsive'` widens the clamp by the blur of the lesser total variation
  of the input's change and of the input, so it rejects less and ghosts less, with blockier
  artifacts.
- Three settings ride on the level (table below), each `'level'` (the default: the level's own
  choice), `'on'` or `'off'` whatever the level, at any level but `'off'`:
  - `temporalResurrection` keeps older frames to bring a disoccluded pixel's detail back;
  - `temporalReprojectionField` reprojects the history by a field rather than by the dilated vector
    alone;
  - `temporalShadingRejectionFlickering` widens the shading rejection by the flicker measure.
- Three settings shape the history where it resurrects and reprojects by a field:
  - `temporalResurrectionFrames` (`2`, a whole number of at least 1, rounded up to an even count):
    the frames the history keeps for good beside the last two, each costing a history's bytes;
  - `temporalResurrectionInterval` (`31`, a whole number of at least 1, made odd): the images
    between two stored for good;
  - `temporalReprojectionFieldSpeed` (`0.125`, 0 or more): the speed, in display pixels an image,
    from which the field anti-aliases the edge of a moving surface.
- Four settings choose how its programs run; the first three leave the image the same:
  - `temporalWaveOps` (`true`) gathers the half-size image the scene's chain reads through the
    lanes of a subgroup, where the device grants `subgroups` at 16, 32 or 64 lanes (else through
    workgroup memory);
  - `temporalWaveSize` (`0`, the device's smallest size from 16; or 16, 32, 64 where the device
    runs it) names the size;
  - `temporalHalfPrecision` (`true`) runs the spatial anti-aliaser in 16-bit floats where the
    device grants `shader-f16`;
  - `temporalHistoryPacked` (`true`) keeps the history's colour in the 11-11-10 format where the
    device stores to it, four bytes a pixel; `false` keeps half floats, eight bytes, a finer blue
    and shadows (the `cinematic` preset writes it). The pass is made again when it changes.

## The reference's own knobs

The settings below are the reference's own knobs of the pass, each at its default.

The history's laws take four:

- `temporalHistorySampleCount` (`16`, 8 to 32): the most samples a display pixel's history holds;
  more steadies the highlights of a still image and ghosts more on fireflies.
- `temporalShadingRejectionSampleCount` (`2`, 0 or more): what it keeps after a total shading
  rejection; lower is clearer after one and less steady.
- `temporalVelocityWeightClampingSampleCount` (`4`, 0 or more, in samples of a history pixel): what
  it keeps once its pixel moves at `temporalVelocityWeightClampingPixelSpeed` (`1`, above 0, in
  half display pixels an image); higher is steadier on a movement and blurrier.

The flicker measure, where the shading rejection widens by it (`temporalShadingRejectionFlickering`),
takes four:

- `temporalFlickeringPeriod` (`2`, 0 or more, in images; `0` runs no measure): the period at which
  a luma oscillation, or a faster one, is a flicker the pass lets ghost.
- `temporalFlickeringAdjustToFrameRate` (`true`) shortens it in proportion where the frame rate
  falls below `temporalFlickeringFrameRateCap` (`60`, hertz above 0), so an effect animated in time
  is not taken for a flicker.
- `temporalFlickeringMaxParallaxVelocity` (`10`, above 0): the parallax speed, in pixels of a 1080p
  image at that frame rate, past which a texel is moving, not flickering.

`temporalShadingExposureOffset` (`0`, -20 to 20) adds stops to the exposure the rejection measures
the colours at, lifting the shadows it sees.

Nine settings tune the thin geometry detection where `temporalThinGeometry` runs it:

- `temporalThinGeometryErrorMultiplier` (`200`, 0 or more): a twentieth of it, ten at the default,
  is the depth step in pixel depth errors past which a texel is a thin line.
- `temporalThinGeometryMinKeepLineContrast` (`0.3`, 0 to 1): the luma contrast of a thin line of
  light.
- `temporalThinGeometryLineFadeRate` (`0.1`, 0 to 1) and `temporalThinGeometryLineFadeRateInsideRegion`
  (`0.03`): how often a high contrast line not seen again fades, outside and inside a cluster hole
  region.
- `temporalThinGeometryLineWeight` (`0.6`): the relaxation weight near a high contrast line.
- `temporalThinGeometryMaxRelaxationWeight` (`0.037`, 0 to 1): the greatest weight by which a
  cluster hole region relaxes the history, before a 3×3 average spreads it.
- `temporalThinGeometryRejectTranslucency` (`0.6`): the share of a texel's luma that the
  translucent layers make, past which its thin geometry is rejected; `0` never.
- `temporalThinGeometryShadingRange` (`'foliage'`, `'foliageAndHair'`, `'all'` or `'varying'`,
  `'varying'` by default): the shading models counted as thin geometry. `'varying'` counts every
  lit surface and relaxes the two-sided foliage with the dilation, the others by their edge alone;
  it needs the flicker measure running (`temporalFlickeringPeriod` above `0` and
  `temporalShadingRejectionFlickering` on) or `temporalThinGeometryMinKeepLineContrast` above `0`,
  else only the foliage counts.
- `temporalThinGeometryAntiFlickering` (`true`) has the flicker measure consider the relaxation the
  detection gives the history, since the detection can fail to find some thin geometry; `false`
  measures the flicker as if the history were not relaxed (the shading rejection itself is relaxed
  either way). It applies where `temporalThinGeometry` and the flicker measure run.

`temporalDownsampleQuality` (`'low'` or `'high'`, `'low'` by default) says how the half-size image
the exposure and the bloom read is made. `'low'` has the temporal pass and the motion blur write it
beside their own image, one filtered sample of four pixels, and the chain's own pass only where
neither draws; `'high'` has the chain draw it alone, four filtered samples of the 4 × 4 pixels
around a texel, steadier on a bright pixel in motion, for the cost of that pass.

## Levels and history size

| Level (`temporalAntialiasing`) | History | Resurrection | Reprojection field | Flicker rejection | Spatial anti-aliaser samples a side |
| --- | --- | --- | --- | --- | --- |
| `'low'` | 100 % | no | no | no | 0 |
| `'medium'` | 100 % | yes | no | no | 3 |
| `'high'` | 100 % | yes | yes | yes | 3 |
| `'max'` | 200 % | yes | yes | yes | 8 |

The resurrection, reprojection field and flicker rejection columns are the defaults of the three
settings above: a setting that says `'on'` or `'off'` overrides its column at any level.

The history is kept at the percent of the display's size the level names, resolved down to the
display's before composition; a device that cannot make it that large (a side past its largest
texture) keeps it at 100 %. Its colour is stored in the 11-11-10 format and its validity in one
8-bit channel where the device stores to them (feature `texture-formats-tier1`), else in half
floats and four 8-bit channels. At 1920 × 1080 the `'max'` history is 3840 × 2160 and four frames of
5 bytes a pixel, 166 MB (398 MB in half floats); at 5120 × 3280 it is 10240 × 6560, 1.34 GB
(3.22 GB), and a device whose largest texture is 8192 keeps it at 100 %, 336 MB (806 MB).

```js
const world = createWorld('viewer', { temporalThinGeometry: true })
world.temporal = { temporalThinGeometry: false } // back to the default, from the next frame
world.temporal = { temporalResurrection: 'off', temporalShadingRejectionFlickering: 'on' } // whatever the level says
world.temporal = { temporalResurrectionFrames: 4, temporalResurrectionInterval: 15 } // more, nearer frames to bring a disoccluded pixel back from
world.temporal = { temporalReprojectionFieldSpeed: null } // 0.125 again
world.temporal = { temporalWaveOps: false, temporalHalfPrecision: false } // the plain, 32-bit programs
world.temporal = { temporalHistoryPacked: false } // half-float history, as the cinematic preset
world.temporal = { temporalHistorySampleCount: 24 } // steadier highlights, more ghosting on fireflies
world.temporal = { temporalFlickeringPeriod: 3, temporalFlickeringFrameRateCap: 30 } // a longer period, followed below 30 Hz
world.temporal = { temporalThinGeometry: true, temporalThinGeometryMinKeepLineContrast: 0.2 } // finer lines of light
world.temporal = { temporalShadingRejectionMode: 'responsive' } // less ghosting, blockier artifacts
world.temporal = { temporalThinGeometry: true, temporalThinGeometryAntiFlickering: false } // the flicker measure ignores the thin geometry's relaxation
world.temporal = { temporalDownsampleQuality: 'high' } // the chain draws the half-size image, the wide filter
```
