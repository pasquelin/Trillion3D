# Loop

The world draws a frame on every display tick while the page shows. Only a hidden page and
`maxFrameRate` space the frames. `onFrame` is the per-frame hook.

```js
// 1. The world leads; you give it work per frame.
world.onFrame(({ delta, metrics }) => {
  ball.position.y = 1 + Math.sin(performance.now() / 500)
  world.invalidate() // I moved something: draw again
})

// 2. You lead; the world schedules nothing.
const world = createWorld('viewer', { interactive: false })
function tick() {
  ball.rotation.y += 0.01
  world.render()
  requestAnimationFrame(tick)
}
tick()
```

`metrics.gpuFrameMs` is the GPU time of the last image the device timed. `metrics.gpuTimer` (`null`
without `timestamp-query`):

- `supported`; `sampleEveryFrames`; `sampledFrames`, `completedSamples` (read back);
  `droppedSamples`; `pending` readbacks; `queryCount` timestamps held;
- `skippedFrames` by cause: `unsupported`, `interval`, `busy`, `disposed`, `answering` (pipeline
  compiling or target not granted; drew nothing), `overflow`.

```js
world.onFrame(({ metrics }) => {
  const timer = metrics.gpuTimer
  if (timer && timer.completedSamples === 0)
    console.log('no GPU time yet, skipped:', timer.skippedFrames)
  else console.log(metrics.gpuFrameMs, 'ms on the GPU')
})
```

`metrics.tessellationLoss` counts what displaced-surface tessellation had no room for since the
device opened (sampled one image in fifteen); zero is healthy, growth is a hole in a displaced
surface or its shadow; `null` before a sample and without a displaced surface:

- `queue`: patches its splitting queue could not hold (`tessellationMaxCandidatePatches`);
- `visible`: patches a visible list could not hold (`tessellationMaxVisiblePatches`);
- `windows`: shadow-map windows past the shadow chain's room (patches not drawn);
- `occluded`: patches the occlusion test hid that the post-pass buffer had no room for.

```js
world.onFrame(({ metrics }) => {
  const lost = metrics.tessellationLoss
  if (lost && (lost.queue || lost.visible || lost.windows || lost.occluded))
    console.warn('tessellation lost patches:', lost)
})
```

`world.beforeFrame(hook)` runs `hook({ delta, time })` before each drawn frame, after physics and
clips advanced; `world.onFrame(hook)` runs after. A camera following a moving body belongs in
`beforeFrame` (in `onFrame` it is a frame late).

```js
world.beforeFrame(() => {
  const { position, quaternion } = car.body // the pose this frame draws
  // 6 m behind the car and 2 m above it, looking at it.
  world.camera.position.set(0, 2, 6).applyQuaternion(quaternion).add(position)
  world.camera.lookAt(position)
})
```

`world.render()` runs the loop's frame (clips, physics, `beforeFrame` hooks); only the camera's
controller is left to the host. A world you lead draws in `render()` alone, which draws every
change since the last (`await world.awaitPages()` waits for pages). A `render()` before the world
can draw (session opening, engine part loading) steps nothing and is drawn once it can. Values
written on a node (`mesh.position.x = 100`, `mesh.visible = false`, a light's intensity, colour or
pose) and lights added or removed show next frame, with no call. `world.setTransform(name,
matrix)` moves a node by its `object.name`, world pose brought into its parent's space. An
asynchronous render failure stops automatic work, emits `INTERACTIVE_RENDER_FAILED` and is
reported via `reportError`.
