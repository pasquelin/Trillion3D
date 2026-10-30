# Temporal antialiasing

A temporal upscaler (`taa/`): a jittered image, motion derived from the visibility buffer, a
history update with shading rejection, the spatial anti-aliaser before the update, all compute
dispatches, one update for every render scale. The pass runs on every frame drawn and its history is reset only on a camera
cut, the one change the reprojection cannot follow. A still view is drawn while its history fills
— whole cycles of the jitter's phases until every pixel of the history holds its most samples, 16
at the display's resolution and 4 at twice it, a history pixel covering a quarter of a display pixel
(`taaConverged`, `historySampleLaws`) — then held on its
converged image like any still view (`taaConverging`, `frame/loop/hold.ts`); a change draws again
on the history it holds, and a session opened with `drawConverged` (the bench's cost series) keeps
drawing it. Its level (`off`, `low`, `medium`, `high`, `max`, `taa/levels.ts`) sets the
kernel, the flicker rejection and the spatial anti-aliaser, the history's resolution, whether it
resurrects and whether it reprojects by a field; the flicker rejection, the resurrection and the
reprojection field are the level's by default and each a setting of its own
(`temporalShadingRejectionFlickering`, `temporalResurrection`, `temporalReprojectionField`: `level`,
`on` or `off`, `taaKnobs`), a change of the last two remaking the history; a level without the flicker
rejection or the anti-aliaser skips its pass. The thin geometry detection, which relaxes the history where geometry
is thinner than a pixel, runs where the setting `temporalThinGeometry` (`world.temporal`, off by
default) asks for it, at any level but `off`, and in the analysis views of the diagnostic; a change
of the setting starts the history again.

**The history** (`historyShape.ts`, `historyFrames.ts`, `historyTargets.ts`). A history is a few frames,
each a colour and its metadata — the history's validity alone, eight bits — at the history's size,
the display's times the level's percent (`levels.ts`: 100, and 200 at `max`) rounded up. The update is
a compute pass, so its targets are storage textures, and WebGPU lets a compute pass store to the
11-11-10 format, the one- and two-channel 8-bit formats and the 16-bit ones only under the feature
`texture-formats-tier1` (§ 25.19 and § 26.1.1 of the specification; it carries
`rg11b10ufloat-renderable`, and `texture-formats-tier2` carries it): with it the colour is stored in
`rg11b10ufloat` — the history's and the resolved image's —, the validity in `r8unorm`, the
render-resolution shading history in `rgb10a2unorm` (ten bits a channel, its reprojection edge in two)
and the anti-aliaser's target in `rg8uint`; without it in half floats, `rgba8unorm`, `rgba8unorm` and
`rgba8uint`, the core's storage formats (`historyFormatsOf`, requested with the device,
`session/gpuDevice.ts`). The mask of the texels the shading rejection asks the spatial anti-aliaser on is an `r8uint` storage texture, one byte a texel, whatever the history's formats, where the device has `texture-formats-tier1` (and its driver accepts it) and grants a fifth storage texture a stage beside the four the rejection always binds, else a buffer of a 32-bit word a texel (`rejectionStorageForms`); a level without the anti-aliaser binds a one-texel stand-in. The update dithers the colour to the format's precision. A history
that would pass the device's widest texture is made at the display's size
(`historyFactor`). The frames follow a sequence (`frameSequenceOf`): without
resurrection, one frame in two textures taking turns, one read as the last image's while the other is
written; with it, the two of the images just drawn and `temporalResurrectionFrames` (rounded up to an even
count) kept for good, every `temporalResurrectionInterval`-th image stored in one of them, the oldest
replaced, and the oldest read as the frame a pixel may be resurrected from (`createFrameRing`,
`planFrame`, `keepFrame`); each frame is a texture of its own, and a view cut drops them all. The update
(`resolveWgsl.ts`, `historyUpdate.ts`) reads the last image's frame and writes its own slot; where the
history is larger than the display's, the resolve (`historyResolve.ts`, its programs `historyResolveWgsl.ts`) brings it down to the colour
the composition reads, a four-by-four Mitchell-Netravali kernel (B = C = 1/3) weighed by
the tone of each colour and held between the least and the greatest of its sixteen, in a compute pass
that writes the half-size image of the scene's chain beside (`SceneChain.begin`), a second
pass doing the display layers; where the history is the display's size the update writes that image
itself, each texel the mean of the four pixels it covers. The chain draws its own (`scene downsample`)
only for an image no pass wrote it beside: the lit image where the temporal pass is off and no blur
drew, or a device that binds fewer than five storage textures to a stage. Memory, bytes of the
history's frames, the half-size image, the resolved image and the analysis's render-resolution
targets (`taaTargetBytes`): a 1920 × 1080 display at `max` costs about 564 MB of history with the
packed formats (663 MB with the core's) and 763 MB in all (902 MB); a 5120 × 3280 one costs 4.57 GB
(5.38 GB) for the history on a device with textures of 16384 and 6.2 GB (7.3 GB) in all, and 1.21 GB
for it (1.48 GB), 2.75 GB in all (3.27 GB), on a device whose widest texture is 8192, which keeps the
history at 100 %. A debug view's as-is pixels (a normal or depth surface, `AS_IS_FLAG`) are none of the
history's: the composition draws them over its output (below, [The display finishing](the-display-finishing.md#the-display-finishing)).

**The passes are compute dispatches** (`analysis.ts`, `historyUpdate.ts`), each in a compute pass of
its own, timed under its label (`TAA_*_PASS`, `diagnostic/stage/passLabels.ts`). Before the
sky, the fog, the clouds and the translucency lie on the image (`measureBeforeTranslucency`, `post/taa/frame.ts`, called
at the head of `encodeSkyAndClouds`, as the reference measures the flicker luma before its sky, fog and clouds), the measures, on the scene the temporal pass reads, where the flicker
measure or the thin geometry detection runs: the flicker luma, the colour's measurement luma taken
to the gamma space in eight bits, and where the detection runs the material's coverage of the
visibility buffer, each a layer of one texture of a byte a texel a layer (`flickerLumaWgsl.ts`,
64 lanes of 2×2 texels, 16×16 a workgroup), which also holds the thin geometry's mask and coverage
history. Then the dilated velocity, the history reprojection (the resurrected frame's shading
history in it), the thin geometry detection and its weight relaxation (the translucency's trim),
the shading rejection, whose entry begins with the flicker measure, the spatial anti-aliaser, a texel a lane, then the history update, one
dispatch over the history in tiles of 8 across — 64 lanes, 8 down, a lane's place in the tile the
bits of its index in the order that puts the four pixels of a half-size texel in four consecutive lanes
(`lanePixel`). The update's lanes beyond the history compute with clamped reads and store nothing. The
history's laws, the flicker measure's rates, the shading rejection's exposure and the thin geometry
detection's thresholds are settings read at each image (`world.temporal`, `TEMPORAL_RULES`): the laws
(`temporalHistorySampleCount`, `temporalShadingRejectionSampleCount`,
`temporalVelocityWeightClampingSampleCount`, `temporalVelocityWeightClampingPixelSpeed`) are the words of
`view.history`, `view.fraction` and `view.rates.y` (`historySampleLaws`) and set the still view's
convergence too (`taaConverged`); the flicker period, its frame rate cap and its parallax speed are
`view.exposure.zw` and `view.rates.x` (`flickerRates.ts`), a period of 0 skipping the measure in the
shading rejection; the offset in stops is `view.preExposure.y`, the factor the measures of the flicker,
the thin geometry and the rejection multiply the exposure by, the history update not; the thresholds of
the thin geometry detection are `view.thin` and `view.thinFade` (`writeThin`; `thinFade.z` is the greatest
relaxation weight, `temporalThinGeometryMaxRelaxationWeight`, which scales the cluster weight before the
3×3 average (0.5, 1, 0.5) that spreads it). The half-size image
(`temporalDownsampleQuality`) is written beside the colour by the update or the resolve, in the
output's format (11-11-10 floats where the device stores to them, as the reference's), and by the
motion blur where one is drawn after them, at `'low'`; at `'high'` the scene chain draws it from the
image with the wide filter (`halveWide`, `sceneChain.ts`). The
settings `temporalWaveOps` (`true`, the default of the reference's wave operations), `temporalWaveSize`
(`0`, the device's own size) and `temporalHalfPrecision` (`true`, its 16-bit math) choose how the
programs run (`waveOps.ts`, `world.temporal`): with subgroups (`subgroups`) at a size the programs are
written for — 16, 32 or 64, the adapter's only size, else one pinned with `subgroup-size-control` —
the update is a workgroup of one subgroup's lanes and gathers the half-size image by two
`subgroupShuffleXor` (masks 1 then 2, the horizontal then the vertical exchange of the pairs); without,
a workgroup of 64 lanes and workgroup memory with a barrier between each exchange. WGSL ties a subgroup
to no place in the workgroup (§ 15.5 "Subgroups" of the WGSL specification), which is why the wave
program has the subgroup be the workgroup. Where the device has 16-bit shader floats (`shader-f16`) the
spatial anti-aliaser runs in half floats (`spatialAntiAliasingShader`'s `half`); the other programs
have one variant. A setting that changes the choice compiles the programs it names off the frame, the
frames drawn with those of the pass's first choice meanwhile. A program a driver refuses does not take
the pass with it: its wave programs are replaced by the plain ones, then the packed formats' by the
core's (`createTaaResolves`). WebGPU has one queue per device
(`GPUDevice.queue`, "the primary `GPUQueue` for this device", § 4.4 of the specification; a device
descriptor names the one `defaultQueue`, § 4.3.1): the reference's asynchronous compute has no
counterpart.

**The flicker measure** (`flickerMeasureWgsl.ts`) is the first stage of the shading rejection's entry, run
where the level rejects by it (or an analysis view is shown), over the same tile and network. It
writes the flicker history of the texels the workgroup writes and, for every texel of its tile — the
three each side that it only reads included, whose values are those of this tile's wrapped network
alone — returns the flicker error and the count to the stages after it in registers, with no buffer
between them; the 16-bit and wave programs are the shading rejection's.

**The shading rejection** (`rejectionWgsl.ts`) is one dispatch, a workgroup of 256 lanes over a
square of 32 × 32 render texels, four a lane down a column, of which it writes the inner 26 × 26: its
3×3 operators exchange their values in workgroup memory, the tile's neighbourhood wrapping around
past its edge, so a value several operators deep is wrong near the edge and the three texels each side
are only read. In it, in this order: the flicker measure, where the level rejects by it, its error
and count passed in registers; the rejection of the last image's history; where the history resurrects, that of the frame a pixel may be
resurrected from, measured only where some written texel of the workgroup is closer to it and rejected
below a half; the shading history of this image's frame, the rejection the
update reads (an analysis view's words in its place), the reprojection of the resurrected pixels, the
scene colour the update reads and the LDR luma the anti-aliaser reads; and each written texel empties
its occluder word. Four storage textures, what every device binds: the shading history, the flicker
history, the rejection, and the reprojection field's vector and jacobian as two layers of one texture — five or six where the anti-aliaser's mask and the luma are textures too, else buffers; the scene colour is a storage buffer, in the history's colour
format, four single floats in four words (`sceneColorWgsl` also packs 11-11-10 floats in a word or four half floats in two,
each channel rounded toward zero as the format's texture would after the stochastic rounding), the luma a byte a texel, four to a word, each
texel's byte cleared and set by two atomics, the texels of a word belonging to up to two workgroups.

**Resurrection** (`resurrectionWgsl.ts`, `reprojectWgsl.ts`, `rejectionWgsl.ts`). A pixel the last
image's history rejects may take its history from a frame kept for good, as that frame saw it: the
reprojection reads that frame's shading history into the second layer of its reprojected histories,
with the bit of the texels off that frame's screen, and the shading rejection decides each pixel —
the frame is closer to the image than the last image's, by more than 0.05 a channel on average over a
texel's 3×3, for more than four of the nine texels around it, and the texel does not fall off that
frame's screen, and its rejection is better by more than 0.1 —; the pixels resurrected take the vector
and jacobian of the reprojection to that frame and the update reads that frame's colour for them.

**The reprojection field** (`reprojectionFieldWgsl.ts`, `nearestVelocityWgsl.ts`). Where the level
reprojects by a field, each texel's vector is its closest neighbour's, corrected by the jacobian of
the vectors over its 3×3, in render pixels, so a surface that rotates or scales reprojects each of the
history's pixels to its own place; the pixels past the boundary the depth edge sets (found by a browse
of three samples a side, `reprojectionBoundary`) keep the texel's own vector, and a hole-filled texel
keeps the occluder's, with no jacobian. The jacobian and the boundary are written by the nearest
velocity and read by the update; the history of a field's level reads its speed (`temporalReprojectionFieldSpeed`).

**What a material asks of its history** (`responsive`, [Temporal anti-aliasing](../compiler/temporal-anti-aliasing.md#temporal-anti-aliasing))
is carried by a two-bit code, `off` 0, `medium` 1, `full` 3 (`responsiveCode`): bit 0 reads the pixel
as a pixel animation — its motion vector is no guide to its detail —, bit 1 restarts its history.
The velocity stage writes it with the flags of the pixel in its target, two words a texel
(`rg32uint`): the vector, and the flags, `PIXEL_ANIMATED` (also set where the surface changes its
vertices with no tracked deformation) and `PIXEL_RESTARTS`. The blends and transmissive layers over
a pixel write their material's code, the mark of it (`RESPONSIVE_MARK_WGSL`), into a one-channel
target of their own (`RESPONSIVE_TARGET`), in a pass of their own on every device, as the reference's velocity pass is (`drawResponsive`: the layers drawn again, depth-tested against the opaque scene at the depth a `pixelDepthOffset` moves each pixel to, `frag_depth`; a thin translucent layer as if its opacity were one), where the reference ORs it into the velocity texel (no
64-bit image atomic, no logic-op blend here): the largest of the layers' marks holds every bit
any of them carries, which the OR does; the nearest velocity reads it with the flags and takes the
union. A layer writes it as the reference does (`blendResponsive`, `marksResponsive`): only a
layer of the pass before the depth of field, drawn translucent, additive or multiplying, only
where its opacity is above 0 and under the clip value of its surface's opacity mask plus a 255th
(`ITEM.opacityClip`), and only where it lies in front of the opaque scene (the pass's depth test). The animation bit signs the closest depth the nearest velocity writes, moves the texel in
full for the flicker measure, keeps the thin geometry detection off it and has the rejection read
its colour blurred over its 3×3; the restart bit goes in the marks, and the reprojection puts it in
its word (`REPROJECT_BITS.restarts`) where this image can resurrect a pixel at all
(`view.resurrection.x`, a level without the resurrection reading `full` as `medium`). A texel whose
word says so is disoccluded for the flicker measure and the shading rejection — its history
restarts, its spatial anti-aliaser asked — and is never resurrected; the update reads no more than the
rejection's bits. The `taa-material-history` view shows the code of each pixel as grey.

**The motion blur's flattening** is done by the nearest velocity where both run: its workgroup is a
tile of the blur's (16 × 16 texels) and the dilated velocity — the closest surface's, the camera's
motion taken out where the blur follows what moves alone — is scaled to the blur's pixels, flattened
with the closest depth and reduced to the tile's range there (`velocityShader`'s `fused`,
`flattenWgsl.ts`), the blur's own dispatch left out (`FusedFlatten.written`). The blur sets itself up
ahead of the pass (`WebgpuResolveKind.fuse`: its targets, its uniform and clock, once an image), and
flattens its own motion when the temporal pass is off, when its fused program has not compiled yet
and when the device binds fewer than six storage textures to a stage (seven with two directions); a
second blur of the chain always flattens its own, the first alone is fused.

**The motion blur's half-size image** is written by its filter as it stores the blurred image
(`filterStore`, `filterWgsl.ts`), the last blur of the chain's, for the scene's chain to read in
place of `scene downsample` (`WebgpuResolveKind.half`, `ResolvedImage`): a thread of a
half-resolution class holds its quad of pixels and stores their mean; a thread of a full-resolution
one stores its pixel, and the four lanes of a quad gather in workgroup memory, one barrier, the lane
of the quad's first pixel storing the mean. The image the blur leaves is the chain's; a still image
(no motion, no blur) keeps the temporal pass's, and an image lying in textures larger than itself
(drawn below the display's size with the temporal pass off) has the chain's own. The render
scale is a dynamic resolution (`scale/dynamicResolution.ts`): a history of the frame's GPU busy
times against the frame time budget, both directions, with or without the temporal upscaler
(spatial upscale in the composition where it is off). The loop draws every refresh, or under the
page's frame cap every few (`frame/cadence.ts`); the budget is `dynamicResolutionFrameTimeBudgetMs`,
33.3 ms by default, the frame cap's interval where it is 0 ([below](#dynamic-resolution)). The
page's options are [SDK.md](../sdk/canvas-camera-and-teardown.md#canvas-camera-and-teardown).

## Dynamic resolution

Where the render scale is `'auto'`, one heuristic fits it to a GPU time budget, and fits the cut's
edge scale (`cutEdgeScaleBudgetMs`) beside it. Each GPU time arrives with the fraction its image was
drawn at; the heuristic keeps the last `dynamicResolutionHistorySize` of them, browses them from the
newest, each suggesting `fraction · target / time` (the square root of the ratio for the render
scale, whose time scales with the area), weighs them by `dynamicResolutionFrameWeightExponent` per
frame back, stops after `dynamicResolutionMaxOverBudgetFrames` frames in a row over the budget, and
proposes the weighted mean. The target is the budget less `dynamicResolutionHeadroomPercent`. A
history all over the budget is forgotten and moves the render scale at once; else a change waits for
`dynamicResolutionChangePeriod` GPU times since the last one, is none under
`dynamicResolutionChangePercentThreshold` percent unless it reaches a bound, and a rise goes
`dynamicResolutionIncreaseAmortization` of the way. The scale's bounds are the page's `renderScale`
(its minimum is 50 % by default); `dynamicResolutionThrottlingMaxPercent` lowers its upper bound.

| Field                                        | Meaning                                                                                                                                                                                                                               | Default |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `dynamicResolutionFrameTimeBudgetMs`         | The frame's GPU time budget, in ms; 0 is the page's frame cap interval instead (the display's refresh unless the page caps the frame rate)                                                                                            | `33.3`  |
| `dynamicResolutionThrottlingMaxPercent`      | The most the render scale may be, in percent of the display, from 0 to 100; 0, none; within the page's bounds                                                                                                                         | `0`     |
| `dynamicResolutionHeadroomPercent`           | The share of the budget left free, in percent, from 0 to 99                                                                                                                                                                           | `10`    |
| `dynamicResolutionOverBudgetHeadroomPercent` | The share of the budget a frame must take to be over it, in percent, from 0 to 99                                                                                                                                                     | `0`     |
| `dynamicResolutionHistorySize`               | The GPU times kept, a whole number from 1 to 4096 (five doubles an entry, allocated at the next sample)                                                                                                                               | `16`    |
| `dynamicResolutionFrameWeightExponent`       | The weight of each frame back against the one after it, 0 or more                                                                                                                                                                     | `0.9`   |
| `dynamicResolutionChangePeriod`              | The fewest GPU times between two changes, a whole number of at least 0                                                                                                                                                                | `8`     |
| `dynamicResolutionIncreaseAmortization`      | How far a rise goes at once, from 0 to 1                                                                                                                                                                                              | `0.9`   |
| `dynamicResolutionChangePercentThreshold`    | The change, in percent from 0 to 100, under which the scale does not move                                                                                                                                                             | `2`     |
| `dynamicResolutionMaxOverBudgetFrames`       | The frames in a row over the budget past which the older ones no longer count, a whole number of at least 0, read no lower than 2                                                                                                     | `2`     |
| `dynamicResolutionUseCpuTimeLogic`           | Whether a frame whose CPU time passes the budget (or the budget less its headroom) is not over budget by its GPU time: lowering the resolution would not shorten it. The CPU time is the engine's own for the image, the one thread's | `false` |

```ts
const world = createWorld(canvas, { renderScale: 'auto', maxFrameRate: 60 })
world.dynamicResolution = {
  dynamicResolutionFrameTimeBudgetMs: 12,
  dynamicResolutionHeadroomPercent: 20,
}
world.dynamicResolution = { dynamicResolutionThrottlingMaxPercent: 70 } // a page that idles draws at most 70 %
explorer.setDynamicResolution('dynamicResolutionUseCpuTimeLogic', true) // from the next GPU time
```

The settings are read again at each GPU time; a number that is not in its range, or not a number,
is refused with the field named, and no quality level writes them. Where the render scale is a
number, nothing is fitted and none of them does anything. The reference's shadow raster budget and
translucency budget have none here (each would size or throttle a pass this engine has no separate
form of), nor has the quantization of the render targets' upper bound (WebGPU has no transient
allocator and a resized target pops: the targets are made once at the bounds' maximum) nor the game
thread's critical path (one thread here).
