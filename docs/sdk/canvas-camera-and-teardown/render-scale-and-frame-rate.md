# Render scale, dynamic resolution and frame rate

`world.renderScale` (also `createWorld` option, `'auto'`): per-axis fraction of the display drawn
before temporal antialiasing rebuilds the image.

- `'auto'`: dynamic resolution, 0.5 to 1 from GPU frame time against frame time budget
  (`dynamicResolutionFrameTimeBudgetMs`, 33.3 ms; the frame cap's interval where 0); without GPU
  timestamps stays 1.
- `{ min, max }` bounds it, a number fixes it. A read gives the last image's scale.
- Without temporal antialiasing the scale is chosen the same way and the image is upscaled by
  Catmull-Rom cubic over the drawn pixels.
- The same history also fits the cut's GPU time budget (`cutEdgeScaleBudgetMs`), when the host gives
  one.

`world.dynamicResolution`: the eleven settings tuning that fit, each also a `createWorld` option,
`explorer.setDynamicResolution(field, value)` and tool `trillion3d_set_dynamic_resolution`, applied
from the next GPU time:

- frame time budget (`dynamicResolutionFrameTimeBudgetMs`, `33.3`);
- scale ceiling (`dynamicResolutionThrottlingMaxPercent`, `0`, none);
- headrooms (`dynamicResolutionHeadroomPercent`, `10`, and
  `dynamicResolutionOverBudgetHeadroomPercent`, `0`);
- history (`dynamicResolutionHistorySize`, `16`, whole 1 to 4096, and
  `dynamicResolutionFrameWeightExponent`, `0.9`);
- change period (`dynamicResolutionChangePeriod`, `8`);
- rise extent (`dynamicResolutionIncreaseAmortization`, `0.9`);
- change under which scale holds (`dynamicResolutionChangePercentThreshold`, `2`);
- consecutive over-budget frames that count (`dynamicResolutionMaxOverBudgetFrames`, `2`);
- whether a frame the CPU took too long is not over budget by GPU time
  (`dynamicResolutionUseCpuTimeLogic`, `false`).

No quality level writes any; with a numeric render scale none does anything
([ENGINE.md](../../engine/temporal-antialiasing.md#dynamic-resolution)).

```js
const world = createWorld('viewer', { renderScale: 'auto', maxFrameRate: 60 })
world.dynamicResolution = {
  dynamicResolutionFrameTimeBudgetMs: 12,
  dynamicResolutionHeadroomPercent: 20,
}
world.dynamicResolution = { dynamicResolutionHeadroomPercent: null } // back to the default 10
```

`world.maxFrameRate` (also `createWorld` option, `Infinity`): caps frames a second drawn, even while
the scene moves. The loop draws every whole number of refreshes, the fastest rate at or under the
cap (12: every 5th refresh at 60 Hz, every 10th at 120 Hz), so each image shows equally long;
refreshes between draw and count nothing, and `'auto'` render scale fits each image to the time the
cap gives. A write applies from next frame; a multi-world page caps out-of-focus worlds.
