# Loop

The world owns the loop and, as a game loop, draws a frame on every display tick while the page
shows: it never pauses because the image settled. Only a hidden page (its animation frames
stop) and `maxFrameRate` space the frames. `onFrame` is the per-frame hook.

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

`metrics.gpuFrameMs` is the GPU time of the last image the device timed, and stays at that reading
until the next one; `metrics.gpuTimer` says how the timer is doing: whether the device times at all
(`supported`, false without `timestamp-query`), every how many images it measures
(`sampleEveryFrames`), the images it opened for a measure and those whose readback came back
(`sampledFrames`, `completedSamples`), those given up unread (`droppedSamples`), the images it left
out by cause (`skippedFrames`: `unsupported`, `interval`, `busy`, `disposed`, `answering` — frames held on a pipeline still compiling or a target not granted, which drew nothing —, `overflow`), the readbacks in flight
(`pending`) and the timestamps it holds (`queryCount`, which grows once for an image that needs
more). It is `null` without `timestamp-query`.

```js
world.onFrame(({ metrics }) => {
  const timer = metrics.gpuTimer
  if (timer && timer.completedSamples === 0)
    console.log('no GPU time yet, skipped:', timer.skippedFrames)
  else console.log(metrics.gpuFrameMs, 'ms on the GPU')
})
```

`metrics.tessellationLoss` counts what the tessellation of displaced surfaces had no room for, since the device opened, as the samples (one image in fifteen, read without waiting) counted it: `queue`, the patches its splitting queue could not hold (`tessellationMaxCandidatePatches`), `visible`, those a visible list could not hold (`tessellationMaxVisiblePatches`), `windows`, the shadow-map windows past the room of the shadow chain, whose patches are not drawn, and `occluded`, the patches the occlusion test hid that the buffer keeping them for the post pass had no room for. Zero in each is the only healthy value; a count that grows is a hole in a displaced surface or in its shadow. It is `null` before a sample came back, and without a displaced surface.

```js
world.onFrame(({ metrics }) => {
  const lost = metrics.tessellationLoss
  if (lost && (lost.queue || lost.visible || lost.windows || lost.occluded))
    console.warn('tessellation lost patches:', lost)
})
```

`world.beforeFrame(hook)` runs `hook({ delta, time })` ahead of each drawn frame, after the
physics drew its bodies at that frame's time and the scene's clips advanced; `world.onFrame(hook)`
runs after the frame was drawn. A camera that follows something that moves — a chase camera behind
a vehicle, a view over a character — is written in `beforeFrame`: there it reads the pose this
frame draws, and the two are drawn together. Written in `onFrame`, it is drawn a frame later than
the body it follows, and the view judders against it at every uneven frame.

```js
world.beforeFrame(() => {
  const { position, quaternion } = car.body // the pose this frame draws
  // 6 m behind the car and 2 m above it, looking at it.
  world.camera.position.set(0, 2, 6).applyQuaternion(quaternion).add(position)
  world.camera.lookAt(position)
})
```

`world.render()` runs the loop's frame — clips, physics and `beforeFrame` hooks advance; only the
camera's controller is left to the host. A world you lead draws in `render()` alone: a change or a
resize asks no frame, and the next `render()` draws every change made since the last one (an object
added, a geometry or material written; `await world.awaitPages()` waits for them). A `render()` the
world cannot draw yet (its session opening, a part of the engine loading) draws and steps nothing,
and is drawn once it can, once. A value written on a node (`mesh.position.x = 100`,
`mesh.visible = false`, a light's intensity, colour or pose) and a light added or removed are seen
by the next frame, with no call. `world.setTransform(name, matrix)` moves a node the page holds no
handle to by its `object.name`, the world pose brought into its parent's space. An asynchronous
render failure stops automatic work, emits `INTERACTIVE_RENDER_FAILED` and is reported as an
uncaught error (`reportError`), so the page's `error` listener sees it.
