# Temporal antialiasing

A temporal upscaler (`taa/`): jittered image, motion derived from the visibility buffer, history
update with shading rejection, spatial anti-aliaser before the update; all compute dispatches, one
update for every render scale. The pass runs on every frame drawn; history resets only on a camera cut.

A still view is drawn until every history pixel holds its most samples, 16 at the display's
resolution and 4 at twice it (`taaConverged`, `historySampleLaws`), then held (`taaConverging`,
`frame/loop/hold.ts`); a session opened with `drawConverged` keeps drawing.

The level (`off`, `low`, `medium`, `high`, `max`, `taa/levels.ts`) sets the kernel, flicker rejection,
spatial anti-aliaser, history resolution, resurrection and reprojection by a field. Flicker rejection,
resurrection and reprojection field are each a setting (`temporalShadingRejectionFlickering`,
`temporalResurrection`, `temporalReprojectionField`: `level` (default), `on` or `off`, `taaKnobs`);
changing the last two remakes the history. A level without flicker rejection or anti-aliaser skips its
pass. The thin geometry detection (relaxes the history under sub-pixel geometry) runs where
`temporalThinGeometry` (`world.temporal`, off by default) asks, at any level but `off`, and in the
analysis views; changing it restarts the history.

## The history

(`historyShape.ts`, `historyFrames.ts`, `historyTargets.ts`.) A history is a few frames, each a colour
and its validity at display size times the level's percent (`levels.ts`: 100, 200 at `max`), rounded
up; past the device's widest texture it is made at display size (`historyFactor`). Targets are storage textures; the 11-11-10, 1- and 2-channel 8-bit and 16-bit
formats are storable only under `texture-formats-tier1`.

| Target | With `texture-formats-tier1` | Without |
| - | - | - |
| colour (history's and resolved image's) | `rg11b10ufloat` | half floats |
| validity | `r8unorm` | `rgba8unorm` |
| render-resolution shading history | `rgb10a2unorm` (reprojection edge in the 2 bits) | `rgba8unorm` |
| anti-aliaser's target | `rg8uint` | `rgba8uint` |

(`historyFormatsOf`, `session/gpuDevice.ts`.) The anti-aliaser's texel mask is an `r8uint` storage
texture where the device has `texture-formats-tier1` and a fifth storage texture a stage; else a
buffer of a 32-bit word a texel (`rejectionStorageForms`). The update dithers the colour to the
format's precision.

The frames follow a sequence (`frameSequenceOf`):

- without resurrection, two textures taking turns;
- with it, the two of the last images plus `temporalResurrectionFrames` (rounded up to even)
  kept: every `temporalResurrectionInterval`-th image replaces the oldest, which is the frame a pixel
  may be resurrected from (`createFrameRing`, `planFrame`, `keepFrame`). A view cut drops them all.

The update (`resolveWgsl.ts`, `historyUpdate.ts`) reads the last image's frame. Where the history is larger than the display's, the resolve (`historyResolve.ts`,
`historyResolveWgsl.ts`) brings it down to the colour the composition reads: a four-by-four
Mitchell-Netravali kernel (B = C = 1/3) weighed by each colour's tone, writing the half-size image of
the scene's chain beside (`SceneChain.begin`). At display size the update writes that image itself.
The chain draws its own (`scene downsample`) only with the temporal pass off and no blur, or on a
device binding fewer than five storage textures to a stage.

Memory (`taaTargetBytes`; packed formats, core formats in brackets):

- 1920 × 1080 display at `max`: 564 MB history (663 MB), 763 MB in all (902 MB).
- 5120 × 3280: 4.57 GB (5.38 GB) history, 6.2 GB (7.3 GB) in all; at 100 % history (widest texture
  8192), 1.21 GB (1.48 GB), 2.75 GB in all (3.27 GB).

A debug view's as-is pixels (`AS_IS_FLAG`) are none of the history's: the composition draws them over
its output ([The display finishing](the-display-finishing.md#the-display-finishing)).

## The passes

Compute dispatches (`analysis.ts`, `historyUpdate.ts`), timed under `TAA_*_PASS`
(`diagnostic/stage/passLabels.ts`).

Before the sky, fog, clouds and translucency (`measureBeforeTranslucency`, `post/taa/frame.ts`, at the
head of `encodeSkyAndClouds`) it measures the flicker luma (gamma space, eight bits) and, for the thin
geometry detection, the material's coverage of the visibility buffer: layers of one byte-a-texel
texture (`flickerLumaWgsl.ts`) that also holds the thin geometry's mask and coverage history.

Then, in order:

1. the dilated velocity;
2. the history reprojection (the resurrected frame's shading history in it);
3. the thin geometry detection and its weight relaxation (the translucency's trim);
4. the shading rejection, whose entry begins with the flicker measure;
5. the spatial anti-aliaser, a texel a lane;
6. the history update, one dispatch over the history in tiles of 8 across, 64 lanes, 8 down
   (`lanePixel`).

Settings read each image (`world.temporal`, `TEMPORAL_RULES`):

- The laws (`temporalHistorySampleCount`, `temporalShadingRejectionSampleCount`,
  `temporalVelocityWeightClampingSampleCount`, `temporalVelocityWeightClampingPixelSpeed`) are
  `view.history`, `view.fraction` and `view.rates.y` (`historySampleLaws`); they set the still view's
  convergence too.
- Flicker period, frame rate cap and parallax speed: `view.exposure.zw` and `view.rates.x`
  (`flickerRates.ts`); a period of 0 skips the measure.
- Offset in stops: `view.preExposure.y`, multiplying the exposure in the flicker, thin geometry and
  rejection measures, not the history update.
- The thin geometry thresholds are `view.thin` and `view.thinFade` (`writeThin`; `thinFade.z` is
  `temporalThinGeometryMaxRelaxationWeight`, scaling the cluster weight before the 3×3 average
  (0.5, 1, 0.5) that spreads it).

`temporalDownsampleQuality`: at `'low'` the half-size image is written by the update, the resolve or
the motion blur; at `'high'` the scene chain draws it with the wide filter (`halveWide`,
`sceneChain.ts`).

`temporalWaveOps` (`true`), `temporalWaveSize` (`0`, the device's own size) and
`temporalHalfPrecision` (`true`, 16-bit math) choose how the programs run (`waveOps.ts`,
`world.temporal`):

- With subgroups of size 16, 32 or 64 (the adapter's only size, else one pinned with
  `subgroup-size-control`) the update gathers the half-size image by `subgroupShuffleXor`; without, by
  workgroup memory.
- With `shader-f16` the spatial anti-aliaser runs in half floats (`spatialAntiAliasingShader`'s `half`).
- A changed setting compiles its programs off the frame. A program a driver refuses is replaced: wave
  programs by plain ones, then the packed formats' by the core's (`createTaaResolves`).

## The flicker measure

(`flickerMeasureWgsl.ts`.) First stage of the shading rejection, run where the level rejects by it (or
an analysis view is shown); writes the flicker history, passes error and count on.

## The shading rejection

(`rejectionWgsl.ts`.) One dispatch, a workgroup of 256 lanes over 32 × 32 render texels, four a lane
down a column, writing the inner 26 × 26 (the three texels each side are only read; the tile's
neighbourhood wraps past its edge). In order:

1. the flicker measure, where the level rejects by it;
2. rejection of the last image's history;
3. where the history resurrects, that of the resurrection frame, measured only where some written
   texel is closer to it and rejected below a half;
4. writes this image's shading history, the rejection (an analysis view's words in its place), the
   reprojection of the resurrected pixels, the scene colour and the LDR luma the anti-aliaser reads;
5. each written texel empties its occluder word.

It binds four storage textures; five or six where the anti-aliaser's mask and the luma are textures
too, else buffers. The scene colour is a storage buffer (`sceneColorWgsl`).

## Resurrection

(`resurrectionWgsl.ts`, `reprojectWgsl.ts`, `rejectionWgsl.ts`.) A pixel the last image's history
rejects may take its history from a kept frame. Resurrected when:

- the frame is closer to the image than the last image's, by more than 0.05 a channel on average over a
  texel's 3×3, for more than four of the nine texels around it;
- the texel does not fall off that frame's screen;
- its rejection is better by more than 0.1.

Resurrected pixels take that frame's reprojection vector, jacobian and colour.

## The reprojection field

(`reprojectionFieldWgsl.ts`, `nearestVelocityWgsl.ts`.) Each texel's vector is its closest
neighbour's, corrected by the vectors' jacobian over its 3×3. Pixels past the depth-edge boundary (three samples a side, `reprojectionBoundary`) keep
the texel's own vector; a hole-filled texel keeps the occluder's, with no jacobian. The history of a
field's level reads its speed (`temporalReprojectionFieldSpeed`).

## What a material asks of its history

(`responsive`, [Temporal anti-aliasing](../compiler/temporal-anti-aliasing.md#temporal-anti-aliasing).)
A two-bit code: `off` 0, `medium` 1, `full` 3 (`responsiveCode`). Bit 0 reads the pixel as a pixel
animation, bit 1 restarts its history.

- The velocity stage writes it with the pixel's flags in its target (`rg32uint`, two words a texel):
  the vector, and `PIXEL_ANIMATED` (also set where the surface changes its vertices with no tracked
  deformation) and `PIXEL_RESTARTS`.
- Blends and transmissive layers write their material's code, the mark (`RESPONSIVE_MARK_WGSL`), into
  their own one-channel target (`RESPONSIVE_TARGET`) in their own pass (`drawResponsive`: depth-tested
  against the opaque scene at the depth a `pixelDepthOffset` moves each pixel to; a thin translucent
  layer as if its opacity were one). The largest mark is kept; the nearest velocity reads it.
- A layer writes it (`blendResponsive`, `marksResponsive`) only if it is of the pass before the depth
  of field, drawn translucent, additive or multiplying, only where its opacity is above 0 and under the
  opacity mask clip plus a 255th (`ITEM.opacityClip`), and only in front of the opaque scene.
- The animation bit signs the closest depth the nearest velocity writes, keeps the thin geometry
  detection off the texel and has the rejection read its colour blurred over its 3×3. The restart bit goes in the marks and the reprojection's word
  (`REPROJECT_BITS.restarts`) where this image can resurrect a pixel (`view.resurrection.x`; a level
  without resurrection reads `full` as `medium`).
- A texel so marked is disoccluded (history restarts, anti-aliaser asked), never resurrected.

The `taa-material-history` view shows each pixel's code as grey.

## The motion blur's flattening

Done by the nearest velocity where both run (`velocityShader`'s `fused`, `flattenWgsl.ts`,
`FusedFlatten.written`, `WebgpuResolveKind.fuse`). The blur flattens its own motion when the temporal
pass is off, its fused program has not compiled, or the device binds fewer than six storage textures
to a stage (seven with two directions). Only the chain's first blur is fused.

## The motion blur's half-size image

Written by the chain's last blur filter as it stores the image (`filterStore`, `filterWgsl.ts`), read
in place of `scene downsample` (`WebgpuResolveKind.half`, `ResolvedImage`). A still image keeps the
temporal pass's; an image drawn below display size with the temporal pass off has the chain's own.

The render scale is a dynamic resolution (`scale/dynamicResolution.ts`), with or without the temporal
upscaler (spatial upscale in the composition where off); frame cadence in `frame/cadence.ts`; see [below](#dynamic-resolution) and
[SDK.md](../sdk/canvas-camera-and-teardown.md#canvas-camera-and-teardown).

## Dynamic resolution

Where the render scale is `'auto'`, one heuristic fits it, and the cut's edge scale
(`cutEdgeScaleBudgetMs`), to a GPU time budget. From the last `dynamicResolutionHistorySize` GPU times,
newest first, each suggests `fraction · target / time` (square root of the ratio for the render
scale); they are weighed by `dynamicResolutionFrameWeightExponent` per frame back, cut after
`dynamicResolutionMaxOverBudgetFrames` frames in a row over budget, and the weighted mean is proposed.
Target: the budget less `dynamicResolutionHeadroomPercent`.

A history all over the budget is forgotten and moves the render scale at once; else a change waits
`dynamicResolutionChangePeriod` GPU times, is none under `dynamicResolutionChangePercentThreshold`
percent unless it reaches a bound, and a rise goes `dynamicResolutionIncreaseAmortization` of the way.
Bounds: the page's `renderScale` (minimum 50 % by default); `dynamicResolutionThrottlingMaxPercent`
lowers the upper bound.

| Field | Meaning | Default |
| - | - | - |
| `dynamicResolutionFrameTimeBudgetMs` | GPU time budget, ms; 0 is the page's frame cap interval | `33.3` |
| `dynamicResolutionThrottlingMaxPercent` | Greatest render scale, percent of display, 0 to 100; 0, none | `0` |
| `dynamicResolutionHeadroomPercent` | Budget share left free, 0 to 99 | `10` |
| `dynamicResolutionOverBudgetHeadroomPercent` | Budget share a frame must take to be over, 0 to 99 | `0` |
| `dynamicResolutionHistorySize` | GPU times kept, whole 1 to 4096 | `16` |
| `dynamicResolutionFrameWeightExponent` | Weight per frame back, 0 or more | `0.9` |
| `dynamicResolutionChangePeriod` | Fewest GPU times between changes, whole, at least 0 | `8` |
| `dynamicResolutionIncreaseAmortization` | How far a rise goes at once, 0 to 1 | `0.9` |
| `dynamicResolutionChangePercentThreshold` | Change under which the scale does not move, percent 0 to 100 | `2` |
| `dynamicResolutionMaxOverBudgetFrames` | Frames in a row over budget past which older ones do not count; whole, at least 0, read no lower than 2 | `2` |
| `dynamicResolutionUseCpuTimeLogic` | A frame whose CPU time passes the budget (or budget less headroom) is not over budget by GPU time | `false` |

```ts
const world = createWorld(canvas, { renderScale: 'auto', maxFrameRate: 60 })
world.dynamicResolution = {
  dynamicResolutionFrameTimeBudgetMs: 12,
  dynamicResolutionHeadroomPercent: 20,
}
world.dynamicResolution = { dynamicResolutionThrottlingMaxPercent: 70 } // a page that idles draws at most 70 %
explorer.setDynamicResolution('dynamicResolutionUseCpuTimeLogic', true) // from the next GPU time
```

A number out of range, or not a number, is refused with the field named; no quality level writes
them. With a numeric render scale none does anything. Differences from the reference: no shadow
raster budget nor translucency budget (no separate pass to size); no quantization of the render
targets' upper bound (targets made once at the bounds' maximum); no game-thread critical path.
