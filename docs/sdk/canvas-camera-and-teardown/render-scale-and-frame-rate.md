# Render scale, dynamic resolution and frame rate

`world.renderScale` (also a `createWorld` option, `'auto'` by default) is the per-axis fraction of the
display drawn before temporal antialiasing rebuilds the image.

- `'auto'` is a dynamic resolution, choosing between 0.5 and 1 from the GPU frame time against the
  frame time budget (`dynamicResolutionFrameTimeBudgetMs`, 33.3 ms by default, the frame cap's
  interval where it is 0); without GPU timestamps it stays at 1.
- `{ min, max }` bounds it, a number fixes it. A read is the last image's scale.
- Without temporal antialiasing the scale is chosen the same way and the image upscaled to the display
  by a Catmull-Rom cubic over the drawn pixels.
- The same history also fits the cut's GPU time budget (`cutEdgeScaleBudgetMs`), when the host gives
  one.

`world.dynamicResolution` holds the eleven settings that tune that fit, each also a `createWorld`
option, `explorer.setDynamicResolution(field, value)` and the tool `trillion3d_set_dynamic_resolution`
writing them from the next GPU time:

- the frame time budget (`dynamicResolutionFrameTimeBudgetMs`, `33.3`);
- the most the scale may be (`dynamicResolutionThrottlingMaxPercent`, `0`, none);
- the headrooms (`dynamicResolutionHeadroomPercent`, `10`, and
  `dynamicResolutionOverBudgetHeadroomPercent`, `0`);
- the history (`dynamicResolutionHistorySize`, `16`, a whole number from 1 to 4096, and
  `dynamicResolutionFrameWeightExponent`, `0.9`);
- the change period (`dynamicResolutionChangePeriod`, `8`);
- how far a rise goes (`dynamicResolutionIncreaseAmortization`, `0.9`);
- the change under which the scale does not move (`dynamicResolutionChangePercentThreshold`, `2`);
- the frames in a row over the budget that count (`dynamicResolutionMaxOverBudgetFrames`, `2`);
- whether a frame the CPU took too long is not over budget by its GPU time
  (`dynamicResolutionUseCpuTimeLogic`, `false`).

None is written by a quality level; where the render scale is a number, none does anything
([ENGINE.md](../../engine/temporal-antialiasing.md#dynamic-resolution)).

```js
const world = createWorld('viewer', { renderScale: 'auto', maxFrameRate: 60 })
world.dynamicResolution = {
  dynamicResolutionFrameTimeBudgetMs: 12,
  dynamicResolutionHeadroomPercent: 20,
}
world.dynamicResolution = { dynamicResolutionHeadroomPercent: null } // back to the default 10
```

`world.maxFrameRate` (also a `createWorld` option, `Infinity` by default) caps the frames a second the
world draws, even while its scene moves. The loop draws on a whole number of refreshes, the fastest
rate at or under the cap (12: every 5th refresh at 60 Hz, every 10th at 120 Hz), so each image is
shown for the same time; the refreshes between draw and count nothing, and the `'auto'` render scale
fits each image to the time the cap gives it. A write applies from the next frame; a page of several
worlds caps those out of focus.
