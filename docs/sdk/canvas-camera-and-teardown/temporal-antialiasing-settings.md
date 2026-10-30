# Temporal anti-aliasing settings

`world.temporalAntialiasing` (also `createWorld` option, `true`): jitters each image by a sub-pixel
offset and accumulates; `false` draws pixel centres without history. A write applies next frame.

`world.temporal`: pass settings beside its level, each also a `createWorld` option. A write names
changed settings, `null` restores a default; a value of another kind is refused by name.

## Main switches

- `temporalThinGeometry` (`false`): finds geometry thinner than a pixel (wire, rail) and relaxes
  history there, at any level but `'off'`; costs a search every image.
- `temporalShadingRejectionMode` (`'stability'` or `'responsive'`, default `'stability'`):
  how rejection widens its clamp. `'stability'`: steadier, better rejection control, more ghosts;
  `'responsive'`: clamp widened by the blur of the lesser total variation of the input's change and
  of the input; rejects less, ghosts less, blockier artifacts.
- Three level-riding settings (table below), each `'level'` (default: level's choice), `'on'` or
  `'off'`, at any level but `'off'`:
  - `temporalResurrection`: keeps older frames to restore a disoccluded pixel's detail;
  - `temporalReprojectionField`: reprojects history by a field, not the dilated vector alone;
  - `temporalShadingRejectionFlickering`: widens shading rejection by the flicker measure.
- Three settings shape history where it resurrects and reprojects by field:
  - `temporalResurrectionFrames` (`2`, whole, at least 1, rounded up to even): frames kept for good,
    each costing a history's bytes;
  - `temporalResurrectionInterval` (`31`, whole, at least 1, made odd): images between two stored;
  - `temporalReprojectionFieldSpeed` (`0.125`, 0 or more, display pixels an image).
- Four settings choose how programs run; the first three leave the image the same:
  - `temporalWaveOps` (`true`): subgroup lanes where the device grants `subgroups` at 16, 32 or 64
    lanes (else workgroup memory);
  - `temporalWaveSize` (`0`: device's smallest from 16; or 16, 32, 64);
  - `temporalHalfPrecision` (`true`): 16-bit floats where the device grants `shader-f16`;
  - `temporalHistoryPacked` (`true`): history colour in 11-11-10 (four bytes a pixel) where the
    device stores to it; `false`: half floats, eight bytes, finer blue and shadows (`cinematic`
    preset writes it). The pass is remade on change.

## The reference's own knobs

Reference's pass knobs, each at default.

History laws:

- `temporalHistorySampleCount` (`16`, 8 to 32): most samples a display pixel's history holds; more
  steadies highlights, ghosts more on fireflies.
- `temporalShadingRejectionSampleCount` (`2`, 0 or more): kept after a total shading rejection.
- `temporalVelocityWeightClampingSampleCount` (`4`, 0 or more): kept once the pixel moves at
  `temporalVelocityWeightClampingPixelSpeed` (`1`, above 0, half display pixels an image).

Flicker measure (used by `temporalShadingRejectionFlickering`):

- `temporalFlickeringPeriod` (`2`, 0 or more, images; `0` no measure).
- `temporalFlickeringAdjustToFrameRate` (`true`): shortens it below `temporalFlickeringFrameRateCap`
  (`60`, hertz above 0).
- `temporalFlickeringMaxParallaxVelocity` (`10`, above 0, pixels of a 1080p image).

`temporalShadingExposureOffset` (`0`, -20 to 20): stops added to the exposure rejection measures at.

Thin geometry detection, where `temporalThinGeometry` runs it:

- `temporalThinGeometryErrorMultiplier` (`200`, 0 or more): a twentieth of it (ten at default) is
  the depth step in pixel depth errors past which a texel is a thin line.
- `temporalThinGeometryMinKeepLineContrast` (`0.3`, 0 to 1): luma contrast of a thin line of light.
- `temporalThinGeometryLineFadeRate` (`0.1`, 0 to 1), `temporalThinGeometryLineFadeRateInsideRegion`
  (`0.03`): how often an unseen high-contrast line fades, outside and inside a cluster hole
  region.
- `temporalThinGeometryLineWeight` (`0.6`): relaxation weight near a high-contrast line.
- `temporalThinGeometryMaxRelaxationWeight` (`0.037`, 0 to 1): greatest weight relaxing history in
  a cluster hole region, before a 3×3 average.
- `temporalThinGeometryRejectTranslucency` (`0.6`): translucent share of a texel's luma past which
  its thin geometry is rejected; `0` never.
- `temporalThinGeometryShadingRange` (`'foliage'`, `'foliageAndHair'`, `'all'`, `'varying'`;
  default `'varying'`): shading models counted. `'varying'` needs the flicker measure running
  (`temporalFlickeringPeriod` above `0` and `temporalShadingRejectionFlickering` on) or
  `temporalThinGeometryMinKeepLineContrast` above `0`, else only foliage counts.
- `temporalThinGeometryAntiFlickering` (`true`): flicker measure accounts for detection's
  relaxation; `false` measures as if history were unrelaxed.

`temporalDownsampleQuality` (`'low'` or `'high'`, default `'low'`): the half-size image exposure and
bloom read. `'low'`: one filtered sample of four pixels; `'high'`: four samples of 4 × 4 pixels,
steadier, costs that pass.

## Levels and history size

| Level (`temporalAntialiasing`) | History | Resurrection | Reprojection field | Flicker rejection | Spatial anti-aliaser samples a side |
| - | - | - | - | - | - |
| `'low'` | 100 % | no | no | no | 0 |
| `'medium'` | 100 % | yes | no | no | 3 |
| `'high'` | 100 % | yes | yes | yes | 3 |
| `'max'` | 200 % | yes | yes | yes | 8 |

The three middle columns are the settings' defaults; `'on'` or `'off'` overrides at any level.

History is kept at the level's percent of display size; a side past the device's largest texture
keeps 100 %. Colour 11-11-10 plus validity in one 8-bit channel where the device stores to them
(feature `texture-formats-tier1`), else half floats and four 8-bit channels. `'max'` at 1920 × 1080:
3840 × 2160, four frames of 5 bytes a pixel, 166 MB (398 MB half floats); at 5120 × 3280:
1.34 GB (3.22 GB), or 336 MB (806 MB) on a device with largest texture 8192 (keeps 100 %).

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
