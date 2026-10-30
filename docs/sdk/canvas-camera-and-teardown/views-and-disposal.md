# Extra views and disposal

`world.addView({ canvas | viewport, camera?, renderScale?, temporalAntialiasing?, maxFrameRate? })`
draws the same world from another camera, into a canvas of its own (a canvas, an element to draw in,
or the ID of either), or over a `viewport` rectangle of the world's canvas, CSS pixels: one of the
two, else `INVALID_VIEW`.

- A view shares everything no camera changes: the scene, its placements, the pages and pools, the
  materials, the shadow pool (each view keeps the clipmap of a sun centred on its own eye; the local
  lights' maps and rendered pages are shared), the physics and the clips: no second scene, upload or
  simulation.
- It owns what a camera changes: its cut, visibility and occlusion pyramid, lighting resolve,
  temporal history and effects.
- Each world frame draws its own camera, then every view due, in the order added, in one loop and
  one budget: `'auto'` render scales fit the whole frame, every view's GPU time in it, to the
  refresh.
- `camera` is a perspective camera of its own by default; `renderScale` (`'auto'`),
  `temporalAntialiasing` (`true`) and `maxFrameRate` (`Infinity`: every frame of the world) read as
  the world's own, and are written on the returned `WorldView` from its next image, as are `camera`
  and `viewport`.
- `view.onFrame(({ delta, metrics }) => …)` runs after each frame that drew it; `metrics`
  (`ViewFrameMetrics`) carries its GPU time, passes, drawn size and scale, triangles and target
  bytes, and the world's frame lists the views it drew in `metrics.views`.
- `view.dispose()` takes it out, keeping a canvas the page gave it; `world.views` lists them, and
  `world.dispose()` takes them all.

Pages showing one scene several times (camera walls, stereo, plan views) add views; separate worlds
remain for different scenes or looks.

Dispose in the page's teardown, **not right after startup**: `world.dispose()` removes owned
controls, observers, queued frames and abort listeners and closes the engine, keeping the canvas.
`createJob` wraps `scene.load(url, { signal, onProgress })` for cancellation and an observable
status.
