# Trillion3D SDK

The public guide: what a page and a Node host write against. How the engine draws underneath is
[ENGINE.md](ENGINE.md), what stays in memory [RESIDENCY.md](RESIDENCY.md), the compiler
[COMPILER.md](COMPILER.md), the cache [FORMAT.md](FORMAT.md), the physics engine in a worker
(every body an ordinary mesh with `physics` set) [PHYSICS.md](PHYSICS.md), the batch and unit
maths for hosts [MATHS.md](MATHS.md). Installation, the licence and the current limits are in the
[README](../README.md#current-limits).

Every public import uses `trillion3d`; conditional exports select the common, browser or Node
API ([Entry points](#entry-points)). `SDK_VERSION` and `FORMAT_VERSION` are independent.

## Terms

- **World** — what `createWorld` returns. It owns the scene, the camera, the renderer and the
  loop; nothing else is constructed.
- **Scene** — `world.scene`, the root objects are added to; a **model**, a compiled manifest, is
  loaded into it with `scene.load(manifestUrl)` like any other addition.
- **Renderer** — the WebGPU drawing path of a world. A host never imports, names or holds one.
- **Host** — the page that creates a world: it owns the canvas, the layout and the disposal.
- **Pose** — a camera framing: `{ position, target, fov? }`.
- **Witness** — a comparison library of the bench, named only through the measurement entry point;
  it never reaches a published world.

`explorer` and `backend` are not public vocabulary.

## Principles

1. **Hosts use the public exports.** Engine, formats and contracts depend on no framework; a host
   (a page, an Electron app, a Node script) imports `trillion3d`, never `packages/` internals
   ([package architecture](../packages/README.md)).
2. **Preparation is compiled and versioned.** Expensive assets are built outside the interactive
   loop, versioned with their schemas and loaded after manifest validation: no frame pays for it.
3. **The host application is never degraded.** The SDK negotiates capabilities, disables an
   optimisation whose measured overhead exceeds its benefit, and recovers from an error, a device
   loss, memory exhaustion or thrashing on the renderer already in use.
4. **Recovery is silent.** No technical warning at normal startup; full diagnostics in developer
   mode; a concise notice only when the machine grants no WebGPU device. Recovery keeps the scene
   state, with no flash, blank screen or visible restart.

## Entry points

`trillion3d` 1.0.0 has one specifier with three environment branches, plus one prebuilt module:

| Import              | Resolver context                        | Source                      | Surface                                                                                                                                         |
| ------------------- | --------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `trillion3d`        | Node ESM, `node` condition              | `packages/sdk/node.mts`     | common and native compilation; Node types, no DOM or WebGPU                                                                                     |
| `trillion3d`        | browser bundler, `browser` condition    | `packages/sdk/browser.ts`   | common and browser rendering; no `node:*` module reachable                                                                                      |
| `trillion3d`        | worker, common code, any other resolver | `packages/sdk/index.ts`     | common maths and contracts; no DOM, WebGPU, filesystem or process API                                                                           |
| `trillion3d/module` | a page without a bundler, a CDN         | `dist/trillion3d.module.js` | the browser branch built as one module, its workers, WebAssembly and chunks beside it ([README](../README.md#public-sdk)); browser declarations |

`browser` precedes `node`, and the final default is the common branch: a resolver that ignores
`browser` or has no platform condition gets the safe common facade. SSR resolves the Node branch.
Importing any branch creates no renderer, worker, DOM object, GPU object or compiler process.

The measurement entry point (`packages/sdk-browser/src/measurement/measurement.ts`: the browser
branch plus the measured world, the backend factories and choice) has no subpath in `exports`, so
it never reaches a package consumer; `bench/witnesses/measurement.ts` adds the witness entry.

`apiInventory()` (`scripts/sdkApi/sdk-api-inventory.ts`) lists, with the TypeScript checker, every entry
point and binding the facades expose.

## Create a world

```js
import { createWorld, object, geometry, material, light } from 'trillion3d'

const world = createWorld('viewer') // the id of a canvas, or the element itself

const ground = object.mesh(geometry.plane(20, 20), material.meshStandard({ color: 0x8899aa }))
const ball = object.mesh(
  geometry.sphere(1, 64, 32),
  material.meshStandard({ metalness: 0.9, roughness: 0.1 }),
)
ball.position.set(0, 1, 0)

world.scene.add(ground, ball)
world.scene.add(light.directional({ intensity: 3, position: [5, 10, 2] }))
world.scene.add(light.ambient({ intensity: 0.2 }))

world.camera.position.set(0, 3, 8)
world.camera.lookAt(0, 1, 0)

await world.scene.load('assets/city/manifest.json') // a compiled model, added like the rest
```

`world.ready` resolves once the renderer is prepared; earlier additions and loads are queued.
`scene.load` takes a real `manifestUrl` (there is no default) and the `slice` scope unless told
`{ scope: 'full' }`; another scope's pointer or manifest is rejected with `SCOPE_MISMATCH`.

**Progress.** `scene.load(url, { onProgress })` reports with `createJob`'s `JobProgress` shape:

| Phase                                      | When                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ phase: 'bytes', completed, total }`     | from the manifest's read: `total` every file it declares, at once; each chunk read adds to `completed`, whatever the server says of length or compression; the ratio never goes down, and the last event, unneeded files dropped, has `completed === total` (a manifest declaring no file: one event, at the end) |
| `{ phase: 'manifest' }`                    | once the manifest is read                                                                                                                                                                                                                                                                                         |
| `{ phase: 'tables' }`                      | once the scene tables are                                                                                                                                                                                                                                                                                         |
| `{ phase: 'resources', completed, total }` | as each file the scene reads lands                                                                                                                                                                                                                                                                                |

`await world.awaitPages({ onProgress })` settles once the pages the view reads are resident:
`{ phase: 'session' }` while the drawing session opens, then `{ phase: 'pages', completed, total }`,
`total` each page the view reads, once, the last event `completed === total`. One callback for both
drives a progress bar from first byte to first pages. A session
closed during the wait (a lost device, an option it cannot take in place) never rejects it: the
wait goes on with the reopened one.

**Vertices.** `scene.load` reads no vertex buffer (`source.bin`): pages draw the model, and the
buffer is read once, on first need. Until `geometry.loadVertices()` resolves, `array`, `getX` and
every synchronous vertex read of a loaded mesh throw `VERTICES_NOT_LOADED`; `count` is known at
once.

```ts
await geometry.loadVertices() // reads the model's buffer once, whichever mesh asks first
const x = geometry.attributes.position.getX(0)
```

**Probing a cache.** `assertCachePointer(pointer, scope)` (which returns the cache URL) and
`assertCacheRoot(root, scope)` run `scene.load`'s first checks with no page downloaded, raising
`INVALID_POINTER`, `CACHE_NOT_READY`, `SCOPE_MISMATCH`, `UNSUPPORTED_FORMAT` or `INVALID_CACHE`.

### Files over HTTP

Every model file read over HTTP — manifest, tables, binary, images, lights, pages, cooked physics,
the WebAssembly modules — goes through one loader. A failure that may pass (the network, 408, 429,
5xx) is asked again once after its `Retry-After` wait (ten seconds at most), or by the reader's own
retry (a physics tile's next update). The page streamer and the HTTP page source ask a page again
`streamingNumRetries` times (3 by default, a negative value without end), at once, whatever the
failure, with no wait but the server's `Retry-After`; a page past its last try fails for good, its
object invalid: no page of it is asked for again. The baked texture levels follow the same count: asked again by each
frame that wants them, `streamingNumRetries` times, then given up. What still fails is `RESOURCE_HTTP_ERROR` (`details.url`, `details.status`, `null`
for the network). `lights.json` and `physics.json` are absent, not failed, on a 404 or a hiding
store's 403. An unreadable `kernels.wasm` leaves the batch kernels to their JavaScript twins.

The optional families ([README](../README.md#public-sdk)), the world stream and each
renderer are chunks imported on first use, a failed import tried once more at once; what still
fails is `FAMILY_LOAD_FAILED` (`T3D-E090`, `details.family`) on
`world.diagnostic.error` (and `world.physics.error`), asked again at the next use, ten seconds later
at the soonest. Frames that need a family wait for it, never draw without it. A page downloads only the renderer it draws with.

**Debug mode** (`createWorld(target, { debug: true })`, `world.diagnostic.debug = true`, `?profile` in the address) files frames into `world.cpuSteps` and the frame report
(`EngineProfiler`). The pass mapping (`gpuPassStageOf`, `gpuPassBlockOf`, `gpuPassBlockTotals`)
is the engine's own, there from the first frame; a page reading the frame report from its first
frame turns debug mode on before it.

`world.openCpuSteps()` opens a CPU step window of the caller's own: `read()` summarises the images
filed since it opened (or since its last read) and opens it again, `close()` stops it. It fills
outside debug mode while it is open, and does not move `world.cpuSteps()`. The stats module
(`startStats(world, { parts, parent?, corner?, words?, worlds? })`, handle `read`, `stop`, `ready`)
reads one for its CPU section, open only while full reports are asked for.

**Frame inspection.** `await world.diagnostic.inspect()` reads what the main view's next image
computed, in world metres, for a map drawn from above (`FrameInspection`, `null` when the session
closed first):

- `camera`, `cutCamera`: the eye, its forward axis, the near plane's four corners and the edges
  leaving them (the far plane is at infinity). `cutCamera` is the camera the cut was made from.
- `clusters`: the cut's clusters, up to 2^18. Each has a world box (`bounds`), a DAG `level`
  (0 is the finest), its `triangles` and a `state` from `CLUSTER_STATE`: `kept` (drawn by the
  cut's main pass or its post pass) or `missing` (asked and not resident, its ancestor drew
  instead). `frustumRejected` counts the clusters cut outside the frustum; `occluded` the items the
  previous image's depth hid in the main pass, held for the post pass, and `postHidden` those the
  post pass's depth then hid for good.
- `shadows`: one record per shadow map. A sun's clipmap level places its mapped pages as four
  world corners each, on the plane through the level's centre facing the light. `rendered` marks
  the pages drawn this image; the others served their cached depth. A local light's map counts
  its pages (`mappedCount`, `renderedCount`) without placing them.
- `reflections`: the traced rays, one grid texel in `stride`², up to 2^14. Each has an origin on
  its surface, a direction and the distance to its hit (`Infinity` when it met nothing near). The
  counts are `towardCamera` (against the view's axis), `offView` (the hit is outside the view)
  and `missed`.
- `lights`: each light's kind, position, direction, reach (`range`), shadow casting, and whether
  its reach meets the view (`seen`).

`world.diagnostic.freeze = true` freezes the main view's cluster cut and occlusion at the camera
of that moment, while the camera keeps moving and drawing. Views beside it are not frozen.
Use it with `world.diagnostic.mode = 'xray'`, which draws the edges of every triangle the cut
submitted through the surfaces, with no depth test. Then step aside: geometry that the frustum,
the detail levels, the HLOD or the occlusion test dropped is missing, and geometry that was
submitted shows even behind a wall.

Cost: none while unused. A frame only tests one absent callback, and the reading code is in the
diagnostics chunk, which loads on the first call. Each call adds the CPU copy of the cut's
lists, plus one device copy of the occlusion verdicts, the shadow page table rows and the sampled
reflection texels. That copy goes through the capture ring and is mapped about one frame later;
the frame never waits for it.

## API rule

| Kind                     | Used for                                                                                                                                                | Examples                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **property**             | state that is read and written; a setter applies its own consequences — the projection update, the next frame — so a host never calls an update by hand | `camera.near = 0.1`, `light.intensity = 2`, `world.exposure`, `world.pixelError`, `world.controls.kind` |
| object with **`.set()`** | a value with several components                                                                                                                         | `position.set(0, 1, 0)`, `repeat.set(4, 4)`, `color.set(0xcc3344)`                                      |
| **method**               | an action or a computation                                                                                                                              | `lookAt`, `add`, `load`, `invalidate`, `render`, `world.stageProfile()`, `world.awaitPages()`           |

## Naming rule

Families are **singular**. Inside one, a member that produces a thing of the scene is named after
the thing (`geometry.box`); a member that sets up machinery is `create` + its name
(`page.createStreamer`).

## Families

Thirteen families describe the scene:

| Family              | What it is                                                                                      | Example                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `geometry`          | the shape alone, with no matter                                                                 | `geometry.sphere(1, 64, 32)`, `geometry.tube(math.path(points), 64, 0.2)`                                            |
| `material`          | the matter alone, with no shape                                                                 | `material.meshStandard({ color: 0x8899aa, metalness: 0.9 })`, `material.meshPhysical({ transmission: 1, ior: 1.5 })` |
| `object`            | shape and matter, placed in the scene                                                           | `object.mesh(geometry.sphere(1), steel)`, `object.group()`                                                           |
| `light`             | lights                                                                                          | `light.ambient({ intensity: 0.2 })`, `light.spot({ outerConeAngle: 0.4, innerConeAngle: 0.1, distance: 30 })`        |
| `camera`            | cameras                                                                                         | `world.camera = camera.perspective({ fov: 55, near: 0.1, far: 500 })`                                                |
| `math`              | vectors, quaternions, boxes, paths                                                              | `math.vector3(0, 1, 0)`, `math.box3().setFromObject(set)`                                                            |
| `texture`, `loader` | pictures                                                                                        | `const albedo = await loader.texture('wood.jpg')`, `albedo.wrap = wrap.repeat`                                       |
| `helper`            | the marks you work with                                                                         | `helper.grid(20, 20)`, `helper.axes(2)`                                                                              |
| `controls`          | handles that move an object with the mouse                                                      | `controls.transform(world).attach(ball)`                                                                             |
| `animation`         | clips and mixers                                                                                | `animation.createMixer(set)`, `animation.clip('bob', 2, [track])`, `mixer.play(bob)`                                 |
| `buffer`            | a geometry built by hand                                                                        | `geometry.createBuffer({ position: buffer.float32(vertices, 3), index: buffer.uint32(indices) })`                    |
| `effect`            | post-processing                                                                                 | [Canvas, camera and teardown](#canvas-camera-and-teardown)                                                           |
| constants           | `blending`, `side`, `wrap`, `filter`, `colorSpace`, `toneMapping`, one named value per constant | `steel.side = side.double`, `world.toneMapping = toneMapping.none`                                                   |

Eight more exist because geometry is **cut into pages** the engine moves in and out of memory
according to what the frame reads:

| Family       | Members                                                      | What it does                                                     | Example                                                                                                                                            |
| ------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`       | `createStreamer`, `createCache`, `httpSource`, `decode`      | geometry in pages                                                | `page.createStreamer({ source: page.httpSource('assets/forest/', { pages, cache: createPageCache() }) })`, passed as `scene.load(url, { stream })` |
| `budget`     | `geometryPool`, `texturePool`                                | fixed envelopes, not wishes                                      | `world.budget.geometryPool = 512 * 1024 * 1024`                                                                                                    |
| `metric`     | `frame`, `gpuPasses`                                         | what the image cost, never estimated                             | `metrics.selectedTriangles`, `metrics.residentPages` in `world.onFrame`; `metric.gpuPasses(world)`                                                 |
| `diagnostic` | `createChannel`, `presentationColor`, `transparentOcclusion` | watching the engine work                                         | `world.diagnostic.mode = 'clusters'` (or `'wireframe'`, `'triangles'`, `'beauty'`)                                                                 |
| `capability` | `detect`, `lighting`                                         | what the machine grants, before an image is promised             | `(await capability.detect()).webgpu`                                                                                                               |
| `capture`    | `surface`, `buffer`                                          | an image aside, at another resolution, without touching the view | `capture.surface(world, { width: 3840, height: 2160 })`                                                                                            |
| `pose`       | `fromBounds`, `runPath`, `pointOfInterest`                   | named poses, automatic framing, replaying a path                 | `world.camera.set(pose.fromBounds(math.box3().setFromObject(set)))`                                                                                |
| `batch`      | `transformPoints`, `composeMatrix4`, `frustumKeepsBox`       | a thousand matrices at once instead of a loop                    | `batch.composeMatrix4(outputs, positions, quaternions, scales, 1000)`                                                                              |

`metric.frame(world)` is never `null`: before the first frame it holds every metric key, the
totals (`cpuFrameMs`, `pageLoads`, `pageBytesRead`) at zero and every measure `null` — not measured,
never a zero that would read as an empty frame.

The world is not a family: it carries `scene`, `camera`, `budget`, `diagnostic`, `controls`,
`onFrame`, `render`, `invalidate` and `dispose`. There is no level-of-detail object and no
instanced or batched mesh type: the DAG cut, instancing and draw grouping are native.

In a compiled scene, moving a node or its parent moves the reach of the bounce's rays and restarts bounce
probe convergence, with no invalidation call: the rays march the global distance field, which the
cut's own placements keep current.

## Loop

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

## What draws

WebGPU only: a machine that grants no WebGPU device is refused by name, `WEBGPU_UNAVAILABLE`, on
the `fatal` event of the session and on `world.ready`. The frame:
[ENGINE.md](ENGINE.md#the-frame-in-order).

## Canvas, camera and teardown

The drawing buffer follows the canvas's CSS box, and `pixelRatio` the browser's, unless set;
`world.resize(width, height)` sets a size, omitted arguments reading the CSS box. A canvas hidden or
zero-size at creation needs an explicit `resize()` or showing first; one hidden later keeps its last
size.

`world.pixelError` is the DAG cut's screen error in pixels (`1` by default: a coarser level strays
at most one pixel from the finer one; `0` keeps the exact leaves, a larger value selects coarser
pages when the cache has them). `pose.fromBounds(box)` frames a box,
`pose.pointOfInterest(name, pose)` names one, `pose.runPath(world, poses, { images })` replays a
path, one display frame per pose, and answers the frames drawn, their CPU time summarized and the
display cadence.

`world.temporalAntialiasing` (option of `createWorld` too, `true` by default) jitters each image by
a sub-pixel offset and accumulates; `false` draws pixel centres with no history, as a pixel-exact
capture needs. A write applies next frame, no session reopened; a read says what the image carries.
`world.temporal` holds the pass's settings beside its level, each an option of `createWorld` too:
`temporalThinGeometry` (`false`) looks for geometry thinner than a pixel — a wire, a rail, which the
pixels it crosses see on some images and not on others — and relaxes the history there, at any level
but `'off'`, for the cost of the finding in every image. `temporalShadingRejectionMode` (`'stability'` or
`'responsive'`, `'stability'` by default) sets how the shading rejection widens its clamp: `'stability'` is
steadier and controls the rejection better but ghosts more; `'responsive'` widens the clamp by the blur
of the lesser total variation of the input's change and of the input, so it rejects less and ghosts
less, with blockier artifacts. Three settings ride on the level (table below):
`temporalResurrection` keeps older frames to bring a disoccluded pixel's detail back,
`temporalReprojectionField` reprojects the history by a field rather than by the dilated vector alone,
and `temporalShadingRejectionFlickering` widens the shading rejection by the flicker measure; each is
`'level'` (the default: the level's own choice), `'on'` or `'off'` whatever the level, at any level but
`'off'`. Three settings shape the history where it resurrects and reprojects by a field:
`temporalResurrectionFrames` (`2`, a
whole number of at least 1, rounded up to an even count) is the number of frames the history keeps
for good beside the last two, each costing a history's bytes; `temporalResurrectionInterval` (`31`,
a whole number of at least 1, made odd) is the number of images between two stored for good;
`temporalReprojectionFieldSpeed` (`0.125`, 0 or more) is the speed, in display pixels an image, from
which the field anti-aliases the edge of a moving surface. Three settings choose how its programs run,
the image the same: `temporalWaveOps` (`true`) gathers the half-size image the scene's chain reads
through the lanes of a subgroup, where the device grants `subgroups` at 16, 32 or 64 lanes (else through
workgroup memory); `temporalWaveSize` (`0`, the device's smallest size from 16; or 16, 32, 64 where the
device runs it) names the size; `temporalHalfPrecision` (`true`) runs the spatial anti-aliaser in 16-bit
floats where the device grants `shader-f16`. `temporalHistoryPacked` (`true`) keeps the history's colour in the 11-11-10 format where the device stores to it, four bytes a pixel; `false` keeps half floats, eight bytes, a finer blue and shadows (the `cinematic` preset writes it); the pass is made again when it changes. A write names the settings it changes, `null` one's default;
a value of another kind is refused by name.

Sixteen more settings are the reference's own knobs of the pass, each at its default. The history's
laws take four: `temporalHistorySampleCount` (`16`, 8 to 32) is the most samples a display pixel's
history holds, more steadying the highlights of a still image and ghosting more on fireflies;
`temporalShadingRejectionSampleCount` (`2`, 0 or more) is what it keeps after a total shading
rejection, lower clearer after one and less steady; `temporalVelocityWeightClampingSampleCount`
(`4`, 0 or more, in samples of a history pixel) is what it keeps once its pixel moves at
`temporalVelocityWeightClampingPixelSpeed` (`1`, above 0, in half display pixels an image), higher steadier
on a movement and blurrier. The flicker measure, where the shading rejection widens by it (`temporalShadingRejectionFlickering`),
takes four: `temporalFlickeringPeriod` (`2`, 0 or more, in images; `0` runs no measure) is the period at
which a luma oscillation, or a faster one, is a flicker the pass lets ghost;
`temporalFlickeringAdjustToFrameRate` (`true`) shortens it in proportion where the frame rate falls below
`temporalFlickeringFrameRateCap` (`60`, hertz above 0), so an effect animated in time is not taken for a
flicker; `temporalFlickeringMaxParallaxVelocity` (`10`, above 0) is the parallax speed, in pixels of a
1080p image at that frame rate, past which a texel is moving, not flickering.
`temporalShadingExposureOffset` (`0`, -20 to 20) adds stops to the exposure the rejection measures the
colours at, lifting the shadows it sees. Seven settings tune the thin geometry detection where
`temporalThinGeometry` runs it: `temporalThinGeometryErrorMultiplier` (`200`, 0 or more; a twentieth of
it, ten at the default, is the depth step in pixel depth errors past which a texel is a thin line),
`temporalThinGeometryMinKeepLineContrast` (`0.3`, 0 to 1; the luma contrast of a thin line of light),
`temporalThinGeometryLineFadeRate` (`0.1`, 0 to 1) and `temporalThinGeometryLineFadeRateInsideRegion`
(`0.03`; how often a high contrast line not seen again fades, outside and inside a cluster hole
region), `temporalThinGeometryLineWeight` (`0.6`; the relaxation weight near a high contrast line),
`temporalThinGeometryMaxRelaxationWeight` (`0.037`, 0 to 1; the greatest weight by which a cluster hole region
relaxes the history, before a 3×3 average spreads it) and `temporalThinGeometryRejectTranslucency` (`0.6`; the share of a texel's luma that the translucent layers
make, past which its thin geometry is rejected, `0` never) and `temporalThinGeometryShadingRange` (`'foliage'`, `'foliageAndHair'`, `'all'` or `'varying'`, `'varying'` by default; the shading models counted as thin geometry: `'varying'` counts every lit surface and relaxes the two-sided foliage with the dilation, the others by their edge alone, and needs the flicker measure running (`temporalFlickeringPeriod` above `0` and `temporalShadingRejectionFlickering` on) or `temporalThinGeometryMinKeepLineContrast` above `0`, else only the foliage counts). `temporalThinGeometryAntiFlickering` (`true`) has the flicker measure
consider the relaxation the detection gives the history, since the detection can fail to find some thin
geometry; `false` measures the flicker as if the history were not relaxed (the shading rejection itself
is relaxed either way). It applies where `temporalThinGeometry` runs and the flicker measure runs.
`temporalDownsampleQuality` (`'low'` or `'high'`, `'low'` by default)
says how the half-size image the exposure and the bloom read is made: `'low'` has the temporal pass
and the motion blur write it beside their own image, one filtered sample of four pixels, and the
chain's own pass only where neither draws; `'high'` has the chain draw it alone, four filtered
samples of the 4 × 4 pixels around a texel, steadier on a bright pixel in motion, for the cost of
that pass.

| Level (`temporalAntialiasing`) | History | Resurrection | Reprojection field | Flicker rejection | Spatial anti-aliaser samples a side |
| ------------------------------ | ------- | ------------ | ------------------ | ----------------- | ----------------------------------- |
| `'low'`                        | 100 %   | no           | no                 | no                | 0                                   |
| `'medium'`                     | 100 %   | yes          | no                 | no                | 3                                   |
| `'high'`                       | 100 %   | yes          | yes                | yes               | 3                                   |
| `'max'`                        | 200 %   | yes          | yes                | yes               | 8                                   |

The resurrection, the reprojection field and the flicker rejection columns are the defaults of the
three settings above: a setting that says `'on'` or `'off'` overrides its column at any level.

The history is kept at the percent of the display's size the level names, resolved down to the
display's before composition; a device that cannot make it that large (a side past its largest
texture) keeps it at 100 %. Its colour is stored in the
11-11-10 format and its validity in one 8-bit channel where the device stores to them (feature
`texture-formats-tier1`), else in half floats and four 8-bit channels. At 1920 × 1080 the `'max'`
history is 3840 × 2160 and four frames of 5 bytes a pixel, 166 MB (398 MB in half floats); at
5120 × 3280 it is 10240 × 6560, 1.34 GB (3.22 GB), and a device whose largest texture is 8192 keeps
it at 100 %, 336 MB (806 MB).

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

`world.softwareRaster` (option of `createWorld` too, `true` by default) rasters in compute each
cluster whose longest edge projects under `world.hardwareRasterEdgePixels` (option of `createWorld`
too, `32` by default, a finite number of pixels above zero) and whose box crosses neither clip
plane; every other cluster goes to the hardware rasterizer, and `false` hands it every one.
`world.depthBucketing` (option of `createWorld` too, `true` by default, the reference's) rasters
the software raster's cutout clusters nearest first, so that a
hidden cutout pixel leaves before its texture is read: each cluster is put in one of 256 buckets
spread by the logarithm of the view depth of its box between `world.depthBucketsMinZ` (`10`) and
`world.depthBucketsMaxZ` (`1000`), in metres, finite numbers above zero (the reference's
centimetres, `1000` and `100000`). As in the reference, the order is made only where the scene holds
voxels; it never changes a pixel. All five are render settings: the page's value holds over the
quality preset, a write applies next frame, and a value of another kind is refused by name.

```js
const world = createWorld('viewer', { softwareRaster: true, hardwareRasterEdgePixels: 32 })
world.softwareRaster = false // every cluster on the hardware rasterizer, from the next frame
world.hardwareRasterEdgePixels = 16 // fewer clusters on the software raster
world.depthBucketing = false // the cutout clusters unordered
world.depthBucketsMaxZ = 500 // the buckets end at 500 m
```

`world.cut` holds the cut's settings, each an option of `createWorld` too: `cutTwoPassOcclusion`
(`true`: the main view tests what it cuts against the previous image's depth, then what that hid
against the depth it just drew), `cutOcclusionCulling`, `cutFrustumCulling` and `cutMinLodCulling`
(`true`: each test on), `cutDrawDistanceCulling` (`true`: an object that names a draw distance —
`drawDistance`, [COMPILER.md](COMPILER.md#object-settings) — is culled outside it, in the cut, in
the sun's shadows and in the rays' scene; `false`, every instance of an instanced mesh is drawn at
every distance, while an object of its own is always culled by its distances),
`cutDistanceCullToSphereEdge` (`true`: an object's draw distance is measured to the edge of the
sphere of its bounds; `false`, to its centre), `cutViewDistanceScale` (`1`, a finite number of at
least 0: the scale every draw distance is multiplied by; the quality levels write it, 0.4 at
`smooth`, 0.6 at `balanced`, 0.8 at `fine`, 1 at `max`, 10 at `cinematic`), `cutViewDistanceApplySecondaryScale`
(`false`) and `cutViewDistanceSecondaryScale` (`1`): a second scale of the draw distances, applied
beside the first once the switch is on, `cutViewDistanceFovMinAngle` (`45`) and
`cutViewDistanceFovMaxAngle` (`90`), two horizontal fields of view in degrees from 0 to 360, with
`cutViewDistanceFovMinAngleScale` and `cutViewDistanceFovMaxAngleScale` (`1` both, 0 or more): the
scale the draw distances of an object of its own take at the first angle and under, at the second
and over, and linearly between (an orthographic view counts as 0 degrees; at 1 and 1 nothing
changes), `cutEdgeScaleBudgetMs` (`0`, none) and `cutEdgeScaleMinPercent` (`30`): a GPU time budget
for the main view's cut and its raster that coarsens its threshold, no further than that share of
its scale, while the render scale is `'auto'`, `cutLodBiasFollowsUpscale` (`true`: an upscaled image's screen error follows
the display over the render width), `cutLodBiasOffset` (`0`) and `cutLodBiasMin` (`-2`), that bias's
offset and floor in powers of two, and the caps of its lists, `cutMaxNodes` (`2097152`),
`cutMaxCandidateClusters` (`16777216`) and `cutMaxVisibleClusters` (`4194304`): past one, the cut
draws what fits and warns. Of these only `cutViewDistanceScale` is written by a quality level: a
value the page set holds over the preset. A write names the settings it changes, `null` one's
default; a value of another kind is refused by name ([ENGINE.md](ENGINE.md#webgpu-page-raster)).

```js
const world = createWorld('viewer', { cutTwoPassOcclusion: true })
world.cut = { cutLodBiasFollowsUpscale: false } // the screen error ignores the upscale, next frame
world.cut = { cutViewDistanceScale: 0.5 } // every object's draw distance halved
world.cut = { cutViewDistanceFovMaxAngleScale: 0.5 } // an object of its own: halved at 90 degrees and over
world.cut = { cutEdgeScaleBudgetMs: 6 } // with renderScale 'auto': the cut coarsens above 6 ms
```

`world.hiz` holds the depth pyramid's settings, each an option of `createWorld` too: `hizTrace`
(`'reference'`: the reflections' trace walks the closest opaque depth of each half-resolution texel,
mip by mip, down to the full-resolution depth, as the reference's does; `'planes'`: it reads each pixel as a plane, which keeps a hit on
a grazing surface that the centre alone passes over), `hizFoldTransparents` (`false`: the trace
layers hold the opaque depth alone; `true`, the nearest transparent surface of each pixel too, so a
ray stops at glass) and `hizTransparentTest` (`'finer'`: a transparent cluster is tested over up to
sixteen texels a side of a fine level; `'reference'`: over four texels a side of the lowest level
that holds it; the image is the same, `'finer'` rejects more clusters), `hizFullResDepth` (`true`: the screen probes' `'reference'` walk goes down to
the full-resolution depth; `false` stops at the half-resolution level, a little less exact and
cheaper; the reflections' walk always goes down) and `lightGridHizCull` (`true`: the light grid
leaves empty the cells behind the farthest depth of their column of the image, read from the pyramid
the image built; `false` lists every cell the lights reach), `lightGridLinkedLists` (`true`: the cells'
lists are chains of links taken from one pool shared by the whole grid, and when links run short each
cell keeps the first lights of its list; `false`: each cell has its own `lightGridMaxCulledLightsPerCell`
words and keeps its first lights up to them) and `lightGridMaxCulledLightsPerCell`
(`32`: the light entries the view's light grid holds per cell, from 1 to 1024; the pool holds that
many for each cell; the lights asked past it are dropped, with one console warning). The cut's occlusion reads
the culling layer, which no setting changes. A write names the settings it changes, `null` one's
default; a value of another kind is refused by name.

```js
const world = createWorld('viewer', { hizTrace: 'planes' })
world.hiz = { hizTrace: null, hizFoldTransparents: true } // the default trace, glass in the pyramid
world.hiz = { hizFullResDepth: false, lightGridHizCull: false } // half-resolution probe walk, no cull
world.hiz = { lightGridLinkedLists: false, lightGridMaxCulledLightsPerCell: 64 } // 64 words of its own a cell
```

`hizPrime` (`'off'`) builds, before a view's cut tests anything, a primed pyramid from a small,
coarse draw of the objects that set `farField` (`object.farField = true`, `false` by default; a saved
scene keeps it when `true`), for the cut's main pass to test against: `'whenMissing'` for an image
whose view has no pyramid of the image before (its first, one after a resize, one after a cut of
the camera), `'always'` for every image. The draw is the image's size shifted right by
`1 + hizPrimeSizeBias` (`2`: an eighth), its depth pushed away from the eye by `hizPrimeDepthBias`
metres (`1.5`), its clusters cut at `hizPrimeErrorScale` (`32`) times the image's pixel error;
`hizPrimeFarFieldOnly` (`true`) draws the flagged objects alone, `false` the whole cut. With no
object flagged it draws nothing and costs nothing. The image is the same: the primed pyramid only
lets the main pass skip what it hides, and the post pass judges again what it hid.

```js
const world = createWorld('viewer', { hizPrime: 'whenMissing' })
mountains.farField = true // this object is drawn into the primed pyramid
world.hiz = { hizPrime: 'always', hizPrimeDepthBias: 3 } // every image, pushed away by 3 metres
world.hiz = { hizPrime: null } // back to the default, 'off'
```

`hzbOcclusion` (`0`) makes the main view leave out the objects the depth it drew hides. At `1` (or `2`, forced) the world box of
every object is projected each image and walked against the farthest depth of the pyramid, with the walk the transparent clusters are
tested with under `hizTransparentTest: 'reference'` (the lowest level that holds the box in four texels a side); the verdicts are copied
for the CPU and come back a few images late, and an object found behind the depth is left out of the next images' cut, in front again
when a test finds it so. An object with no box, outside the view or within `hzbOcclusionNeverTestDistance` metres (`0`) of the eye is
never rejected, and the shadow maps never see the verdict. `hzbOcclusionExpandAmount` (`0`) metres and
`hzbOcclusionExpandScreenSpace` (`0`) pixels grow every tested box, which hides fewer objects and shows fewer of them late;
`hzbOcclusionExpandNewlyAmount` and `hzbOcclusionExpandNewlyScreenSpace` (`0`) grow, beside them, an object not tested for
`hzbOcclusionFramesNotTestedToExpand` (`5`) images for the next `hzbOcclusionFramesToExpandNewly` (`2`) images it is tested in.

```js
const world = createWorld('viewer', { hzbOcclusion: 1 })
world.hiz = { hzbOcclusionExpandScreenSpace: 8, hzbOcclusionNeverTestDistance: 2 } // grown by 8 pixels, none tested within 2 m
world.hiz = { hzbOcclusion: null } // back to the default, none
```

`world.tessellation` holds the settings of the run-time tessellation, each an option of
`createWorld` too. A write names the settings it changes, `null` one's default; a value of another
kind is refused by name. They are render settings: the page's value holds over the quality preset (no
preset level writes them), and a write applies next frame.

| Setting                           | Takes                                                                                                                                  | Default   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `tessellation`                    | `true` / `false`: displaced materials are tessellated and displaced; `false` draws every one flat and runs nothing of the tessellation | `true`    |
| `tessellationDicingRate`          | A finite number of pixels above 0: the size a micro-triangle is diced to; smaller cuts finer and costs more                            | `2`       |
| `tessellationMaxPatchesPerGroup`  | A whole number of at least 1: the patches one group of the dicing takes (held to 21)                                                   | `5`       |
| `tessellationMaxCandidatePatches` | A whole number from 1 to 134217727: the patches the splitting queue holds, 16 bytes each                                               | `2097152` |
| `tessellationMaxVisiblePatches`   | A whole number from 1 to 134217727: the patches a pass's visible list holds, 16 bytes each                                             | `2097152` |
| `tessellationShadowsDirectional`  | `true` / `false`: the shadow maps of the suns take a displaced surface's displaced shape                                               | `true`    |
| `tessellationShadowsLocal`        | `true` / `false`: the shadow maps of the local lights (points and spots) take it                                                       | `true`    |

A patch past either capacity is lost for the image. The buffers hold what the device lets one
storage buffer bind: capacities that would not fit are brought down in proportion. Neither shadow
setting does anything while `tessellation` is off or the scene holds no displaced material.

```js
const world = createWorld('viewer', { tessellationDicingRate: 2 })
world.tessellation = { tessellationDicingRate: 4 } // coarser micro-triangles, from the next frame
world.tessellation = { tessellationShadowsLocal: false } // lamps cast the flat surface
world.tessellation = { tessellation: false } // every displaced material drawn flat
world.tessellation = { tessellation: null, tessellationDicingRate: null } // back to the defaults
```

The explorer's tool `trillion3d_set_tessellation` writes one setting at a time (`field`, `value`).
Nothing of the tessellation is allocated while the setting is off or no displaced material is in the
scene; turning it off gives the buffers back.

What tessellation does not do:

- A displaced surface is drawn flat by the passes that do not read the visibility buffer's pixels:
  the rays' scene and the reflections' traced scene see the surface its triangles describe. Its
  motion vector is the flat surface's point moved as the surface moves, plus this image's
  displacement, whole ([ENGINE.md](ENGINE.md#motion-of-a-displaced-pixel)): the displacement itself is not tracked from image to image, so a
  height map that changes in time gets no velocity from its change.
- A masked displaced surface casts a tessellated shadow, cut out at the vertices of its patches on a
  device that grants nine storage buffers to a vertex stage and per pixel on a device that grants
  eight, which every WebGPU device does ([ENGINE.md](ENGINE.md#masked-casters-in-the-shadow-maps)). A shadow patch is judged by the frustum of
  the map and the page it casts into, not by the depth the page has already seen.
- A per-job override of a material's displacement fields is not read. The displacement baked into a
  mesh ([COMPILER.md](COMPILER.md#baked-displacement)) is read for the rigid triangle primitives of
  a mesh, tessellated together; a primitive that deforms, or stands for a part of an assembly, bakes
  none.
- A scene compiled before the texture-coordinate density existed reads a density of 1 for every set;
  recompile it to measure it.

`world.volumetricLightmap` holds the setting of the precomputed indirect light a baked scene carries
(a `volumetric-lightmap.bin`, [FORMAT.md](FORMAT.md#volumetric-lightmapbin)), an option of
`createWorld` too: `volumetricLightmap` (`true`: the lightmap is read by the fog's static term and by
the lighting of movable objects; `false`: every read of it answers black, as in a scene without one;
it does nothing where the scene has no lightmap), `volumetricLightmapLoadingRange` (64: the metres around the view within which the cells of the finest bricks are loaded) and `volumetricLightmapBrickMemory` (30: the megabytes of finest bricks that stay resident, the cells nearest the view winning them). The fog's static term is scaled by
the `heightFog` part's `volumetric.staticLightingScatteringIntensity` (`1`, never below `0`; `0` leaves the term
out). The fog's sky light follows the
sky light part's `mobility`: a `'static'` one lights the fog by none of its own harmonics (its light is the
lightmap's), a `'stationary'` one that casts shadows scatters multiplied by the lightmap's sky visibility (a lightmap
baked with a sky light; the compiler does not bake one yet), a `'movable'` one by the global distance field's. A write names the setting it changes, `null` its default; a value of another kind is refused
by name.

```js
const world = createWorld('viewer', { volumetricLightmap: false }) // the precomputed light off
// finest bricks streamed within 100 m of the view, 60 MB of them resident at most
world.volumetricLightmap = {
  volumetricLightmapLoadingRange: 100,
  volumetricLightmapBrickMemory: 60,
}
world.volumetricLightmap = { volumetricLightmap: null } // back to the default, on
```

`world.globalDistanceField` holds the settings of the global distance field, an option of `createWorld`
too: the clipmaps composited from the meshes' distance fields around the camera (a mesh has one where
its build sets `distanceField`, [COMPILER.md](COMPILER.md#distance-fields)) and the brick atlas those
fields are streamed into ([ENGINE.md](ENGINE.md#distance-fields)). Lengths are in centimetres. Each
setting is the reference's console variable of that name with its default:
`globalDistanceField` (`true`), `globalDistanceFieldUpdate` (`true`), `globalDistanceFieldClipmaps` (`4`, at
most 6), `globalDistanceFieldViewDistance` (`20000`), `globalDistanceFieldClipmapExponent` (`2`),
`globalDistanceFieldResolution` (`128`), `globalDistanceFieldMipFactor` (`4`),
`globalDistanceFieldOccupancyRatio` (`0.3`), `globalDistanceFieldCacheMostlyStaticSeparately` (`true`),
`globalDistanceFieldPartialUpdates` (`true`), `globalDistanceFieldStaggeredUpdates` (`true`),
`globalDistanceFieldUpdatesPerFrame` (`2`), `globalDistanceFieldForceFullUpdate` (`false`),
`globalDistanceFieldForceUpdateOnce` (`false`), `globalDistanceFieldFastCameraMode` (`false`),
`globalDistanceFieldCameraVelocityDecay` (`0.7`), `globalDistanceFieldAverageCulledObjectsPerCell` (`512`),
`globalDistanceFieldRecacheOnStreaming` (`true`), `globalDistanceFieldForceRecacheOnStreaming` (`false`),
`globalDistanceFieldStartDistance` (`100`), `globalDistanceFieldMinMeshRadius` (`20`),
`globalDistanceFieldMinMeshRadiusInVoxels` (`0.5`), the ones of the rays the reflections march through the field —
`globalDistanceFieldTraceResolution` (`252`) and `globalDistanceFieldTraceClipmapExtent` (`2500`), the voxels along a
clipmap and the first clipmap's half-extent while rays are marched, each next clipmap twice the one before,
`globalDistanceFieldTraceViewDistance` (`20000`), the distance the scene is kept to then: the field makes one clipmap
more than `globalDistanceFieldClipmaps` where the extent of the next reaches it, two more where the one after does (the
default four clipmaps of 2500 become five at `40000` and six at `80000`); while rays are marched, which the reflections
do by default, `globalDistanceFieldViewDistance`, `globalDistanceFieldClipmapExponent` and `globalDistanceFieldResolution`
have no effect, the three above size the clipmaps in their place,
`globalDistanceFieldCoveredExpandSurfaceScale` (`1`) and `globalDistanceFieldNotCoveredExpandSurfaceScale` (`0.6`), the
scale of the half voxel by which a ray expands the surface it meets in the pages the meshes cover and in those only
two-sided meshes (foliage) reach, `globalDistanceFieldSimpleCoverageBasedExpand` (`false`), which reads the coverage
atlas, the coverage of each voxel of such a page, and where `true` counts the whole page as not covered and leaves the
atlas unread, `globalDistanceFieldNotCoveredMinStepScale` (`4`), the scale of its least step there,
`globalDistanceFieldDitheredTransparencyStepThreshold` (`0.5`) and `globalDistanceFieldDitheredTransparencyTraceThreshold`
(`0.9`), the noise under which a dithered ray is stopped there — and the atlas's `meshDistanceFieldMaxObjectRadius`
(`100000`), `meshDistanceFieldSurfaceBiasExpand` (`0.25`), `meshDistanceFieldBrickAtlasSize` (`128`, a power
of two, read when the atlas is made), `meshDistanceFieldBrickAtlasDepth` (`32`), `meshDistanceFieldUploadKiB`
(`8192`), `meshDistanceFieldBlockBricks` (`16`, read when the atlas is made), `meshDistanceFieldForceMips`
(`0`: follow the view; 1 to 3 loads that many mips of every mesh), `meshDistanceFieldReverseAllocation`
(`false`) and `runtimeMeshDistanceFields` (`false`): a mesh made at run time, which no compiler gave a field, gets
one built when it appears, on the page's GPU, by the compiler's own program (the same text, the same steps: the
nearest triangle within the band, the 98 rays across the sphere for the sign; the voxels the device is in doubt of
are measured again on the CPU, so the field is the compiler's). It is read when the scene's page records are made (a mesh cut at run time is flagged as having a field then) and each image after; set it with the world's other options before the scene opens. It costs the build once for each distinct mesh,
in chunks short enough for the page's frames to go on, and the rays marched through the field meet the mesh a few
frames after it appears. A mesh that deforms, one with no ray-tracing tree and one too deep for the program to walk
get none. The reference builds fields at import only, so the setting is off until a scene asks for it. A write
names the settings it changes, `null` one's default; a value of another kind is refused by name. A scene whose
meshes built no distance field, and none asked for them at run time, is not touched.

```js
const world = createWorld('viewer', { globalDistanceFieldClipmaps: 5 }) // one more clipmap
world.globalDistanceField = {
  globalDistanceFieldViewDistance: 40000,
  meshDistanceFieldUploadKiB: 16384,
}
world.globalDistanceField = { globalDistanceFieldFastCameraMode: true } // follow a fast camera, lower quality
world.globalDistanceField = { globalDistanceFieldFastCameraMode: null } // back to the default, off
// A cheaper march for the reflections: coarser clipmaps while rays are marched
world.globalDistanceField = { globalDistanceFieldTraceResolution: 140 }
// A scene kept to 800 m while rays are marched: the field grows from four clipmaps to six
world.globalDistanceField = { globalDistanceFieldTraceViewDistance: 80000 }
// Meshes made at run time (a generated terrain, a procedural prop) take part in the marched rays too
world.globalDistanceField = { runtimeMeshDistanceFields: true }
// Cheaper still, a page foliage reaches counted as not covered whole, the coverage atlas unread
world.globalDistanceField = { globalDistanceFieldSimpleCoverageBasedExpand: true }
```

`world.distanceFieldOcclusion` holds the settings of the sky light's occlusion by the distance fields, an option of
`createWorld` too: how much of the sky each pixel sees, from cones traced against the global field and the meshes' own
fields ([ENGINE.md](ENGINE.md#distance-fields)), drawn when the sky light is movable and casts shadows, the bounce is
off (with it on, its probes carry the sky and the screen probes its visibility) and a mesh built a distance field. The
sky light then lights each pixel along the way its sky is most open and by the share of it the pixel sees: the sky's
diffuse light is read along a normal turned toward that direction and scaled by the visibility, and the sky's reflection
off a rough surface is occluded by the cone the sky leaves open (`distanceFieldOcclusionSpecularMode`: 0 by the share of
sky seen, 1 by the intersection of the reflection's cone with the open one, `skyLightSpecularOcclusionStrength` its
strength). The light's own settings shape it: `occlusionMaxDistance`, `contrast`, `occlusionExponent`, `minOcclusion`,
`occlusionTint` and `occlusionCombineMode`. The settings below, each with its default; lengths are in centimetres: `distanceFieldOcclusion` (`true`), `distanceFieldOcclusionQuality`
(`2`: 0 off, 1 the global field alone, 2 the meshes' fields too), `distanceFieldOcclusionObjects` (`true`),
`distanceFieldOcclusionStepExponentScale` (`0.5`), `distanceFieldOcclusionMaxViewDistance` (`20000`, held to 65000),
`distanceFieldOcclusionViewFadeDistanceScale` (`0.7`), `distanceFieldOcclusionSampleSet` (`1`),
`distanceFieldOcclusionJitterConeDirections` (`false`), `distanceFieldOcclusionUseJitter` (`true`),
`distanceFieldOcclusionTraverseMips` (`true`), `distanceFieldOcclusionUseHistory` (`true`),
`distanceFieldOcclusionHistoryStabilityPass` (`true`), `distanceFieldOcclusionHistoryWeight` (`0.85`),
`distanceFieldOcclusionHistoryDistanceThreshold` (`30`), `distanceFieldOcclusionSpecularMode` (`1`),
`skyLightSpecularOcclusionStrength` (`1`, at least 0.1 where it is used) and `distanceFieldOcclusionObjectsPerCullTile`
(`512`). A write names the settings it changes, `null` one's default; a value of another kind is refused by name. A
scene whose meshes built no distance field is not touched.

```js
const world = createWorld('viewer', { distanceFieldOcclusionQuality: 1 }) // the global field alone
world.distanceFieldOcclusion = { distanceFieldOcclusionMaxViewDistance: 40000 } // light pixels up to 400 m
world.distanceFieldOcclusion = { distanceFieldOcclusionUseHistory: false } // no temporal filter
world.distanceFieldOcclusion = { distanceFieldOcclusionQuality: null } // back to the default, 2
```

`world.surfaceCache` holds the settings of the surface cache, an option of `createWorld` too: the atlas that keeps the
captured surface of the meshes' cards (flat boxes along a mesh's faces, built by the compiler), which the rays that
leave the screen will read where they hit a mesh. Each setting is the reference's of that meaning, with its default, the
row of the screen probes' level `ultra` (the default; `cinematic` holds the same); the level `high` holds another
row of the atlas's side, the cards' density and resolutions, the lights a tile, the lighting's update factors and the radiosity's
probes (`SURFACE_CACHE_LEVEL_ROWS`), which a setting you name overrides; lengths are in centimetres. The atlas: `surfaceCacheAtlasSize` (`4096`, texels a side, cut into pages of 128) and
`surfaceCacheResolution` (`1`, from 0.5: a factor on the pages along a side, held between 1 and 64, and on the cards'
resolutions). Which resolution a card is kept at, from its larger half side over the eye's distance, a metre at least:
`surfaceCacheCardTexelDensityScale` (`100`), `surfaceCacheCardMaxTexelDensity` (`0.2`), `surfaceCacheCardMaxResolution`
(`512`, up to 2048), `surfaceCacheCardMinResolution` (`2`), `surfaceCacheOrthographicCardMinResolution` (`1`: an
orthographic view's own least, `0` takes the plain one), `surfaceCacheSceneDetail` (`1`, from 0.125 to 8: it divides the
least resolution) and `surfaceCacheCardCaptureMargin` (`0`, added to the distance of the global distance field's
outermost clipmap, past which a card is not kept). Which meshes get cards: `surfaceCacheMeshCardsMinSize` (`10`: the area
a mesh's largest face must exceed is its square, a fifth of that for an emissive mesh) and `surfaceCacheMeshCardsCullFaces`
(`true`: a card whose face is under that area is left out). A mesh a world cut at run time, which no compiler gave cards,
has six axis-aligned cards made from its bounds, thickened by 5 cm, while `runtimeMeshCards` (`true`) is on; off, only the screen
sees it in a reflection that leaves the screen. What an image does: `surfaceCacheCardCapturesPerFrame` (`300`
cards captured, the nearest first; the cards of twice as many meshes are added; `0` stops every capture),
`surfaceCacheRemovesPerFrame` (`512`), `surfaceCacheCardCaptureFactor` (`64`: the atlas's texels over those of the atlas
the captured pages are drawn in), `surfaceCacheCardCaptureRefreshFraction` (`0.125`: the share spent capturing pages again,
the oldest first, to follow the materials), `surfaceCacheCardCaptureEnableInvalidation` (`true`),
`surfaceCacheNumFramesToKeepUnusedPages` (`256`), `surfaceCacheCompress` (`1`: `2` keeps the atlas's albedo, normal and emission in
block-compressed textures, BC7, BC5 and BC6H, a quarter of those layers' memory, where the device has `texture-compression-bc`;
`1` is compression by writing through a view of another format, which WebGPU cannot do, so it compresses nothing; `0` never),
`surfaceCacheAllowCardSharing` (`true`: cards of one mesh with the same
materials, face and proportions copy one capture), `surfaceCacheAllowCardDownsampleFromSelf` (`true`),
`surfaceCacheCaptureLodScaleFactor` (`1`: the view's pixel error over it is the error the pages are drawn at),
`surfaceCacheResampleLighting` (`true`), `surfaceCacheDilationMode` (`0`: 1 the
two-sided meshes, 2 all), `surfaceCacheDiffuseColorBoost` (`1`, up to `4`: the luminance of the albedo a read returns,
raised to the power of its inverse) and `surfaceCacheFastCameraMode` (`false`: lower density, half the greatest resolution, twice the
captures). The feedback that asks for finer pages: `surfaceCacheFeedback` (`true`), `surfaceCacheFeedbackTileSize` (`16`,
raised to a power of two), `surfaceCacheFeedbackMinPageHits` (`16`),
`surfaceCacheFeedbackUniqueElements` (`1024`) and `surfaceCacheFeedbackResLevelBias` (`-0.5`: levels added to the one a ray's cone calls for). The lighting of the cards' texels: `surfaceCacheDirectLightingUpdateFactor` (`32`) and
`surfaceCacheRadiosityUpdateFactor` (`64`: the atlas's texels over the texels lit directly, and given indirect light, in an
image, the pages left longest unlit first), `surfaceCacheLightingUpdateSpeed` (`1`, from 0.5 to 16: it divides both),
`surfaceCacheLightingQuality` (`1`, from 0.5 to 6: it multiplies the radiosity probes' hemisphere by its square root and, from 6, halves their
spacing), `surfaceCacheLightingForceFullUpdate` (`false`), `surfaceCacheFreezeUpdateFrame` (`0`; any other number stops the update clock
and the pages' record of being lit, so that every image lights the same subset, for debugging), `surfaceCacheLightingMaxDistanceFromFrustumToPrioritize` (`500`, `-1`
never: the pages near the frustum are lit twice as soon), `surfaceCacheLightingFeedback` (`true`: a page the rays read at its finest level in the last two images is lit at the greatest update speed, 4, where the scene has acceleration structures and `surfaceCacheDirectLightingHardwareRayTracing` is on), `surfaceCacheDirectLighting` (`true`),
`surfaceCacheDirectLightingMaxLightsPerTile` (`8`, up to 32, a power of two), `surfaceCacheDirectLightingBatchShadows` (`2`, from 0 to 2: the
tiles of each light are gathered into a run before the masks and the light functions are made over them; at `2` the point lights', the
spots' and the rectangles' tiles are each gathered by their type, at `0` and `1` each light has a run of its own; the image is the same), `surfaceCacheDirectLightingGlobalSdfShadowRayBias` (`1`:
voxels the shadow ray starts off the surface, three where it grazes the light) and `surfaceCacheDirectLightingCloudTransmittance`
(`true`). Where the scene has acceleration structures the direct light's shadow is traced through the scene's triangles instead:
`surfaceCacheDirectLightingHardwareRayTracing` (`true`; `false` keeps the distance field's ray) keeps, for each light of a tile, a
mask of the tile's texels (the light function and the clouds' shade, then whether a ray must settle it), and one ray goes from each
texel the mask leaves open; `surfaceCacheDirectLightingHardwareRayTracingShadowRayBias` (`1` cm off the texel, three where it grazes
the light), `…EndBias` (`1` cm: a lamp's ray stops short of it), `…AdaptiveShadowTracing` (`true`: a tile that every texel saw a light
at, or none did, at its last update traces one texel of each quad of four, a different one each update), `…ForceTwoSided` (`false`:
the front faces of a primitive that is not two-sided are culled; `true` takes all as two-sided), `surfaceCacheDirectLightingStochastic` (`false`, experimental, with the shadows traced: each texel is lit by
`surfaceCacheDirectLightingStochasticSamplePerTexel` (`1`, up to 4, 3 taken as 4) lights picked among those of its tile with a chance proportional to `log2(1 + luminance)`, a light under
`surfaceCacheDirectLightingStochasticMinWeight` (`0.001`) never picked, and only the picked ones traced; `…StochasticTemporal` (`true`) blends the result over at most
`…StochasticTemporalMaxFramesAccumulated` (`12`) images, the history held within `…StochasticTemporalNeighborhoodClampScale` (`2`) standard deviations of the texel's 5 × 5 neighbours; example:
`world.surfaceCache = { surfaceCacheDirectLightingStochastic: true, surfaceCacheDirectLightingStochasticSamplePerTexel: 2 }`) and
`surfaceCacheHardwareRayTracingMaxIterations` (`8192` triangles a ray may test; a ray that stopped counts as blocked). The radiosity, `surfaceCacheRadiosity` (`true`), `surfaceCacheRadiosityProbeSpacing` (`4`, texels, a power of two up to 8),
`surfaceCacheRadiosityHemisphereProbeResolution` (`4`, up to 16), `surfaceCacheRadiositySpatialFilterProbes` (`true`) with its
`…KernelSize` (`1`: 0 none, 1 four neighbours, 2 thirteen), `surfaceCacheRadiosityProbePlaneWeighting` (`true`) with its
`…DepthScale` (`-100`), `surfaceCacheRadiosityMaxRayIntensity` (`40`, times the exposure),
`surfaceCacheRadiosityDistanceFieldSurfaceBias` (`10` cm along a ray before it can hit) and `…SurfaceSlopeBias` (`5` cm off the
texel) for its rays through the global distance field; where the scene has acceleration structures and its cut draws no cell of
the world DAG, `surfaceCacheRadiosityHardwareRayTracing` (`true`) casts them through the scene's triangles instead, from
`…HardwareRayTracingNormalBias` (`0.1` cm off the texel along its normal) and `…HardwareRayTracingBias` (`0.1` cm along the ray),
the translucent primitives passed, the cards of the primitive hit read at the hit with
`surfaceCacheHardwareRayTracingSurfaceCacheSamplingDepthBias` (`10` cm) and no light from a hit nearer than
`surfaceCacheHardwareRayTracingMinTraceDistanceToSampleSurfaceCache` (`10` cm) or on the back of a one-sided primitive, a
trace that stopped black and a miss the sky; `surfaceCacheHardwareRayTracingAvoidSelfIntersections` (`3`: 0 culls the back
faces, 1 traces again from past a near hit, 2 and 3 pass the near hits as the ray travels) with
`surfaceCacheHardwareRayTracingSkipBackFaceHitDistance` (`5` cm) and `…SkipTwoSidedHitDistance` (`1` cm) keeps a ray off the
geometry it starts on. `surfaceCacheRadiosityTemporal` (`true`) with its `…MaxFramesAccumulated` (`4`) and `…FixedJitterIndex` (`-1`: the probes'
jitter moves). A read of the cards finds each texel's final light, its albedo over π times its direct and indirect light plus its
emission; the lighting settles over some hundred images after a change, and the frame is not held while it does. The capture's
raster is not plugged in yet, so on an image today the cards hold no surface to light. A write names the settings it changes, `null` one's default; a value of
another kind is refused by name. A change that alters the atlas's pages, the compression, the sharing or the downsampling
empties the atlas. A scene whose meshes carry no cards is not touched.

```js
const world = createWorld('viewer', { surfaceCacheAtlasSize: 2048 }) // a smaller atlas, in less memory
world.surfaceCache = { surfaceCacheCardCapturesPerFrame: 150 } // half the captures of an image
world.surfaceCache = { surfaceCacheFeedback: false } // only the coarsest level of each card is kept
world.surfaceCache = { surfaceCacheCompress: 2 } // the colour layers in blocks: a quarter of their memory
world.surfaceCache = { surfaceCacheAtlasSize: null, surfaceCacheCardCapturesPerFrame: null } // back to the defaults
```

**Ambient occlusion.** A crease, a corner or the foot of a wall receives less of the light that comes from all round than
an open surface does. The engine finds that loss in the depth the image drew, by one of two methods, and leaves one byte a
pixel, which the lighting multiplies in where it belongs: the emission of a surface (the light the base pass left in the
picture) and the sky light's diffuse (by the smaller of the material's occlusion and this one), never a declared light,
whose shadows are its own.

It draws **where no global illumination is on**, that is, with the bounce off (`bounce: false`, which a page writes: the
`smooth` quality level writes it too, but also `ambientOcclusionLevels: 0`, so that nothing is searched there). With the
bounce on — at any level of the screen probes, `'off'` included, where the world's probes light the pixels — the probes
carry their own short-range occlusion (`screenProbeShortRangeOcclusion`), the same contact shadow found another way, and
the two never meet: a view draws no ambient occlusion, holds no texture for it and runs no pass.
`ambientOcclusionWithScreenProbes` (off) draws it over the probes' light too, but only while their own short-range
occlusion is off (`screenProbeShortRangeOcclusion: false`), and then it occludes their light alone, at the strength
`screenProbeOcclusionIntensity` names.

**The disc search** (`ambientOcclusionMethod: 'disc'`, the default). Each pixel searches the depth round it, along a few
directions turned by a small noise and at a few distances, for what rises above its surface, and keeps the share of the
sky it still sees. The search runs at the image's size and at its half and its quarter, each coarser result blended into
the finer one. With `ambientOcclusionCompute` from 1 up the search is made in one resolution from the normals the depth
gives, without the blur among the four pixels of a quad, and, where the image does not accumulate in time, smoothed
(`ambientOcclusionComputeSmooth`).

**The horizon search** (`ambientOcclusionMethod: 'horizon'`). Each pixel looks, along a few directions in the image
(`ambientOcclusionHorizonAngles`), for the highest horizon each side of it finds in the depth, and integrates the sky that
is left against the surface's normal. The result is blurred in space (a square filter that weighs each neighbour by how
near it lies to the pixel's plane, which also applies the power and the intensity), blended in time into the last image's
(clamped to the neighbourhood of this one, the last image found again through the motion of the camera, or of the surface
where it moves by itself; the history is white where it does not reach) and upsampled to the image's size. The history
belongs to the view: dragging the intensity, the power or the radius keeps it, only a cut or a change that remakes the
textures (the filters, the half-size search, a resize) starts it again, and so does an image it skipped. A view at rest is
drawn again until the history has the images it needs to come within a tenth of what it converges to (22 at the default
blend of 0.1: `ceil(ln 0.1 / ln(1 − blend))`), whatever the temporal anti-aliasing does, then held. It has its own radius,
`ambientOcclusionHorizonRadius`; the distance fade, the quality's shape, the power and the intensity are the occlusion's.
With the spatial filter off, the last pass of the method applies the power and the intensity itself, so that the setting
changes the softness and nothing else.

Every setting has the reference's default. Lengths are in metres (the reference's centimetres over a hundred):

| Setting                                                                                | Default              | Meaning                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ambientOcclusion`                                                                     | `true`               | The master switch; `false` draws none.                                                                                                                                                                 |
| `ambientOcclusionMethod`                                                               | `'disc'`             | `'disc'` or `'horizon'`.                                                                                                                                                                               |
| `ambientOcclusionIntensity`                                                            | `0.5`                | How much of the occlusion shows, 0 to 1; 0 is off.                                                                                                                                                     |
| `ambientOcclusionStaticFraction`                                                       | `1`                  | The share of a surface's emission the occlusion darkens, 0 to 1.                                                                                                                                       |
| `ambientOcclusionRadius`                                                               | `2`                  | How far from a point a surface may lie and occlude it, in metres (the disc search). In the default view-space mode it is the radius at 4 m from the eye and grows with the distance.                   |
| `ambientOcclusionRadiusInWorldSpace`                                                   | `false`              | The radius is the world's, at any distance.                                                                                                                                                            |
| `ambientOcclusionFadeDistance`, `ambientOcclusionFadeRadius`                           | `80`, `50`           | The occlusion has faded to nothing at 80 m, fading over the last 50 (both methods).                                                                                                                    |
| `ambientOcclusionPower`                                                                | `2`                  | The exponent of the occlusion, from 0.1.                                                                                                                                                               |
| `ambientOcclusionBias`                                                                 | `3`                  | How far a point is lifted off its surface along its normal, in thousandths of its depth (the disc search).                                                                                             |
| `ambientOcclusionQuality`                                                              | `50`                 | 0 to 100: the resolutions of the disc search (one below 35, two below 70, three above) and the samples a pixel takes (five shapes: 5, 25, 55 and 75 are the steps), the steps of the horizon search.   |
| `ambientOcclusionLevels`                                                               | `-1`                 | The resolutions, 1 to 3, 0 none (the horizon search too); -1 follows the quality.                                                                                                                      |
| `ambientOcclusionMaxQuality`                                                           | `100`                | A ceiling on the quality; a negative value forces the quality its absolute value names.                                                                                                                |
| `ambientOcclusionMipBlend`, `ambientOcclusionMipScale`, `ambientOcclusionMipThreshold` | `0.6`, `1.7`, `0.01` | The share of the coarser result blended in, the radius's growth at each coarser resolution, and the depth step under which neighbours count as one surface when a resolution is made.                  |
| `ambientOcclusionMipLevelFactor`                                                       | `0.4`                | How fast the samples climb the depth pyramid's coarser levels along the search; at 1 or less they stay on the finest.                                                                                  |
| `ambientOcclusionRadiusScale`                                                          | `1`                  | A scale on the radius, 0.1 to 15.                                                                                                                                                                      |
| `ambientOcclusionWithScreenProbes`                                                     | `false`              | Draw it over the probes' light, while the screen probes' own short-range occlusion is off.                                                                                                             |
| `ambientOcclusionCompute`                                                              | `0`                  | 0 the pixel passes; 1 to 3 the single compute-style pass (one resolution, the depth's normals, no quad blur). 2 and 3 name an asynchronous queue a browser device lacks: all three make the same pass. |
| `ambientOcclusionComputeSmooth`                                                        | `true`               | The compute pass is smoothed (a box of four taps two texels apart) where the image does not accumulate in time.                                                                                        |
| `ambientOcclusionHorizonNormals`                                                       | `false`              | The horizon search reads the surfaces' own normals rather than the depth's.                                                                                                                            |
| `ambientOcclusionHorizonFilterWidth`                                                   | `5`                  | The side of the spatial filter in pixels: 3 and 4 as they are, any other number the five-wide filter.                                                                                                  |
| `ambientOcclusionHorizonThickness`                                                     | `0.5`                | How thick a surface is taken to be (any number, it is squared): more lowers the occlusion a thin surface casts.                                                                                        |
| `ambientOcclusionHorizonRadius`                                                        | `2`                  | The distance in metres, from 0, at which an occluder stops counting for the horizon search.                                                                                                            |
| `ambientOcclusionHorizonAngles`                                                        | `2`                  | The directions a pixel searches, 1 to 16, spread over half a turn.                                                                                                                                     |
| `ambientOcclusionHorizonPauseJitter`                                                   | `false`              | The directions stop turning from image to image.                                                                                                                                                       |
| `ambientOcclusionHorizonDownsample`                                                    | `false`              | The horizon search runs at half the image's size and is upsampled at the end (the spatial filter then reads the depth at the right place; see below).                                                  |
| `ambientOcclusionHorizonTemporal`, `ambientOcclusionHorizonSpatial`                    | `true`, `true`       | The temporal filter and the spatial filter (a compute pass). With the spatial filter off the power and the intensity apply in the method's last pass.                                                  |
| `ambientOcclusionHorizonBlend`                                                         | `0.1`                | The share of this image the temporal filter takes, from 0; the rest is the history's.                                                                                                                  |

The quality levels (`world.quality`, group `imageEffects`) write the reference's five post-process levels of the
resolutions, the ceiling, the climb and the radius scale: `smooth` — `ambientOcclusionLevels` 0 (none: no occlusion is
drawn at this level), ceiling 0, climb 1, scale 1.2; `balanced` — follows the quality, ceiling 60, climb 1, scale 1.5;
`fine` — ceiling 100, climb 0.6, scale 1.5; `max` writes nothing: the defaults are the reference's own default level
(ceiling 100, climb 0.4, scale 1); `cinematic` — the same as `max`, and the horizon search's number of angles
(`ambientOcclusionHorizonAngles`) at 4, the one value the reference's fifth level writes of it. A value the page writes
holds over the level. Two settings of the reference are not offered because they do nothing there (a falloff ratio and an upsample switch
that no shader reads); its dead deprecated distance, its depth-bounds test and its framebuffer compression have no form in
a browser.

Two faults of the reference, fixed. With the horizon search at half size the reference's spatial filter reads the depth at
the wrong place (it is told a reduction of one), so its weights come from the top-left quarter of the picture; here the
depth is read where the texel is. And with its spatial filter off the reference leaves the integral as the search writes
it — two over π, 0.637, on every open surface — and never applies the power or the intensity: the whole picture 36 %
darker and two settings inert; here the method's last pass takes the integral back to one and applies both, as the filter
does.

The occlusion publishes `ambientOcclusion: { method, drawn, bytes, why }` among the frame's metrics: which method ran,
whether the image drew it, the bytes its textures hold and, where the device's memory budget kept the view from being made,
the reason (the view is then asked again only once the budget's room holds it). An agent sets the settings through
`trillion3d_set_ambient_occlusion`.

```js
const world = createWorld({
  canvas,
  ambientOcclusionIntensity: 0.7, // a stronger darkening than the default 0.5
  bounce: false, // the occlusion draws where no global illumination is on
})
world.ambientOcclusion = { ambientOcclusionRadius: 3 } // a wider reach, from the next frame
world.ambientOcclusion = { ambientOcclusionMethod: 'horizon', ambientOcclusionHorizonAngles: 4 } // the horizon search, four directions
world.ambientOcclusion = { ambientOcclusionMethod: 'disc', ambientOcclusionCompute: 1 } // the disc search in one resolution, smoothed
world.ambientOcclusion = { ambientOcclusionRadius: null } // null gives a setting back to the preset
world.quality.preset = 'balanced' // writes the resolutions' ceiling, the climb and the radius scale
world.ambientOcclusion = { ambientOcclusion: false } // off: no pass, no texture, no byte
```

The explorer takes the same by field (`explorer.setAmbientOcclusion('ambientOcclusionPower', 3)`).

`ambientCubemap` is a light from a cube of the page's, off until the world is given one: a world option, `{ size, texels }`, the
side of a face in texels (a power of two from 16 to 1024) and the six faces' linear colours (`6 · size² · 3` numbers, none negative;
a cube of another form is refused by name at the opening). It is a second source of the indirect light, beside the environment's and
the sky light's: a surface's diffuse colour is lit by the cube read along its normal at the mip where the cube is convolved by the
whole hemisphere, and its specular reflectance by the cube read along its reflection at the mip its roughness picks, weighed by the
same energy terms as the other sources, so the coat, the cloth's fuzz and a thin surface's back take it as they take the
others'. Its settings are `ambientCubemapTintRed`, `ambientCubemapTintGreen` and `ambientCubemapTintBlue` (`1` each, from 0), the
tint, and `ambientCubemapIntensity` (`1`, from 0), the scale that multiplies it; a colour that is black draws nothing, and an image
that sets no cube, or a black one, compiles no code for it and binds no texture. The cube's mip chain is filtered by angle on the GPU,
once for a cube, over the images a budget of texels an image allows (a cube of 16 texels a face in one image, a cube of 1024 in some
tens); the images drawn meanwhile are drawn again and light nothing from the cube. The cube can be changed or taken away while the
world runs: `explorer.setAmbientCubemapCube(cube)` replaces it (its chain is filtered again, the old one freed), `explorer.setAmbientCubemapCube(null)`
takes the light away, and a cube of another form is refused by name. The translucent surfaces take no light from it. An agent sets the
settings through `trillion3d_set_ambient_cubemap`.

```js
const world = createWorld({
  canvas,
  ambientCubemap: { size: 16, texels: new Float32Array(6 * 16 * 16 * 3).fill(0.4) }, // a grey cube
  ambientCubemapIntensity: 2, // twice its light
})
world.ambientCubemap = { ambientCubemapTintBlue: 1.5 } // bluer, from the next frame
world.ambientCubemap = { ambientCubemapIntensity: 0 } // off: no code, no texture
explorer.setAmbientCubemapCube({ size: 16, texels: new Float32Array(6 * 16 * 16 * 3).fill(0.1) }) // another cube, filtered from the next images
explorer.setAmbientCubemapCube(null) // no cube: the light goes, the texture is freed
```

`reflectionCapture` holds the settings of the scene's reflection captures. A capture is an object of the scene
(`explorer.addReflectionCapture`): a place the scene is drawn from through the six faces of a cube, which the surfaces around it read as
the light that comes from far away. Its fields are `id` (unique), `shape` (`'sphere'`, the default, or `'box'`), `matrix` (sixteen numbers,
column-major, metres: the translation is the centre, and for a box the lengths of the columns are its half extents and their directions its axes),
`influenceRadius` (a sphere's radius, `30` m by default, at least `0.08`), `boxTransitionDistance` (`1` m by default: how far inside its faces a box's
cube fades out), `brightness` (`1`, from 0: the factor its light is multiplied by) and `captureOffset` (`[0, 0, 0]`: where the scene is drawn from, relative to the centre).
Inside its shape the cube is read as if the scene it holds were the shape itself (the reflection ray is intersected with the sphere or the box, so a reflection
moves with the viewer), faded toward the shape's edge; where captures overlap the smallest is read first and lets through what it does not cover,
the sky light taking the rest. They light the rough reflection of the opaque surfaces — the share of a lobe that neither the screen nor the scene's rays answer —, composited over the sky light's. Where the reflection ray of the scene is
answered, the capture adds nothing. A capture is drawn between two images, one at a time, and again when its place moves or one of the face settings
changes; `explorer.recaptureReflectionCaptures()` asks them all again. The settings, all run-time: `reflectionCaptures` (`true`; off, none is made or read),
`reflectionCaptureResolution` (`128`, from 16 to 1024, the power of two at or below it), `reflectionCaptureSupersample` (`1`, from 1 to 8),
`reflectionCaptureNearPlane` (`0.05` m), `reflectionCaptureLightFunctions` (`false`), `reflectionCaptureDiffuse` (`false`: the cube's four smallest mips
(1, 2, 4 and 8 texels) hold the capture's diffuse light and the opaque surfaces take their diffuse light from the captures where they reach, in place of the sky light's)
and `reflectionCaptureDiffuseReference` (`true`: that diffuse light is the exhaustive convolution of the cube; `false`, it is evaluated from nine harmonics summed from the cube).
The diffuse light is the mean radiance weighted by the cosine in both ways. The captures hold the sky past the sky light's distance threshold, where a sky light that is not static shines.
The translucent surfaces and the strands take no light from the captures. An agent sets the settings through `trillion3d_set_reflection_capture`.

```js
explorer.addReflectionCapture({ id: 'hall', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 1.5, -2, 1], influenceRadius: 12 }) // a sphere
explorer.addReflectionCapture({ id: 'room', shape: 'box', matrix: [5, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 3, 0, 1], boxTransitionDistance: 2, brightness: 1.5 }) // 10 x 6 x 8 m
explorer.setReflectionCaptureObject('hall', { brightness: 0.8 }) // the records change, no new capture
explorer.setReflectionCapture('reflectionCaptureResolution', 256) // every cube is made again
world.reflectionCapture = { reflectionCaptureDiffuse: true } // the diffuse light of the captures, from the next images
explorer.removeReflectionCapture('hall')
```

`world.shading` holds the material pass's settings, each an option of `createWorld` too:
`gpuTimingDetail` (`false`, the default: the material pass is one timed pass; `true`: a frame sampled for the GPU timing times its shading bins and each material class's shading as passes of their own, `Trillion3D material bins` and `Trillion3D material shading <class key>` in `gpuPassMs.passes`, the image the same),
`gpuShadeStage` (`0`, the default: the whole shading kernel; `1` to `5`: a diagnostic that stops each class's shading after its binned pixel, its triangle's header and indices, its vertex fetch and transform, its interpolation and derivatives, its material and surface, writing no surface — the image is not the scene's —, each class compiled again; with `gpuTimingDetail`, the difference of two stages' `Trillion3D material shading <class key>` times is the stage's cost),
`shadeBinningMode` (`'auto'`: each material's pixels binned as its shading asks — one by one for
every material of the engine —, `'pixel'` one by one, `'quad'` by 2 × 2 quad), the image the same in
each mode, `shadingRoughDiffuse` (`true`, the default: a lit surface's diffuse light is the energy-preserving rough diffuse of a new project, brighter against the light and darker at grazing views as the roughness grows, a rectangle light's and the indirect light's staying Lambert's; `false`: Lambert's diffuse whatever the roughness), `shadingAccurate` (`true`, the default: the visibility of the lit surfaces' specular lobes is the exact joint Smith term of the GGX lobe; `false`: its approximation), `irisNormal` (`false`, the default: an eye's iris is lit by the direction its `tangent` output gives; `true`: by an iris normal of its own, `clearCoatBottomNormal`) and `clearCoatNormal` (`false`, the default: a clear coat and its base share one normal; `true`: the base keeps the normal of a graph's `clearCoatBottomNormal` output or of a material's normal map, and the coat the `normal` output's or its own normal map's, their difference kept as the reference keeps it, in 8 bits, and the coat's highlight found without the Newton step). A write
names the settings it changes, `null` one's default; a value of another kind is refused by name
([ENGINE.md](ENGINE.md#material-surfaces)); changing `irisNormal`, `clearCoatNormal`, `shadingRoughDiffuse` or `shadingAccurate` redraws a still view
from the next frame.

```js
const world = createWorld('viewer', { shadeBinningMode: 'pixel' })
world.shading = { shadeBinningMode: 'quad' } // every material binned by quad, next frame
world.shading = { irisNormal: null } // back to the default, false
world.shading = { irisNormal: true } // an eye's iris has the normal of the clearCoatBottomNormal output
world.shading = { gpuTimingDetail: true } // the material pass's bins and each class timed apart, next sampled frame
world.shading = { gpuShadeStage: 3 } // each class's shading stops after its vertex fetch and transform, next frames
world.shading = { clearCoatNormal: true } // a clear coat keeps the clearCoatBottomNormal output as its base's normal
world.shading = { shadingRoughDiffuse: false } // Lambert's diffuse everywhere, whatever the roughness
world.shading = { shadingAccurate: false } // the approximate specular visibility, a mobile project's
```

`world.exposureSettings` holds the automatic exposure's settings, each an option of `createWorld`
too: `exposureBias` (`1`, stops added to the target: the mean lands at 0.18 · 2^bias before the
curve), `exposureMinBrightness` (`-10`) and `exposureMaxBrightness` (`20`), the range of the mean in
EV100 (the same value for both fixes the exposure), `exposureHistogramLogMin` (`-10`) and
`exposureHistogramLogMax` (`20`), the stops of luminance the histogram spans, `exposureLowPercent`
(`10`) and `exposureHighPercent` (`90`), from 1 to 99, the shares of the pixels, darkest first, left
out of the mean, `exposureSpeedUp` (`3`) and `exposureSpeedDown` (`1`) in stops a second (0 holds),
`exposureTransitionDistance` (`1.5` stops, past which the exposure moves linearly),
`exposureBlackBucketWeight` (`0`, from 0 to 1: how much the pixels of no light count) and
`exposureLuminanceMethod` (`'uniform'`, the mean of the channels; `'ntsc'`; `'workingSpace'`),
`exposureMethod` (`'histogram'`, the default; `'basic'`, the weighted mean of the log luminance of the image's cells, a
cheaper measure; `'manual'`, no measure: the camera's exposure), `exposureApplyPhysicalCamera` (`true`: where the method
is manual, the aperture — the depth of field's, f/4 by default —, `exposureCameraShutterSpeed` (`60`, in 1/s, from 0.01 to 8000) and `exposureCameraIso` (`100`, from 1) set the exposure, EV100 = `log2(aperture² · shutter speed · 100 / ISO)`;
`false` reads the camera as EV100 0 and the bias alone sets it) and `exposureLensAttenuation` (`0.78`, from 0.01: 0.78
makes lighting unitless, a luminance of 1 being EV100 0; a lower one raises the luminance every EV100 is read from).
They apply where `world.exposure` is `'auto'`, from the next frame; the exposure adapts on the world's time, so a world
that holds still does not move it. The metering mask, `exposureMeterMask` (an `ImageBitmap`, read at the opening;
`explorer.setExposureMeterMask(image)` changes it, `null` gives it back), weighs where the image is measured by its red
channel. A manual exposure that does not change costs the GPU nothing. The same object holds the
pre-exposure's three settings, which apply to a lit view whatever its exposure: `preExposure` (`true`:
every light is written to the image already multiplied by the exposure of the image before, and the
composition multiplies the image by the exposure over that number, so the picture is the same and
the half floats keep their range at any exposure; `false` writes every light as it is) and
`preExposureOverride` (`0`: above 0, the number every light is multiplied by, in place of the
exposure of the image before) and `cachedLightingPreExposure` (`4`, from −16 to 16: the stops the
sky light's real-time capture is pre-exposed by, whatever the exposure — it is written multiplied by
2 to the minus that number and read back multiplied by its inverse, so its half floats keep their
range from about −8 to +12 stops of exposure at 4, −4 to +16 at 8; read with `preExposure` on or
off). It also holds the local exposure's settings, `localExposure…`, which
apply to a lit view whatever its exposure (the effect chain, below). A write names the settings it changes, `null` one's default; a value a setting does
not take is refused by name.

The exposure's compensation curve, `exposureCurve` (an option of `createWorld` and of the explorer,
read at the opening; `explorer.setExposureCurve(curve)` changes it, `null` or `false` gives it back),
adds stops to the target by how bright the scene is: a list of keys `[ev, compensation]`, an EV100
(the mean luminance over middle grey, one stop a doubling) and the stops added there (0 none, -1
twice as dark, 1 twice as bright), linear between keys; or `{ keys, before, after }` for the
extrapolations (`'constant'` by default; `'cycle'`, `'cycleWithOffset'`, `'oscillate'`, `'linear'`,
`'none'`), a key an object `{ ev, compensation, interpolation, tangentMode, arriveTangent,
leaveTangent, … }` for a `'constant'` or `'cubic'` run. It is baked into 64 samples over EV100 -10 to
+20. None by default: the image is the same. A curve is replaced, not edited in place, and one that
is not a curve is refused by name.

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
explorer.setExposureCurve(null) // no compensation
```

The local exposure's contrast curves, `localExposureHighlightContrastCurve` and
`localExposureShadowContrastCurve` (options of `createWorld` and of the explorer;
`explorer.setLocalExposureHighlightContrastCurve(curve)` and
`explorer.setLocalExposureShadowContrastCurve(curve)` change them, `null` or `false` gives them
back), take the same keys `[ev, scale]` as the compensation curve, but the value of a key is a scale
the highlights' or the shadows' contrast (`localExposureHighlightContrast`,
`localExposureShadowContrast`) is multiplied by, read at the EV100 of the frame's mean luminance as
the compensation curve is. A curve set makes the local exposure run whatever the contrasts. None by
default: the contrasts are used as they are.

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
```

`world.renderScale` (option of `createWorld` too, `'auto'` by default) is the per-axis fraction of
the display drawn before temporal antialiasing rebuilds the image: `'auto'` is a dynamic
resolution, choosing between 0.5 and 1 from the GPU frame time against the frame time budget
(`dynamicResolutionFrameTimeBudgetMs`, 33.3 ms by default, the frame cap's interval where it is 0);
without GPU timestamps it stays at 1. `{ min, max }` bounds it, a number fixes it. A read is the
last image's scale. Without temporal antialiasing the scale is chosen the same way and the image
upscaled to the display by a Catmull-Rom cubic over the drawn pixels. The same
history also fits the cut's GPU time budget (`cutEdgeScaleBudgetMs`), when the host gives one.

`world.dynamicResolution` holds the eleven settings that tune that fit, each an option of
`createWorld` too, `explorer.setDynamicResolution(field, value)` and the tool
`trillion3d_set_dynamic_resolution` writing them from the next GPU time: the frame time budget
(`dynamicResolutionFrameTimeBudgetMs`, `33.3`), the most the scale may be
(`dynamicResolutionThrottlingMaxPercent`, `0`, none), the headrooms
(`dynamicResolutionHeadroomPercent`, `10`, and `dynamicResolutionOverBudgetHeadroomPercent`, `0`),
the history (`dynamicResolutionHistorySize`, `16`, a whole number from 1 to 4096, and
`dynamicResolutionFrameWeightExponent`, `0.9`), the change period (`dynamicResolutionChangePeriod`,
`8`), how far a rise goes (`dynamicResolutionIncreaseAmortization`, `0.9`), the change under which
the scale does not move (`dynamicResolutionChangePercentThreshold`, `2`), the frames in a row over
the budget that count (`dynamicResolutionMaxOverBudgetFrames`, `2`) and whether a frame the CPU
took too long is not over budget by its GPU time (`dynamicResolutionUseCpuTimeLogic`, `false`).
None is written by a quality level; where the render scale is a number, none does anything
([ENGINE.md](ENGINE.md#dynamic-resolution)).

```js
const world = createWorld('viewer', { renderScale: 'auto', maxFrameRate: 60 })
world.dynamicResolution = {
  dynamicResolutionFrameTimeBudgetMs: 12,
  dynamicResolutionHeadroomPercent: 20,
}
world.dynamicResolution = { dynamicResolutionHeadroomPercent: null } // back to the default 10
```

`world.maxFrameRate` (option of `createWorld` too, `Infinity` by default) caps the frames a second
the world draws, even while its scene moves: the loop draws on a whole number of
refreshes, the fastest rate at or under the cap (12: every 5th refresh at 60 Hz, every 10th at
120 Hz), so each image is shown for the same time; the refreshes between draw and count nothing, and
the `'auto'` render scale fits each image to the time the cap gives it. A write applies from
the next frame; a page of several worlds caps those out of focus.

`world.effects` is the ordered chain of passes after temporal antialiasing, before the canvas.
A world starts with a bloom in its chain, `effect.bloom()` at its defaults: six Gaussian blurs of
the linear image at six scales, added to it before the exposure and the curve, in a view lit by
declared lamps — about 9 percent of the light at the default `intensity` of `0.675`. Remove it
(`world.effects.clear()`) or set its `intensity` to 0 for an image without. `effect.bloom({ intensity,
threshold, sizeScale, levels })`: `threshold` (`-1` by default, every pixel glows) the exposed
luminance past which a pixel glows; `sizeScale` (`4`) the multiplier of every level's width;
`levels` the six levels' `{ size, tint }`, finest first — `size` a percent of the level's width (`0.3`,
`1`, `2`, `10`, `30`, `64`; 0 leaves the level out), `tint` a number or `[r, g, b]` (`0.3465`,
`0.138`, `0.1176`, `0.066`, `0.066`, `0.061`). `world.vignette` (`0.4`; 0 none) darkens the
lit image toward its corners, and the local exposure — `localExposureHighlightContrast` and
`localExposureShadowContrast` (`0.8`), `localExposureDetailStrength` (`1`), `localExposureBlurBlend`
(`0.6`), `localExposureBlurSize` (`50`), `localExposureMiddleGreyBias` (`0`), the two thresholds
(`0`) and their strengths (`1`), in `world.exposureSettings` — brings each pixel's light nearer to
middle grey by how far the light around it is from it. It is on by default, as in a new project; `1` for both contrasts with a detail of `1` turns it off.

```js
const [bloom] = world.effects.passes // the bloom the world started with
bloom.intensity = 0.3 // a fainter glow; 0 turns it off, `world.effects.clear()` removes it
world.vignette = 0.2 // a lighter vignette; 0 none
world.exposureSettings = { localExposureHighlightContrast: 1, localExposureShadowContrast: 1 } // local exposure off
```

**Film effects.** The lit image of a view is finished with the effects of a lens and a film, after the exposure and before
the curve. `world.vignette` (`0.4`) is the strength of the vignette; the rest of its look, and the other effects, are the
run-time settings `world.film` — also options of `createWorld`, and `explorer.setFilm(field, value)` on a session; an
agent sets them through `trillion3d_set_film`. Each has the reference's default, so with nothing written the vignette and
the dither are on and the grain, the colour fringe and the tint are off. A write applies from the next frame; `null` gives
a setting back to its default or to the quality level's. The effects draw in the lit image only: a view that shows the
albedo, a diagnostic view and a capture show the image as it is.

| Setting                                                                                   | Default                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filmGrainIntensity`                                                                      | `0`                    | The film grain's strength; 0 draws none. The grain multiplies the exposed light by a noise of mean 1, so the image keeps its average brightness.                                                                                                                                                                                                                                                                                               |
| `filmGrainIntensityShadows`, `filmGrainIntensityMidtones`, `filmGrainIntensityHighlights` | `1` each               | The share of the grain in the dark, middle and bright pixels; all three at 0 draw none.                                                                                                                                                                                                                                                                                                                                                        |
| `filmGrainShadowsMax`                                                                     | `0.09`                 | The luminance up to which a pixel is dark: the dark share fades out to nothing there.                                                                                                                                                                                                                                                                                                                                                          |
| `filmGrainHighlightsMin`, `filmGrainHighlightsMax`                                        | `0.5`, `1`             | The luminances from which a pixel starts to be bright and from which it is wholly so.                                                                                                                                                                                                                                                                                                                                                          |
| `filmGrainScaleX`, `filmGrainScaleY`                                                      | `1`                    | The size of a grain along each axis: 1 is a texel of one pixel on an image 1920 wide, and the grain grows with the image.                                                                                                                                                                                                                                                                                                                      |
| `filmGrainSequenceLength`                                                                 | `97`                   | The images after which the grain's pattern repeats.                                                                                                                                                                                                                                                                                                                                                                                            |
| `chromaticAberration`                                                                     | `0`                    | The colour fringe's intensity, in percent of the distance to the centre. The red and the green of a pixel are read nearer the centre than its blue, by their wavelengths. 0.01 or less draws nothing.                                                                                                                                                                                                                                          |
| `chromaticAberrationStartOffset`                                                          | `0`                    | The distance from the centre, 0 to 1, where the fringe starts; 1 draws nothing.                                                                                                                                                                                                                                                                                                                                                                |
| `chromaticAberrationQuality`                                                              | `'high'`               | `'off'` draws no fringe whatever its intensity.                                                                                                                                                                                                                                                                                                                                                                                                |
| `chromaticAberrationMax`                                                                  | `-1`                   | −1 leaves the intensity as it is, 0 or more caps it there, −2 forces an extreme one (5).                                                                                                                                                                                                                                                                                                                                                       |
| `vignetteType`                                                                            | `'cosineFourthLaw'`    | The shape: the cosine-fourth law of a lens, or `'oval'`.                                                                                                                                                                                                                                                                                                                                                                                       |
| `vignetteColorRed`, `vignetteColorGreen`, `vignetteColorBlue`                             | `0`                    | The colour the image darkens toward (black).                                                                                                                                                                                                                                                                                                                                                                                                   |
| `vignetteCenterX`, `vignetteCenterY`                                                      | `0.5`                  | Where it is brightest; 0.5 is the middle.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `vignetteSizeX`, `vignetteSizeY`, `vignetteSoftness`                                      | `1`, `1`, `5`          | The oval's extent and how fast it falls to the colour.                                                                                                                                                                                                                                                                                                                                                                                         |
| `tonemapperQuality`                                                                       | `5`                    | 0 to 5: under 2 the vignette is off, under 4 the grain is. The quality levels write 0 at `'smooth'`, 2 at `'balanced'` and 5 at `'fine'` and `'cinematic'`.                                                                                                                                                                                                                                                                                    |
| `tonemapperSharpen`                                                                       | `-1`                   | Below 0 the scene's `sharpness`; 0 or more replaces it. Both are read from 0 to 10.                                                                                                                                                                                                                                                                                                                                                            |
| `sceneColorTintRed`, `sceneColorTintGreen`, `sceneColorTintBlue`                          | `1`                    | The tint the scene's colour is multiplied by; the bloom's glow is not tinted.                                                                                                                                                                                                                                                                                                                                                                  |
| `quantizationDitheringBits`                                                               | `0`                    | The dither that hides the display's steps: a triangular noise of one level of the display's channel added to the colour shown, always drawn, with a new pattern at each image drawn. 0 or less takes the step from the target (1/255 for an 8-bit one); a number of bits, any whole number, makes it 1/(2^bits − 1), 32 too small to show.                                                                                                     |
| `propagateAlpha`                                                                          | `false`                | Whether the image carries an alpha channel. Off, the colour is shown opaque and the alpha is read by nothing. On, the alpha is the share of the background the image leaves visible, an inverse opacity: 1 where nothing is drawn, 0 on a surface, multiplied by the transmittance of the sky, the fog, the clouds and the translucent layers; the post stages read the colour as it is and carry the alpha beside it, and a capture holds it. |
| `primitiveAlphaHoldout`                                                                   | `false`                | Whether the engine supports the alpha holdout. It takes effect only with `propagateAlpha` on: the translucent layers are then drawn once more, far to near, to accumulate the share of the background they leave visible, which replaces the image's alpha, so a layer of blending `'alphaHoldout'`, or a sky, clouds or height fog that holds out (`holdout`), punches a hole in it.                                                          |
| `translucencyHoldoutLocation`                                                             | `'beforeDepthOfField'` | Where the accumulated alpha is laid over the image: `'beforeDepthOfField'`, with the translucent layers, or `'afterDepthOfField'`, only where a layer left something, once the depth of field has drawn.                                                                                                                                                                                                                                       |

```js
world.film = { filmGrainIntensity: 0.3, filmGrainScaleX: 1.5, filmGrainScaleY: 1.5 } // a coarser grain
world.film = { chromaticAberration: 2, chromaticAberrationStartOffset: 0.3 } // a fringe from a third of the way out
world.film = {
  vignetteType: 'oval',
  vignetteSizeX: 1.4,
  vignetteSoftness: 3,
  vignetteColorBlue: 0.04,
}
world.film = { tonemapperSharpen: 1 } // sharpen whatever the scene says; `null` gives the scene's back
world.film = { quantizationDitheringBits: 32 } // no visible dither: bit-exact captures
world.film = { propagateAlpha: true } // a capture carries the share of the background left visible (1 − opacity) in its alpha, for compositing
world.film = { propagateAlpha: true, primitiveAlphaHoldout: true } // holes in the alpha where a layer, the sky, the clouds or the fog hold out
const world = await createWorld(canvas, { filmGrainIntensity: 0.3 }) // as an option
```

The scene's own `sharpness` (the `environment` of the scene) is read from 0, none, to 10; 1 is a unit-gain sharpening and
0, the default, draws none. The dither is on by default: at one level of an 8-bit display, 1/255, its noise changes no
pixel by more than one level. The grain's pattern changes with each image: a view whose grain is drawn is drawn again at
every image, at rest too. The dither's pattern changes with each image that is drawn; a view at rest, which is not drawn
again, keeps the pattern of its last image — the held image is 8 bits, and a new noise added to it averages, over the
images, to the held image and not to the light; to draw every image at rest, as the reference does, open the session with
`drawConverged: true`.

**Colour grading.** The display turns the exposed light into the colour it shows through one table, baked from the scene's
display curve and these settings, `world.colorGrading` — also options of `createWorld`,
`explorer.setColorGrading(field, value)`, and the tool `trillion3d_set_color_grading`. A write applies from the next frame
and bakes the table again; `null` gives the default back. With nothing written the colour is the film curve's own: no white
balance, no grade. The film curve's own settings, its expansion of a bright colour's gamut, its blue correction and its
amount shape the curve the scene gets by default (`toneMapping: 'filmic'`); the white balance, the grade, the correction,
the display's gamma and the table apply to every curve but `'none'`. The translucent layers and the particles drawn over a
display filter show their colours through the same chain, so a grade, a white balance or a transfer moves them with the
scene under them. The scene's `toneMapping: 'filmic'` has two methods, `tonemappingMethod`: the film curve, and the
standard output transform of the film industry's colour system, in two versions (`acesVersion`). The scene's curve is
`'filmic'` or `'none'`, and no other.

| Setting                                                                                     | Default                             | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tonemappingMethod`                                                                         | `'filmic'`                          | How the scene's `'filmic'` display curve turns the light into colour: `'filmic'`, the film curve; `'standardAces'`, the standard output transform of the film industry's colour system. The film curve's settings below, the blue correction, the correction's polynomial and the display gamma's ratio do not shape it; the expansion of the gamut, the white balance and the grade do.                                                                                                                                                                                                                                                                                                                                                                            |
| `acesVersion`                                                                               | `2`                                 | 1 or 2: the version of the standard output transform. 2 is a model of the colour's lightness, colourfulness and hue, whose tone scale is fitted to a 100-nit display, whose colourfulness is compressed with the lightness and whose colours outside the display's gamut are pulled in along lines of constant hue; 1 is the earlier one, which works on the three channels — a glow on dark saturated colours, a pull of the reds by hue, a desaturation and a tone scale of a display of 1000 nits, of which the 100 an sRGB display shows are kept: **its picture is much brighter** (a neutral light of 0.18 is shown 0.26 in linear display light against version 2's 0.16). Only `'standardAces'` reads it, and `applyColorGrading: false` does not reset it. |
| `acesGamutCompression`                                                                      | `0`                                 | From 0 to 1: the share of a compression of the colours past the gamut's edge that version 1 applies first; 0 applies none. Version 2 does not read it, and `applyColorGrading: false` does not reset it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `acesSceneColorMultiplier`                                                                  | `1.5`                               | From 0: the factor the light is multiplied by before the standard output transform; only `'standardAces'` reads it, and `applyColorGrading: false` does not reset it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `filmSlope`, `filmToe`, `filmShoulder`, `filmBlackClip`, `filmWhiteClip`                    | `0.88`, `0.55`, `0.26`, `0`, `0.04` | The film curve: the straight run's slope in log luminance (any number but 0, which divides by it), how much of the range the toe (dark end) and the shoulder (bright end) bend over, and how far the black and the white are lifted. A toe above 0.8 puts middle grey on the straight run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `blueCorrection`                                                                            | `0.6`                               | 0 to 1: how far saturated blues are pulled toward the centre of the working gamut before the curve and given back after it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `expandGamut`                                                                               | `1`                                 | From 0: how far a bright, saturated colour is carried toward a wider gamut before the curve; 0 expands none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `toneCurveAmount`                                                                           | `1`                                 | From 0: how much of the curve is mixed into the colour; 0, with `expandGamut` 0, takes the curve away.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `temperatureType`                                                                           | `'whiteBalance'`                    | How the next two are read: `'whiteBalance'`, the white the scene was lit by, which is taken to white; `'colorTemperature'`, the colour of the light the image is turned toward.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `whiteTemperature`, `whiteTint`                                                             | `6500`, `0`                         | The white balance's temperature in kelvins and tint, −1 green to 1 magenta; 6500 and 0 leave the light as it is. Any number: the chain stays finite for every temperature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `colorSaturation…`, `colorContrast…`, `colorGamma…`, `colorGain…`, `colorOffset…`           | `1` (offset `0`)                    | The grade: five operations, each four numbers — `Red`, `Green`, `Blue` and `Master`, the one the three share — for all the light (`colorGainRed`), for its dark part (`colorGainShadowsRed`), its middle (`colorGainMidtonesRed`) and its bright part (`colorGainHighlightsRed`), which apply over the whole light's: 80 settings. A saturation of 1 leaves the colour, 0 takes it to its luminance; a contrast is the power about middle grey (0.18); a gamma the power 1 over it; a gain multiplies; an offset adds after the gain.                                                                                                                                                                                                                               |
| `colorCorrectionShadowsMax`, `colorCorrectionHighlightsMin`, `colorCorrectionHighlightsMax` | `0.09`, `0.5`, `1`                  | Where the dark part ends, and where the bright part starts and is whole; the middle is what is left of both.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `colorMin`, `colorMid`, `colorMax`                                                          | `0`, `0.5`, `1`                     | The correction of the colour the film curve gives, each from −10 to 10: the polynomial through 0 → min, 0.5 → mid, 1 → max, in linear light. The defaults are the identity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `applyColorGrading`                                                                         | `true`                              | `false` reads the white balance, the grade, the film curve's settings, the method and the bounds of the parts at their defaults, whatever was written; the correction, the display's gamma and transfer, the multiplier, version and gamut compression of the standard output transform and the table keep their values.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `displayGamma`                                                                              | `2.2`                               | The gamma the display is taken to have; its ratio to 2.2 is a power on the film curve's colour. 2.2 changes nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `tonemapperGamma`                                                                           | `0`                                 | 0 keeps the transfer; a number above 1 shows the colour through that gamma in place of the transfer (2.2 is the pure gamma some displays take); a number under 1 is read as 1: no transfer at all, the linear light as the display value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `sdrInverseEotf`                                                                            | `'default'`                         | The transfer to the display value: `'default'`, the method's own — the sRGB curve for the film curve, the power 2.4 for `'standardAces'` —, `'srgb'`, or `'bt1886'`, the power 2.4 of a studio display.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `lutSize`                                                                                   | `32`                                | The texels a side of the cube the colour is baked into, from 2, with no other limit than the largest 3D texture the device makes (the cube is baked at that side) and the device's memory budget, which admits the cube (4 bytes a texel, 8 where the device has no storage textures of a 10-bit format: 128 KiB at 32, 1 MiB at 64, 64 MiB at 256, twice that without): where the budget's room holds fewer texels the cube is the largest side it holds, never a refusal, and the frame's metrics say so (`toneTable: { side, bytes, why }`). A larger cube follows the curve more closely (at 32 its mean difference from the exact curve is a fifth of one display level, at 64 a twentieth) and costs more to bake.                                            |
| `lutShaper`                                                                                 | `'log'`                             | How a light addresses the cube: by its logarithm over 14 stops, or `'pq'`, the perceptual quantizer of a high-range display (100 times the light, in nits).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

```js
world.colorGrading = { whiteTemperature: 4800, whiteTint: 0.1 } // warm the cold light of a scene
world.colorGrading = { colorSaturationMaster: 1.2, colorContrastMaster: 1.1 } // a richer image
world.colorGrading = { colorGainShadowsBlue: 1.15, colorGainHighlightsRed: 1.05 } // blue shadows, warm highlights
world.colorGrading = { filmSlope: 0.91, filmToe: 0.53, filmShoulder: 0.23, filmWhiteClip: 0.035 } // another film
world.colorGrading = { applyColorGrading: false } // the defaults of the whole grade, keeping the table
world.colorGrading = { tonemappingMethod: 'standardAces' } // the standard output transform, shown through the power 2.4
world.colorGrading = {
  tonemappingMethod: 'standardAces',
  sdrInverseEotf: 'srgb',
  acesSceneColorMultiplier: 1.2,
}
world.colorGrading = {
  tonemappingMethod: 'standardAces',
  acesVersion: 1,
  acesGamutCompression: 0.5,
} // the earlier version, half compressed
world.colorGrading = { colorSaturationMaster: 0 } // a monochrome scene: its tinted glass and its sparks are monochrome too
const world = await createWorld(canvas, { lutSize: 64, colorMin: 0.01 }) // as options
```

`effect.outline({ objects, color, thickness })` lines the visible silhouette of `objects`, each
with its subtree — a runtime mesh or a loaded model's node, at whatever detail is drawn —, over the
display image after tone mapping, so `color` (`#ff9f1c` by default) shows as written; `thickness`
(`2` by default, up to `32`) is in CSS pixels. What hides a selected object hides its line.
`outline.objects = [...]`, `outline.color.set(...)` and `outline.thickness` show next frame; with no
object, no pass runs and nothing is allocated.
`world.effects.add(pass, index?)`, `remove(pass)` and `clear()` change the chain; settings show next
frame. An empty chain costs nothing; a still image is post-processed once.

`world.addView({ canvas | viewport, camera?, renderScale?, temporalAntialiasing?, maxFrameRate? })`
draws the same world from another camera — into a canvas of its own (a canvas, an element to draw
in, or the ID of either), or over a `viewport` rectangle of the world's canvas, CSS pixels —, one
of the two, else `INVALID_VIEW`. A view shares everything no camera changes: the scene, its
placements, the pages and their pools, the materials, the shadow pool (each view keeps the clipmap
of a sun centred on its own eye; the local lights' maps and the pages rendered are shared), the
physics and the clips, so it costs no second scene, upload or simulation. It owns what a camera
changes: its cut, visibility and occlusion pyramid, lighting resolve, temporal history and effects.
Each frame of the world draws its own camera, then every view due, in the order added, in one loop
and one budget: `'auto'` render scales fit the whole frame, every view's GPU time in it, to the
refresh. `camera` is a perspective camera of its own by default; `renderScale` (`'auto'`),
`temporalAntialiasing` (`true`) and `maxFrameRate` (`Infinity`: every frame of the world) read as
the world's own, and are written on the returned `WorldView` from its next image, as are `camera`
and `viewport`. `view.onFrame(({ delta, metrics }) => …)` runs after each frame that drew it;
`metrics` (`ViewFrameMetrics`) carries its GPU time, passes, drawn size and scale, triangles and
target bytes, and the world's frame lists the views it drew in `metrics.views`. `view.dispose()`
takes it out, keeping a canvas the page gave it; `world.views` lists them, and `world.dispose()`
takes them all. Pages showing one scene several times (camera walls, stereo, plan views) add views;
separate worlds remain for different scenes or looks.

Dispose in the page's teardown, **not right after startup**: `world.dispose()` removes owned
controls, observers, queued frames and abort listeners and closes the engine, keeping the canvas.
`createJob` wraps `scene.load(url, { signal, onProgress })` for cancellation and an observable
status.

`world.textureFiltering` holds the settings of the anisotropic filtering, each an option of
`createWorld` too: the most reads a texture takes along the longer axis of its footprint. A texture
that asks for less (`Texture.anisotropy`, 8 for a new one; the `maximum` detail asks 16) keeps its
own; one that asks for more is held to the ceiling. A write names the settings it changes, `null`
one's default; a value of another kind is refused by name. They are render settings of the textures
group: the quality presets write them (below), the page's value holds over a preset, and a write
applies from the next image.

| Setting                              | Takes                                                                                                                                                                                                                                                                                                                                                                                                                               | Default |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `textureMaxAnisotropy`               | A whole number from 1 to 16: the ceiling of the sampler the clouds' textures, the only ones not streamed by tile, are read through; `1` turns their anisotropic filtering off                                                                                                                                                                                                                                                       | `8`     |
| `virtualTextureMaxAnisotropy`        | A whole number from 1 to 16, held to the power of two at or below it: the ceiling of the reads and of the tile requests of every map of a material; a lower one reads fewer taps                                                                                                                                                                                                                                                    | `8`     |
| `virtualTextureAnisotropicFiltering` | `true` / `false`: `false` reads a streamed texture ONCE per sample, at the level of the footprint's longer axis moved toward the shorter by the elongation (up to the ceiling's logarithm), picked among the two levels it straddles by a per-pixel, per-image noise, the tiles asked being that level's; `true` takes as many taps along the footprint as the elongation asks, up to the ceiling. The same at every quality preset | `false` |

| Quality preset                | `smooth` | `balanced` | `fine` | `max` | `cinematic` |
| ----------------------------- | -------- | ---------- | ------ | ----- | ----------- |
| `textureMaxAnisotropy`        | `1`      | `2`        | `4`    | `8`   | `8`         |
| `virtualTextureMaxAnisotropy` | `4`      | `4`        | `8`    | `8`   | `8`         |

The streamed textures' ceiling bounds what a pixel asks to stream as much as what it reads: a surface
seen at a grazing angle is read at a coarser level when the ceiling is low, and asks for fewer
tiles. The headers of the textures are written again when it moves; the clouds' textures' sampler is
made again.

```js
const world = createWorld('viewer', { virtualTextureMaxAnisotropy: 4 })
world.textureFiltering = { virtualTextureMaxAnisotropy: 16 } // sharper at a slant, from the next image
world.textureFiltering = { textureMaxAnisotropy: 1 } // the clouds' textures read isotropic
world.textureFiltering = { virtualTextureAnisotropicFiltering: true } // taps along the footprint, as many as the elongation asks
world.textureFiltering = { virtualTextureMaxAnisotropy: null, textureMaxAnisotropy: null } // defaults
```

The explorer's tool `trillion3d_set_texture_filtering` writes one setting at a time (`field`, `value`).

### Camera controllers

A controller reads the canvas's pointer, wheel and key events and writes the camera's pose; a world
asks for one at creation and drives it through `world.controls`:

```js
const world = createWorld('viewer', { controls: 'orbit' }) // at creation
world.controls.kind = 'fly' // switch live
world.controls.enabled = false // pause input
world.controls.target.set(0, 1, 0) // orbit pivot
```

They live on the world, whose canvas they read, and follow `world.camera` when it is replaced;
setting `kind` releases the current controller and builds the next. `firstPerson` is the
character's head without a body.

| `world.controls.kind` | Motion                                         | Gestures                                                            |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `'orbit'`             | orbit around `target`, world up kept           | drag turns, secondary drag or two fingers pan, wheel and pinch zoom |
| `'fly'`               | six degrees of freedom                         | `W`/`S`, `A`/`D`, `R`/`F`, arrows, `Q`/`E` roll, drag to look       |
| `'firstPerson'`       | pointer-locked walk, horizon level             | pointer turns the head, `W`/`S`/`A`/`D`, `Space`/`Shift`            |
| `'character'`         | a body that walks, runs, jumps and falls       | pointer turns the head, `W`/`S`/`A`/`D`, `Space` jumps              |
| `'vehicle'`           | none: drives `world.controls.vehicle`          | `W` throttle, `S` brake, `A`/`D` steer, `Space` handbrake           |
| `'trackball'`         | free spin about the screen axes, roll included | drag spins, secondary drag pans, wheel zooms                        |
| `'panZoom'`           | planar view, no rotation                       | drag slides, wheel and pinch zoom, arrow keys pan                   |
| `'none'` (default)    | camera posed by the host                       | none                                                                |

All publish `object.position`, `addEventListener('change')`, `removeEventListener` and `dispose()`;
the three with a pivot add `target`, `minDistance`, `maxDistance`, `enableZoom`, `enablePan` and
`update()`, which clamps a pose the host wrote. `change` fires only when the pose moved.
`enableZoom` and `enablePan` (`true`) are also settings of `world.controls`, kept across `kind`
like its limits and speeds: readable under every kind, read only by a controller with a pivot, so
one turned off under `'fly'` is off in the `'orbit'` that follows.

**The character's body.** `'character'` moves an upright capsule with an adult's values
(`HUMAN_BODY`, the engine's own character: a 0.34 m radius and 1.76 m capsule, a 6 m/s walk, a 4.2 m/s jump, 44.765° slopes, 0.45 m steps, 100 kg, a 250 N push),
each a setting of `world.controls`. Its body is the physics' virtual character in its worker
([PHYSICS.md](PHYSICS.md)), so the world needs `physics: true`: it climbs steps and slopes, rides
a moving platform, pushes dynamic bodies with at most `pushStrength` newtons and is pushed back,
and the level is whatever carries `mesh.physics = 'static'`. The feet are drawn at the bodies' time.
Until the physics runs the character stands where it was put and hears no key.

The body reads one drive (`characterDrive.ts`), the engine's movement model: on a floor the velocity
turns toward the wish by `groundFriction` (8 per second), gathers `maxAcceleration` up to `walkSpeed`
(6 m/s) and, with no key, is braked by the friction and `brakingDecelerationWalking` (20.48 m/s²); in
the air the sideways velocity is kept (`fallingLateralFriction` 0, `brakingDecelerationFalling` 0), the
keys pushing with `airControl` (0.05, doubled under `airControlBoostVelocityThreshold` 0.25 m/s) of the
force, and the fall is held to `terminalVelocity` (40 m/s). A press jumps once, from a floor, before the next landing (`jumpMaxCount` 1, `jumpMaxHoldTime` 0): a press in the air, or one the body is not allowed, is lost, and a body that walked off an edge has no jump. The
physics takes at most four steps a frame (`MAX_CATCH_UP_STEPS`): a slower page shows slow motion,
never a jump.

**The character's modes.** The body walks, falls, swims where `world.physics.water` carries it and
flies while `flying` is set (`controls.mode`). `canCrouch` (false by default) lets C crouch it to
`crouchedHeight` (0.8 m) at `crouchedSpeed`; `canSwim` (true), `swimSpeed` (3 m/s), `flySpeed` (6 m/s),
`buoyancy` (1), `fluidFriction` (0.3) and `maxAcceleration` (20.48 m/s²) shape a body in a fluid, which
goes where the head looks, Space rising and C sinking ([PHYSICS.md](PHYSICS.md#movement-modes)).

```ts
world.controls = 'character'
world.controls.canCrouch = true
world.controls.flying = true // the body flies; false lets it fall
```

**The character's gravity.** The body is pulled by the world's gravity, `world.physics.gravity`,
times `world.controls.gravityScale` (1 by default; 0 floats the body, and no sole then pushes on the
floor): the rise after a jump, the apex of a given `jumpSpeed`, and the fall follow
the world, live, so a Moon world lifts the body higher and longer, and lets it fall as slowly. The
rise and the fall are under the one gravity, and only its vertical component counts: a body stands
upright on its world's up, so a gravity vector with a sideways part pulls it down by its `y` alone.

```js
world.physics.gravity = 'moon' // the body rises and falls under 1.62 m/s²
world.controls.gravityScale = 0.5 // and feels half of it
```

**Vehicles.** `'vehicle'` maps the keys to a `VehicleInput` (`throttle`, `brake`, `steer`,
`handbrake`) and hands it to `world.controls.vehicle.drive(input)` on each change. Any object with
`drive` can be driven, the physics' vehicles first (`vehicle.car`,
[PHYSICS.md](PHYSICS.md#vehicles)). `kind = 'vehicle'` while `vehicle` is `null` throws
`NO_VEHICLE`. The camera does not follow: the page moves it in `world.beforeFrame` ([Loop](#loop)),
never in `onFrame`, a frame late.

### Picking, moving and saving

`await world.raycast(at)` resolves to the nearest hit under a canvas point (CSS pixels,
`event.offsetX`/`offsetY`) or along a world `Ray`, or `null`: the scene node drawn there (a mesh
the page added, or a node of a loaded model, under it), world `point` and `normal`, `distance`, and
`face`, the drawn triangle (its cluster × 256 + its rank in it). It always returns a promise,
settled a frame or so later: the GPU traces every ray cast in the same tick together — down the
placement tree, each placement's cluster hierarchy, then the triangles the rasters draw — and reads
the hits back without ever stalling the page. What is hit is the finest detail the pool holds, in
view or out of it, opaque or blended: a loaded model on its own triangles, a skinned, morphed or
waved mesh where this frame draws it. A line is hit where the ray passes within `lineThreshold`
world units of it (1 by default, as three.js's `Raycaster.params.Line.threshold`; 0 never hits a
line), at the ray's nearest pass, its `normal` facing the ray; a point is hit on its dot, as wide as
its material's `size`. Sprites, hidden objects and `helper` marks are passed by
(`{ helpers: true }` meets the marks, as `controls.transform` does).
`{ objects }` limits the subtrees; a sizeless canvas refuses a point (`RAYCAST_NO_VIEW`); a world
whose drawing session is not open yet resolves `null`. `canvasRay(camera, canvas, { x, y })` is the
world ray through a canvas point in CSS pixels, as `world.raycast` aims it: read on the canvas's CSS
box, shaped as the drawing buffer is drawn (a sizeless canvas throws `RAYCAST_NO_VIEW`);
`camera.rayThrough(x, y, aspect)` is the ray through a picture point. The exact raycast, on the physics' collision shapes, is
[PHYSICS.md](PHYSICS.md#exact-raycast). An orthographic camera made with `fitAspect: true` takes its
width from the canvas.

`controls.transform(world, options)` puts move, turn and scale handles on one object:
`attach(object)`, `detach()`, `setMode('translate' | 'rotate' | 'scale')`,
`setSpace('world' | 'local')`, `snap = { translate, rotate, scale }`, events `change`, `dragStart`,
`dragEnd` — one drag, one undo step. The handles are unlit `helper` meshes at a share of the canvas
height (`size`, a quarter by default). The pointer's hover is asked of `world.raycast` as it moves;
a press takes the latest answer — a handle when the nearest hit is one, so a handle hidden by the
scene is never grabbed — before the camera controller hears it. A touch has no hover: its first
press asks, the next one grabs. A drag writes the local pose through the parents; the centre cube
scales uniformly, by e per handle length up the screen. `attach` or `detach` mid-drag ends it with its `dragEnd`.

`scene.toJSON(camera)` writes plain, versioned JSON (`format: 'trillion3d-scene'`, `formatVersion:
5`): hierarchy, poses, each shape by the call that built it (`geometry.box(2, 1, 1)`; one changed
after, or hand-written, by its vertices), materials by parameters, bodies as `physics` declared them
(at rest), lights, background, the sky module's word (`sky`), the camera's pose; shared shapes and materials once, a loaded
model by its manifest address, `helper` marks left out. A texture, a picture environment, a shader
material or a number JSON cannot hold is refused (`SCENE_NOT_SAVABLE`). `await scene.fromJSON(json,
camera)` replaces the content (`helper` marks kept) and reloads the models; another format or
version (2, 3, 4 and 5 are read; 2's air, fog and sky light move into the sky module, a rectangle
light's intensity saved by 2 or 3, its radiance, is read as half that many nits, and a spot saved
before 5 with an `angle` and a `penumbra` is read as an outer cone and an inner cone of the angle
less that share, a lamp that named no unit in candelas) is refused (`UNSUPPORTED_SCENE_FORMAT`) before anything is removed. Calls during a read run
in order, each replacing the last. A scene editor needs these three doors and nothing else.

### Live material values

A material written on `color`, `emissive`, `emissiveIntensity`, `metalness`, `roughness` or
`opacity` is repainted in place, opaque or blended, the session kept (a colour picker dragged for
ten seconds keeps one session; a glass fading out keeps its material). A change it cannot hold in
place — a texture, a kind, a side, transparency, values another material
object shares — is copied on write: the copy is a new material, and the meshes that wear it join
the running session as any mesh added to the scene does, the session never opened again for it.
`world.diagnostic.sessions` counts the sessions a world opened: one, unless the device was lost or
an option changed (`session-reopen`, `cause`).

`material.meshPhysical` accepts `anisotropy` (strength, 0–1), `anisotropyRotation` (radians),
`clearcoat` and `clearcoatRoughness`, drawn with `anisotropyMap` (RG the direction, B the
strength), `clearcoatMap` (R), `clearcoatRoughnessMap` (G) and `clearcoatNormalMap`
(`clearcoatNormalScale`), each map at its native size with its own filters, wrap, transform and UV
channel, read as linear data. A map reads the UV channel its `texCoord` names, `TEXCOORD_0` to
`TEXCOORD_7`, from the compiled geometry page (eight sets) or from the source geometry (two); a
geometry without that set reads the first. A transparent surface carries the first set and one
more, the first past it that one of its maps reads. A rectangle light stretches its specular lobe
along the anisotropy.

A cloth — velvet, woven fabric — is a `material.meshPhysical` with `sheen` above 0 (the switch of the
cloth shading model), `sheenColor` (the fuzz colour, black unless set) and `sheenRoughness` (the
cloth amount, 0 to 1, 0 unless set), drawn with `sheenColorMap` (sRGB) and `sheenRoughnessMap` (its
alpha channel), each multiplying its factor. The specular of every light is then the standard lobe
mixed with an inverse-GGX fuzz lobe of the fuzz colour by the cloth amount, the diffuse stays
Lambert's, and the fuzz times the cloth amount joins the diffuse colour of the indirect light (the
environment's, the sky light's, the probes' and the volumetric lightmap's). The cloth model has
neither coat nor anisotropy, and a surface has one model: a `transmission` above 0, then a
`clearcoat` above 0, win over the sheen, which is then left out; a glTF material that declares
`KHR_materials_transmission` or `KHR_materials_clearcoat` beside `KHR_materials_sheen` is read so
whatever the factors (`gltf-sheen-dropped`). A glTF material's `specularColorFactor` and
`specularColorTexture`, and its iridescence, are kept in the compiled table and not drawn
(`gltf-specular-color-not-drawn`, `gltf-iridescence-not-drawn`).

`specularIntensity` (0 to 1) is the specular input of a dielectric: its reflectance at normal
incidence is 0.08 of it, so a surface that declares none keeps 0.5 (4%), 1 gives 8% and 0 no
highlight; a metal takes its base colour and ignores it. `specularIntensityMap` multiplies it by the
alpha channel of an image. A glTF material's `KHR_materials_specular` writes both as it declares
them (`specularFactor`, `specularTexture`, factor 1 when the extension names none); any surface that
declares one is read as a physical surface, a zero included. A surface that wears a graph takes its
specular from the graph's `specular` output instead.

```ts
const dull = material.meshPhysical({ color: 0x8090a0, roughness: 0.4, specularIntensity: 0.2 })
```

```ts
const velvet = material.meshPhysical({
  color: 0x401020,
  roughness: 0.8,
  sheen: 1,
  sheenColor: 0xff80a0,
  sheenRoughness: 0.6,
})
```

With a volumetric lightmap in the scene (`volumetricLightmap`, on by default), a pass of its own reads
its third-order harmonics at every lit opaque pixel and the indirect pass lights the pixel's diffuse
colour with their irradiance along its normal, as it does the environment's; a blended surface reads
none.

A clear coat (`clearcoat` above zero, a material's or a graph's) lies over the base as the reference's clear coat shading
model has it, in every light, on an opaque surface as on a blended one: the coat is a dielectric GGX lobe of
reflectance 0.04 at its own roughness (`clearcoatRoughness`, held at 0.02 at least), weighted by `c`; the base is lit through it —
its diffuse and its specular under the coat's two crossings, `(1 − F)²`, F the coat's Fresnel at the half vector, a metal base
absorbing along the refracted path of the light and the eye, the light's angle refracted by the coat's index of 1.5.
The environment, the bounce and the reflections see the base through the coat too: its colour is attenuated by the
coat's Fresnel along the view (a metal's replaced by its absorbed colour), the base's reflection is weighed by what the coat lets
through and the coat's own reflection is added. The coat shares the base's normal — the coat normal map a material carries is
read only with `world.shading = { clearCoatNormal: true }`. A coat costs a lobes target the size of the image and a
lobed lighting program wherever a surface carries one.

Lit materials can declare `subsurfaceColor` (black, off, by default) and an optional `subsurfaceMap`
for thin **double-sided** surfaces such as foliage: light arriving through the back, tinted.
Each light gives the eye its energy times `subsurfaceColor` times a wrapped cosine, `(½ − N·L) / (3/2)²`
held to 0..1 (the front takes light too, up to a cosine of one half), times a broad lobe that peaks
where the eye looks into the light; it has no 1/π and no cosine of its own.
Diffuse thin-surface transmission, not a volume: a glass volume uses physical `transmission`,
`thickness`, `attenuationColor` and `attenuationDistance`. The thickness is in the mesh's own units,
as glTF's: a placement scaled twice crosses, refracts and shadows through twice the path. A glTF
`KHR_materials_volume` that names no `attenuationDistance` attenuates over one metre.

A blended or transmissive surface casts no shadow: the shadow maps hold the opaque surfaces and the
cutouts, and glass, smoke and a light beam let the light of the sun and the lamps through. A shadow-casting light with a source size — a point or spot `radius`, a rectangle's `size` (its
shadow's source radius is half its width), a sun's `angularRadius` — casts penumbrae that harden at contact, traced through the shadow maps on opaque
and blended surfaces alike; a size of zero casts hard shadows.

### Geometry rewritten every frame

A shape rewritten every frame — a sea, a cloth, a procedural mesh, an editor handle — declares
`geometry.usage = 'dynamic'`: cut into pages once, index alone, a written list
(`attributes.position.needsUpdate = true`) uploads in place the vertices from the first changed to
the last, the frame after, no session reopened, drawn and shadowed like every paged mesh. A geometry
changed on two consecutive frames turns dynamic by itself (`geometry-dynamic`). A soft body's
geometry is dynamic; two soft bodies in one geometry are refused with `PHYSICS_FAILED` — give each
its own (`geometry.clone()`).

Culling reads `geometry.maxBounds` if declared, else a box derived from the first vertices
([ENGINE.md](ENGINE.md#dynamic-geometry)). A frame sends at most `DYNAMIC_UPLOAD_BUDGET_BYTES`
(4 MiB), every buffer written counted, as `metrics.dynamicUploadBytes` reports; a rewrite past it
waits for the next frame, in order, never dropped. Water need not be rewritten: a mesh lying
flat on the physics' water is moved by its waves on the GPU ([PHYSICS.md](PHYSICS.md)).

```js
const sheet = geometry.plane(28, 20, 112, 80)
sheet.usage = 'dynamic'
world.onFrame(({ metrics }) => {
  for (let v = 0; v < sheet.attributes.position.count; v++)
    sheet.attributes.position.setY(v, wave(v))
  sheet.attributes.position.needsUpdate = true // 9 000 vertices, uploaded in place
  console.log(metrics.dynamicUploadBytes)
})
```

### Particles: emitters spawning with the world's frames

`world.particles.add(spec)` makes an emitter over a fixed pool of particles, stepped on the GPU
and drawn with the translucent layers. Like an effect's emitter, it spawns `rate` particles a
second and any `burst` the page asks, each born with a lifetime, a speed and a direction drawn from
the ranges given, the direction inside a cone; the pool (`capacity`, `origin`, `blend`, `color`,
`size`, `fade`, `softness`, `acceleration`, `translucencyPass`) is fixed for its life, the spawn can
change at any time.

```js
const fire = world.particles.add({
  capacity: 2000, // particles alive at most; a newer one replaces the oldest
  origin: [0, 0.2, 0], // the emitter's place in the world, metres
  rate: 120, // particles a second
  lifetime: [0.6, 1.2], // seconds, a number or [min, max]
  speed: [1, 2.5], // metres a second at birth
  direction: [0, 1, 0], // the cone's axis
  spread: 0.35, // the cone's half angle, radians (0 to π)
  acceleration: [0, 1.5, 0], // metres per second squared on every live particle
  blend: 'additive', // 'premultiplied' for smoke
  size: 0.15,
  color: [1, 0.55, 0.15, 1],
  seed: 3, // one seed and one clock give one effect
})
fire.update({ rate: 20, spread: 0.1 }) // from the next particle on
fire.burst(200) // now, whatever the rate says
fire.update({ active: false }) // stops the rate; a burst still spawns
fire.dispose() // its particles go with it
```

A `capacity` below `rate * lifetime` makes the pool overwrite its oldest particles. A rate or a
spawn the contract refuses throws `PARTICLE_RATE`, `PARTICLE_SPAWN`, `PARTICLE_DIRECTION` or
`PARTICLE_SPREAD`; a pool the device cannot hold throws `PARTICLE_CAPACITY`.

### Guides: lines, points and helpers over the image

`world.guides` draws what a page shows _about_ its scene — an axis, a grid, a box, a measured
segment, a light's cone — without adding it to the scene: its own pass after the image is composed,
quads of a fixed CSS-pixel width, hidden by what stands in front, outside temporal accumulation.

```js
const grid = world.guides.add(helper.grid(20, 20), { width: 1.5 }) // any helper; it follows it
const cone = world.guides.add(helper.spotLight(spot)) // follows the light, no update() needed
const ruler = world.guides.lines({ positions: [0, 0, 0, 4, 0, 0], color: '#ffd24a', width: 3 })
const marks = world.guides.points({ positions: [0, 0, 0, 4, 0, 0], color: '#ffd24a', size: 8 })
ruler.setVisible(false) // kept, not drawn
grid.setTransform(model.matrixWorld) // placed by the page: it stops following its node
marks.remove()
```

- `add(object, { width, size })` reads an object's line and point meshes (every `helper` builds
  them) in their colours, triangles excluded, and follows its world transform (a light's or
  camera's helper: that light's or camera's) until `setTransform` hands it to the page. `lines`
  takes two ends per segment, `points` one position per dot.
- Each call answers a handle: `setVisible(on)`, `setTransform(matrix)` (sixteen column-major
  numbers or a matrix), `remove()`; `world.guides.clear()` removes all. Re-placing a guide at its
  pose changes nothing, so a still view stays held.
- At most `GUIDE_VERTEX_CEILING` (65,536) vertices a world, hidden ones included; a call beyond
  throws `GUIDE_CEILING` and adds nothing. `world.guides.vertexCount` reads what is held.
- With no guide shown the pass is neither built nor encoded. Positions are packed relative to the
  first guide in double precision, so a guide far from the origin keeps its detail. Text labels are
  not drawn.

## Installation and environment API

Installing, the CDN `importmap` and the licence: [README](../README.md#quick-start).
`npm install trillion3d`
takes only its machine's compiler package ([COMPILER.md](COMPILER.md#platform-packages)).

A strict browser TypeScript project enables the `browser` condition; without it, Bundler resolution
selects the common declarations, which lack `createWorld`.

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "customConditions": ["browser"],
    "lib": ["ES2023", "DOM"],
    "types": ["@webgpu/types"],
  },
}
```

A browser host installs `trillion3d` and, for its types, `@webgpu/types`; nothing else: the
package ships no rendering library (`tests/integration/installed-package.test.ts`).

A Node TypeScript host uses `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` and
`"types": ["node"]`; NodeNext then selects the Node declarations from the same specifier.

A page without a bundler imports `trillion3d/module`. A bundler takes `trillion3d` as the entry, the
installed workers (`pageWorker.js`, `pageIntegrationWorker.js`, `physicsWorker.js`) as
module-worker entries, and code splitting; copy each installed WebAssembly
module (`kernels.wasm`, `joltPhysics.wasm`, `joltPhysicsThreads.wasm`) beside every chunk that
names it, and serve that output with the compiled scene cache. `pnpm run proof:package -- --browser`
is the repository's executable esbuild configuration (`-- --bundle` without a browser).

Electron runs `prepare` in the main process and `createWorld` in the renderer
([hosts](../packages/README.md#hosts)); another language spawns the compiler and reads the
versioned cache ([COMPILER.md](COMPILER.md#using-it-from-any-other-host)).

## Compiling from Node

`prepare(input, output, scope, budget, options)`, `prepareMany(jobs, options)` and the
`trillion3d-compile` CLI relay to the native executable; arguments, events, batch mode,
cancellation, exit codes and how the executable is found:
[COMPILER.md](COMPILER.md#using-it-from-node). Not found, it fails with
`COMPILER_EXECUTABLE_MISSING`, or `COMPILER_PLATFORM_UNSUPPORTED` on a machine the compiler is not
built for. Every error carries its public code, its cause and its action.

## Scene hierarchy foundation

Below `world.scene`, the common facade publishes the DOM-free transform foundation
(`SCENE_MODEL_VERSION` 1): `createSceneRoot` makes a `SceneRoot`, a tree kept outside a world.
`root.createNode({ id, visible })` gives stable, root-unique ids; `add` and `reparent` keep the
local pose, `attach` the world pose (a shear is lost); `remove` and `clear` detach, `destroy`
invalidates a subtree for good. `clone` gives a fresh id unless one is given, `copy` keeps the
destination's; copying an ancestor into its descendant is rejected (`SCENE_COPY_OVERLAP`), as are
duplicate ids and nodes of two roots; a cycle changes nothing. Setters mark the transform dirty:
call `updateWorldMatrix()` before reading `worldMatrix`.

```javascript
import { createSceneRoot } from 'trillion3d'

const scene = createSceneRoot({ id: 'warehouse' })
const shelf = scene.createNode({ id: 'shelf' }).setPosition(2, 0, -4)
const crate = scene.createNode({ id: 'crate' }).setScale(0.5, 0.5, 0.5)
scene.add(shelf)
shelf.add(crate).updateWorldMatrix()
```

`TransformNode` (browser facade) views that node through `matrix`, `matrixWorld`,
`matrixAutoUpdate`, `matrixWorldNeedsUpdate` and `updateMatrixWorld(force)`; `Object3D` and the
engine's graph extend it. Every write through a node is heard as it is made; numbers written
straight into a kept `matrix.elements` are announced with `matrixWorldNeedsUpdate = true`, a light's
colour channels written straight with `needsUpdate = true`: a still scene reads nothing per frame.
An update or walk costs its subtree only; a dropped object frees its slot when collected. A node
the session poses under a moving parent is composed on the GPU: its `matrixWorld` is read composed
once per frame, and `updateMatrixWorld` has nothing of it to do.

The graph classes are `Object3D`, `Group`, `Mesh`, `Scene`, `Camera` and `Light` (its `kind`; a
`rectArea` for a rectangle, a `probe` with 27 coefficients in `sh`). A probe's `sh` is nine RGB
triples of the real orthonormal spherical harmonics of the radiance, in the band order constant,
`y`, `z`, `x`, `xy`, `yz`, `3z² − 1`, `xz`, `x² − y²`; the irradiance at a normal is each
coefficient times its band's cosine weight (π, 2π/3, π/4) times its harmonic. `emptyIrradiance()`
makes the 27 zeros, which `addUniformIrradiance(sh, rgb)` (the same light from every side),
`addHemisphereIrradiance(sh, sky, ground, up)` and `addIrradianceCoefficients(sh, coefficients,
scale)` add to. A light hears its colours and
target only while in a world. A world hands a `hemisphere` light the sky over a ground as the
environment's irradiance. A `Scene` built with no loader refuses `load`
(`UNSUPPORTED_SCENE_UPDATE`); its `onBeforeRender` and `onAfterRender` run around each draw. A
`Camera` publishes `projectionMatrix` (the engine's own: depth reversed onto [0, 1], 1 on the near
plane and 0 at infinity for a perspective camera, at the far plane for an orthographic one) and
`matrixWorldInverse`.

`clone(recursive)` returns the same class with name, pose, matrices, flags, `userData` and, unless
`recursive` is `false`, cloned children; `copy(source, recursive)` writes the same into an existing
node. A `Light` also keeps its light values and target, a `Camera` its optics, a `Mesh` its
primitive, sharing geometry and material. Cloning a `Scene` or `LoadedModel` throws
`UNSUPPORTED_SCENE_UPDATE`; `cloneObject` is the deep copy, sharing nothing.

Attributes are a `BufferAttribute` owning its numbers or an `InterleavedBufferAttribute` viewing an
`InterleavedBuffer` (`VertexAttribute` names either); a normalised integer reads and writes as its
value over its type's largest; `needsUpdate = true` bumps `version`, and `addUpdateRange` limits
the upload to the numbers written.

A `Geometry` carries `attributes`, `morphAttributes` (`morphTargetsRelative` when targets hold
displacements), `drawRange` (`setDrawRange(start, count)`: the corners of the index drawn, or of
the vertices in order; any write of it cuts the pages again), `name`, `userData`; its bounds span every vertex and morph shape, at
the value each stands for (a normalised integer scaled back, a two-number position at z = 0).
`toNonIndexed()` gives each corner its own vertex. A geometry no mesh wears gives back its pages
and GPU memory, with no call; replacing a mesh's geometry disposes the one it
replaces, host copies included.

## Page materials

Once `await world.awaitPages()` has opened the drawing session, a page reads and edits a loaded
model's materials through its `world`:

| Call                                         | Result                                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `world.materials()`                          | `SceneMaterial[]`, cache table order then the page's, as detached copies (`id`, `name`, `baseColor`, `opacity`, `metalness`, `roughness`, `emissive`, `side`, `alphaMode`, `alphaCutoff`, `tiling`, `null` without a map) |
| `world.material(id)`                         | one by listed ID; an unknown ID raises `UNKNOWN_MATERIAL`                                                                                                                                                                 |
| `world.importedMaterials()`                  | the source file's values, whatever the page changed; created materials excluded                                                                                                                                           |
| `world.setMaterial(id, patch)`               | every surface built from it, next frame; `true` if it was applied in place, `false` if one needs a new session                                                                                                            |
| `world.createMaterial(props?)`               | a page-owned material, at most 256 per session (`MATERIAL_CEILING` past it, nothing created)                                                                                                                              |
| `world.dropMaterial(id)`                     | releases an unused created material, its variants, map and accounted bytes                                                                                                                                                |
| `world.materialMapBytes()`                   | runtime map bytes held and pending, under the fixed 64 MiB ceiling                                                                                                                                                        |
| `world.assignMaterial('mesh/primitive', id)` | a created material on a compiled primitive, numbers from `metadata.primitives`; unknown: `UNKNOWN_SCENE_NODE`                                                                                                             |

A patch sets `baseColor` (linear, 0 to 1), `opacity`, `metalness`, `roughness`, `alphaCutoff` (0 to
1), linear `emissive` (nonnegative), `alphaMode` (`'opaque'`, `'mask'`, `'blend'`) or nonzero
`tiling`, which needs a map only that material uses (`MATERIAL_TEXTURE_SHARED`); an invalid one
raises `INVALID_MATERIAL` before any write. A change that cannot move drawables between opaque,
masked and blended in place raises `MATERIAL_CLASS_CHANGE` first.

`world.createMaterial({ name?, baseColor?, opacity?, metalness?, roughness?, emissive?, alphaMode?,
alphaCutoff?, map? })` returns its record; with an `ImageBitmap` `map`, a promise to await before
assignment, a failed upload publishing nothing. The bitmap is borrowed: decode it with
`premultiplyAlpha: 'none'` and `colorSpaceConversion: 'none'`, and close it once the material is
dropped or the session disposed. Each material owns its texture. Runtime maps have a fixed 64 MiB
decoded RGBA ceiling, checked before allocation (`TEXTURE_BUDGET`). `tiling` is set-only. Dropping
an assigned material raises `UNSUPPORTED_SCENE_UPDATE`: assign a replacement first. Dropped IDs are
never reused.

## Material graph

A material can compute its outputs from a graph: nodes wired into the outputs its domain reads, compiled to the shader that evaluates them. `material.graph(domain)` makes an empty one; each call on it adds a node and gives back the wire of its output, and `output(name, wire)` plugs a wire into an output.

```js
import { material, light, Texture } from 'trillion3d'

const g = material.graph('lightFunction') // 'surface' | 'lightFunction' | 'volume'
const clouds = g.textureSample(new Texture(cloudImage), { uv: g.panner({ speed: [0.02, 0] }) })
const tint = g.vectorParameter('tint', [1, 0.9, 0.7, 1]) // named, given values with g.set
g.output('emissive', g.multiply(g.channel(clouds, 'rgb'), g.channel(tint, 'rgb')))

lamp.lightFunction = material.lightFunction({ graph: g }) // the light shines through moving clouds
g.set('tint', [1, 0.5, 0.2]) // the next image
```

A material wears a graph of its own domain (`material.lightFunction({ graph })`, `material.volume({ graph })`, any other member for `'surface'`); another domain is refused (`INVALID_MATERIAL`). The graph is heard like a texture: a write to it, to a texture it reads, or to a parameter (`g.set(name, value)`) repaints what wears it. `material.clone()` clones the graph, and a saved world stores it with the material and reads it back, except a graph that holds a texture, refused as a material that holds one is (`SCENE_NOT_SAVABLE`).

**Outputs by domain.** An output is cast to its type (a scalar is repeated, a longer vector is cut, a shorter one is filled with zeros) and takes its default where nothing is wired.

| Output                   | Type   | Default       | `surface`                                                                                                                                                                                                                                                                                                         | `lightFunction` | `volume`            |
| ------------------------ | ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------- |
| `baseColor`              | float3 | 0, 0, 0       | read (a lit surface)                                                                                                                                                                                                                                                                                              |                 | the albedo          |
| `metallic`               | float  | 0             | read (a lit surface)                                                                                                                                                                                                                                                                                              |                 |                     |
| `specular`               | float  | 0.5           | read (a lit surface): a dielectric reflects 0.08 × it at normal incidence                                                                                                                                                                                                                                         |                 |                     |
| `roughness`              | float  | 0.5           | read (a lit surface)                                                                                                                                                                                                                                                                                              |                 |                     |
| `emissive`               | float3 | 0, 0, 0       | read; an unlit surface shows it as its colour                                                                                                                                                                                                                                                                     | the colour      | the light given off |
| `opacity`                | float  | 1             | read when `transparent`                                                                                                                                                                                                                                                                                           |                 |                     |
| `opacityMask`            | float  | 1             | read: wired, it makes the surface a masked one, cut where the output is below the clip value (`opacityMaskClipValue`, 0.3333)                                                                                                                                                                                     |                 |                     |
| `normal`                 | float3 | 0, 0, 1       | read (a lit surface, tangent space)                                                                                                                                                                                                                                                                               |                 |                     |
| `ambientOcclusion`       | float  | 1             | read (a lit surface)                                                                                                                                                                                                                                                                                              |                 |                     |
| `subsurfaceColor`        | float3 | 1, 1, 1       | read (a lit, two-sided surface: its thin transmission)                                                                                                                                                                                                                                                            |                 | the extinction      |
| `anisotropy`             | float  | 0             | read (a lit surface): the stretch of the highlight, from -1 to 1; a negative one stretches it along the bitangent                                                                                                                                                                                                 |                 |                     |
| `tangent`                | float3 | 1, 0, 0       | read with `anisotropy`: the direction of the stretch, in tangent space                                                                                                                                                                                                                                            |                 |                     |
| `clearCoat`              | float  | 1             | read (a lit surface): the strength of a clear coat over the base; off where unwired (the surface has no coat)                                                                                                                                                                                                     |                 |                     |
| `clearCoatRoughness`     | float  | 0.1           | read with `clearCoat`                                                                                                                                                                                                                                                                                             |                 |                     |
| `refraction`             | float  | 1             | read (a translucent surface that transmits): its index of refraction, 1 bending nothing, 0 saying none (the material's own applies)                                                                                                                                                                               |                 |                     |
| `worldPositionOffset`    | float3 | 0, 0, 0       | read: moves the vertices of the surface (world space), see "World position offset"                                                                                                                                                                                                                                |                 |                     |
| `shadingModel`           | float  | 1             | read where the material says `shadingModel: 'fromMaterialExpression'` (a lit opaque or masked surface): the shading model of the pixel, by the reference's numbers (0 unlit, 1 default lit, 2 subsurface, 4 clear coat, 6 two-sided foliage, 8 cloth), see "Shading model per pixel"; unwired, the material's own |                 |                     |
| `cloth`                  | float  | 0             | read with `subsurfaceColor` (a lit opaque or masked surface): the amount of the cloth model, from 0 to 1, the fuzz colour being `subsurfaceColor`; see "Shading model per pixel"                                                                                                                                  |                 |                     |
| `pixelDepthOffset`       | float  | 0             | read: the distance, in metres along the camera vector, the pixel is pushed away from the camera in the depth the visibility raster writes (an opaque or masked surface) or in the depth its responsiveness mark is tested at (a translucent one), see "Pixel depth offset"                                        |                 |                     |
| `displacement`           | float  | 0.5           | read (an opaque or masked surface): the normalized height the tessellation pushes the surface's points by, see "Displacement"                                                                                                                                                                                     |                 |                     |
| `scatteringCoefficients` | float3 | 0, 0, 0       | read (a lit surface that is water): the scattering of the water's volume, per centimetre; wiring any of the four water outputs makes the surface single-layer water, see "Single-layer water"                                                                                                                     |                 |                     |
| `absorptionCoefficients` | float3 | 0, 0, 0       | read (water): the absorption of the water's volume, per centimetre                                                                                                                                                                                                                                                |                 |                     |
| `phaseG`                 | float  | 0             | read (water): the anisotropy of the scattering, from -1 (back) to 1 (forward)                                                                                                                                                                                                                                     |                 |                     |
| `colorScaleBehindWater`  | float3 | 1, 1, 1       | read (water): a colour multiplied into what is seen through the water, faded out over the first 50 cm of depth; caustics, for one                                                                                                                                                                                 |                 |                     |
| `transmittanceColor`     | float3 | 0.5, 0.5, 0.5 | read (a lit translucent surface that is thin translucent): the colour the background is multiplied by for a view perpendicular to the surface, from 0 to 1; wiring it or `surfaceCoverage` makes the surface thin translucent, see "Thin translucent"                                                             |
| `surfaceCoverage`        | float  | 1             | read (thin translucent): the coverage of the whole surface, the thin part and the material over it, from 0 to 1                                                                                                                                                                                                   |

An output the domain does not read is refused when it is wired (`INVALID_MATERIAL`). A light function has no world position, camera, normal or depth: it is drawn once into an atlas slot for every light and view, so `worldPosition`, `cameraPosition`, `cameraVector`, `vertexNormal`, `pixelNormal` and `vertexColor` are refused there (`INVALID_MATERIAL`, naming the node), and `objectPosition` is zero. The volume domain has no normal. `pixelNormal` cannot feed `normal`.

A lobe is on where its output is wired (`anisotropy`, `clearCoat`); an unwired one is off, and the defaults above apply to the other output of its pair. A surface that wears a graph takes its lobes from the graph alone: the material's `anisotropy` and `clearcoat` are not read.

**Types.** A value is a float of one to four components (a texture object is a fifth kind, which only a sample reads). A scalar written as a constant fits any width. An operation between a scalar and a vector repeats the scalar; between two vectors of different widths it is an error ("arithmetic between float2 and float3 is undefined"). `min`, `max` and `clamp` make their other inputs the type of the first. Constants fold: the sum, product or sine of constants is a constant, a product by 0 or 1 and a quotient by 1 write no code, a `lerp` of equal values or at 0 or 1 is one of them, a quotient of constants is a constant. A value the pixels share — a constant, a parameter, anything computed from these alone — is known when the program is compiled, and some nodes treat it so: a divisor of that kind (`divide`, `fmod`) is held to at least 1e-5 in magnitude, its sign kept and a zero read as positive, so that `x / parameter` is `1e5 × x` where the parameter is 0 and a quotient of constants by 0 is a constant (a varying divisor is not held: a quotient by it is the hardware's); `normalize` of such a value leaves a zero vector at zero; `round` of it goes up at a half, where a varying value goes to the even whole number. `normalize` of a varying scalar is 1.

**Nodes.** Where an input is not wired, a node uses its own constant (its default is in brackets).

| Group       | Calls                                                                                                                                                                                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constants   | `constant(x)` to `constant(x, y, z, w)`; `channel(wire, 'rgb' \| 'r' \| 'a'…)` picks an output of a node (a sample's rgb, r, g, b, a, rgba)                                                                                                                                                                                                         |
| Parameters  | `scalarParameter(name, 0)`, `vectorParameter(name, [0, 0, 0, 1])`, `textureParameter(name, texture)`; `g.set(name, value)` gives them values                                                                                                                                                                                                        |
| Textures    | `textureSample(texture, { uv, texture, mip, mipMode: 'none' \| 'level' \| 'bias', constCoordinate: 0, name })`, `textureObject(texture)`                                                                                                                                                                                                            |
| Coordinates | `texCoord(index = 0, uTiling = 1, vTiling = 1)`, `time(period?, ignorePause = false)` (`period` 0 holds it still), `panner({ speed: [u, v], coordinate, time, fractionalPart })`, `rotator({ centerX: 0.5, centerY: 0.5, speed: 0.25, coordinate, time })`                                                                                          |
| World       | `worldPosition(cameraRelative)`, `cameraPosition()`, `objectPosition()`, `vertexNormal()`, `pixelNormal()`, `cameraVector()` (the unit vector from the point to the camera), `vertexColor()` (rgb, r, g, b, a; refused until a pass carries the vertex colour), where the domain has them                                                           |
| Arithmetic  | `add(a, b)` (0, 1), `subtract` (1, 1), `multiply` (0, 1), `divide` (1, 2), `power(base, exponent = 2)`, `abs`, `min` (0, 1), `max` (0, 1), `clamp(x, min = 0, max = 1, mode)`, `saturate`, `lerp(a, b, alpha)` (0, 1, 0.5), `oneMinus`, `frac`, `floor`, `ceil`, `round`, `sign`, `fmod(a, b)`, `sqrt`, `exp`, `exp2`, `log`, `log2(x)`, `log10(x)` |
| Waves       | `sine(x, period = 1)`, `cosine(x, period = 1)`, `tangent(x, period = 1)`: `x` is in turns of `period` when it is above 0, in radians otherwise; `arctangent2(y, x)`                                                                                                                                                                                 |
| Vectors     | `dot`, `cross` (float3), `normalize`, `length`, `appendVector(a, b)` (four components at most), `componentMask(x, 'rg')`                                                                                                                                                                                                                            |
| Choice      | `if(a, b, greater, equal, less, threshold = 0.00001)`: `greater` where `a >= b`, `less` below, `equal` within the threshold when wired                                                                                                                                                                                                              |
| Colour      | `fresnel({ exponent = 5, baseReflectFraction = 0.04, normal })`, `desaturation(x, fraction?, luminance?)`, `contrast(x, amount = 1, pivot = 0.5)`                                                                                                                                                                                                   |
| Noise       | `noise({ position, filterWidth = 0, noiseFunction = 'simplex', scale = 1, quality = 1, turbulence = true, levels = 6, outputMin = -1, outputMax = 1, levelScale = 2, tiling = false, repeatSize = 512, relativeToCamera = false })`                                                                                                                 |

A number passed where a wire goes is that node's own constant: `g.multiply(tex, 2)` and `g.lerp(a, b, 0.25)` need no constant node. A texture reads through the materials' colour atlas, with its own wrap, filters, repeat, offset and rotation; `mipMode` `'level'` reads the level in `mip` (0 is the full picture), `'bias'` adds `mip` to the level the footprint asks. A sample waits, like a map, until its texture has joined the atlas.

**A surface that wears a graph is the graph.** The opaque resolve and the transparent pass read the outputs of the graph in place of the material's colour, `metalness`, `roughness`, `emissive`, normal map, occlusion map, lobes and thin transmission, and of its other maps; an output that is not wired takes its default (the table above), never the material's value. What the material still decides is how the surface is drawn: `side`, `transparent`, `blending`, `alphaTest`, `depthWrite`, its family (`meshStandard`, `meshPhysical`, `meshBasic`…) and its lit or unlit model. The outputs are held to their range as a shader holds them: `baseColor`, `metallic`, `roughness`, `ambientOcclusion`, `specular` and `opacity` from 0 to 1, `emissive` not below 0 (see `allowNegativeEmissive`), the thin transmission `subsurfaceColor` from 0 to 1. `normal` is in tangent space and bends the vertex normal in the frame the normal maps use; a surface has no `normal` map of its own while it wears a graph. The material's record holds neutral factors for such a surface, so its `opacity`, `subsurfaceColor` and maps leak into nothing.

**An unlit surface draws through `emissive`.** A material of an unlit family (`meshBasic`…) reads the `emissive` output as its colour, its `opacity`, its mask and its `worldPositionOffset`: its other outputs are not read and take their defaults, whatever is wired to them.

```js
import { material, Texture } from 'trillion3d'

// A glass that ripples: translucent, its colour and opacity from a panned map, its roughness from the time.
const g = material.graph('surface')
const waves = g.textureSample(new Texture(waveImage), {
  uv: g.panner({ speed: [0.03, 0.01], coordinate: g.texCoord(0, 4, 4) }),
})
g.output(
  'baseColor',
  g.multiply(g.channel(waves, 'rgb'), g.vectorParameter('tint', [0.6, 0.8, 1, 1])),
)
g.output('opacity', g.multiply(g.channel(waves, 'a'), 0.7))
g.output('roughness', g.add(0.1, g.multiply(g.sine(g.time(), 4), 0.05)))
g.output('specular', g.constant(0.9)) // a brighter highlight than the default 0.5 gives
mesh.material = material.meshStandard({ transparent: true, graph: g })
g.set('tint', [1, 0.7, 0.5]) // the next image: only a value is written, nothing compiles again
```

- **`allowNegativeEmissive`.** A material option, `false` by default: the `emissive` output may take light away only where it is `true`, as in `material.meshStandard({ allowNegativeEmissive: true, graph })`. It is saved with the world and is part of what decides the surface's program.
- **Specular.** A dielectric reflects `0.08 × specular` at normal incidence, `0.04` at the default 0.5, the value of every surface that gives none; a metal reflects its colour. The opaque resolve leaves the specular of a pixel in its surface flags (a step of 1/254), the lights, the reflections' weight and the transparent pass read it; a clear coat keeps its own 0.04 (`'layered'`), or adds `0.04 × its weight` to the reflectance (`'single'`).
- **Anisotropy.** The graph's `anisotropy` `a`, from -1 to 1 (`tangent` the direction of the stretch, in tangent space, carried whole to the world and kept orthogonal to the final normal), makes the highlight `α(1 + a)` wide along the tangent and `α(1 − a)` across it, `α` the square of the roughness; where `a` is negative the long axis is the bitangent. A material's own `anisotropy` gives the same widths. Under a clear coat the base keeps its anisotropy, in the coat's context.
- **Refraction.** The `refraction` output of a translucent surface that transmits (`meshPhysical({ transmission: 1, transparent: true })`) is the index of refraction its fragments bend what lies behind by; 1, the default, bends nothing, and 0 says none: the material's own applies. A graph that wires it wins over the `ior` the material declares. Of the reference's three refraction modes only the index of refraction is read; the pixel-normal strength, the two-dimensional offset and the refraction depth bias are not offered.
- **Texture coordinates.** The first set is `texCoord(0)`. A set past the first (`texCoord(1)` to `texCoord(3)`) is read where the geometry carries it; on a translucent surface, the program that carries one set past the first (the lobed one) reads one: the lowest the graph names; the sets past it read the first. Sets 4 to 7 read the first set.
- **Footprints.** A texture read takes its footprint from the coordinate evaluated at the pixel beside and the pixel below, so a tiled or panned coordinate reads the level its own pixels ask. A read whose coordinate holds another read takes the other's footprint at the pixel itself: three reads a level. The tiles a texture needs are asked of the streamer as a map's are.
- **Time.** A graph that reads `time` keeps the image drawing, in the opaque resolve and in the transparent pass: a view that shows one is not held on its last image. The time is the page's clock in seconds, read once an image, the same for the surface, the translucent surface, the fog and the rasters.
- **Noise.** `noise` adds `levels` (1 to 10) noises of `position` — the world position, repeated every 65536 metres, where nothing is wired —, each `levelScale` times finer and `levelScale` times weaker than the one before, and brings the sum to `outputMin`..`outputMax`: with `turbulence` the levels add the absolute value of the noise, without it the sum of -1..1 noises is brought to 0..1. `filterWidth` fades the levels finer than it away (a level's weight is multiplied by `saturate(1 - width)`, the width growing with the frequency). The functions are `'simplex'` (gradient noise on the tetrahedra of a skewed lattice), `'gradient'` (a cubic lattice repeating every `repeatSize` cells, and every 128 whatever the size), `'fastGradient'` (repeating every 15 cells), `'gradientAlu'`, `'valueAlu'` (cubic lattices of hashed values, each repeating every `repeatSize` cells where `tiling` is true) and `'voronoi'` (the distance to the nearest of the points jittered in each cell, `quality` 1 to 4 searching 8, 16, 27 and 32 cells, repeating with `tiling`); each runs in the shader, from the lattice's coordinates alone. A position is read in the graph's units, metres: `noise({ scale: 0.01 })` is a noise whose features are 100 metres across.
- **Fresnel.** `fresnel` is `pow(1 - max(0, n · v), exponent) × (1 - base) + base`, `n` the pixel's normal (or the wire `normal`), `v` the unit vector to the camera (`cameraVector`); the power's base is held to at least 0.0001. `desaturation` takes a colour (or a scalar, repeated) towards `dot(colour, luminance)`, the luminance weights of the sRGB working space (0.2126, 0.7152, 0.0722) unless named: by `fraction`, or, with none wired, to the grey itself (a scalar).
- **Not read.** The outputs that move a pixel or change a shading model — a displacement, a pixel depth offset, a shading model, a front material, a surface thickness, the customized texture coordinates `0` to `7` and the packed material attributes — are not offered: they need the programmable raster this engine does not have yet. On a translucent surface the position of the object (`objectPosition`) reads zero and the pixel normal is the vertex normal.
- **A graph the pass refuses** (a node or output it cannot compile) is named once (`material-graph-refused`) and the surface is drawn from the material's parameters. A scene wears at most 256 programs of the opaque resolve at once, each over its geometry's attributes (a program no surface wears gives its place back): past them a surface is drawn from its parameters and the engine says so.
- **A pipeline the device refuses to compile** is named once for each refusal (`pipeline-refused`, with the pipelines it names): the pass that needs it is left out of the image, which stays as drawn without it, and the engine asks the device again every 240 frames.
- **A graph that joins a running world** (a material assigned, a node, an output or a texture written into a graph a material wears) makes its surfaces wear another program. The engine compiles it while the frame waits, showing the previous image, and does not open the session again; the cutouts and offsets the rasters evaluate join the modules that hold them the same way, and the engine says so once (`material-graph-rasters-late`). A value written with `g.set` writes the values alone: nothing compiles. When an offset joins, the temporal anti-aliasing starts its history again.

**Opacity mask (the cutout).** A graph that wires `opacityMask` makes a masked surface: a pixel is kept where `opacityMask` is not below the clip value, cut otherwise, in every pass that decides what a surface covers — the visibility rasters, the dicing of a displaced surface and the shadow maps (a leaf casts the shadow of its shape). The clip value is the material's `opacityMaskClipValue` (any number: the output is compared with it as it comes, 0 keeps every pixel whose output is not below 0, and the output of a graph is not held to a range), else its `alphaTest` where above 0 (a glTF material keeps its `alphaCutoff`), else 0.3333. The mask is the opaque class's: a translucent surface (`transparent: true`) reads `opacity`, never `opacityMask`.

**What a mask can read.** A cutout is decided where only a texture coordinate exists: `texCoord(0)` (or the one set a mask names; a mask that names two is refused), a texture read at it, the parameters, `time` and `realTime`, with the footprint of the render pixel. A mask that reads the world position, the camera or its vector, the normal or the vertex colour is refused: the engine names it once (`material-graph-refused`) and the surface is drawn whole. A mask that reads `time` animates in the images and in the shadows of the surfaces that move; the shadow of a static surface whose mask animates is not drawn again (it keeps the shape it was cached with).

```js
import { material, Texture } from 'trillion3d'

// A leaf that dissolves: the alpha of its map, eaten by a noise that drifts with the time.
const g = material.graph('surface')
const leaf = g.textureSample(new Texture(leafImage), { uv: g.texCoord(0) })
const eaten = g.textureSample(new Texture(noiseImage), {
  uv: g.panner({ speed: [0.05, 0], coordinate: g.texCoord(0, 3, 3) }),
})
g.output('baseColor', g.channel(leaf, 'rgb'))
g.output('opacityMask', g.multiply(g.channel(leaf, 'a'), g.add(g.channel(eaten, 'r'), 0.2)))
const wear = material.meshStandard({ graph: g, side: 'double', opacityMaskClipValue: 0.5 })
```

Two material options (saved with the world, written in place):

- **`opacityMaskClipValue`** (a number, absent by default): the value `opacityMask` is cut against. Absent: the material's `alphaTest` where above 0, else 0.3333. A material with a graph that wires no `opacityMask` ignores it.
- **`ditherOpacityMask`** (boolean, `false` by default): the cut is dithered. Each pixel adds `0.83 × noise − 0.5` to the mask (less the clip value) before the test, the noise the engine's blue noise read at the pixel and at the image's frame (the wall clock at sixty a second), so that the temporal anti-aliasing averages the edge into a soft translucency instead of a hard staircase. It applies in every raster that cuts pixels — the hardware raster, the compute raster and the shadow maps' raster, as the camera's — to any masked material, a graph's mask or a plain `alphaTest`; the dicing of a displaced surface cuts at its vertices, never at a pixel, and keeps the hard test. Until the engine has loaded its blue noise the cut is hard. A still image keeps the dither it was drawn with.
- **`normalCurvatureToRoughness`** (boolean, `false` by default): the material's roughness is raised to at least the one given by the change of its vertex normal across one pixel: `saturate(max(dN/dx·dN/dx, dN/dy·dN/dy)^0.333)`, so a curved surface far away reads rougher and its highlight does not flicker. It reads the interpolated vertex normal, never the normal map, and costs no extra texture read; a flat face is unchanged. A clear coat's roughness is raised the same way. The curve is set by the `world.shading` fields `normalCurvatureScale` (`1`, any number, held to [0, 2] where read), `normalCurvatureBias` (`0`, any number, held to [-1, 1] where read) and `normalCurvatureExponent` (`0.333`, any number, held to [0.05, 20] where read), each an option of `createWorld` too: `world.shading = { normalCurvatureExponent: 0.5 }`. Example: `new Material('meshStandard', { roughness: 0.2, normalCurvatureToRoughness: true })`.

**World position offset.** `g.output('worldPositionOffset', offset)` moves every vertex of the surface by `offset`, a float3 in the world's axes and metres, evaluated for each vertex in every pass that places it: the visibility buffer's two rasters, the shading of a pixel, the shadow maps (a swaying tree casts the shadow of the shape it has), the translucent pass and the temporal anti-aliasing (which reprojects a pixel by where its vertex was, so a moving surface leaves no trail). The offset sees what a vertex has: `worldPosition()` (the vertex before the offset), `objectPosition()`, `cameraPosition()`, `vertexNormal()`, `time()`, the parameters, **one** texture coordinate set (`texCoord(0)` is the geometry's first set; a vertex weight painted in the second coordinate of the UVs is a common use) and the textures it reads. It reads no `pixelNormal()` and no second texture set: a graph that wires such an offset is refused (named once, `material-graph-refused`) and its surface is drawn from the material's parameters, as any graph the engine does not compile. An offset that is not a finite number is not corrected: the vertex goes where the number says.

What moves: the triangles of a surface; the corners of the flat triangles of a surface displaced by a height map (`displacementMap`), which are moved before the patch is cut and diced, so the patch is diced and displaced on the moved triangle; the bricks of voxels the far levels of a mesh are drawn as (`voxelize`), each brick rigidly, by the offset at the centre of its box, its box and its voxels alike — a swaying crown does not stop where the cut switches to voxels. A sprite and a line are built on the screen and are not moved.

A texture read in the offset is read at the finest level (a vertex has no footprint) and asks no tile: a tile that is not resident reads its fallback level. A device lets its vertex stages read the colour atlas when it grants ten storage buffers a stage (`maxStorageBuffersPerShaderStage`, and `maxStorageBuffersInVertexStage` where it reports one); the engine asks the adapter for all it offers. On a device that grants fewer, a graph whose offset reads a texture is refused once (`material-graph-refused`) and its surface is not moved. The shadow maps' splitting of a displaced surface's patches judges them by the offsets that read no texture alone; the vertices drawn are moved by all.

```js
import { material, Mesh } from 'trillion3d'

// A leaf that bends in the wind: the farther up its UVs, the more it sways, along a direction that turns with the position.
const g = material.graph('surface')
g.output('baseColor', g.constant(0.2, 0.6, 0.2))
const height = g.componentMask(g.texCoord(0), 'g')
const phase = g.add(g.time(), g.componentMask(g.worldPosition(), 'r'))
const sway = g.multiply(g.multiply(g.sine(phase, 2), height), g.scalarParameter('amplitude', 0.15))
g.output('worldPositionOffset', g.multiply(sway, g.constant(1, 0, 0.4)))
const leaf = material.meshStandard({ graph: g, maxWorldPositionOffset: 0.2 })
const tree = new Mesh(geometry, leaf)
tree.worldPositionOffsetDisableDistance = 80 // past 80 m from the camera the leaves stop swaying
tree.shadowCacheInvalidation = 'rigid' // its shadows are not drawn again for the sway, only when it moves
tree.mobility = 'movable' // it arrives cached in the dynamic layer of the shadow maps, as one often moving does
scene.add(tree)
```

The object decides whether and how far its surfaces' offsets are evaluated (properties of the node, saved with the world, written in place; the defaults are the reference's):

- **`evaluateWorldPositionOffset`** (boolean, `true`): `false` leaves the object's vertices where the geometry puts them.
- **`worldPositionOffsetDisableDistance`** (metres, `0`): past this distance from the camera to the centre of the object's bounds the offset stops (0 never stops it). In the shadow maps of a directional light the distance is the clipmap level's: an object that names one is moved in the levels whose threshold distance — the distance past which the level no longer shows the motion, which doubles for each level coarser — is not past its own, and left at rest in the coarser ones; a local light's maps move it whatever the distance. A level's threshold counts the clipmap's whole resolution bias, the view's width and field of view included. Three settings of the shadow maps name the rule: `shadowClipmapWpoDisableDistance` (`true`; `false` moves the object in every level), `shadowClipmapWpoDisableDistanceLodBias` (3, from 0 to 30: the levels the rule is held back by) and `shadowClipmapWpoDisableDistanceInvalidateOnScaleChange` (`false`; `true` draws a level again when its threshold shifts with the view's resolution or field of view: steadier shadows of moving vegetation, at the price of redraw spikes).
- **`worldPositionOffsetWritesVelocity`** (boolean, `true`): whether the temporal anti-aliasing reprojects a pixel of the object by where its vertex was. `false` costs less where the offset does not change; with an offset that moves, it leaves a trail. The previous place is the offset of the image before — its clocks and camera — on the object where its previous world matrix put it.
- **`shadowCacheInvalidation`** (`'auto'`, `'always'`, `'rigid'` or `'static'`, `'auto'` by default): how the object's shadow pages are kept. `auto` draws them again while its offset is evaluated (not past its distance) or while it moves; `always` every image, for an animation the engine cannot know; `rigid` not for its offset, only when it moves; `static` not for its offset nor for its moves: a pose it takes later is not seen by its cached shadows, and the pages are drawn again when it joins or leaves the scene.
- **`mobility`** (`'static'`, `'stationary'` or `'movable'`, unset by default): whether the object is often moving. A `movable` object has its shadow pages kept in the dynamic layer of the shadow maps from the frame it joins the scene, so that its arrival draws no page of the static layer; the others are kept in the static layer until they first move. Either returns to the static layer after `shadowCacheFramesStaticThreshold` frames without a move. Unset, the object is `movable` when a skin or a morph deforms it and `static` otherwise; an object whose surfaces wear an offset or a displacement arrives in the dynamic layer whatever it says — unless the shadow option `shadowCacheWpoPrimitives` (false) is on —, and `shadowCacheInvalidation = 'static'` keeps it out of it. `undefined` gives back the default. It is saved with the world; a light keeps its own `mobility`, which is another setting.

Four more switches of the object say what it is to a view: **`firstPerson`** (boolean, `false`) marks an object drawn as a
first-person one — the hands and the weapon of a player, close to the camera: its pixels wear the first-person mark the shadows treat
apart (`shadowFirstPersonPixelRequestBias`, `shadowFirstPersonRequestMinLevelClamp`), and it casts no dynamic shadow of its own —,
**`firstPersonWorldSpaceRepresentation`** (boolean, `false`) marks the object that stands for it in the world, the body of the player:
the view that owns it, the main camera's, does not draw it (the reference forces `bOwnerNoSee` on it), and it casts into a second
clipmap of each sun (`shadowFirstPersonClipmap`, `docs/SHADOWS.md`) and into no regular shadow map; and **`castHiddenShadow`**
(boolean, `false`) lets an object that is hidden (`visible = false`, or under a hidden node) go on casting its shadow while no view
draws it (it is read for an object that casts and is no world-space representation); and **`holdout`** (boolean, `false`) cuts the object out of the picture: with `film.propagateAlpha` and `film.primitiveAlphaHoldout` on, its pixels are black with an alpha of 1 (nothing of the scene shows there, the image keeps the hole), and they leave no surface to the lighting, the reflections or the fog. With either film setting off, the flag is ignored. A node is a first-person object or its
world-space representation, never both: setting one while the other is on is refused (`RangeError`). All four are saved with the world.

```js
const arms = mesh(geometry, material)
arms.firstPerson = true
const body = mesh(geometry, material)
body.firstPersonWorldSpaceRepresentation = true // not drawn by the main camera, casts
const ghost = mesh(geometry, material)
ghost.castHiddenShadow = true
ghost.visible = false // casts, drawn by no view
const cutout = mesh(geometry, material)
cutout.holdout = true // a hole in the picture (film: propagateAlpha + primitiveAlphaHoldout)
```

**Who sees an object.** Two more switches, both `false` by default and saved with the world, hide an object by who looks. A camera
can name an **owner**, `camera.owner = node` (`null` by default): the node its view belongs to, the player's. An object that is the owner
or under it is _owned_ by that view. **`ownerNoSee`** hides the object from the views that own it and draws it for every other view;
**`onlyOwnerSee`** draws it for the views that own it alone and hides it from every other, those of cameras that name no owner
included. A camera with no owner owns nothing. The two switches add to a camera's `hidden` and `showOnly` lists, which still apply
(`hidden` wins). Until a camera names an owner, the stand-in of a first-person object (`firstPersonWorldSpaceRepresentation`) keeps
its own rule, hidden from the main camera; once one does, it is hidden from the views that own it, as an `ownerNoSee` object is.

```js
// The player's hands are seen by the player's camera alone, its body by every other camera.
const player = object.group()
player.add(hands, body)
hands.onlyOwnerSee = true
body.ownerNoSee = true
const eye = camera.perspective({ fov: 70 })
eye.owner = player // the player's own camera: it sees the hands, not the body
const minimap = camera.perspective()
minimap.owner = null // a camera that names no owner sees the body, not the hands
```

Two options of the material bound the offset: **`maxWorldPositionOffset`** (metres, `0`), the greatest distance the offset may move a vertex along an axis — the offset is held to it, and the bounds of the surface's clusters grow by it where the view and the shadows decide what is seen; `0` holds nothing and grows nothing, so an offset that moves a surface out of its bounds can be cut away at the edge of the view or of a shadow map before the surface reaches it: name the greatest offset when it is large —, and **`alwaysEvaluateWorldPositionOffset`** (boolean, `false`), which evaluates the offset whatever `evaluateWorldPositionOffset` and `worldPositionOffsetDisableDistance` say. The rays that light the scene's reflections and indirect light, and the distance fields, see the surface at rest.

**Shading model per pixel.** Where the material says `shadingModel: 'fromMaterialExpression'` (any other name, `defaultLit` by default, is the material's own and the graph's output is ignored), `g.output('shadingModel', model)` picks the shading model of each pixel of a lit surface the opaque or masked pass shades (a translucent surface shades by the material's). The value is the rounded number of the reference's own enumeration (`GRAPH_SHADING_MODELS`: `unlit` 0, `defaultLit` 1, `subsurface` 2, `preintegratedSkin` 3, `clearCoat` 4, `subsurfaceProfile` 5, `twoSidedFoliage` 6, `hair` 7, `cloth` 8, `eye` 9, `singleLayerWater` 10, `thinTranslucent` 11). The lighting has the physical model, the unlit one, the thin subsurface, the clear coat, the cloth, the preintegrated skin, the hair and the eye: a pixel of `unlit` shows its emission alone, as an unlit material does; a pixel of `twoSidedFoliage` reads `subsurfaceColor` as its thin transmission (a two-sided surface); one of `subsurface` is lit as `defaultLit` and, beside it, gets from every light a term of its own on any side: an in-scattering lobe against the eye, a wrapped back scattering weighed by the `opacity` output (read once a `shadingModel` is wired) and the material's occlusion, times the `subsurfaceColor` output (or its transmitted colour, hue-shifted, where the light is shadowed), which also adds to its indirect diffuse colour; one of `clearCoat` has the coat `clearCoat` and `clearCoatRoughness` give; one of `cloth` has the cloth lobe, its fuzz colour the `subsurfaceColor` output and its amount the `cloth` output (the cloth takes the place of the coat and the anisotropy); one of `preintegratedSkin` is lit as `defaultLit` and, beside it, lets light through its thickness: the light's cosine mapped to [0, 1] and one minus the `opacity` output (read for an opaque surface once a `shadingModel` is wired) address a table the reference ships (the `PreintegratedSkinBRDF` image, read from a file beside the module), times the `subsurfaceColor` output, which also adds to its indirect diffuse colour; one of `hair` has neither diffuse nor specular lobe but the hair's own scattering (reflection, transmission, internal reflection and a multiple scattering approximation): the `normal` output is the fibre's direction (toward its root), `roughness` and `specular` shape the lobes and `metallic` is the scatter amount; a hair reflects nothing and its indirect diffuse colour is its response to the environment; one of `eye` has the specular lobe of a dielectric and, in place of the diffuse lobe, a term that lights the sclera by the light's cosine and the iris by the cosine of its normal with a caustic, mixed by the iris mask: the mask and the distance of the iris are the `clearCoat` and `clearCoatRoughness` outputs, the iris direction the `tangent` output as a direction in the world's axes (where it is not wired the iris looks along `(0, 0, -1)`, the reference's own decoded default), and the metalness is not read. With `world.shading = { irisNormal: true }` (default `false`, the reference's `r.IrisNormal`) the iris has a normal of its own: the `clearCoatBottomNormal` output (a float3 in tangent space like `normal`, the iris plane normal — the `tangent` output, or the surface's normal where it is not wired — where it is not wired) is the iris normal, the caustic normal is the plane normal bent toward the opposite of the normal by the iris mask times the `clearCoatRoughness` output, and the eye's specular is held at 0.25. A pixel of `subsurfaceProfile` is lit as `defaultLit` with the Burley diffuse and two specular lobes, then scattered (see "The scattering of the light under a surface"); its `opacity` output (at 0.1 or under, the pixel is plain) is the share of the profile's radius it scatters over. A pixel of any other model is lit as `defaultLit`. A graph that wires no `shadingModel` keeps the behaviour of its wired outputs (a coat where `clearCoat` is wired, a cloth where `cloth` is wired and no model is, a thin transmission where only `subsurfaceColor` is).

```js
// A skin: opaque, lit by the preintegrated skin model, a little translucent (opacity 0.6) and tinted red where light goes through.
const g = material.graph('surface')
g.output('baseColor', g.constant(0.8, 0.6, 0.5))
g.output('roughness', g.constant(0.45))
material.shadingModel = 'fromMaterialExpression' // the graph's output decides
g.output('shadingModel', g.constant(3)) // preintegratedSkin; hair is 7, eye is 9
g.output('subsurfaceColor', g.constant(0.9, 0.3, 0.2))
g.output('opacity', g.constant(0.6))
```

```js
import { material } from 'trillion3d'

// A fabric with a worn patch: the cloth model where the mask is low, the plain lit one elsewhere.
const g = material.graph('surface')
const wear = g.channel(g.textureSample(wearMap), 'r') // wearMap: a Texture
g.output('baseColor', g.constant(0.4, 0.1, 0.1))
g.output(
  'shadingModel',
  g.if({ a: wear, constB: 0.5, aGreaterThanB: g.constant(1), aLessThanB: g.constant(8) }),
)
g.output('subsurfaceColor', g.constant(0.9, 0.6, 0.6)) // the fuzz colour of the cloth pixels
g.output('cloth', g.constant(0.8))
```

**Pixel depth offset.** `g.output('pixelDepthOffset', offset)` pushes each pixel of the surface away from the camera, by `offset` in metres along the camera vector, in the depth the visibility raster writes: the offset times the cosine of the pixel's ray with the view axis is added to the view depth, and a pixel is never brought nearer (a negative offset leaves it). It is how a decal-like layer sinks into a wall, or a plane of foliage is given thickness. It is evaluated by the software raster's pixels and the hardware raster's fragments of the rows that wire it, in the context a cutout has — its first texture coordinate set, its footprint and the clocks; a graph that reads a world position, the camera, a normal, a vertex colour or two texture sets there, or names another set than the `opacityMask`'s or the `worldPositionOffset`'s, is refused (named once, `material-graph-refused`) and the surface is written at the depth of its triangles. The shadow maps and the tessellated surfaces write the depth of their triangles whatever the output says, as the reference does. A translucent surface is drawn at the depth of its triangles whatever the output says; the output moves it only in the mark the layer leaves in the temporal pass's responsiveness (see "Thin translucent").

```js
const g = material.graph('surface')
g.output('baseColor', g.constant(0.5, 0.5, 0.5))
// A bump of 5 cm at the middle of each tile of the texture coordinate, seen as depth.
g.output(
  'pixelDepthOffset',
  g.multiply(g.channel(g.textureSample(heightMap), 'r'), g.constant(0.05)),
)
```

**Thin translucent.** A lit translucent surface whose graph wires `transmittanceColor` or `surfaceCoverage` is a thin translucent surface, the reference's thin translucent shading model (number 11 of `GRAPH_SHADING_MODELS`): an infinitely thin sheet that absorbs the background behind it, under a lit layer. The `opacity` output is the coverage of the lit layer (base colour and emission) over the sheet, `surfaceCoverage` the coverage of the whole, and `transmittanceColor` the colour the background keeps for a view perpendicular to the surface; the colour is taken to the power one over the cosine of the view with the normal, which makes the sheet thicker at a slant. The light entering and leaving the sheet is reduced by Fresnel (on the surface's specular colour, which follows `baseColor`, `metallic` and `specular`), and the specular of the lights and of the reflections is added over it. Both outputs are read in [0, 1]. Where the device is granted `dual-source-blending` the layer adds its light and multiplies the background by its transmittance in one pass; without it, the layer is blended by the grey coverage of that multiplier (its premultiplied colour, one minus the average of the multiplier as alpha). Like the reference's, the surface is lit per pixel, has the physical lighting only (a pixel naming model 11 in an opaque surface is lit as `defaultLit`), and marks the temporal pass's responsiveness as if its opacity were one. A glTF material with `KHR_materials_transmission` is such a surface, as the reference imports it: the transmittance colour is the base colour times the transmission, the lit layer covers by the largest of one minus the transmission, the metalness and the roughness, and the coverage is one; a material whose alpha mode is `mask` is clear (covers nothing, transmits all, has no specular) where its base map's alpha reaches 0.333 and glass elsewhere (it is not cut by its cutoff).

```js
import { material } from 'trillion3d'

// A tinted pane: the background keeps 20% of its red, 50% of its green and 90% of its blue seen straight on,
// the pane itself, a faint white, covers a tenth.
const g = material.graph('surface')
g.output('baseColor', g.constant(1, 1, 1))
g.output('roughness', g.constant(0.05))
g.output('opacity', g.constant(0.1))
g.output('transmittanceColor', g.constant(0.2, 0.5, 0.9))
g.output('surfaceCoverage', g.constant(1))
const pane = material.meshPhysical({ graph: g, transparent: true })
```

A graph that also wires `pixelDepthOffset` on a translucent surface moves the depth its responsiveness mark is tested at: the temporal pass's responsiveness is written by a pass of its own, on every device, which draws the translucent layers again into the responsive target, tested against the opaque depth at the depth the offset moves each pixel to, so a layer pushed behind the opaque surface leaves no mark. The colour passes write no mark.

**Displacement.** `g.output('displacement', height)` gives the normalized height, from 0 to 1, the tessellation pushes the points of the surface by along their normals, where a displaced glTF material reads its height map: a point moves by `(height - displacementCenter) * displacementMagnitude` metres, faded with distance. The material names the numbers, as the reference's material does: **`displacementMagnitude`** (metres, `4`), **`displacementCenter`** (`0.5`, the height that stays on the surface), and **`displacementFadeStart`** and **`displacementFadeEnd`** (the on-screen size in pixels of the largest displacement at which it starts to fade and is gone, the first the larger; both left out, it never fades). The output is read at the context of a cutout, one texture coordinate set (the texture coordinate density of the surface being measured for the glTF materials of a prepared scene, one unit of the set is a metre here), by the dicing of the image and of the shadow maps alike, so the shadow is that of the displaced surface. It follows the project's `tessellation` settings. A graph that reads more than that is refused as the pixel depth offset is, and the surface is drawn flat. The reference's `TessellationMultiplier` output is deprecated there and read by no shader, and is not an output here.

```js
const rock = material.graph('surface')
rock.output('baseColor', rock.constant(0.35, 0.33, 0.3))
rock.output('displacement', rock.channel(rock.textureSample(rockHeight), 'r'))
const stone = material.meshStandard({
  graph: rock,
  displacementMagnitude: 0.3,
  displacementCenter: 0.5,
})
```

**A graph in the volume domain.** An object of the fog's volume (a mesh that wears `material.volume({ graph })`, or `addFogVolume({ id, graph })`) takes its albedo from `baseColor` (from 0 to 1), its extinction from the red channel of `subsurfaceColor` (from 0 to 65 000 per metre) and its emissive light from `emissive`, evaluated at the centre of each cell it covers, in place of its `albedo`, `extinction` and `emissive`. Its context is the world position of the cell, the camera, the object's position and the time; there is no texture coordinate and no normal. The volume domain has no `ambientOcclusion` output: wiring it is refused. An unwired `subsurfaceColor` is 1: wire it, or the object adds one per metre.

```js
import { material, Texture } from 'trillion3d'

// Smoke that thins with height and drifts: a density from a noise map read at the world position.
const g = material.graph('volume')
const noise = g.textureSample(new Texture(noiseImage), {
  uv: g.panner({ speed: [0.02, 0], coordinate: g.componentMask(g.worldPosition(), 'rg') }),
})
const density = g.multiply(g.channel(noise, 'r'), g.scalarParameter('density', 0.8))
g.output('baseColor', g.constant(0.7, 0.7, 0.75))
g.output('subsurfaceColor', g.appendVector(density, g.constant(0, 0)))
g.output('emissive', g.constant(0, 0, 0))
scene.add(new Mesh(box, material.volume({ graph: g })))
```

A texture a volume graph reads is taken into the colour atlas and asked at its full detail: keep them small (a noise of 128 to 512 texels). A graph that does not compile adds what its material gives.

**A light function material on a mesh.** `material.lightFunction()` draws into the light function atlas alone. A mesh that wears one is drawn with the default material (white, unlit): it raises no error.

A graph that does not compile (a missing required input, a type error, a node the domain has no value for) raises `INVALID_MATERIAL` naming the node. A light function whose graph is refused is drawn from its parameters, as one with no graph is, and the engine names the refusal once (`light-function-graph-refused`). A graph that reads `time` is drawn again at each image, in every domain (a surface, the transparent pass, a volume of the fog, a light function). The `time` node, and the panner and the rotator when no time is wired, read the world's time: the clock the world's clips and controllers run on, the one the automatic exposure adapts on, a pause of the loop counted as one bounded interval, so that a paused world holds every graph still. With `ignorePause` the node reads the wall clock instead, which runs on through a pause: for an effect that must keep moving. The clock is read once for each image, so the surface, the transparent pass, the fog and a light function of one image read the same seconds. An engine with no world (a bench) reads the wall clock for both.

```js
const g = material.graph('surface')
g.output('emissive', g.sine(g.time(), 2)) // the world's time: holds while the world is paused
g.output('baseColor', g.sine(g.time(undefined, true), 0.25)) // ignorePause: the wall clock, runs through a pause
g.output('opacity', g.sine(g.time(4), 1)) // a period of 4 s on the world's time
```

`power(base, exponent = 2)` raises each component of `base` to the exponent and gives zero for a base of at most 2.98e-8 (2^-25): a negative base, or one too small to take a logarithm of in single precision, gives 0, never a NaN (a large result still overflows, as a single-precision power does). The exponent is read as the base is: a scalar is repeated for every component, a vector of the base's width works on each component of the base (a float3 base by a float3 exponent takes each channel to its own power), and over a scalar base a vector exponent gives its first component. A vector exponent of another width than a vector base is refused with `INVALID_MATERIAL`: "arithmetic between float3 and float2 is undefined". An exponent of 1, an exponent of 0 and a base of 0 are written as no code.

```js
const albedo = g.channel(g.vectorParameter('albedo', [0.8, 0.5, 0.2, 1]), 'rgb')
g.output('baseColor', g.power(albedo, 2.2)) // one exponent for the three channels
g.output('emissive', g.power(albedo, g.constant(2.2, 1, 0.5))) // red, green and blue each by their own
g.power(albedo, g.constant(2, 3)) // refused: float3 against float2
```

## Lights

Only a light the host declared lights an opaque surface: no fixed ambient, constant sky or authored
scene lighting; a windowless corridor stays black at noon. Emission is always added.
`world.exposure` is the camera exposure on linear radiance before tone mapping: `'auto'` (the
default, also `true`) measures each image on the GPU and brings its mean brightness to middle grey,
so a view lit by the sun and one in shade land on the same average whatever the lamps' power; a
number above zero is the manual multiplier, used as it is (`false` is 1). A view lit by no declared
lamp shows its albedo as it is, with no exposure and no curve. `world.toneMapping` is `'filmic'` by
default ([ENGINE.md](ENGINE.md#exposure-and-the-display-curve)). `meshNormal` and
`meshDepth` surfaces are output as stored. A map a family never reads (a `meshToon` `gradientMap`,
a `meshMatcap` `map`, a `meshMatcap` or `meshNormal` `normalMap`) is refused by name;
`meshMatcap`, `meshNormal` and `meshDepth` ignore an `aoMap`. Transparent surfaces follow another
lighting rule: [ENGINE.md](ENGINE.md#transparent-surfaces).

`scene.background` is the colour behind every object (`null` by default); set or written through
its methods (`set`, `setRGB`, `setHex`, `setHSL`), it shows next frame; a direct `.r`, `.g` or `.b`
write needs it set again. A picture background is refused (`UNSUPPORTED_SCENE_UPDATE`).

### Sky module

The sky is one module: the air, the sun, the sky light, the height fog and the clouds of a new
world's level, each a part. It is off by default and then costs nothing: no part is resolved, no
light is held, nothing is allocated and no pass is drawn. One word switches it on, `scene.sky` for a
scene (it is saved with it) or `world.modules` for a page; both take `true` (every part at its
default), `false`, or an object naming the parts, each `true`, `false` or its settings — a part the
object does not name stays on, at its default (`mergeModuleParts`): an object switches off only the
parts it sets to `false`:

```js
world.scene.sky = true // the whole level: air, sun, sky light, height fog, clouds
world.scene.sky = { clouds: false } // all but the clouds
world.scene.sky = { sun: { intensity: 8, rotation: [-30, 90, 0] }, heightFog: true, clouds: false }
world.scene.sky = { heightFog: { baseDensity: 0.004, falloff: 0.03, volumetric: true } }
world.scene.sky = null // no word: the page's, else off

world.modules.set('sky', false) // the page switches it off, over the scene's word
world.modules.set('sky', { sun: { shaftBloom: true } }) // and sets a field, over the scene's
world.modules.clear('sky') // the scene's word is back
world.modules.state('sky') // { enabled, by: 'scene', parts: { sun: { … }, clouds: false, … } }
```

Per field the strongest word wins: the editor's, then the page's, then a quality preset's (none switches the sky on),
then the scene's, then the default; a part a stronger word switched off stays off. A part or a field the
module does not have, or a value out of range, is refused (`INVALID_MODULE_OPTION`,
`INVALID_SCENE_ENVIRONMENT`) and nothing changes. The stats overlay is the second module
(`world.modules.set('stats', true)`, its panel in the canvas's parent; its tabs and the panel are
its parts).

| Part         | What it is                                                                                                  | Defaults, the level's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atmosphere` | The planet's air: the sky, the haze, the sun's light tinted by it ([Atmosphere part](#atmosphere-part)).    | The component's: Earth-like.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `sun`        | One directional light, the air's first light, with its shadows, light shafts and cloud shadow map.          | `intensity` 6 lux, `useTemperature` on at `temperatureKelvin` 6500, `angle` 0.7357° (the disk's diameter), `rotation` `[-16.2856, 43.7319, 112.3607]` (pitch, yaw, roll in degrees; the yaw turns about +y, a negative pitch shines down), `shadowDistance` 200 m, `castShadow`, `shadowsAir` and `shadowsClouds` on, `shaftOcclusion` on. These are the values of the sun the level's template places, not the directional light's own defaults (10 lux, a disk of 0.5357°, shadows to 400 m, no temperature, no shadow on the air or the clouds); a field the template leaves alone has the light's default. A directional light you add yourself (`light.directional(...)`) has the light's own defaults, so its disk is 0.5357° wide, the sun part's 0.7357°. |
| `skyLight`   | The sky's light on the scene, captured from the air and the clouds.                                         | `realTimeCapture` on, `mobility: 'movable'`, `lowerHemisphereIsSolidColor` off; the other fields the component's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `heightFog`  | Fog thinning out with height ([Height fog part](#height-fog-part)); its volume is its `volumetric` setting. | `baseDensity` 0.00436 per metre (0.0436 in the reference's centimetre numbers) at `baseHeight` −68.5 m; the other fields as below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `clouds`     | One layer of clouds, ray marched from the eye ([Clouds part](#clouds-part)).                                | The layer's and the material's defaults. The four sample scales are 1 (`viewSamplesScale`, `reflectionSamplesScale`, `shadowSamplesScale`, `reflectionShadowSamplesScale`): at a scale of 1 a view ray takes 96 samples and a shadow ray 10, held to the sky quality's most (`cloudViewSamplesMax` 768, `cloudReflectionSamplesMax` 80, `cloudShadowSamplesMax` 80, `cloudReflectionShadowSamplesMax` 24).                                                                                                                                                                                                                                                                                                                                                        |

The sun's own fields are a light's (`intensity`, `color`, `useTemperature`, `temperatureKelvin`,
`angle`, `rotation`, `shadowDistance`, `castShadow`, `distanceFieldShadows` (off, as the level's sun has
it, the light's own is on) at `distanceFieldShadowDistance` 300 m (the light's own is 512), `shadowsAir`, `shadowsFog`, `fogScattering`,
`atmosphereSunIndex`, `forwardShadingPriority`, `transmittancePerPixel`, `sunDiskTint`), its light shafts' (`shaftOcclusion`,
`shaftOcclusionDarkness`, `shaftOcclusionDepthRange`, `shaftOverrideDirection`, `shaftBloom`,
`shaftBloomScale`, `shaftBloomThreshold`, `shaftBloomMaxBrightness`, `shaftBloomTint`) and its cloud
shadow map's (`shadowsClouds`: the cloud march reads the sun's opaque shadow map, only for the air's
first light; `castCloudShadows`, `cloudShadowStrength`, `cloudShadowOnAtmosphereStrength`,
`cloudShadowOnSurfaceStrength`, `cloudShadowDepthBiasKm`, `cloudShadowExtentKm`,
`cloudShadowResolutionScale`, `cloudShadowRaySamplesScale`, `cloudScatteredLuminanceScale`). The
module's lights hang from no scene and are never saved: a directional light of the scene competes
with the sun by the air's rule (the brightest of each index is held). There is one sky light, the
part's: where a scene is made to hold more, the last shown lights it, the others give nothing.

**Cloud ambient occlusion.** Under thick clouds the sky's multiple scattering (the light the air scatters more than once, which lights the sky and the haze from every side) fades out. The sky light part asks for it with five fields: `cloudAmbientOcclusion` (default `false`: nothing is built), `cloudAmbientOcclusionStrength` (default 1, at least 0: how much light the clouds block), `cloudAmbientOcclusionExtentKm` (default 150, at least 1: the radius round the camera the map covers), `cloudAmbientOcclusionMapResolutionScale` (default 1, at least 0.25: the factor on a map of 512 texels a side) and `cloudAmbientOcclusionApertureScale` (default 0.05, from 0 to 1: the cone round the vertical over which the occlusion is integrated, 0 one direction and a sharp occlusion, 1 the whole hemisphere and a blurry one). A map is built from above along the planet's vertical, round the point under the camera, and the air reads it wherever it marches the sky: the sky, the haze over the distance, the haze marched on the opaque surfaces and on the clouds, and the sky light's own capture; it dims the multiple scattering of the air's first light there (the second light's is not dimmed). It does not dim the sky light's own diffuse and specular light on the surfaces: the capture is of the sky as the air makes it, the occlusion is in the air.

The sky quality settings that shape the map are `cloudSkyAO` (default on: the switch of the pass), `cloudSkyAOResolutionMax` (2048: the largest side), `cloudSkyAOTraceSamples` (10: the samples a ray of the map takes through the layer), `cloudSkyAOFiltering` (on: the map is dilated and smoothed, integrated over the hemisphere above each texel) and `cloudSkyAOSnapKm` (20: the length, in kilometres, its position is snapped to, so that it does not flicker; 0 or less is read as 0.1 m, the map then following every step of the camera). No quality level writes any of them. The map is made only while a clouds part is followed and the sky light asks; a scene with no clouds, or whose sky light leaves the flag off, pays nothing.

```js
world.scene.sky = {
  atmosphere: true,
  sun: { castCloudShadows: true },
  skyLight: { cloudAmbientOcclusion: true, cloudAmbientOcclusionStrength: 0.8 },
  clouds: true,
}
world.skyQuality = { cloudSkyAOResolutionMax: 1024, cloudSkyAOFiltering: false } // a smaller, unfiltered map
world.skyQuality = { cloudSkyAO: false } // the pass off, whatever the sky light asks
world.skyQuality = { cloudSkyAOSnapKm: 5 } // the map's place snapped to 5 km
```

The sun's light shafts are the light's own: `shaftOcclusion` is on for the sun and off for any other
light, and the same nine fields are a light's below. For the sun they are written the same way:

```js
world.modules.set('sky', {
  sun: {
    shaftOcclusionDarkness: 0.2, // the occluded fog keeps a fifth of its inscattering
    shaftOcclusionDepthRange: 2000, // whatever is nearer than 2 km occludes
    shaftBloom: true,
    shaftBloomTint: [1, 0.9, 0.7], // a warm bloom
  },
})
```

**The presets.** `world.quality.preset` is one of `smooth`, `balanced`, `fine`, `max` and `cinematic`, or
`auto`, and a group is set to a level of the same names (`world.quality.set(group, level)`). `auto` is
the default: the hardware benchmark picks each group's level for the machine, and a preset or a group the
page names wins. `max`, the top level, writes nothing: the settings' defaults are the reference's fourth level. `cinematic` is the fifth,
above it: each group writes the reference's fifth-row values for the settings the engine has. A value the
page sets holds over any preset.

**The hardware benchmark.** `world.quality.benchmark(options)`
runs the benchmark, keeps its result in the origin's local storage (in the page's memory where it grants none) for this GPU
adapter, and draws it: the preset becomes `auto`. A world under `auto` (the default, or `quality: { preset: 'auto' }`, or set
to it later) draws the result kept for its adapter when there is one; where none is kept it runs the benchmark once
when the world opens, before its first image (never inside a frame), keeps the result for the adapter and
draws every image at it. A page that names a preset runs nothing. A
result kept for another adapter, or by an older engine, is not read. The run first waits for the world's
device to finish its work; the processor tests run in a worker (where the page refuses it they are left out
and `cpuIndex` is `null`, which no level reads), the graphics tests on a WebGPU device of their own; a frame
the world draws meanwhile shares the GPU with them, so a page asks it while the view is still. Disposing the
world stops a run. It measures two processor tests (segments against a triangle, a fractal) and seven
graphics tests (arithmetic, texture reads, dependent reads, fill, bandwidth, two vertex tests) timed by the
GPU timestamps, each against the time of the machine whose index is 100, into a processor index and a
graphics index. A browser that rounds its timestamps (to 100 µs without a developer switch) is found by the
step of its stamps, and the graphics work is multiplied by that step in microseconds (at most 1000), so a
step weighs on each pass as the reference's microsecond does. A group reads the graphics index against
three thresholds; the groups marked `min` read the lower of the processor and graphics indices
(a run with no processor index reads the graphics one):

| Group           | Index    | Thresholds of levels 1, 2 and 3 |
| --------------- | -------- | ------------------------------- |
| `viewDistance`  | min      | 18, 42, 105                     |
| `shadows`       | min      | 18, 42, 105                     |
| `effects`       | min      | 18, 42, 105                     |
| `edgeSmoothing` | graphics | 18, 42, 115                     |
| `indirectLight` | graphics | 18, 42, 115                     |
| `imageEffects`  | graphics | 18, 42, 115                     |
| `textures`      | graphics | 18, 42, 115                     |

Levels 0 to 3 are `smooth` to `max`: the benchmark never chooses `cinematic`. The benchmark gives levels only: the resolution stays the page's
`renderScale` or `quality.resolution`, else the display-based default. A device
without GPU timestamps, or a test left unmeasured, gives no graphics index: every group stays at `max`. A
preset or a group the page names after wins over the benchmark's levels.

`world.quality.hardware` reads the result (`null` before one): `cpuIndex`, `gpuIndex`, each test's own
index (`cpuSteps`, `gpuSteps`), `workScale`, `gpuWorkScale` (the work the graphics tests ran at),
`gpuMultiplier`, and what they give, `groups`. The `options` of `benchmark` are `workScale`,
a whole number from 1 to 1000 (10: ten runs of each processor test, the graphics passes at ten times their
base work, a few seconds of the device's work), `cpuMultiplier` and `gpuMultiplier` (1: factors of the two
indices).

```js
const world = createWorld('viewer') // auto: the result kept, else one run before the first image
const found = await world.quality.benchmark() // measured now, kept for this adapter, drawn
console.log(found.groups) // { viewDistance: 'fine', edgeSmoothing: 'max', … }
world.quality.preset = 'max' // the page's preset wins
```

- `viewDistance`: `cutViewDistanceScale` 10.
- `edgeSmoothing`: `antialiasing: 'max'`.
- `shadows`: `shadowDistanceScale` 1, `shadowNearLevels` 10, `shadowOverlapScale` 1, `shadowFarField` on,
  `shadowMaxResolution` 4096, `shadowResolutionLodBiasLocalMoving` 0,
  `shadowRayCountDirectional` and `shadowRayCountLocal` 16 (the most a lane holds),
  `shadowSamplesPerRayDirectional` and `shadowSamplesPerRayLocal` 8, `shadowMaxPhysicalPages` 8192 (a pool
  of 8192 pages needs a device whose binding holds 512 MiB; a device that holds less draws the largest pool that fits), `volumetricFogQuality` `'ultra'`.
- `imageEffects`: `motionBlurQuality` `'veryHigh'` with the full-size gather, `bloomQuality` `'highest'` and
  `bloomScreenPercentage` 100, `gaussianFastBlurThreshold` 100, the depth of field's gather at the full size
  with 5 rings and the diaphragm's shape, `depthOfFieldScatterMaxRatio` 0.25, `depthOfFieldRecombine`
  `'high'` with `depthOfFieldRecombineBokeh`, `ambientOcclusionHorizonAngles` 4, `lutSize` 64, `lutShaper`
  `'pq'`, `lightShafts` on.
- `indirectLight`: `screenProbes` `'cinematic'`, `reflectionQuality` `'cinematic'`, `skyLightIntensityScale` 1.
- `effects`: the atmosphere's eleven settings, the sky and the haze on the surfaces marched (the table of
  the air's settings below).
- `textures`: nothing, as at every level: the group has no wired setting.

The quality presets and the sky's quality settings reach the module through the effects and shadows
groups, as they reach the rest of the image:

```js
world.quality.preset = 'fine' // the effects' and shadows' level 2: fewer samples, smaller tables
world.skyQuality = { cloudShadowMap: false, lightShafts: false } // switch two passes off
world.skyQuality = { cloudShadowMap: null } // given back to the preset
```

The settings are read again at each image: a change reaches the sky light's capture, the clouds and their shadow maps in the image that follows, and rebuilds only what it needs (a program, a target's size). `cloudsOn: false` takes the clouds out of the view, of the sky light's capture and of their shadow maps; `cloudShadowMap: false` stops the shadow map passes; a preset writes the settings its level names and leaves the others as the page wrote them. The sky settings the levels write, besides the atmosphere's eleven (`SKY_PRESET_LEVELS.effects`):

| Preset      | `lightShafts`    | `skyLightIntensityScale` |
| ----------- | ---------------- | ------------------------ |
| `smooth`    | off              | 0.8                      |
| `balanced`  | off              | 1                        |
| `fine`      | on               | 1                        |
| `max`       | the default (on) | 1                        |
| `cinematic` | on               | 1                        |

No quality level writes a cloud setting.

```js
world.skyQuality = { cloudsOn: false } // no clouds in the view, the capture or the shadow maps
world.skyQuality = { cloudsOn: null } // given back to the preset
world.skyQuality = { skyLightIntensityScale: 0.5 } // a dimmer sky light, at once
```

A scene saved before the module (`formatVersion` 2) moves its `atmosphere`, its `fog` and its sky
light node into the module's parts once, when it is read; each part keeps the fields it had, the
fog the numbers it had by default and not the level's, and the sun and the clouds, which that scene
never had, are off. A scene is saved with its `sky` word (`formatVersion` 3 and after).

### Height fog part

The `heightFog` part places height fog over opaque and transparent surfaces; its `color` is a
linear-RGB array, and `false` takes it off. A part naming a linear or an extinction law
(`near`/`far`, `density`/`heightFalloff`) is that law alone and takes none of the level's numbers.
Distance is from the camera; height uses the scene's positive Y:

```js
const color = [0.35, 0.45, 0.6]
world.scene.sky = { heightFog: { color, near: 10, far: 100 } } // Linear: clear before 10, all fog after 100.
world.scene.sky = { heightFog: { color, density: 0.02 } } // Exponential: uniform medium.
world.scene.sky = { heightFog: { color, density: 0.02, heightFalloff: 0.15, baseHeight: 0 } } // Extinction form.
world.scene.sky = { heightFog: true } // Height fog at the level's numbers.
world.scene.sky = { heightFog: { baseDensity: 0.004, falloff: 0.03, maxOpacity: 0.8 } } // Height fog.
world.scene.sky = { heightFog: false } // Every part but the height fog: no fog.
```

The height fog's own fields are the reference's numbers in metres, each with its default, those of the
table: the defaults of a fog a scene declares itself (`SceneEnvironment.fog`), where `{}` is that fog.
Inside the sky word, `heightFog: true` and `{}` are another object, the fog the level places: a
`baseDensity` of 0.00436 per metre (0.0436 in the reference's centimetre numbers) at a `baseHeight` of
−68.5 m, over the table's defaults for every other field. A part that names a field keeps the level's
others, as the fog placed keeps its place when its density is edited: `{ baseDensity: 0.002 }` is the
table's density at the level's base height, not the fog `{}` of a scene's own declaration. The law
is [ENGINE.md](ENGINE.md#fog). A reference number in centimetres converts exactly: a density or
falloff is divided by 10 (they are per 1000 centimetres), a distance by 100.

| Field                  | Default                                                 | Meaning (the reference's number → ours)                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color`                | black                                                   | The light the fog scatters by itself, linear RGB. With an atmosphere the sky's light is added to it.                                                                                          |
| `baseDensity`          | `0.002`                                                 | Density at `baseHeight`, per metre, ≥ 0 (its `0.02` ÷ 10).                                                                                                                                    |
| `falloff`              | `0.02`                                                  | Per metre, ≥ 0: the density halves every `1 / falloff` metres up, 50 m (its `0.2` ÷ 10).                                                                                                      |
| `baseHeight`           | `0`                                                     | The height the density is `baseDensity` at, metres.                                                                                                                                           |
| `maxOpacity`           | `1`                                                     | The most of a surface's light the fog may hide, in [0, 1].                                                                                                                                    |
| `startDistance`        | `0`                                                     | Metres from the eye where the fog starts, ≥ 0.                                                                                                                                                |
| `cutoffDistance`       | `0`                                                     | Metres from the eye past which there is no fog, ≥ 0; 0 none.                                                                                                                                  |
| `directional`          | `{ exponent: 4, startDistance: 100, color: [0, 0, 0] }` | The sun's lobe: sharpness `exponent` > 0, metres before the sun's light is scattered (its `10 000` ÷ 100), the luminance scattered toward the sun times the sun's own.                        |
| `skyContribution`      | `[1, 1, 1]`                                             | The factor of the atmosphere's sky radiance the fog takes on, per channel, ≥ 0.                                                                                                               |
| `inMainView`           | `true`                                                  | Whether the views the page draws show the fog.                                                                                                                                                |
| `inSkyCapture`         | `true`                                                  | Whether the distant fog is laid over the sky of the sky light's real-time capture, and so lights the scene through it.                                                                        |
| `inReflectionCaptures` | `true`                                                  | Whether the scene the sky light captures from its own place (its `capturedScene` source) shows the fog.                                                                                       |
| `holdout`              | `false`                                                 | Whether the fog holds its light out: it draws black and punches a hole in the image's alpha by its coverage. Takes effect with the alpha holdout (`primitiveAlphaHoldout`, `propagateAlpha`). |
| `skyLightScattering`   | `{ strength: 0, roughness: 0.15 }`                      | The sky light's capture as a light of the fog's in-scattering: `strength` from 0, `roughness` in [0, 1]. Read only where the run's `fogReadsSkyLight` is on.                                  |

Three switches say where the fog is drawn, each on by default: `inMainView` the views the page draws (the camera's
and the extra views of the page), `inSkyCapture` the sky light's real-time capture, `inReflectionCaptures` the scene
the sky light captures from its own place. A view that does not show the fog draws none of it — the analytic fog, its
volume and the reflections' rays are all unfogged — while the atmosphere's haze and the local fog volumes, other
components, stay (the atmosphere has its own `inMainView`). A fog that holds out (`holdout`) adds no light and lays its
coverage on the image's alpha instead (the film settings `primitiveAlphaHoldout` and `propagateAlpha`).

```js
world.scene.sky = { heightFog: { inMainView: false } } // the fog lights the scene through the sky light's capture, but is not seen
world.scene.sky = { heightFog: { inSkyCapture: false } } // the distant fog does not reach the sky light
world.scene.sky = { heightFog: { holdout: true } } // with the alpha holdout on: the fog is a hole in the alpha
```

`skyLightScattering` lets the sky light's capture light the fog: the fog's in-scattering colour is mixed toward the
filtered cube read along the ray, at the mip the `roughness` names, times the light's colour, by the `strength`; the
sun's lobe fades by the same share, and the fog's own cubemap is not read while the strength is above 0. It applies in
a view with sky lighting and a ready cube, never in the capture itself (it would read what it writes), and only where
the project switch `fogReadsSkyLight` (off by default, a setting of the volumetric fog, `world.volumetricFog…`) is on; with the
strength at 0 nothing is read. The local fog volumes and the fog's volume are not lit this way.

```js
world.fogReadsSkyLight = true // the project switch, off by default
world.scene.sky = {
  skyLight: true,
  heightFog: { skyLightScattering: { strength: 0.5, roughness: 0.15 } },
}
```

With the atmosphere part on, the default fog is coloured by the sky and scatters the sun's light: a
`heightFog` over the `atmosphere` part and a sun is the reference's default fog. A
height fog lies over the atmosphere's sky too: from the horizon down, where the scene draws no
ground, a pixel is the fog's colour alone (a distance fog leaves the sky as it is); with no
atmosphere it lies over the background colour the same way. Without an
atmosphere, the fog is its declared `color` and, if the lobe's colour is not black, the sun's: the
one the scene holds (the brightest directional light, below), else the first directional light
added. The extinction form `{ color, density, heightFalloff?, baseHeight? }` stays: a medium of `density` per metre (`T = exp(−density · d)` where nothing falls off) divided by e every
`1 / heightFalloff` metres up; it is mapped exactly to the height law (`baseDensity = density /
(ln 2)²`, `falloff = heightFalloff / ln 2`) and shows the image it always showed.

`near` and `far` are finite with `0 ≤ near < far`; `density`, `heightFalloff` and the colour
components finite and nonnegative; `baseHeight` finite; the height fog's numbers in the ranges
above; otherwise `INVALID_SCENE_ENVIRONMENT`. To change a field, write `scene.sky` again. A
`fog: false` material stays unfogged. `SceneEnvironment.fog` carries the same fields. The law:
[fog lighting law](ENGINE.md#fog).

#### Objects in the fog's volume

A mesh whose material is of the volume domain draws no surface: the box its geometry fills, placed
by its pose, is voxelised into the volume of the `heightFog` part's `volumetric` setting (the scene needs that volume,
with a `volumetricFogQuality` other than `off`), where it adds to the medium of every cell it
covers. `material.volume` takes the three outputs of the domain; each is per metre, linear:

| Output         | Default | Meaning                                                                                                                            |
| -------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `albedo`       | white   | The share of the light each channel scatters, in [0, 1] (held to it).                                                              |
| `extinction`   | `0`     | The fraction of light a metre of the object takes away, ≥ 0 (held to 65 000): 0 adds no medium.                                    |
| `emissive`     | black   | The light the object gives off, ≥ 0 per channel (held to 65 000), times `emissiveIntensity`; read where `volumetricFogGlow` is on. |
| `emissiveOnly` | `false` | True: the albedo and the extinction count as zero, only the emissive light is added (the unlit model of the domain).               |

A cell adds `albedo · extinction` of scattering, `extinction` and the emissive light, each times a
fade that is 1 up to 0.6 of the fog's distance and falls to 0 at it, and only where its centre lies
in the object's box. Overlaps add. An object farther from the eye than the fog's distance plus its
radius is left out.

```js
const smoke = new Mesh(
  new BoxGeometry(4, 3, 4),
  material.volume({ albedo: [0.8, 0.8, 0.8], extinction: 0.4 }),
)
smoke.position.set(0, 1.5, -8)
world.scene.add(smoke) // a box of smoke in the fog; it draws no surface
const lamp = material.volume({ emissive: [2, 1, 0.5], emissiveOnly: true })
smoke.material = lamp // an emissive glow in the same box, from the next frame
```

A page without a mesh declares an object directly: `addFogVolume({ id, shape, matrix, boundsMin,
boundsMax, material })` (`shape` `'box'`, the default, covers the oriented box `boundsMin`…
`boundsMax` of its own space placed by `matrix`; `'sphere'` covers the sphere around that box, as a
particle does; `material` the outputs above), `setFogVolume(id, patch)`, `removeFogVolume(id)` and
`fogVolumes()`. A name already held is refused (`DUPLICATE_SCENE_FOG_VOLUME`), an unknown one
(`UNKNOWN_SCENE_FOG_VOLUME`), a field out of its range (`INVALID_SCENE_FOG_VOLUME`, or
`INVALID_MATERIAL` for an output). A mesh drawn at several placements (`InstancedMesh`) is drawn
as it is, not voxelised.

```js
session.addFogVolume({
  id: 'beam',
  shape: 'sphere',
  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, -6, 1],
  boundsMin: [-1, -1, -1],
  boundsMax: [1, 1, 1],
  material: { extinction: 1.5, emissive: [0.2, 0.4, 1] },
})
```

Two run-time settings pick the passes an object is voxelised in, as settings of the volume
(`volumetricFog…`): `volumetricFogVoxelizationSlicesPerPass` (default `8`, at least 1) is how many
of the slices an object reaches make one pass, and `volumetricFogVoxelizationShowOnlyPass`
(default `-1`) keeps one pass of each object, from `0`, to see where the passes lie; `-1` keeps
them all. The passes only divide the slices: the sum is the same.

```js
world.volumetricFogVoxelizationSlicesPerPass = 4 // passes of four slices
world.volumetricFogVoxelizationShowOnlyPass = 1 // only the second pass of each object, to look
world.volumetricFogVoxelizationShowOnlyPass = -1 // back to all of them
```

#### Local fog volumes

A local fog volume is a sphere of fog placed in the scene, the way a light is: the fog an author puts
in a doorway, a valley or a room. It is not the object of the section above (`addFogVolume`, a box or
a sphere voxelised into the fog's volume with a material of its own): a local fog volume is a medium
with its own law, drawn over the scene's fog whether the scene has a fog or not, and, where the scene's
fog has a volume, voxelised into it too.

Its medium thins out two ways at once: radially, densest at the sphere's centre and nothing at its
surface, and with height along the sphere's own up. What a ray crosses of it is the two laws'
coverages multiplied (one minus the transmittance of each), so that the soft edge of the sphere and
the layering of the height show together; a volume with either extinction at 0 shows nothing. It is
lit by the sun (the directional light the forward readers take) and by the sky light, scatters by its
albedo, and gives off its own emissive light.

```js
session.addLocalFogVolume({
  id: 'valley',
  // Its place: sixteen numbers, column-major, metres. The origin is the sphere's centre, the second
  // column its up, the largest column's length its scale (a radius of 5 m times it).
  matrix: [3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, 40, 1, -25, 1],
  radialDensity: 0.6,
  heightDensity: 1.2,
  heightFalloff: 300,
  albedo: [0.9, 0.95, 1],
  emissive: [0.02, 0.03, 0.05],
  startDistance: 20,
  sortPriority: 1,
})
session.setLocalFogVolume('valley', { radialDensity: 0.9 }) // the fields named replace the volume's own
session.localFogVolumes() // detached copies, in the order they were added
session.removeLocalFogVolume('valley')
```

| Field                    | Default  | Meaning                                                                                                                                                                                                                                                            |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                     | —        | Its name, unique among the local fog volumes.                                                                                                                                                                                                                      |
| `matrix`                 | identity | Sixteen numbers, column-major, its own space to the world's, metres. The sphere's radius is 5 m times the largest of the columns' lengths; its second column is the up the height law is measured along (the world's up is +y); shear and reflection are left out. |
| `radialDensity`          | `1`      | The extinction of the radial fog at the sphere's centre, per metre, ≥ 0 (held to it).                                                                                                                                                                              |
| `heightDensity`          | `1`      | The extinction of the height fog at the sphere's height 0, per metre, ≥ 0 (held to it).                                                                                                                                                                            |
| `heightFalloff`          | `1000`   | How fast the height fog thins out, ≥ 1 (held to it): the density is `heightDensity · e^(−falloff / 100 · h)`, `h` the height in the sphere's radii.                                                                                                                |
| `heightOffset`           | `0`      | The height, in radii, the height fog's density is `heightDensity` at.                                                                                                                                                                                              |
| `scatteringDistribution` | `0.2`    | The phase function's `g`, in [0, 0.999] (held to it): 0 scatters equally every way, nearer 1 toward where the light goes.                                                                                                                                          |
| `albedo`                 | white    | The share of the light each channel scatters, in [0, 1] (held to it).                                                                                                                                                                                              |
| `emissive`               | black    | The light the medium gives off, a luminance, ≥ 0 per channel (held to it); it follows the medium's coverage.                                                                                                                                                       |
| `startDistance`          | `0`      | Metres from the eye before which the volume does not show, ≥ 0 (held to it); the run's `localFogVolumeStartDistance` holds it above that.                                                                                                                          |
| `sortPriority`           | `0`      | A whole number in [-127, 127] (held to it): a volume of a lower priority is drawn behind one of a higher, whatever their distance; equal priorities go farthest first.                                                                                             |

The numbers are the reference's, in this engine's units: the reference writes distances in
centimetres and densities per centimetre, here a start distance, the radius (5 m times the scale), the
density cap and every extinction are metres and per metre, and the height axis is the matrix's second
column in a world whose up is +y. A name already held is refused (`DUPLICATE_SCENE_LOCAL_FOG_VOLUME`),
an unknown one (`UNKNOWN_SCENE_LOCAL_FOG_VOLUME`), a field that is `null` or not a finite number, a
colour of three or a matrix of sixteen whose columns have a length (`INVALID_SCENE_LOCAL_FOG_VOLUME`).
Like the lights and the objects of the volume, local fog volumes are declared at run time and are not
part of a saved world; they can be declared whatever the settings below say, even with the project
switch off, and then are never drawn.

Nine settings, those of the volumetric fog (`world.volumetricFog…`, `setVolumetricFog`), say how they are
drawn; the first is the project's, read once when the session opens:

| Setting                          | Default | Meaning                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localFogVolumeSupport`          | `true`  | The project switch of the local fog volumes, read once when the session opens (changing it later changes nothing). Off, no program holds any of their code, not the sky light's capture's either, and no pass, buffer or block is made for them; they can still be declared, and are never drawn. |
| `localFogVolumes`                | `true`  | Whether the local fog volumes are drawn.                                                                                                                                                                                                                                                          |
| `localFogVolumeInVolume`         | `true`  | Whether they are voxelised into the fog's volume where the scene's fog has one — the analytic law then draws only what lies past the volume's far end, and they lie under the volume's light. Off, the analytic law draws them whole, over the finished fog, the volume's light too.              |
| `localFogVolumeMaxVolumeDensity` | `1`     | The most extinction, per metre, a volume gives a cell of the fog's volume: its height law grows steepest at its bottom, and a dense cell makes the volume's history leak. 0 or more (held to it).                                                                                                 |
| `localFogVolumeStartDistance`    | `10`    | Metres from the eye before which no local fog volume shows, whatever its own start distance; held to at least 0.1.                                                                                                                                                                                |
| `localFogVolumeMaxCount`         | `32`    | The most volumes a view draws, the farthest and the lowest in priority dropped; held to 1…256.                                                                                                                                                                                                    |
| `localFogVolumeTileSize`         | `128`   | The side, in pixels, of the tiles of the screen the volumes are culled by: each tile keeps the list of the volumes over it, and a pixel or a cell of the fog's volume walks its tile's list alone. Held to 8…512; the lists are made for the tile grid the view cuts, whatever its size.          |
| `localFogVolumeUsesDepthPyramid` | `true`  | Whether a tile's list drops a volume that lies wholly behind the surfaces the depth pyramid holds over it, so that no pixel walks a volume it cannot show. Off, or where the image has no pyramid, the tile's frustum alone culls.                                                                |
| `localFogVolumeOnTranslucent`    | `false` | Whether translucent surfaces are fogged by them too; off, they are fogged by the scene's fog alone.                                                                                                                                                                                               |

```js
world.localFogVolumes = false // draw none of them, whatever the scene declares
world.localFogVolumeInVolume = false // keep them out of the fog's volume: drawn whole, over its light
world.localFogVolumeMaxVolumeDensity = 0.5 // no cell of the fog's volume takes more than 0.5 per metre of them
world.localFogVolumeStartDistance = 5 // the volumes show from five metres
world.localFogVolumeMaxCount = 64 // a view draws up to 64, the nearest and the highest in priority
world.localFogVolumeOnTranslucent = true // glass in the valley's fog is fogged by it too
world.localFogVolumeTileSize = 64 // smaller tiles: shorter lists, more tiles to cull (never fewer than 8 pixels)
world.localFogVolumeUsesDepthPyramid = false // cull by the tile's frustum alone
```

```js
// The project switch is the session's, read once when it opens: off, no program holds any of the
// local fog volumes' code. A session that draws none of them is made so.
const world = createWorld('viewer', { localFogVolumeSupport: false }) // the project switch, at the session's opening
```

The tiles and their lists are the engine's: the view is cut into square tiles, and before the fog is
laid one pass writes, for each, the volumes that can show over it (the sphere not wholly outside the
tile's frustum, and, with `localFogVolumeUsesDepthPyramid`, not wholly behind the surfaces of the depth
pyramid over its footprint). The image is the same as without the lists; the cost is per volume over a
pixel's tile, not per volume the view draws. The lists live in a buffer made for the tile grid, only
while a view draws a volume, and it counts in the bytes of that view's targets (`metrics.views`). The
culling runs with the frame's other passes — it has no queue of its own to set — and no view of each
tile's count of volumes is offered. The tile side asked for is never changed. Three diagnostics tell
what the engine could not do, none of them stops the volumes being drawn:

| Diagnostic                  | Meaning and what to do                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fog-local-tiles-too-large` | The lists for the tile grid would not fit a storage buffer of the device, so the view is not tiled and every pixel walks every volume of the view. Raise `localFogVolumeTileSize`; said once for a size. |
| `fog-local-cull-failed`     | The culling pass did not compile: the same, untiled, until it does.                                                                                                                                      |
| `fog-local-sky-failed`      | The pass that gives the volumes the sky light's term did not compile: the term stays black, the sun and the volume's own light are drawn.                                                                |

### Atmosphere part

The `atmosphere` part fills the sky, hazes the distance and tints the sun's light through the
air of a planet whose ground is the scene's plane `y = 0`. `true` is an Earth-like atmosphere, an
object sets any field over those defaults — planet radius and air thickness in kilometres,
scattering and absorption coefficients per kilometre, the ground's height in scene metres
(`groundHeight`) and where its top stands on that plane (`groundPosition`, `[x, z]` in metres, `[0, 0]`
by default):

```js
world.scene.sky = { atmosphere: true } // the whole level: a part not named stays on
world.scene.sky = { sun: false, skyLight: false, heightFog: false, clouds: false } // the air alone
world.scene.sky = {
  atmosphere: { planetRadius: 6360, height: 60, mieAnisotropy: 0.8, groundHeight: 0 },
}
// A city 50 km from the world's origin: the planet's top under it, so the horizon curves from there
world.scene.sky = {
  atmosphere: { groundHeight: 120, groundPosition: [50_000, -12_000] },
}
world.scene.sky = { sun: { intensity: 10 }, heightFog: false, clouds: false } // the air, a sun, the sky's light
world.scene.sky = { atmosphere: false } // every part but the air
world.scene.sky = { atmosphere: { inMainView: false } } // the air lights the world but is not drawn in the view
world.scene.sky = { atmosphere: { holdout: true } } // with the alpha holdout on: the sky and its haze draw black and are a hole in the alpha
```

`inMainView` (on) says whether the sky, the sun's disk and the haze on the surfaces and the clouds are
drawn in the view the camera sees. Off, none is: the sky is black, the fog alone over it, and nothing is
hazed, while the sun's light tinted by the air and what the sky light captures of the air are as they
are.
`holdout` (off) makes the air hold its light out where the alpha holdout is in effect (the film settings
`primitiveAlphaHoldout` and `propagateAlpha`): the sky draws black with the coverage of its air, which is laid on
the image's alpha as a hole, and the haze on the surfaces and the clouds adds no light, dimming what lies behind it all the same.

The sun is the brightest directional light of index 0 (the second light is below), its colour times
its intensity weighed by the eye's sensitivity to each channel, held as lights are added and removed (with an atmosphere or none): a
light added replaces it only if brighter, and the sun removed gives its place to the brightest of
the others, the first added of equals; `atmosphereSun: false` leaves one out. Where it is on,
`background` is not shown, and the `skyLight` part lights the scene from the sky (without an
atmosphere, from the background colour; below the horizon the sky itself, unless `lowerHemisphereIsSolidColor` is `true` (off by default, as in a new level's sky light): then `lowerHemisphereColor`, black, replaces it, `lowerHemisphereCoverage`, 1 by default, from 0 to 1, being the colour's alpha: how much of the colour replaces the sky and the clouds below the horizon, the rest of them showing through). The bounce is on by default
(`world.bounce`, `false` turns it off): the sky light then reaches a surface only where the scene
lets it — the street lit from above, the arcade dark — and a reflection that leaves the scene
shows the sky; with the bounce off, the sky light lights every surface with the sky nothing hides.

The sky light can also light the scene with the scene itself: with `realTimeCapture` off and
`sourceType: 'capturedScene'` it draws the scene once from its position into its cube, the six faces
of a cube seen from there, the distance `skyDistanceThreshold` (150000 cm, the reference's default)
the nearest it shows, and `captureEmissiveOnly` keeping only what the surfaces emit. It is captured
when the light is created, when its cubemap or its angle changes and when `realTimeCapture` is
switched; not when its colour, its intensity or its lower hemisphere changes, nor when it moves. A
host that changed the world asks for the sky again by writing the part again:

```js
world.scene.sky = {
  skyLight: { realTimeCapture: false, sourceType: 'capturedScene', cubemapResolution: 128 },
}
```

Its quality settings: `skyLightCaptureSupersample` (1, from 1 to 8) draws the faces larger and
averages them down, `skyLightCaptureLodDistanceScale` (1) asks more detail of the scene in the faces.
The faces trace no reflection of the scene. The model:
[sky light, captured scene](ENGINE.md#atmosphere-and-sky-light).

```js
world.scene.sky = {
  skyLight: {
    lowerHemisphereIsSolidColor: true,
    lowerHemisphereColor: [0.05, 0.04, 0.03],
    lowerHemisphereCoverage: 0.6,
  }, // a ground that lets 40% of the sky's light through
}
```

A sky light whose source is a specified cubemap (`realTimeCapture: false`, `sourceType: 'specifiedCubemap'`)
lights the scene with a picture the part holds as data: `cubemap`, `{ size, texels }` — `size` texels
across one face, from 1 to 1024, and `texels` the six faces in the order +x, −x, +y, −y, +z, −z of a cube
texture looked up by the scene's own direction (+y up), each row by row from its top-left corner, three
linear numbers ≥ 0 a texel (`6 · size² · 3` numbers; a typed array or an array). The data is not copied:
it must not be written after it is set. A host that moves between two pictures (two times of the day)
adds `cubemapBlend`, `{ destination: { size, texels }, fraction }`: the light reads the source mixed with
the destination by `fraction`, 0 the source alone, 1 the destination alone, a value beyond held to them;
write the part again to move the fraction. Saved worlds keep both (a typed array is saved as an array of
its numbers). A malformed field is refused with `TypeError` naming it (`skyLight: cubemap.texels expects
72 numbers, six faces of 2² texels`).

```js
const sky = new Float32Array(6 * 2 * 2 * 3).fill(0.4) // a 2×2 cube of one grey: the sky's radiance
world.scene.sky = {
  skyLight: {
    realTimeCapture: false,
    sourceType: 'specifiedCubemap',
    sourceCubemapAngle: 90, // degrees about the vertical
    cubemap: { size: 2, texels: sky },
  },
}
// later, toward the evening cube
world.scene.sky = {
  skyLight: {
    realTimeCapture: false,
    sourceType: 'specifiedCubemap',
    cubemap: { size: 2, texels: sky },
    cubemapBlend: { destination: { size: 2, texels: evening }, fraction: 0.25 },
  },
}
```

Nothing is clamped: where the brightest texel of a picture passes what a half float holds (65504), the
engine writes the whole picture times the scale that brings that texel to 65504 and gives the light the
inverse, so a sun texel of 1e6 lights the scene as 1e6, on any device; the two cubes of a blend share one
scale, the brighter one's, so that the mix is of two lights in one unit. A cube of a large side is written
face by face over several images from one buffer, and is the light's once its six faces are written. The
part's data is the one source of the cube: the engine has no second entry for a texture the host makes.

The air holds two lights, a sun and a second one: a moon, or a second sun. Every directional light
has an `atmosphereSunIndex`, `0` by default (`1` for the second light); of the lights that may light
the air (`atmosphereSun` not `false`) the brightest of each index is held, as the sun is: a light
added takes the place of its index only if brighter, the light removed gives it to the brightest of
the others of its index, the first added of equals, and a light moved to the other index is removed
and added again. The sky, the haze over the distance, the sun disks and the sky light all take both
lights. Index 1 held with none of index 0 is not moved to index 0: the second light shines alone.
Any index other than 0 or 1 is refused (`INVALID_SCENE_LIGHT`). `SceneLight.atmosphereSunIndex`
carries the same value in a declared light (directional lights only).

```js
world.scene.sky = { atmosphere: true, sun: false } // the scene's own lights are the air's
world.scene.add(light.directional({ intensity: 10, position: [-50, 70, 0] })) // the sun, index 0
const moon = light.directional({ intensity: 0.3, position: [60, 40, 20], atmosphereSunIndex: 1 })
world.scene.add(moon) // the second light of the air: its own sky, haze, disk and tint on what it lights
moon.atmosphereSunIndex = 0 // a write reaches the world at once; 0 is the default
```

A light's colour can follow a temperature: with `useTemperature` on, its colour is multiplied by
that of a black body at `temperatureKelvin` (6500 by default, white; read between 1000 and 15000),
and the sun, the sky and the fog take that colour. Three options say more of how a directional light
meets the air: `sunDiskTint` (white, a linear colour) multiplies the sun's disk in the sky and never
the light it gives; `shadowsAir` (off) lets the light's shadow shade the air — the haze and the sky's
march read its shadow map along their rays, so that a mountain's shadow reaches into the haze, as
`atmosphereSampleLightShadowMap` (on) allows; `transmittancePerPixel` (off) reads the air's
transmittance toward the light for each surface point and not once at the ground, so that a low sun
reddens a valley and not the summit above it. A saved world keeps each of them.

A light draws light shafts through nine fields, each written to its record and to a saved world
only when it differs from its default. `shaftOcclusion` (off) lets the light darken the fog's
inscattering where the scene hides it: `shaftOcclusionDarkness` (0.05) is what a full occlusion
maps to, 1 darkening nothing, and everything nearer the eye than `shaftOcclusionDepthRange` (1000
metres) occludes; `shaftOverrideDirection` (`[0, 0, 0]`, a vector) names, when it is not zero, the
direction the shafts come from instead of the light's own. These four belong to a directional light
alone. `shaftBloom` (off) adds a bloom around any light: `shaftBloomScale` (0.2) is the factor on
the colour it adds, `shaftBloomThreshold` (0) the brightness the image must pass after exposure to
bloom, `shaftBloomMaxBrightness` (100) the brightness above which it is brought down, and
`shaftBloomTint` (white, a linear colour) the factor on its colour. A vector is changed in place with
`set`, as `sunDiskTint` is.

```js
const sun = light.directional({ intensity: 10, position: [-50, 70, 0], castShadow: true })
sun.shaftOcclusion = true
sun.shaftOcclusionDepthRange = 2000 // metres
sun.shaftOverrideDirection.set(-0.3, 0.4, 0.1) // the shafts come from there
sun.shaftBloom = true
sun.shaftBloomTint.set([1, 0.85, 0.6])
world.addLight({ id: 'lamp', kind: 'point', intensity: 50, position: [0, 3, 0], shaftBloom: true })
```

```js
const sun = light.directional({ intensity: 10, position: [-50, 70, 0], castShadow: true })
sun.useTemperature = true
sun.temperatureKelvin = 5200 // a warmer white
sun.sunDiskTint.set([1, 0.8, 0.6]) // the disk redder than the light it gives
sun.shadowsAir = true // the mountains' shadows in the haze
world.addLight({
  id: 'moon',
  kind: 'directional',
  direction: [0.2, -1, 0.1],
  color: [0.7, 0.8, 1],
  intensity: 0.3,
  atmosphereSunIndex: 1,
  temperatureKelvin: 4100,
  useTemperature: true,
})
```

The air's samples are scaled by `sampleCountScale` (1, from 0.25): the caps its quality settings
give the marches (below) are no more than 32 times it, and the haze volume's samples a slice no more
than twice it. The air's quality is the sky's quality settings of `world.skyQuality` — `atmosphereOn`
(on), the samples of a march through the air (`atmosphereSamplesMin`, `atmosphereSamplesMax`,
`atmosphereDistanceToMaxSamplesKm`), of the sky table (`skyTableSamplesMin`, `skyTableSamplesMax`,
`skyTableDistanceToMaxSamplesKm`) and of a slice of the haze volume (`aerialSamplesPerSlice`), the
sizes of the tables (`transmittanceWidth`, `transmittanceHeight`, `multiScatterWidth`,
`multiScatterHeight`, `skyTableWidth`, `skyTableHeight`) and of the haze volume (`aerialWidth`,
`aerialDepthSlices`, `aerialDepthKm`), the samples that build the transmittance and the
multiple-scattering tables (`transmittanceSamples`, `multiScatterSamples`), and the switches
`skyTableFast` (the sky read from its table, else every sky pixel marched), `aerialFastOnOpaque` (on; off, a pass over the lit image marches the haze of each opaque pixel from the eye to its depth, jittered by the blue noise and shaded by the shadow maps and the clouds, the translucent surfaces reading the volume either way), `aerialDepthTest`,
`transmittanceTable`, `transmittanceSmallFormat` (the table in four 8-bit channels),
`distantSkyLightTable` and `distantSkyLightAltitudeKm` (the fog's sky, made every image),
`multiScatterHighQuality` (8 directions over the sphere), `skyTablesFullPrecision` (the haze
volume in 32-bit floats) and `atmosphereSampleLightShadowMap` —, whose defaults are the reference's
fourth level (`max`) and which the `smooth`, `balanced` and `fine` presets set to its lower three and the
`cinematic` preset to its fifth:

```js
world.quality.preset = 'fine' // the effects' level 2: 2 samples a slice, 64 samples at most
world.skyQuality = { skyTableFast: false, atmosphereSamplesMax: 256 } // every sky pixel marched
world.scene.sky = { atmosphere: { sampleCountScale: 2 } } // twice the samples, within those caps
world.skyQuality = { skyTableFast: null } // given back to the preset
```

The `cinematic` preset is the fifth level of the effects group (`smooth`, `balanced`, `fine` and `max` are
its levels 0 to 3): it marches every sky pixel and the haze on the opaque surfaces instead of reading their
tables, and writes these values (`SKY_PRESET_LEVELS.effects.cinematic`):

```js
world.quality.preset = 'cinematic' // the same values, written by the level
world.skyQuality = {
  aerialSamplesPerSlice: 8,
  aerialDepthSlices: 32,
  skyTableFast: false, // every sky pixel is marched
  aerialFastOnOpaque: false,
  skyTableSamplesMin: 4,
  skyTableSamplesMax: 256,
  atmosphereSamplesMin: 8,
  atmosphereSamplesMax: 256,
  transmittanceSmallFormat: false,
  transmittanceSamples: 30,
  multiScatterSamples: 20,
}
```

**Ranges.** `planetRadius`, `height`, `rayleighScaleHeight` and `mieScaleHeight` are above 0 (a `height`
under 0.1 km is read as 0.1 km, the thinnest air), `mieAnisotropy` is between −1 and 1 (the bounds
themselves are refused: at ±1 the phase function's denominator is 0 straight along the ray, so the open
range is kept), `aerialPerspectiveStartDepth` is 0 or more, `multiScatteringFactor` is from 0 to 100 and
`minSunElevation` from −90° to 90°. A value outside refuses with the range in its message; a world saved
with an anisotropy of −0.3 or a radius of 12000 km loads and draws.

**The planet's place.** The planet is a sphere under the plane `y = groundHeight`, its top at
`groundPosition`; a planet that is to have its _centre_ at a place is given that place with a
`groundHeight` its radius (in metres) over it. The three ways to place a planet (its top at the world's
origin, its top at a place, its centre at a place) are this one setting.

**The view from above the air.** An eye above the air (higher than `planetRadius + height`) is not
brought down into it: the air is seen from outside, the planet's limb with its blue edge, the sun's disk
through the air at the limb, the haze and the clouds along a ray from where it enters the air; a ray that
never enters it sees black. An eye under the ground is held five metres over it. Under an orthographic
camera the sky, the haze and the clouds are drawn as well, each pixel's ray starting at the pixel's own
point ([the air under an orthographic camera](ENGINE.md#atmosphere-and-sky-light)).

A field out of range is refused
(`INVALID_SCENE_ENVIRONMENT`); to change a field, write `scene.sky` again.
`SceneEnvironment.atmosphere` carries the same fields. The model:
[atmosphere and sky light](ENGINE.md#atmosphere-and-sky-light).

### Clouds part

The `clouds` part is one layer of clouds ray marched from the eye: in the view, in its shadow maps and in
the sky light's capture, whether or not the scene has an atmosphere. `true` is the level's layer; an
object sets fields of the layer and of its material over the defaults of the [parts table](#sky-module).
It is drawn while the sky quality's `cloudsOn` is on (the default), read again at each image. The wind
drifts the clouds by the world's time, the clock the material graphs read: a paused world holds them
still. Under an orthographic camera the layer is traced directly, a ray for each pixel.

**Clouds with no atmosphere.** With none they stand on a planet of `planetRadiusKm` (6360 by default)
under the plane `y = 0`: the sun and the second light's own illuminance reaches them (a transmittance of
one), there is no haze on them and `sunTintPerSample` has no effect, and the distant sky light that lights
them (`cloudDistantSkyLight`) is the sky light's own diffuse light, not read from an air. The lights of the
air are packed for the clouds only while a clouds part is followed.

```js
world.scene.sky = { atmosphere: false, clouds: true, sun: true } // clouds over a planet with no air
```

**How the lights shade the cloud.** `rayMarchVolumeShadow` (default `true`) says how the cloud is shaded
by the air's lights, in the view and in the sky light's capture. On, a ray is marched through the material
from each sample toward each light (`shadowSamplesScale`, `shadowRayLengthKm`): the exact shade, dearer.
Off, no ray is marched: each sample reads the clouds' shadow map of the light (the sky quality's
`cloudShadowMap`, the light's `castCloudShadows` and `cloudShadowStrength`), its optical depth `d` letting
`exp(-d)` of the light through for the first order of scattering and `exp(-d · e^n)` for the order `n`,
`e` being `multiScatterOcclusion`. A light with no map (the setting off, the light not casting cloud
shadows) then shades nothing. The programs are made for the choice, so changing it compiles them again
once. What the shadow map serves besides, in both settings: the air's march (the sky, the haze, the
distant sky light), the surfaces' direct light, the fog's light and the translucent surfaces; with the
switch on, the cloud's own shade is marched and the map is not read by the cloud.

```js
// Cheaper clouds: read the shadow map instead of marching toward the sun.
world.modules.set('sky', { clouds: { rayMarchVolumeShadow: false } })
// The shadow map is then what shades the clouds, so keep it on and give the sun a map:
world.skyQuality = { cloudShadowMap: true }
```

**The sky light on the underside.** `undersideSkyLoss` (0.5, from 0 to 1) is how much of the distant
sky light the underside of a cloud loses where the cloud's material gives no occlusion of its own. The
built-in material always gives one (`ambientOcclusion`, 0.5), so no cloud of it reads the setting.

**The sun's shadow in the opaque scene.** `skyLightShadowFromOpaque` (off) acts on the clouds of the sky
light's capture as well as on its sky: the clouds read the sun's shadow map where
`cloudSampleLightShadowMap` is on and the first light of the air casts a shadow that is projected this
image.

**The settings.** `cloudShadowMapSpatialFiltering` (1, read from 0 to 4), `cloudShadowMapNewFrameWeight`
(1, read from 0 to 1), `cloudLocalLightShadowSamples` (12, read from 0 to 128), `cloudRenderTargetScale`
(1, read from 0.1 to 1) and `cloudEmptySpaceSkippingDepthKm` (40, read from 1) take any number and are
read held to the range, as the console variables they come from are: 8 filter passes is 4, a weight of 2
is 1. The sky occlusion map's settings (`cloudSkyAO`, `cloudSkyAOResolutionMax`, `cloudSkyAOTraceSamples`,
`cloudSkyAOFiltering`, `cloudSkyAOSnapKm`) are in [the sky module](#sky-module). Removed, because nothing in
the engine could read them: `lightShaftAfterDof` (the shafts are added to the lit image; the other image
the switch could send them to, a translucency drawn apart, does not exist here), `skyLightDepthBuffer` (the
capture draws no mesh, so its depth is the far everywhere and the switch changed no pixel), and the sky
light's `indirectLightingIntensity`, `samplesPerPixel`, `affectReflection` and
`affectGlobalIllumination` (the reference reads them in its ray-traced and path-traced lighting only). A
scene or a call naming one is refused with the field's name.

**The empty-space table.** `cloudEmptySpaceSkipping` (off) builds, before each view's tracing, a table of
where the clouds start (32 × 32 texels over the view, `cloudEmptySpaceSkippingDepthKm` deep in 64 slices),
and the march of a ray begins there; never in a reflection. `cloudEmptySpaceSkippingSliceBias` (0) moves
the start by that many slices, −1 one slice toward the eye, and `cloudEmptySpaceSkippingCorners` (on)
reads the corners of each cell as well as its centre. The built-in material leaves the table's input
unconnected, and an unconnected input says matter is everywhere, so its table holds only the first
slice's start moved by the bias (0 by default): the image is the one without the table, for the cost of
the pass.

```js
world.skyQuality = { cloudEmptySpaceSkipping: true } // the table is built each image
world.skyQuality = { cloudEmptySpaceSkippingSliceBias: 2, cloudEmptySpaceSkippingCorners: false }
world.skyQuality = { cloudEmptySpaceSkipping: null } // given back to the preset
```

**On the translucent surfaces.** The clouds are composed over the lit image before the transparents are
drawn, so a translucent surface behind a cloud would be drawn over it. Two things lay them right, both
read per vertex:

- `cloudShadowOnTranslucent` (a project switch, `false` by default, read once when the session opens):
  the clouds' shadow maps also shade the translucent surfaces. The shade of the forward directional light
  (below) is read from its clouds' shadow map at each vertex of a translucent surface and interpolated
  over the triangle, so it costs a vertex a map read and a pixel nothing. It applies where the forward
  light is one of the air's two lights that has a map this image: the sky quality's `cloudShadowMap` on
  (the default), the light's `castCloudShadows` on (off by default) and its `cloudShadowOnSurfaceStrength`
  above 0 (1 by default, the factor on how much of the shade the surfaces take). Like every run-time
  setting it is advertised to the tools by `runtimeToolsSchema` (field `cloudShadowOnTranslucent`, the
  "effects" quality group, no preset writes it) and held in the sky quality rules.
- `cloudFog` (a material option, `false` by default): a see-through (`transparent`) surface that is
  fogged (`fog` not `false`) receives the clouds in front of it as part of its fog — the cloud image is
  laid over the fog of each vertex of the surface, faded in over `cloudSoftBlendingDistanceOnTranslucent`
  kilometres from the cloud's front, so a surface behind a cloud is seen through it, not over it. A rough
  approximation that helps where a translucent surface lies behind a cloud (a window seen through a cloud
  bank, a particle sprite beyond a cloud); the surface needs the vertices to carry it, so a very large
  triangle shows the cloud at its corners only. Setting it on a material of a scene changes its blended
  programs, like `allowNegativeEmissive` changes the graph's.

`cloudFogLateOnTranslucent` (off), with `cloudFogLate` on and a trace size that rebuilds the image
(`'quarterToHalf'`, `'quarterToFull'`): the surfaces whose material has `cloudFog` read the cloud image
with the fog already laid on it, which the rebuild writes as one more image of the rebuilt size; off,
they read the image without the fog (the fog is laid on the clouds only when they are composed over the
lit image), so a translucent surface behind a cloud can show with another fog than the cloud's.
`cloudSoftBlendingDistanceOnTranslucent` (0.5), read from 0.0001, is the kilometres, from the cloud's
front, over which the cloud fades in over a translucent surface behind it. Off, the programs that draw a
translucent surface hold none of this code; with either on, they read both per vertex, the one that is
off giving its neutral value.

```js
const world = createWorld('viewer', { cloudShadowOnTranslucent: true }) // the shade: a project switch
// The sun has a cloud shadow map, and lets the surfaces take all of its shade:
world.scene.sky = { clouds: true, sun: { castCloudShadows: true, cloudShadowOnSurfaceStrength: 1 } }
// A glass pane in the scene now darkens under a cloud's shadow; at 0.5 it would take half of it:
world.scene.sky = {
  clouds: true,
  sun: { castCloudShadows: true, cloudShadowOnSurfaceStrength: 0.5 },
}

const glass = material.meshStandard({
  transparent: true,
  opacity: 0.4,
  cloudFog: true, // the clouds in front of the glass are laid over its fog
})
world.skyQuality = {
  cloudFogLateOnTranslucent: true, // the image the translucent surfaces read has the fog on it
  cloudSoftBlendingDistanceOnTranslucent: 1, // 1 km to fade a cloud in over a surface behind it
}
world.skyQuality = { cloudFogLateOnTranslucent: null } // given back to the preset
```

The model: [the clouds in the air and the sky light](ENGINE.md#atmosphere-and-sky-light) and
[the transparent surfaces](ENGINE.md#transparent-surfaces).

### Declared lights

Lights are added, changed and removed like any object. Each is a `SceneLight` (version 4): `point`
and `spot` carry `position` and `range` in metres, `spot` also `direction`, an `outerConeAngle` and an
`innerConeAngle`, half-angles in radians; `rect` carries `position`, `range`, the `direction` of its face's normal, its width axis
`right` and its `size` (width, height; a side under 1 cm lights and casts as one of 1 cm, the light
keeping what you declared); `directional` only `direction` (of propagation), refused with a
`position`, `range` or a cone angle. All carry linear `color`, an `intensity` and
`castsShadow`, a rectangle too. A `directional` may
also carry `shadowDistance` ([A sun's shadow distance](#a-suns-shadow-distance-and-its-far-casters))
`atmosphereSunIndex` ([Atmosphere part](#atmosphere-part)) and `forwardShadingPriority` (below), refused
on any other kind.

**Intensity and its unit.** A `directional` light's `intensity` is in lux, `10` when it names none.
A `point`, a `spot` and a `rect` write theirs in `intensityUnits` (the node form's `intensityUnits`,
refused on a `directional`), one of five, `'unitless'` by default:

| `intensityUnits` | What the number is                               | The light it gives                                                                                                                                                     |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'candelas'`     | A luminous intensity.                            | The number, in candelas.                                                                                                                                               |
| `'lumens'`       | A luminous flux.                                 | Spread over the solid angle it fills: a point's sphere (4π), a spot's cone (2π (1 − cos of its outer cone)), a rect's cosine lobe (π).                                 |
| `'nits'`         | A luminance.                                     | Times the source's area: a point or spot's sphere or capsule, 4π r (r + length / 2) of its `emitterRadius` and `emitterLength` (none without a radius); a rect's face. |
| `'ev'`           | An exposure value at ISO 100, any finite number. | 2 to that power, in candelas (a luminance over an implicit square metre).                                                                                              |
| `'unitless'`     | The default scale.                               | 16 candelas for every 10 000.                                                                                                                                          |

A lamp that names no `intensity` is the light a new one is placed with, `5000` unitless, written in
its unit: 8 candelas, 8 × 4π ≈ 100.5 lumens for a point (8 × π ≈ 25.1 for a rect), an EV of
`3` (log2 8) and 8 candelas over the source's area in nits. A `rect` lights by the radiance of its
candelas over half its face's area; the node form's rectangle is 64 cm a side by default. A point or
a spot taken off the inverse square (`inverseSquared: false`) takes its `intensity` as it is, a
brightness in no unit: there it is at least 0 in any unit, and a default in EV or nits is `8`.
Elsewhere the intensity is at least 0, but any number in EV. A point or spot in nits under the inverse
square needs an `emitterRadius`: with no source it would give no light, and is refused
(`INVALID_SCENE_LIGHT`). The node form (`light.point(…)`, `light.spot(…)`, `light.rectArea(…)`,
`light.directional(…)`) has the same defaults; an ambient, hemisphere or probe light's `intensity`
is `1`. A version-2 rect's intensity was its radiance: a radiance `L` is `L / 2` nits, which a saved
scene of before version 4 is read as (one with no radiance is refused, `UNSUPPORTED_SCENE_FORMAT`).
A lamp saved before version 5 that named no unit was in candelas, and is read as such.

```js
light.point({ position: [0, 3, 0] }) // 5000 unitless, 8 candelas
light.spot({ intensity: 800, intensityUnits: 'lumens', position: [0, 3, 0] }) // 800 lumens through its cone
world.addLight({
  id: 'sun',
  kind: 'directional',
  color: [1, 1, 1],
  direction: [0, -1, 0],
  castsShadow: true,
}) // 10 lux
```

Two options of every light say how the volumetric fog and the clouds take it, over the light on
surfaces, which they never change: `fogScattering` (default `1`, `0` or more) is the factor on its
colour in the fog volume and in the clouds' local lights, and a light of `0` is left out of both;
`shadowsFog` (default `true` for a `directional` light, `false` for any other) lets a light that
casts a shadow shadow the fog too. The sky light has the same factor, its part's `volumetricScatteringIntensity`
(`1` by default): the factor on the sky the fog scatters. A saved world
keeps a `shadowsFog` set against its kind's default; `fogScattering` is among the light's numbers.

```js
const lamp = light.point({ intensity: 20, position: [0, 3, 0], distance: 12, castShadow: true })
lamp.fogScattering = 0.5 // half of it in the fog and the clouds; 0 leaves it out of both
lamp.shadowsFog = true // its shadow map also shadows the fog volume (a sun's does by default)
world.scene.sky = { skyLight: { volumetricScatteringIntensity: 0 } } // the fog scatters none of the sky light
```

The same in the declared form: `world.addLight({ id: 'lamp', kind: 'point', ..., fogScattering: 0.5,
shadowsFog: true })`; a negative `fogScattering` or a `shadowsFog` that is not a boolean is refused
(`INVALID_SCENE_LIGHT`). A `rect` takes `shadowsFog` as a point does, and refuses `emitterRadius`,
`emitterLength`, `emitterSoftRadius` and `emitterAxis` (`INVALID_SCENE_LIGHT`): they describe the source
of a point or a spot, a rectangle's source is its `size`.

A directional light takes `softAngle` (degrees, from 0 up to, not including, 180; default 0), the soft angle of its disk: it widens the
highlight the sun leaves on a glossy surface without lighting more of the surface, as `emitterSoftRadius` does for a point or a
spot. A point, a spot or a rect refuses it (`INVALID_SCENE_LIGHT`).

```js
const sun = light.directional({ intensity: 6, softAngle: 2 }) // a broader highlight on polished surfaces
```

A point or a spot takes a light profile, the shape of the light a lamp gives as a photometric file measured it (an IES file the
compiler turned into a profile, a lamp of an imported scene that names one has it already): `iesProfile` is the profile's id,
`useIesBrightness` (default `false`) makes the light's intensity the profile's brightness (its greatest candela, `iesBrightness`:
a finite number above 0 that the compiler writes with the profile, and only beside `iesProfile`) times
`iesBrightnessScale` (default `1`, from 0) in place of `intensity`, written in the light's unit; a light that carries no
`iesBrightness` keeps its `intensity`. The colour of the light is
multiplied, for each direction it leaves in, by the profile's share of its greatest candela there, so a profiled light lights nothing
a profile says it does not. The profile is read in the light's own frame: its vertical axis is the `direction` of the light, its 0
degree vertical angle (the nadir) straight ahead along the way the light shines, and its horizontal angles run round that axis, laid out from
`emitterAxis`, the light's own up, which is also the axis of its tube where it has an `emitterLength`. A light that names a profile
therefore needs both a `direction` and an `emitterAxis`, and the axis may not be parallel to the direction
(`INVALID_SCENE_LIGHT`); a sun or a rect refuses the profile's fields. The profiles are held in one atlas (`world.lightProfile`, below)
of at most `lightProfileAtlasMaxProfiles` (32) of them at once; a light whose profile is not among them, or not loaded yet, lights as a
lamp with none. A scene with no profiled light compiles no profile code and binds no
atlas. The translucent surfaces do not read the profile: they are lit as by a lamp with none.

```js
world.addLight({
  id: 'downlight',
  kind: 'spot',
  position: [0, 3, 0],
  direction: [0, -1, 0],
  emitterAxis: [1, 0, 0], // the light's own up: the profile's horizontal angles are laid round the direction from it
  iesProfile: 'downlight.ies', // a profile the compiler wrote from the file
  useIesBrightness: true, // the intensity is the profile's greatest candela...
  iesBrightnessScale: 0.5, // ...times 0.5
})
```

`world.lightProfile` holds the settings of the profiles' atlas, each an option of `createWorld` too, with the reference's default:
`lightProfileAtlasResolution` (`256`, from 16 to 4096: the texels a side of a slice; a profile of another side is resampled to it, bilinear,
when it is written) and `lightProfileAtlasMaxProfiles` (`32`, from 1 to 32: the most profiles the atlas holds). The atlas is made with
the slices the lights ask (one per distinct profile, up to that most) and no more, made again, with every profile written into it
again, when more are asked than it was made with or a setting moves, and handed back when no light names a profile any more. An
agent sets them through `trillion3d_set_light_profile`.

```js
world.lightProfile = { lightProfileAtlasResolution: 128 } // lighter slices, a softer profile
world.lightProfile = { lightProfileAtlasMaxProfiles: 8 } // at most 8 profiles; a ninth lights as a lamp with none
```

### Rectangle lights' pictures

A `rect` light may name a picture mapped on its face, which its colour is multiplied by wherever it lights (a window, a screen, a gobo):
`sourceTexture` (the id the picture was registered under), `sourceTextureScale` (`[1, 1]`, each from above 0 to 1: the share of the picture
shown) and `sourceTextureOffset` (`[0, 0]`, each from 0 to 1: where the share starts). Seen from the front of the light, the picture runs left
to right along `right` and its top edge lies toward `cross(direction, right)`. Any other kind refuses the three fields; a scale or an offset
without a `sourceTexture` is refused (`INVALID_SCENE_LIGHT`). The host registers the picture, an `ImageBitmap` or any image the engine can copy
to a texture, with `world.setRectLightTexture(id, image)` (`null` forgets it; a light whose picture is not registered lights as a plain
rectangle) and says it changed in place with `world.refreshRectLightTexture(id)`. The pictures of all the lights are kept in one square
atlas, a slot each (a picture named by several lights, with the same share, is one slot), packed without overlap with the holes of the
freed slots reused first, with a chain of mip levels the lighting reads by the solid angle the rectangle covers. The diffuse light, the
specular lobe (also under a clear coat, a cloth's fuzz or a subsurface profile), the thin surfaces' transmission, the cards of the surface cache and
the sampled lighting read the picture; the volumetric fog tints the light of the rectangle by it while `volumetricFogRectLightTexture` (`false` by
default, a setting of the volumetric fog, `world.volumetricFog…`) is on: each cell reads the picture along the mean direction of the rectangle's light
(the direction of its form factor with no normal), at the level the solid angle it covers asks; the translucent surfaces' forward programs (the blends) read it where the device grants 17 sampled textures a shader stage, which the session
asks of an adapter that offers them; on an adapter that stops at 16 they light the rectangle plain (declared fallback: the widest blend program, with
display layers, already binds the sixteen guaranteed); the
translucency lighting volume lights the rectangle plain, and the reflections' and the bounce's rays take the light of the surface cache, which holds the picture.

`world.rectLightAtlas` holds the settings of the atlas, each an option of `createWorld` too, with the reference's default:
`rectLightAtlasMaxResolution` (`4096`, from 64 to 16384: the most texels a side; past it the pictures are packed a mip level smaller until they
fit), `rectLightAtlasFilterQuality` (`0` a box of 2 by 2 texels, `1` a Gaussian approximation), `rectLightAtlasMaxTextureRatio` (`2`, from 1 to 16:
the most a picture may be wider than high, or higher than wide, before its short side is stretched), `rectLightAtlasFormat` (`0` 11, 11 and 10 bits,
faster, the hue may shift, kept as 16-bit floats on a device that cannot draw into it; `1` four 16-bit floats),
`sampledLightsTexturedRectLights` (`true`), and the switches `rectLightAtlasForceUpdate`,
`rectLightAtlasResetOnChange`, `rectLightAtlasClear`, `rectLightAtlasDebugClear` (magenta in a new atlas), `rectLightAtlasDebug` and
`rectLightAtlasDebugMipLevel` (the debug view, below), all off or 0.

```js
world.setRectLightTexture('window', await createImageBitmap(blob))
world.addLight({
  id: 'window-light',
  kind: 'rect',
  position: [0, 2.5, 0],
  direction: [0, -1, 0],
  right: [1, 0, 0],
  size: [2, 1],
  range: 12,
  intensity: 8,
  sourceTexture: 'window', // the picture registered above
  sourceTextureScale: [0.5, 1], // the left half of it
  sourceTextureOffset: [0, 0],
})
world.rectLightAtlas = { rectLightAtlasMaxResolution: 2048, rectLightAtlasFilterQuality: 1 }
world.rectLightAtlas = { rectLightAtlasDebug: true } // draws the atlas over the image
world.volumetricFogRectLightTexture = true // the fog's cells tint a rectangle's light by its picture
```


`transmission` (default `false`) makes a light shine through the subsurface-profile surfaces it shadows (their
transmission: the light that crosses the thickness behind the lit side, ears, fingers, wax). It acts on a light
that is `movable` and casts a shadow, and on no other: a stationary or static light has its shadow baked or held
still, without the thickness the transmission needs. A saved world keeps a `transmission` that is on.

```js
const lamp = light.point({
  intensity: 20,
  position: [0, 3, 0],
  distance: 12,
  castShadow: true,
  mobility: 'movable',
})
lamp.transmission = true // the profile surfaces it shadows glow where its light goes through them
```

The same in the declared form: `world.addLight({ id: 'lamp', kind: 'point', ..., mobility: 'movable', castsShadow: true, transmission: true })`;
a `transmission` that is not a boolean is refused (`INVALID_SCENE_LIGHT`).

Every light has a `mobility`: `'static'` (meant to be baked into the lightmaps: it neither moves nor changes
and casts no dynamic shadow), `'stationary'` (it does not move, its colour and intensity may change; **the
default of every light kind**) or `'movable'` (fully dynamic). Any other value is refused
(`INVALID_SCENE_LIGHT`); a saved world keeps a mobility other than the default. The volumetric lightmap
reads it to know which directional light's shadowing it holds (`mobilityOf(light)`, `scene/light/fields.ts`).

```js
const lamp = light.point({ intensity: 20, position: [0, 3, 0], distance: 12 })
lamp.mobility = 'movable' // 'static' | 'stationary' (the default) | 'movable'
world.addLight({
  id: 'lamp2',
  kind: 'point',
  color: [1, 1, 1],
  intensity: 20,
  castsShadow: false,
  position: [0, 3, 0],
  range: 12,
  mobility: 'static',
})
```

A rectangle light casts a shadow like a point light: one cube of six faces centred on it, as far as
its `range`. A surface behind the rectangle's plane is outside its shadow region (a surface exactly
in the plane is in front: the rectangle lights it), and a surface turned away from it is not
shadowed by it. Its penumbra is traced toward its centre through a cone whose radius is half its
width; `shadowRayCountLocal` and `shadowSamplesPerRayLocal` set its rays and steps, as for any local
light. The two forms of a light below are the same panel, 2 m by 1 m, three metres up, facing down, its
shadow as deep as 12 metres (the node form's `distance` is the `range` of the declared one):

```js
const panel = light.rectArea({
  width: 2,
  height: 1,
  intensity: 30,
  position: [0, 3, 0],
  distance: 12,
  castShadow: true,
})
panel.rotation.x = -Math.PI / 2 // a node's face looks down its −z: turned to look down −y
panel.shadowsFog = true // its shadow map also shadows the fog volume
world.addLight({
  id: 'panel',
  kind: 'rect',
  position: [0, 3, 0],
  range: 12,
  direction: [0, -1, 0],
  right: [1, 0, 0],
  size: [2, 1],
  color: [1, 1, 1],
  intensity: 30,
  castsShadow: true,
  shadowsFog: true,
})
```

`shadowResolutionScale` (`1`, a number of 0 or more; a point, a spot or a rect; refused on a sun) is the factor on the
resolution the light's shadow is given. It decides whether the light takes a shadow and how it fades with its size
on the screen (see [Local lights' shadow gates](SHADOWS.md#local-lights-shadow-gates-and-distant-lights)): `0` takes the
shadow away, a number above 1 keeps a far light's shadow longer, one below 1 lets it go sooner. A saved scene keeps it
when it is not 1.

```js
const lamp = light.point({ intensity: 20, position: [0, 3, 0], distance: 12, castShadow: true })
lamp.shadowResolutionScale = 2 // keeps its shadow farther than a lamp left at 1
world.addLight({
  id: 'far',
  kind: 'point',
  position: [0, 3, 90],
  range: 12,
  color: [1, 1, 1],
  intensity: 20,
  castsShadow: true,
  shadowResolutionScale: 0.5,
})
```

Of the directional lights of a scene, one is the forward light: the one the volumetric fog is lit by
and the one the clouds' shade on translucent surfaces follows
([ENGINE.md](ENGINE.md#transparent-surfaces)). It is the light of the highest `forwardShadingPriority`
(a whole number of at least `0`, `0` by default); of equal priorities, the one whose colour times
intensity is greatest, the first added of equals. A priority that is not a whole number of at least
`0` is refused (`INVALID_SCENE_LIGHT`), and so is one on a light that is not directional. A saved
world keeps it, and the sun part of the sky takes it as a field.

```js
const sun = light.directional({ intensity: 10, position: [-50, 70, 0] })
const lamp = light.directional({ intensity: 30, position: [20, 40, 0] }) // brighter: the fog follows it
world.scene.add(sun, lamp)
sun.forwardShadingPriority = 1 // the sun now, whatever the lamp's brightness; a write reaches the world at once
world.scene.sky = { clouds: true, sun: { forwardShadingPriority: 1 } } // the sky's own sun, the same field
```

No bound on the light count: a 16×16 screen tile lists up to 64 lights reaching it, past that
exactly those reaching it. Past 64 shadow
slices a caster lights without a shadow (`shadowCastersUnsliced`). The shadow pool and its metrics:
[SHADOWS.md](SHADOWS.md#memory).

### Light functions

A light can wear a light function: a material that gives, at each point the light reaches, a factor
on its colour, to cast the shape of a window, a leaf canopy or a moving cloud. It is a material of
the engine's one material system, made as `material.lightFunction`; the colour it gives is its
emission: `emissive` times `emissiveIntensity`, times `emissiveMap` read at the coordinate of the
light's projection across its tile (0 to 1), with the map's own wrap, filters, repeat, offset and
rotation. White, no effect, by default. It has no world position and no depth: it is drawn once,
whatever the lights that wear it, into one atlas the lighting, the volumetric fog and the
translucent layers read. The map joins the materials' colour atlas, within the texture budget, and
the slot is drawn again until the map is read at the detail the slot shows. A material made by
another member is refused (`TypeError`), and a mesh refuses a light function material (`INVALID_MATERIAL`). A [material graph](#material-graph) wired to its `emissive` output replaces the parameters.

```js
import { material, light, Texture } from 'trillion3d'

const window = material.lightFunction({ emissiveMap: new Texture(frameImage) }) // a window's panes
const lamp = light.spot({ intensity: 60, position: [0, 4, 0], distance: 20, outerConeAngle: 0.6 })
lamp.lightFunction = window // the light now shines through it
lamp.lightFunctionScale.set(4, 4, 4) // metres a tile: up, right, along the light (10.24 each by default)
lamp.lightFunctionFadeDistance = 200 // metres from the eye past which it fades (1000 by default)
lamp.lightFunctionDisabledBrightness = 0.5 // what the light is where it is faded out (0.5 by default)
window.emissive = 0xffcc66 // a warm tint, written to every light that wears it
sun.lightFunction = window // a sun projects it along its direction
rectLamp.lightFunctionConeAngle = 30 // a rectangle: through a cone of 30 degrees (0, flat, by default)
```

How a light projects it: a spot maps its cone to the tile (the edge of the cone is the edge of the
tile at any distance); a point light maps the tile around itself by longitude and latitude; a
rectangle by its face's plane, or through `lightFunctionConeAngle` (at most 89 degrees) like a spot;
a sun by its axes, the tile repeating every `lightFunctionScale`. The function fades to
`lightFunctionDisabledBrightness` over the last fifth of `lightFunctionFadeDistance` from the eye.
The declared form is `world.addLight({ id, kind, ..., lightFunction: id,
lightFunctionScale: [4, 4, 4] })`; a scale of three numbers above 0, a fade distance above 0, a
brightness of 0 or more and, for a `rect`, a cone angle of 0 or more are checked, and any of these
beside no `lightFunction` is refused (`INVALID_SCENE_LIGHT`).

`world.lightFunction` holds the settings of the atlas, each an option of `createWorld` too, with
the reference's default: `lightFunctionAtlas` (`true`, the whole system), `lightFunctionSlotResolution`
(128 texels a side of a slot, at least 32), `lightFunctionAtlasSize` (4 slots a side, from 2 to 16:
16 materials at the default; a light whose material has no slot left has none),
`lightFunctionMaxLights` (`-1`, no limit: the most lights that read the atlas, the nearest to the
eye, suns first, kept), `lightFunctionFormat` (`'grey'`, the mean of the colour; or `'colour'`), and
which passes read the atlas: `lightFunctionDeferred` (`true`, the lighting of the opaque image and
the translucency volume's injection), `lightFunctionFog` (`true`, the volumetric fog's local lights; its sun always reads it),
`lightFunctionBounce` (`true`, the lights of the bounce: the probes' rays and the screen probes' scene
traces) and `lightFunctionTranslucent` (`false`, the translucent layers).

```js
world.lightFunction = { lightFunctionAtlasSize: 8, lightFunctionSlotResolution: 256 } // 64 sharper slots
world.lightFunction = { lightFunctionTranslucent: true, lightFunctionFormat: 'colour' } // glass, coloured
world.lightFunction = { lightFunctionFog: false } // the fog's lamps shine plain; its sun keeps its function
world.lightFunction = { lightFunctionBounce: false } // the bounce lights its surfaces with plain lamps
```

The bounce reads the function at the surface a probe's ray hits: a lamp whose function dims that point
gives it less light, and one that dims it wholly casts no shadow ray there. A function that moves (a
material that reads `time`) or changes makes the probes trace again, at each image it does.

### A lamp's range is authored, and no frame shortens it

`range` is the lamp's attenuation radius in metres: influence ends there through the window
`(1 − (d/range)⁴)²`, and a `point` or `spot` shadow map is built to it. The page sets it
(`light.distance`); unset, the world derives one from the scene's extent. Every path — the world, a
source file, `addLight`, `setLight` — stores it as-is: no exposure, curve or threshold shortens it.

`capability.lighting(world)` reports what the active engine applies — `{ shadows, reason? }` —
not what the contract accepts; declared lights, the lighting view and node moves always apply at the
next frame; `reason` names in one sentence what is not applied.

### Every mesh casts a shadow unless it says `castShadow = false`

Under a casting light (the light's `castShadow: true`, `false` by default), every opaque mesh
casts (a mesh's `castShadow` defaults to `true`). `mesh.castShadow = false`, written any time,
leaves every shadow map; the mesh still receives shadows. An outline drawn as a larger copy of its
part wants it off, or it shades the part.

### One primitive out of the shadow maps: `castsShadowMaps = false`

A model's mesh of several primitives (one material each) is a group of one mesh per primitive, and
each of those meshes has its own `castsShadowMaps`, `true` by default. Set `false`, that primitive
leaves the lights' shadow maps and, while another primitive of its model casts into them, nothing
else: the distance fields, the global illumination, the contact shadows and the views still hold
it, and it still receives shadows. A model none of whose primitives casts into the maps casts
nothing at all, the distance fields' shadows included, as one mesh does: a model of one primitive
set `false` is such a model. `castShadow` gates first, whole: a mesh with `castShadow = false` casts
none whatever `castsShadowMaps` says. A translucent surface is never in the shadow maps, so the
switch is for opaque and masked primitives.

```ts
// `model` is a loaded model; the thin trim along a cornice costs pages of shadow for a shadow
// nobody reads: out of the shadow maps, still drawn and still lit, the rest of the model casting.
const trim = model.getObjectByName('Cornice_Trim')!
trim.castsShadowMaps = false

const rail = object.mesh(geometry.box(2, 0.02, 0.02)) // a mesh of your own: alone, it casts nothing
rail.castsShadowMaps = false
```

A write is told to the world like `castShadow`: the shadow cache stales the pages the primitive
was drawn in, and a row of a streamed cell takes the value of its source mesh. A clone, a model
node and a saved scene keep it (a saved scene writes it only when it is `false`).

### A sun's shadow distance and its far casters

A directional light's shadows follow the eye. A sun has a **shadow distance**: `shadowDistance`, in
metres, `400` by default, `true` the same, `false` or `0` none. The distance is the sun's own and the
view scales it (`shadowDistanceScale`). It lays the sun's shadow levels and the **edge** where its
distance-field cascade begins; it does not leave a caster out of the shadow maps. The reference's
far-shadow test reaches the subjects it gathers on the CPU, which are no cluster geometry, and every
caster the engine draws is made of clusters: the shadow maps take each of them at any distance,
whether its object casts far shadows or not; no distance-field shadow takes it in their place on the view.

`farShadowCulling` decides whether the sun has a near edge and the distance-field cascade that follows it. The
reference's far-shadow test would act on a caster that is no cluster geometry, of which the engine has none: it has
no switch for the test, nor a per-object one.

The edge lies a little past the distance: the far end of the last of the sun's near shadow levels,
with the overlap that level has into the next when another level follows. The levels are the sun's
own settings, each with the default of a directional light:

| Light option                  | Default  | Meaning                                                                                                                                                                                                                                         |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shadowCascades`              | `4`      | the near levels the distance is cut into (at most the view's `shadowNearLevels`)                                                                                                                                                                |
| `shadowCascadeExponent`       | `3`      | how many times the span of the level before each takes                                                                                                                                                                                          |
| `shadowCascadeTransition`     | `0.1`    | the share of its span a level overlaps into the next                                                                                                                                                                                            |
| `farShadowCascades`           | `0`      | far levels between the distance and `farShadowDistance`, while that is more than a metre farther: counted, never drawn (the shadow maps take every cluster caster at any distance); a light that has some ends its near levels with the overlap |
| `farShadowDistance`           | `3000` m | where those levels end                                                                                                                                                                                                                          |
| `distanceFieldShadows`        | `true`   | whether the distance-field cascade follows the near levels                                                                                                                                                                                      |
| `distanceFieldShadowDistance` | `512` m  | where that cascade ends (`true` the default, `false` none)                                                                                                                                                                                      |

The edge at the defaults is 427.0 m (400 m, near plane 0.05 m): the last level starts at 130.03 m and
overlaps 27 m into the cascade that follows; the distance itself from 512 m on.

```js
const sun = light.directional({ castShadow: true, shadowDistance: 600, shadowCascades: 3 })
sun.shadowDistance = 250 // metres, from the next frame; the light is made again, its cached pages drawn again
sun.distanceFieldShadowDistance = false // no distance-field cascade after the near levels
```

The view's settings sit beside them, each an option of `createWorld` too, resolved over the quality
preset like the raster's:

| View option                  | Default               | Meaning                                                                                                       |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `shadowDistanceScale`        | `1` (0 to 2)          | the factor on every sun's distance, so `0.5` halves it; `0` leaves the test nothing to cull                   |
| `farShadowCulling`           | `true`                | whether a sun has a near edge and the distance-field cascade that follows it                                  |
| `shadowNearLevels`           | `10` (0 to 10)        | the most near levels; `0` leaves no edge: nothing is culled                                                   |
| `shadowOverlapScale`         | `1` (0 to 2)          | the factor on the overlap                                                                                     |
| `shadowFarField`             | `true`                | whether the distance-field cascade follows the near levels, where the scene has distance fields               |
| `shadowMaxFarCascades`       | `10`                  | the most far levels a light may count (`farShadowCascades`)                                                   |
| `shadowFarDistanceOverride`  | `0`                   | metres, where far levels end for every light when above 0; no far level is drawn, so it has no visible effect |
| `distanceFieldDistanceScale` | `1` (0.0001 to 10000) | the factor on every light's distance-field distance                                                           |

A distance-field cascade needs two things besides its row: the sun's `distanceFieldShadows`, and a scene
whose meshes have distance fields (the mesh build's `distanceField`, on by default). Without fields the
edge is the distance itself (400 m).

```js
const world = createWorld('viewer', { shadowDistanceScale: 0.85, distanceFieldDistanceScale: 2 })
world.shadows = { farShadowCulling: false } // no near edge, no distance-field cascade, from the next frame
world.shadows = { farShadowCulling: null } // back to the default
```

One more setting of the view is the gate every light's shadow passes: `shadowQuality` (`5`, a whole
number from 0 to 5). At `0` no light takes a shadow, the sun's included: no shadow map, page or trace
is planned, no page pool is made (one made before is freed, its cache with it), the lit passes read no
shadow and drop their shadow code, so a scene that asks for none pays nothing for them. At `1` to `5`
every light takes the same shadow: the shadow maps have one method, so the levels above 0 differ in
nothing today. A light that declares `castsShadow` keeps the declaration: the setting takes the shadow
away, never the flag, and a scene turned back to a level above 0 draws its shadows again from a cache
of its own. The setting does not reach the indirect light's own occlusion of a light (the bounce probes
trace a ray toward each shadow-casting light, as before) nor the clouds' shadow on the sun.

```js
const world = createWorld('viewer', { shadowQuality: 0 }) // no light takes a shadow
world.shadows = { shadowQuality: 3 } // from the next frame: every light does
world.shadows = { shadowQuality: null } // back to the default, 5
world.quality.preset = 'smooth' // the first level: no shadow at all, unless the page set one
```

The quality levels (the `shadows` group) write the four that shape the distance and its edge, the shadow
maps' rows and the shadow quality, as the rules' own rows (`SHADOW_PRESET_LEVELS`,
`packages/sdk-core/src/contracts/shadowOptions.ts`):

| level       | `shadowDistanceScale` | `shadowNearLevels` | `shadowOverlapScale` | `shadowFarField` | `shadowQuality` | edge at 400 m |
| ----------- | --------------------- | ------------------ | -------------------- | ---------------- | --------------- | ------------- |
| `smooth`    | 0.6                   | 1                  | 0                    | off              | 0               | 240.0 m       |
| `balanced`  | 0.7                   | 1                  | 0.25                 | off              | 3               | 280.0 m       |
| `fine`      | 0.85                  | 4                  | 0.8                  | on               | 5               | 358.4 m       |
| `max`       | nothing (1)           | nothing (10)       | nothing (1)          | nothing (on)     | nothing (5)     | 427.0 m       |
| `cinematic` | 1                     | 10                 | 1                    | on               | 5               | 427.0 m       |

(edge at a near plane of 0.05 m.) A value the page set holds over a preset: a `smooth` preset draws no
shadow at all, and a page that sets `shadowQuality: 5` brings them back over it. A value of another
kind, or out of its range, is refused by name. A change of a light's own setting (its distance, its
cascades) makes the light again and its cached pages are drawn again; a change of the view's settings
moves the edge the next frame's test reads, and the cached pages are kept.

#### The sun's distance-field shadow

A sun's shadow maps draw every cluster at any distance, and every mesh the engine draws is made of clusters, so
the view traces no distance-field shadow of the sun: the cascade past the near levels (from their end to
`distanceFieldShadowDistance`) moves the far-shadow edge, and shadows nothing by itself. The distance fields of
the meshes shade the sun where the maps do not reach: the surface cache's cards, whose direct light traces a ray
through the meshes listed by tile across each sun. These settings act on that list and on the cascade's edge:

| View option                         | Default              | Meaning                                                                                                                                                              |
| ----------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `distanceFieldShadowing`            | `true`               | whether a sun may have a distance-field shadow cascade at all: the master switch of the feature; off, none is drawn                                                  |
| `distanceFieldShadowQuality`        | `3` (0 to 3)         | the steps of a ray: 0 none, 1 twenty, 2 thirty-two, 3 sixty-four                                                                                                     |
| `distanceFieldShadowTileSize`       | `2` m                | the side of the tiles across the light the meshes are listed in                                                                                                      |
| `distanceFieldShadowTwoSidedBias`   | `1`                  | the factor on the distance a two-sided mesh's surface is expanded by                                                                                                 |
| `distanceFieldShadowObjectsPerTile` | `128`                | the meshes a tile has room for on average; a tile past it loses meshes (its shadow flickers)                                                                         |
| `distanceFieldShadowCompactTiles`   | `true`               | the tiles' lists lie one after the other; `false`: each tile has a place of its own and a tile past it loses meshes                                                  |
| `distanceFieldShadowSnapResolution` | `2048` (at least 32) | the texels across the lists' shadow space the origin's snap grid is cut from (4 texels a step, 4 texels off each side): the tile grid moves in steps with the camera |

The lists are made before the surface cache's lighting, as long as the scene has a mesh with a distance field and
a sun casts a shadow, for the first four shadowed lights of a frame. A merged shell's field is listed exactly where
the shell is drawn: a cell shown instead of its actor, or an actor not loaded, casts nothing through it.

An object that is not to be in that scene sets **`affectDistanceFieldLighting`** (boolean, `true`), a property of every
object, saved with the world: `false` leaves it out of the distance fields altogether, so that the global field the
screen probes march and the distance-field shadows hold nothing of it, and its pixels carry no mark of having a
distance field (the screen probes' traces then treat them as thicker, `screenProbeThicknessScaleWithoutField`). An
object is in the scene only where it also casts a shadow (`castShadow`) and its mesh has a distance field.

```js
// A decal-thin sign that must not stand in the distance fields: it neither shadows nor blocks the probes' rays.
sign.affectDistanceFieldLighting = false
```

```js
const world = createWorld('viewer', {
  distanceFieldShadowQuality: 2, // 32 steps a ray
})
world.shadows = { distanceFieldShadowTileSize: 4 } // fewer, larger tiles: cheaper lists, more meshes a tile
world.shadows = { distanceFieldShadowCompactTiles: false } // each tile has a place of its own in the lists
```

An agent sets the same through `trillion3d_set_shadows`, and a light's distance and cascades
through the fields of `trillion3d_add_light` (`shadowDistance`, `shadowCascades`, `shadowCascadeExponent`,
`shadowCascadeTransition`, `farShadowCascades`, `farShadowDistance`, `distanceFieldShadows`,
`distanceFieldShadowDistance`, with `true` for
the default and `false` for none where a distance). How the far casters are left out of the maps:
[SHADOWS.md](SHADOWS.md#far-casters).

### A see-through surface casts no shadow

A blended material (`transparent: true`) lets light pass, as glass, smoke and a light beam do, and
draws nothing into the shadow maps: `material.meshStandard({ transparent: true, opacity: 0.5 })` casts
no shadow, whatever its opacity. An opaque or cutout surface behind it still casts its own.

### A see-through surface reads the sun's shadow, with one sample

A blended or transmissive surface is lit light by light in its own fragment: no mask holds it, so it
reads each light's shadow map itself. Three project switches say how. They are shadow settings
(`createWorld` options, `world.shadows`, `trillion3d_set_shadows`), read once when the session opens
(changing them later changes nothing, as for `cloudShadowOnTranslucent`), and no quality level
writes them:

- `shadowTranslucentQuality` (`0`, or `1`): at `0`, one sample of the light's map at the surface's
  point, with no ray, the cheap read every layer of a blend can pay; at `1`, the full trace the
  opaque surfaces get (rays across the light, a screen ray for contact, a dither on the share in a
  penumbra), at a high cost for every translucent pixel, and the sun's pages the trace reads are
  also marked for the nearest translucent surface the image before drew in front of each pixel.
- `shadowTranslucentLocalLights` (`false`): whether a point, spot or rectangle light's shadow reaches
  the surface. Off, a shadowed local light lights it unshadowed and the translucent programs hold
  none of the local lights' shadow code; the sun's shadow always reaches it. On, the local lights are
  read as `shadowTranslucentQuality` says.
- `translucentRectLights` (`false`): whether a rectangle light lights the surface as a rectangle.
  Off, it lights it as a point light at its centre and the translucent programs hold none of the
  rectangle shading; opaque surfaces always take the rectangle.

```js
// Glass under a lamp is shadowed by what stands between them: one sample of each light's map.
const world = createWorld('viewer', { shadowTranslucentLocalLights: true })
// And with the penumbra the opaque surfaces get, for every translucent pixel.
const fine = createWorld('viewer', {
  shadowTranslucentQuality: 1,
  shadowTranslucentLocalLights: true,
})
// A rectangle light lights glass as the rectangle it is.
const panels = createWorld('viewer', { translucentRectLights: true })
```

A material can ask more of its own, whatever the switches say, at their defaults of `false` and `0`:
`translucentDirectionalLightShadowQuality` above 0 takes the full trace for the sun's shadow on its
surfaces, `translucentLocalLightShadow` shadows the local lights on them, and
`translucentLocalLightShadowQuality` above 0 takes the full trace for those lights. A scene whose
surfaces ask nothing pays nothing: the translucent programs hold none of that code.

```js
// One pane of glass reads the sun's shadow with the full trace, the rest of the scene with one sample.
material.meshStandard({
  transparent: true,
  opacity: 0.3,
  translucentDirectionalLightShadowQuality: 1,
})
// A lantern's glass is shadowed by the lamps around it, one sample of each map.
material.meshStandard({ transparent: true, translucentLocalLightShadow: true })
// And with the full trace for those lamps.
material.meshStandard({
  transparent: true,
  translucentLocalLightShadow: true,
  translucentLocalLightShadowQuality: 1,
})
```

A light shadows a translucent surface only while it casts (`castsShadow`) and the shadows are on
(`shadowQuality` past 0). The shadows of the fog and of the air are their own reads: these switches do
not touch them. How the read is made: [SHADOWS.md](SHADOWS.md#reading-the-shadow).

### Contact shadows

A shadow map is too coarse for what stands against a surface: the lit passes add a **contact shadow**, a short ray
from each pixel toward each light through the depth of the scene, eight steps long, which darkens the pixel where
something touches it in the light's way. Each light names its own, as properties (also parameters of the light tool and
fields of a saved scene), every kind of light's:

| Light property                     | Default | Meaning                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contactShadowLength`              | `0`     | the length of the ray; `0` casts none. In screen units — a share of the screen's height at the pixel's depth — unless the next. Only a light that casts a shadow (`castShadow`) casts one, and only while the shadow quality is above 0 (below it no light has the dynamic shadow bit; the hair model's short ray stays) |
| `contactShadowLengthInWorldSpace`  | `false` | the length is in metres                                                                                                                                                                                                                                                                                                  |
| `contactShadowCastingIntensity`    | `1`     | how dark the shadow is, from 0 to 1, where the ray meets a surface that casts contact shadows (every surface but an eye's and one of an object that sets `castContactShadow = false`)                                                                                                                                    |
| `contactShadowNonCastingIntensity` | `0`     | how dark it is, from 0 to 1, where it meets one that does not                                                                                                                                                                                                                                                            |

The eye and hair shading models cast a ray whatever the light says, and whatever the view's switch says: a pixel of the
eye model half a centimetre toward every light, one of the hair model a fifth of the half height of the screen at its
depth under a light that casts no shadow. The view's settings are shadow settings, options of `createWorld` too, and
no quality level writes them:

| View option                                | Default | Meaning                                                                                                                                                                                      |
| ------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contactShadows`                           | `true`  | whether the lights cast their rays; off, the lights cast none (the eye and hair models still cast theirs, and so do the surfaces of a material with `contactShadows`)                        |
| `contactShadowOverrideLength`              | `-1`    | a length that replaces every light's own when it is 0 or more (`0` turns the lights' off); below 0, none                                                                                     |
| `contactShadowOverrideLengthInWorldSpace`  | `false` | whether that length is in metres                                                                                                                                                             |
| `contactShadowOverrideCastingIntensity`    | `-1`    | the intensity every light's shadow has at a surface that casts, when it is 0 or more (any number; the effective intensity is held to 1, above which the reference lights negatively)         |
| `contactShadowOverrideNonCastingIntensity` | `-1`    | the same at a surface that does not                                                                                                                                                          |
| `contactShadowMethod`                      | `0`     | how the lights' rays are cast: `0` the short ray every lit pixel casts, `1` the Bend screen-space shadow, a texture made before the lighting                                                 |
| `contactShadowBendSurfaceThickness`        | `0.005` | the thickness a pixel's surface is taken to have when a Bend ray meets it (share of the depth left to the far plane); method `1` only                                                        |
| `contactShadowBendMaxLights`               | `8`     | how many lights the Bend march serves in an image (1 to 16), suns first then the nearest local lights; the others cast the short ray; one texture of the image's size (4 bytes a pixel) each |
| `contactShadowIntensityMode`               | `0`     | the Bend shadow's intensity: `0` by the hit surface's `castContactShadow`, `1` by depth (fade below), `2` the casting intensity everywhere                                                   |
| `contactShadowIntensityFadeStart`          | `1600`  | the depth in centimetres where the Bend shadow begins to fade from the non-casting intensity to the casting one (mode `1`)                                                                   |
| `contactShadowIntensityFadeLength`         | `800`   | the length of that fade, in centimetres (mode `1`)                                                                                                                                           |

```js
// A lamp whose shadow holds the books down on the shelf: a ray of a fiftieth of the screen's height, on a light that casts.
const lamp = light.point({ intensity: 20, position: [0, 3, 0], distance: 12, castShadow: true })
lamp.contactShadowLength = 0.02
// A sun with its ray in metres, and a shadow half as dark.
const sun = light.directional({
  castShadow: true,
  contactShadowLength: 0.3,
  contactShadowLengthInWorldSpace: true,
  contactShadowCastingIntensity: 0.5,
})
// The view: every light's ray at four hundredths of the screen's height, then back to the lights' own; or none at all.
const world = createWorld('viewer', { contactShadowOverrideLength: 0.04 })
world.shadows = { contactShadowOverrideLength: null }
world.shadows = { contactShadows: false }
```

Two more options say what the rays meet and what they shade, one of an object and one of a material:

- **`castContactShadow`** (boolean, `true`), a property of every object, saved with the world: whether the object stops the
  rays the lights cast from the pixels around it. `false` lets them through its pixels, which then count, where a ray
  meets them, as surfaces that do not cast (`contactShadowNonCastingIntensity`); the eye model never casts, whatever
  the object says. It changes nothing of the object's own pixels.
- **`contactShadows`** (boolean, `false`), an option of a material: the lights cast contact shadows on a see-through
  surface of it that is lit with `translucencyLighting: 'forward'` (an opaque one is shadowed by the lights' own rays),
  or a transmissive one. From each of its pixels a ray of a fifth of the half height of the screen at its depth goes
  toward every light through the depth of the opaque scene, whatever the light's own length, its `castShadow` or the
  view's `contactShadows` say, with the light's casting and non-casting intensities. The translucent programs hold that
  code only for a scene that has such a material. A single-layer water casts none, a surface lit from the translucency
  lighting volume has no light to cast one toward.

```js
// A figure that does not shade its neighbours' pixels with a contact shadow, and a pane that receives them.
statue.castContactShadow = false
const glass = material.meshStandard({
  transparent: true,
  opacity: 0.3,
  translucencyLighting: 'forward',
  contactShadows: true,
})
```

A light also holds `indirectLightingIntensity` (`1`, from 0): the factor on the light it gives the scene's indirect
lighting, kept in the same record. A light that casts no shadow gives the material's occlusion to its lobes: a pixel in
a crease of an ambient-occlusion map is darker under it, as the shadow of a light that casts one already is. How the
ray is made, and how the view's settings reach the lights: [ENGINE.md](ENGINE.md#direct-lighting).

### A light that follows the exposure

A point, a spot or a rectangle light holds `inverseExposureBlend` (`0`, from 0 to 1): how much its strength is divided by the image's
exposure. At `0` the light keeps its strength whatever the exposure; at `1` it is divided by it, so it looks the same in a dark scene
as in a bright one, as a lit sign does under the automatic exposure; between, the geometric blend, the exposure to the power of minus
the number. A directional light has none (setting one is refused, `INVALID_SCENE_LIGHT`). The value is saved with the world. The
buffer keeps the light's own strength; every pass that reads it — the lights, the fog, the translucent surfaces, the surface cache —
applies the blend there, with the exposure of the view it draws, so two views at two exposures each see their own.

```js
const sign = light.point({ intensity: 800, inverseExposureBlend: 1 }) // looks as bright in the dark as in the day
sign.inverseExposureBlend = 0.5 // half-way, the next frame
```

### A light that is left out at a distance

In a perspective view a point, a spot or a rectangle light is left out of the image, its lighting and its shadow both, when it spans too
little of the screen, or lies past its own distance. Its bounding sphere has a radius `W` (metres) and lies at the distance `d` from the
view: the light is drawn while `min(0.02, lightMinScreenRadius / W) * factor * d < 1` (so a light of 1.5 m or less, or of no
size, is dropped past 50 m, a larger one past `W / 0.03`), and, when its `maxDrawDistance` (`0`, no limit, in metres) is above 0,
while `d < maxDrawDistance * lightMaxDrawDistanceScale` (a scale of 0 drops every light that names a distance). `factor` is the
view's horizontal field of view in degrees over 90 (a zoomed view keeps its lights farther away), or 1 where
`lightDrawRangeFollowsFieldOfView` is `false`. The three view settings are `lightMinScreenRadius` (`0.03`),
`lightMaxDrawDistanceScale` (`1`) and `lightDrawRangeFollowsFieldOfView` (`true`), written with the view's shadow settings (`world.shadows`, each frame). A directional light and an
orthographic view always draw. A directional light refuses `maxDrawDistance` (`INVALID_SCENE_LIGHT`). The value is saved with the world.

```js
const lamp = light.point({ intensity: 20, distance: 8, maxDrawDistance: 120 }) // gone past 120 m
lamp.maxDrawDistance = 0 // no limit again, the next frame
world.shadows = { lightMinScreenRadius: 0.06 } // small lights are dropped twice as near
```

### Lighting channels

A light lights an object only if they share a **lighting channel**. There are three, `channel0`, `channel1` and `channel2`, and
every object and every light is in channel 0 alone by default, so by default every light lights every object. Both hold
`lightingChannels`, a set of three booleans (saved with the world): a whole set is written, the set read is frozen, and a set missing a
channel, or holding anything but booleans, is refused (`RangeError` for an object, `INVALID_SCENE_LIGHT` for a light). A set with no
channel is legal: an object in none is lit by no light, a light in none lights nothing.

```js
// A lamp that lights the scenery in channel 1 alone, and a prop in channels 0 and 1 that every light reaches.
const lamp = light.point({ lightingChannels: { channel0: false, channel1: true, channel2: false } })
scenery.lightingChannels = { channel0: false, channel1: true, channel2: false }
prop.lightingChannels = { channel0: true, channel1: true, channel2: false }
lamp.lightingChannels = { channel0: true, channel1: true, channel2: false } // a write reaches the lights at once
```

The channels act on the direct light of the opaque surfaces and of the see-through surfaces lit in the forward pass
(`translucencyLighting: 'forward'`, the water, the transmissive layers); the translucency lighting volume, the fog and the indirect
light do not read them. A scene whose lights and objects are all in channel 0 compiles its lighting without the test.

### A see-through surface lit from the translucency lighting volume

A blended surface takes the light of a **volume** the engine builds round the camera each image, one read for the
pixel in place of every light (`translucencyLighting`):

- `'volumetricNonDirectional'` (the default of a material made in code): the volume's light, as a medium takes it, from
  its constant light alone, the same whatever the surface's normal: no reflection.
- `'volumetric'`: the volume's light, as a medium takes it, weighed by the surface's normal: no reflection.
- `'volume'`: the volume's light, as a surface takes it, and the reflection of the environment kept. A blended
  material imported from a scene file is given this one.
- `'forward'`: every light read for the pixel, its shadow and its highlight included. A material imported from a scene
  file that transmits (`KHR_materials_transmission`) is given this one.

In the three volume modes (a volume is built whenever a blended surface wears one of them, which is the default)
the surface gives back the volume's light on its diffuse colour (none for a metal), in a `normal` or `additive` layer of
the default lit model or the thin subsurface. The mode alone says what lights a layer, whatever its blending mode: a layer
of another blending mode (`alphaComposite`, `alphaHoldout`, `multiply`, `subtractive`), and a layer of any other shading
model (the skin, the subsurface profile, the eye, the hair), is lit by no light of its own in a volume mode: it takes
nothing of the volume and no highlight from the lights, and keeps the light the bounce and the environment give it, as
a forward surface does. Only `'forward'` reads every light. A
shadow catcher and a transmissive (refracting) surface keep their forward lighting whatever the mode. A scene none of
whose surfaces asks for a volume the volume lights makes none, nor does an image that draws no such layer: no pass runs, no texture is made and the programs hold none of its code;
a surface whose mode is changed redraws the session's blended programs, as `cloudFog` does.

#### The fog of a see-through surface: per vertex or per pixel

The fog a see-through surface is seen through is worked out for each vertex and interpolated, from the farthest layer to the
nearest: the height fog (or the distance fog) with the haze of the air behind it, the local fog volumes of the
tile the vertex lies in over them, and the clouds over those where the material has `cloudFog`. The fog's volume is
always read for the pixel and laid over it, the local fog volumes of a pixel under it. A scene none of whose see-through surfaces takes its fog per vertex (all
`computeFogPerPixel`, water or `fog: false`) compiles its programs without the vertex fog. A material with
`computeFogPerPixel: true` (`false` by default) works the whole fog out for each pixel instead: exact, and dearer, for
a large triangle or a surface near the fog's start. Single-layer water is always per pixel.

```js
material.meshStandard({ transparent: true, opacity: 0.3, computeFogPerPixel: true }) // a large pane, fogged exactly
```

```js
material.meshStandard({ transparent: true, opacity: 0.4, translucencyLighting: 'forward' }) // every light read for the pixel
material.meshStandard({ transparent: true, opacity: 0.4, translucencyLighting: 'volume' }) // a pane lit by the volume
material.meshStandard({ transparent: true, opacity: 0.2, translucencyLighting: 'volumetric' }) // smoke or a veil
material.meshStandard({
  transparent: true,
  opacity: 0.2,
  translucencyLighting: 'volumetricNonDirectional',
}) // a glow lit the same on every side
```

A double-sided see-through surface (`side: 'double'`) is drawn in one pass that culls neither face, as every
two-sided surface is. `twoSidedPasses` (boolean, `false` by default) asks two passes instead, its back faces then its front
faces, so a closed shape (a bottle, a bubble) shows its far side through its near one in the right order, for twice the
draws of the surface in the blend pass:

```js
// A bubble drawn back faces first, then front faces.
material.meshStandard({ transparent: true, opacity: 0.3, side: 'double', twoSidedPasses: true })
```

The volume is two nested cascades of cubes of cells that follow the camera: the inner one holds the view to
`translucencyVolumeInnerDistance` metres, the outer one the stretch from there to `translucencyVolumeOuterDistance`; their
centres are snapped to a whole number of cells, so that the light does not crawl as the camera moves. Each image the sun
and every local light that reaches a cascade are injected into its cells, each by its own shadow map read at the cell
(the sun with its light function, the clouds' shade and the air's tint; a local light with its fall-off and its light
function); the light is kept as a two-band spherical harmonic, so a surface reads the light's direction too. A cell whose
shadow no virtual shadow map holds a page for reads its light unshadowed. A surface past the outer cascade reads the sun
unshadowed and no local light. The cells are then blended with the image before (`translucencyVolumeTemporal`) and blurred
(`translucencyVolumeBlur`), and the surfaces read them by eight loads and a blend of the two cascades. The settings are the
reference's, each an option of `createWorld` too, held over the quality preset, changed later from the next frame
(`packages/sdk-core/src/contracts/translucencyVolumeOptions.ts`); a value a setting does not take is refused:

| Field                                    | Meaning                                                                                                                        | Default |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `translucencyVolume`                     | Whether the volume is made; off, a surface that reads it reads black                                                           | `true`  |
| `translucencyVolumeDim`                  | Cells a side of each cascade, 4 to 2048 (held to what the device's 3D textures hold)                                           | `64`    |
| `translucencyVolumeInnerDistance`        | Metres from the camera the inner cascade ends at                                                                               | `15`    |
| `translucencyVolumeOuterDistance`        | Metres from the camera the outer cascade ends at                                                                               | `50`    |
| `translucencyVolumeBlur`                 | The spatial filter: each cell is the mean of eight trilinear reads round it; it runs after the temporal blend where that is on | `true`  |
| `translucencyVolumeTemporal`             | Each cell is blended with the same point of the volume of the image before, ahead of the blur                                  | `false` |
| `translucencyVolumeHistoryWeight`        | The share of that history kept, 0 to 1                                                                                         | `0.9`   |
| `translucencyVolumePositionOffsetRadius` | Cells: the radius of a noise, different for each pixel and image, that moves the point a surface reads the volume at; 0 none   | `0`     |
| `translucencyVolumeAdaptToPerspective`   | The cascades are sized by the camera's own field of view and aspect, not a field of 45 degrees and a square view               | `false` |
| `translucencyVolumeMinFov`               | Degrees: the least field of view the cascades follow while the setting above is on                                             | `45`    |
| `translucencyVolumeFovSnap`              | Degrees: the field is rounded up to a multiple of it, which makes the volume jump in steps as the field animates               | `10`    |
| `translucencyVolumeMarkVoxels`           | Only the cells the surfaces read (8 per fetch, dilated by a cell) are marked, lit and filtered                                 | `false` |

The quality presets write the cells' count and the blur: `smooth` 24 cells and no blur, `balanced` 32 and no blur, `fine`
and `cinematic` nothing. A volume of the default size holds 16 MiB of textures (two half-float textures of the light as
injected, and the packed volume the surfaces read); with the temporal filter on it holds two more such volumes, 24 MiB
with no blur and 32 with it; the device's memory budget may refuse them, and the surfaces then read black.

```js
const world = createWorld('viewer', { translucencyVolumeDim: 32 }) // a coarser volume
world.translucencyVolume = {
  translucencyVolumeInnerDistance: 30,
  translucencyVolumeOuterDistance: 120,
} // a larger reach, from the next frame
world.translucencyVolume = {
  translucencyVolumeTemporal: true,
  translucencyVolumeHistoryWeight: 0.8,
} // blend with the image before
world.translucencyVolume = { translucencyVolumeDim: null } // given back to the preset
world.translucencyVolume = { translucencyVolumeMarkVoxels: true } // light only the cells the surfaces read
world.translucencyVolume = { translucencyVolume: false } // off: no pass, no texture, no byte
```

The explorer takes the same by field (`explorer.setTranslucencyVolume('translucencyVolumeDim', 48)`), and an agent through
`trillion3d_set_translucency_volume`.

### Translucency global illumination volume

The indirect light of the see-through surfaces (blend, water, transmission) is held in a grid fitted to the view: a cell is
`translucencyGiGridPixelSize` pixels a side across the image, and its depth slices follow a logarithm of the distance from the camera out
to `translucencyGiEndDistance`. Each image every cell traces `translucencyGiTracingResolution` squared cones (the global distance field
marched, the surface cache read at the hit, the radiance cache read for what the march leaves), the light is filtered along the three
axes, projected on two-band harmonics and blended with the volume of the image before; a surface reads it with one filtered fetch,
instead of gathering the world's probes in each fragment. The cells read the world's radiance cache, `translucencyGiRadianceCacheClipmapBias`
cascades coarser than the one covering them. The grid needs the screen probes' levels that cast probes; below them, and with the setting
off, a surface takes the sky light irradiance alone. Settings (`packages/sdk-core/src/contracts/translucencyGiOptions.ts`), distances in metres:

| Setting                                                  | Meaning                                                              | Default |
| -------------------------------------------------------- | -------------------------------------------------------------------- | ------- |
| `translucencyGi`                                         | Whether the volume is made                                           | `true`  |
| `translucencyGiTraceFromVolume`                          | The cells march the distance field before reading the cache          | `true`  |
| `translucencyGiRadianceCache`                            | The cells read the radiance cache                                    | `true`  |
| `translucencyGiRadianceCacheClipmapBias`                 | Cascades coarser than the covering one for reads and marks           | `3`     |
| `translucencyGiGridPixelSize`                            | Pixels a side of a cell                                              | `32`    |
| `translucencyGiGridDistributionLogZScale`                | Per metre, the slices' logarithm scale                               | `1`     |
| `translucencyGiGridDistributionLogZOffset`               | The logarithm's offset                                               | `1`     |
| `translucencyGiGridDistributionZScale`                   | Slices per doubling of the depth                                     | `4`     |
| `translucencyGiEndDistance`                              | Metres, the depth of the last slice                                  | `80`    |
| `translucencyGiTracingResolution`                        | Cones a cell traces along a side                                     | `3`     |
| `translucencyGiMaxRayIntensity`                          | The brightest a cone may be, in exposure units                       | `20`    |
| `translucencyGiGridCenterOffsetFromDepthBuffer`          | Cells a trace point behind the depth is held in front of it; <0 none | `0.5`   |
| `translucencyGiOffsetThresholdToAcceptDepthBufferOffset` | Cells, the nearest behind the depth a point is moved forward from    | `1`     |
| `translucencyGiSpatialFilter`                            | Filter the cones' light along the three axes                         | `true`  |
| `translucencyGiSpatialFilterSampleCount`                 | Cells either side of the filter centre                               | `3`     |
| `translucencyGiSpatialFilterStandardDeviation`           | Cells, the filter's Gaussian                                         | `5`     |
| `translucencyGiTemporalReprojection`                     | Blend with the image before, reprojected                             | `true`  |
| `translucencyGiTemporalJitter`                           | Turn the trace point and directions each image                       | `true`  |
| `translucencyGiTemporalHistoryWeight`                    | Share of the history kept                                            | `0.9`   |
| `translucencyGiTemporalMaxRayDirections`                 | Turns the directions take before they come round                     | `8`     |

```js
const world = createWorld('viewer', { translucencyGiGridPixelSize: 16 }) // finer cells
world.translucencyGi = { translucencyGiEndDistance: 150 } // a deeper grid, from the next frame
world.translucencyGi = { translucencyGiTemporalHistoryWeight: null } // given back to its default
world.translucencyGi = { translucencyGi: false } // off: no pass, no texture
```

The explorer takes the same by field (`explorer.setTranslucencyGi('translucencyGiEndDistance', 120)`), and an agent through
`trillion3d_set_translucency_gi`.

### Single-layer water

A lit surface whose material graph wires any of the four water outputs (`scatteringCoefficients`,
`absorptionCoefficients`, `phaseG`, `colorScaleBehindWater`, the first two per centimetre) is a body of water seen through
one layer. It is drawn over the opaque scene, after the lights and before every translucent layer, in the passes the
reference's single-layer water has: the scene without the water is copied (its depth as the distance along the view, its
colour), the water's depth is drawn first, then the water is shaded over the copy — its surface lit by the declared lights
as a physical surface, the base material's colour under the coverage its `opacity` output gives (1: the base material
only, 0: pure water), the volume between the surface and the scene behind it integrated analytically — and last the
reflection of the surface is added. The volume is the sun's in-scattering (a phase function of `phaseG` in the direction
the refraction bends the view to; the sun is the forward directional light) and the ambient light's, over the share of the
light the volume scatters before it absorbs it, less the Fresnel reflectance of the surface; what lies behind is read
where the surface refracts it (the surface normal bent by the index of refraction, from the surface's `specular`, or the
`refraction` output when it is wired), dimmed by the colour absorption over the depth of water and by the fall from the
scene to the water's height, and multiplied by `colorScaleBehindWater`. The reflection is the transparents' front
layer's trace — the engine's reflection of the nearest transparent surface, traced as the opaque one is — weighed on the
surface's reflectance, faded in over the first 50 cm of water above the scene, always traced for the water whatever
`reflectionFrontLayer` says (at every level that traces reflections). The water's depth becomes the scene's: fog,
particles and the transparents drawn after are hidden behind it.

```js
const g = material.graph('surface')
g.output('baseColor', g.constant(0.05, 0.08, 0.1))
g.output('opacity', g.constant(0)) // pure water; 1 shows the base material alone (foam)
g.output('scatteringCoefficients', g.constant(0.0003, 0.0004, 0.0006)) // per centimetre
g.output('absorptionCoefficients', g.constant(0.0004, 0.00015, 0.0001))
g.output('phaseG', g.constant(0.2))
g.output('colorScaleBehindWater', g.constant(1, 1, 1))
g.output('roughness', g.constant(0.05))
const water = material.meshStandard({ graph: g }) // wired to a water output: drawn as the water
```

The settings are the reference's `r.Water.SingleLayer.*`, each an option of `createWorld` too, held over the quality preset
(which writes none of them), changed later from the next frame
(`packages/sdk-core/src/contracts/singleLayerWaterOptions.ts`); a value a setting does not take is refused. Distances are
metres, where the reference's are centimetres:

| Field                                                 | Meaning                                                                                                                                                                                                                                                      | Default          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `singleLayerWater`                                    | Whether the water is drawn                                                                                                                                                                                                                                   | `true`           |
| `singleLayerWaterReflection`                          | The reflection: `'enabled'` (the front layer's trace), `'disabled'`, `'captures'` (the captures and the sky) or `'screenSpace'` (the screen march and the captures, no scene ray)                                                                            | `'enabled'`      |
| `singleLayerWaterReflectionDownsample`                | Times fewer pixels a side (1 or 2) the water's reflections are traced at                                                                                                                                                                                     | `1`              |
| `singleLayerWaterReflectionCheckerboard`              | With a downsample of 2, blocks of two pixels across and one down                                                                                                                                                                                             | `false`          |
| `singleLayerWaterReflectionReconstruction`            | A pixel rebuilds its reflection from the rays round it                                                                                                                                                                                                       | `false`          |
| `singleLayerWaterReflectionDenoising`                 | The temporal and the bilateral denoising of the water's reflections                                                                                                                                                                                          | `false`          |
| `singleLayerWaterReflectionTemporal`                  | The temporal denoising of the `'screenSpace'` technique                                                                                                                                                                                                      | `true`           |
| `singleLayerWaterUnderwaterFogWhenCameraIsAboveWater` | The height fog is also laid on the scene seen through the water, at the depth of what lies behind it, with the camera above the water                                                                                                                        | `false`          |
| `singleLayerWaterTiledComposite`                      | The reflection composite draws the 8 by 8 tiles that hold water, not the whole target                                                                                                                                                                        | `true`           |
| `singleLayerWaterTiledSceneColorCopy`                 | The scene's colour is copied for those tiles alone (with the refraction culling on and the copy not downsampled)                                                                                                                                             | `true`           |
| `singleLayerWaterWaveOps`                             | The tiles are listed with subgroup operations where the device grants them                                                                                                                                                                                   | `true`           |
| `singleLayerWaterDepthPrepass`                        | The water's depth is drawn first (the tiles and the refraction mask need it)                                                                                                                                                                                 | `true`           |
| `singleLayerWaterOptimizedClear`                      | The scene's depth is copied over the view alone, not the whole texture                                                                                                                                                                                       | `true`           |
| `singleLayerWaterVelocityOutputPass`                  | When the water writes its velocity: `'depthPrepass'` (right after its depth), `'basePass'` (with its shading) or `'none'`                                                                                                                                    | `'depthPrepass'` |
| `singleLayerWaterShadersSupportDistanceFieldShadow`   | The programs keep the sun apart from the rest of the water's light, for the sun's distance-field shadow; read when the session opens                                                                                                                         | `true`           |
| `singleLayerWaterDistanceFieldShadow`                 | The sun's light on the water is kept apart for the sun's distance-field shadow, which leaves out the meshes made of clusters (all the engine draws; the shadow maps shadow them) (needs the setting above and meshes with fields)                            | `true`           |
| `singleLayerWaterShadersSupportVsmFiltering`          | The programs hold the full trace of the sun's shadow for the water; read when the session opens                                                                                                                                                              | `false`          |
| `singleLayerWaterVsmFiltering`                        | The sun's shadow on the water is the full trace the opaque surfaces get, not one sample: the shading reads the sun unshadowed (`shadowSkipSun`) and the composite multiplies the separated sun by the trace at the water's surface (needs the setting above) | `false`          |
| `singleLayerWaterCloudShadow`                         | The clouds shade the sun that lights the water's volume                                                                                                                                                                                                      | `false`          |
| `singleLayerWaterRefractionDownsample`                | Times fewer pixels a side (1 or 2) the copy of the scene the water refracts is made at                                                                                                                                                                       | `1`              |
| `singleLayerWaterRefractionCulling`                   | Skip the refraction where it shows little (the three cullings below)                                                                                                                                                                                         | `false`          |
| `singleLayerWaterRefractionDistanceCulling`           | Metres from the camera past which the refraction is skipped; 0 none                                                                                                                                                                                          | `0`              |
| `singleLayerWaterRefractionDistanceCullingFadeRange`  | Metres over which it fades out before that distance                                                                                                                                                                                                          | `4`              |
| `singleLayerWaterRefractionFresnelCulling`            | Fresnel reflectance above which the refraction is skipped; 0 none                                                                                                                                                                                            | `0`              |
| `singleLayerWaterRefractionFresnelCullingFadeRange`   | The Fresnel range over which it fades out                                                                                                                                                                                                                    | `0.2`            |
| `singleLayerWaterRefractionDepthCulling`              | Metres of water depth below which the refraction is skipped; 0 none                                                                                                                                                                                          | `0`              |
| `singleLayerWaterRefractionDepthCullingFadeRange`     | Metres of depth over which it fades out                                                                                                                                                                                                                      | `1`              |

The water writes its velocity as the reference's water pass does: the vectors of the texels it covers become the camera's motion at
the water's depth and their visibility identifiers are cleared, so that the temporal pass and the motion blur read a surface that
moves with the camera alone. Not ported: `ForceVelocity` (deprecated, ignored by the reference itself), `MobileFallback` and
`r.ParallelSingleLayerWaterPass` (a mobile renderer and a render-thread parallelism this engine does not have). `screenSpace` is the
screen march alone — full resolution, no scene ray, no far screen trace, no reconstruction or spatial filter —, `captures` the
captures and the sky, `disabled` no reflection.

```js
const world = createWorld('viewer', { singleLayerWaterRefractionDownsample: 2 }) // a coarser copy of the scene
world.singleLayerWater = { singleLayerWaterReflection: 'captures' } // no ray: the captures and the sky, from the next frame
world.singleLayerWater = {
  singleLayerWaterRefractionCulling: true,
  singleLayerWaterRefractionDistanceCulling: 200,
}
world.singleLayerWater = { singleLayerWaterReflection: null } // given back its default
```

The explorer takes the same by field (`explorer.setSingleLayerWater('singleLayerWaterReflection', 'captures')`), and an agent
through `trillion3d_set_single_layer_water`.

### Heterogeneous volumes: voxel grids and the volumetric shadow map

`world.heterogeneousVolumeRendering` holds the settings of the heterogeneous volumes. Besides the live shading, the volumes can be
shadowed through voxel grids: a grid cut in the view's frustum and an axis-aligned one over the volumes' bounds, each a top level of
cells holding bottom-level voxels (`heterogeneousVolumesBottomLevelGridResolution`, 1 to 4, 4 by default; an indirection grid of
`heterogeneousVolumesIndirectionGridResolution`, 4, while `heterogeneousVolumesIndirectionGrid` is on). A grid of the greatest extinction
of each top-level cell (`heterogeneousVolumesMajorantGrid`, on; `heterogeneousVolumesMajorantGridMax`, off, adds the chain down to one
cell) and a bitmask of the occupied cells (`heterogeneousVolumesTopLevelBitmask`, off) speed up the tracking. The shadow of a light or of
the camera is then a list of samples a texel (`heterogeneousVolumesShadowsMaxSampleCount`, 8, kept within
`heterogeneousVolumesShadowsRelativeErrorThreshold` 0.05 and `...AbsoluteErrorThreshold` 0, compressed while
`heterogeneousVolumesShadowsUseAvsmCompression` is on). `heterogeneousVolumesShadowsPipeline` picks the way: 0, the default, shades the
volumes live; 1 builds the grids. Sparse voxels (`heterogeneousVolumesSparseVoxel`, off, with `...GenerationMipBias`, `...PerTileCulling`
and `...Refinement`) are the cells of a coarse level where a volume has density.

`heterogeneousVolumesShadowsType` picks the map the volumes' cast shadows are kept in: 1, the default, the beer map (the first and last
place with extinction of each texel and the transmittance at both); 0 the adaptive volumetric shadow map, a list of up to
`heterogeneousVolumesShadowsMaxSampleCount` samples a texel (each volume's list combined with the volumes' before it, then compressed in
two levels), read by the lit passes in place of the beer map. A resolution that would not fit the device's storage buffer is halved.
`heterogeneousVolumesHardwareRayTracing` (off), with `heterogeneousVolumesPreshading` on, makes the march visit only the spans of the
sparse voxels a ray meets: the voxels (`...SparseVoxelGenerationMipBias`, `...SparseVoxelRefinement`) are cut out of the baked extinction,
a hierarchy of boxes is built over them and each pixel's ray walks it, front to back, by a compute pass.

```js
world.heterogeneousVolumeRendering = {
  heterogeneousVolumesShadows: true,
  heterogeneousVolumesShadowsType: 0, // adaptive volumetric shadow map
  heterogeneousVolumesPreshading: true,
  heterogeneousVolumesHardwareRayTracing: true, // march only the voxels the ray meets
  heterogeneousVolumesSparseVoxelRefinement: true,
}
```

```js
world.heterogeneousVolumeRendering = {
  heterogeneousVolumesShadows: true,
  heterogeneousVolumesShadowsPipeline: 1,
  heterogeneousVolumesFrustumGridShadingRate: 2, // voxels two pixels wide in the view
  heterogeneousVolumesMinimumVoxelSizeInFrustum: 0.05, // metres
  heterogeneousVolumesShadowsMaxSampleCount: 16,
}
```

With `heterogeneousVolumesShadowsPipeline` at 1 the grids are built in the shadows phase of every image, whether or not the volumes cast shadows. The volumes are
rasterized into them: each top-level cell a volume's box meets gets the voxel its distance and `heterogeneousVolumesShadowsShadingRate` (1 pixel in the view,
`...ShadowsOutOfFrustumShadingRate` 2 out of it) ask, its bottom level and indirection cells are taken from pools sized by
`heterogeneousVolumesOrthoGridMaxBottomLevelMemoryInMegabytes` (128, `...FrustumGridMaxBottomLevelMemoryInMegabytes` 128 for the frustum grid, which the shadows
do not build), and the volume's material is evaluated at the voxels. A region of a bottom level whose extinction hardly varies (a relative error under
`heterogeneousVolumesBottomLevelGridHomogeneousAggregationThreshold`, 0.001, and under four empty voxels) is stored as one voxel while
`heterogeneousVolumesBottomLevelGridHomogeneousAggregation` is on, the default. A pool that is full leaves the cells that would not fit empty; a bottom level
of three voxels a side takes two, which the Morton order the cells are found by needs. `heterogeneousVolumesShadowsLightDirectional`, `...Point`, `...Spot`
and `...Rect`, all on, say which kinds of light cast a volumetric shadow. The map of each light is rendered through the grids, a list of samples a
texel along the rays of the light's beer map, and kept as that map, or as the adaptive one with `heterogeneousVolumesShadowsType` 0.

`heterogeneousVolumesDebug` (0, off) replaces the image of the volumes by the transmittance through the grids, the opacity left in the alpha and, in the
colour, what the way of finding it gathers: 1 walks the ortho grid and the frustum grid cell by cell; 2 to 5 follow the ray by samples (steps of a voxel, the majorant of the
cell under each step, the greatest majorant of the grid, the cells of the majorant grid in turn); 6 to 9 track it with random walks (spectral weighted delta, ratio, spectral ratio,
the cells of the majorant grid in turn, each by delta tracking), one walk a pixel, so the image is noisy and the temporal pass accumulates it. The views `world.diagnostic.mode`
takes, `'heterogeneous-volumes-dda-marching'`, `'...-sample-marching'`, `'...-sample-majorant'`, `'...-sample-max-majorant'`, `'...-sample-majorant-dda'`,
`'...-delta-tracking'`, `'...-ratio-tracking'`, `'...-spectral-ratio-tracking'` and `'...-tracking-majorant-dda'`, are the modes 1 to 9.

```js
// The shadows traced through the grids, and the grids seen by the walk of a ray through the majorant grid, cell by cell.
world.heterogeneousVolumeRendering = {
  heterogeneousVolumesShadows: true,
  heterogeneousVolumesShadowsPipeline: 1,
  heterogeneousVolumesOrthoGridMaxBottomLevelMemoryInMegabytes: 256,
  heterogeneousVolumesShadowsLightPoint: false, // only the sun casts a volumetric shadow
  heterogeneousVolumesBottomLevelGridHomogeneousAggregationThreshold: 0.01,
}
world.diagnostic.mode = 'heterogeneous-volumes-sample-majorant-dda'
```

### The scattering of the light under a surface (subsurface profile)

A surface whose material graph picks the subsurface-profile shading model (`shadingModel: 'subsurfaceProfile'`, or a graph's output 5 under `fromMaterialExpression`) lights as a plain one, then the
engine spreads its diffuse light over the neighbouring pixels of the lit image by the profile's scattering, and multiplies the
result by the surface's colour: skin, wax, marble. The light is spread in the image, after the lights, the indirect light and the
reflections and before the sky, the fog and the transparents; the specular light is not. A profile is a subsurface
profile asset (`SubsurfaceProfile`: the colour and mean free path the light travels, the world unit scale, the boundary colour
bleed, the dual specular and the transmission); a pixel keeps its profile's number in the table of profiles the engine holds (`setSubsurfaceProfiles`), the default
skin being profile 0; the material parameter that names a profile is `subsurfaceProfile` (below). By default a profile is scattered by importance sampling, a few
samples a pixel chosen for the pixel's variance and drawn from the profile's own distribution; a profile of `implementation:
'separable'` is scattered by two separable passes. Each setting has the default of the reference's fourth quality level.

The profile of a material is its `subsurfaceProfile` parameter: any of the fields of the reference's subsurface profile asset, the others being
the default skin's (`scatterRadius` 1.2, `subsurfaceColor`, `falloffColor`, `boundaryColorBleed`, `extinctionScale`, `scatteringDistribution` 0.93,
`normalScale` 0.08, `ior` 1.55, `roughness0` 0.75, `roughness1` 1.3, `lobeMix` 0.85, `surfaceAlbedo`, `meanFreePathColor`, `meanFreePathDistance`,
`worldUnitScale`, `transmissionTintColor`, `tint`, `distanceScale`, `burley`, `meanFreePath` and `implementation`). A material that names none is
scattered by the default skin; two that name the same profile share it (at most 255 profiles).

```js
// Skin: a profile of its own, scattered by the pass, with no graph. `subsurfaceOpacity` (above 0.1) is the share of the profile's
// radius the pixel scatters over.
const skin = material.meshPhysical({
  color: 0xcc8c73,
  roughness: 0.45,
  shadingModel: 'subsurfaceProfile',
  subsurfaceProfile: { scatterRadius: 1.2, lobeMix: 0.85, roughness0: 0.75, roughness1: 1.3 },
  subsurfaceOpacity: 1,
})
// A graph decides each pixel's model only under `shadingModel: 'fromMaterialExpression'`.
```

**The shading model of a material** (`shadingModel`, the reference's own names: `defaultLit` the default, `unlit`, `subsurface`,
`preintegratedSkin`, `clearCoat`, `subsurfaceProfile`, `twoSidedFoliage`, `hair`, `cloth`, `eye`, `singleLayerWater`,
`thinTranslucent`, and `fromMaterialExpression`, the model the `shadingModel` output of the material's graph gives each pixel; under any
other name the graph's output is ignored, as the reference ignores it). With no graph, as material parameters: `unlit` shows `emissive`
(times `emissiveIntensity`, and its map) alone; `preintegratedSkin` is lit by `subsurfaceColor` and `subsurfaceOpacity`; `subsurfaceProfile` by
`subsurfaceProfile` and `subsurfaceOpacity`; `eye` by `irisMask` (the share that is iris, 1 by default), `irisDistance` (0.1 by default, the
caustic's concavity) and a profile, the iris looking along (0, 0, -1); `hair` by its fibre direction, the page's tangent (the surface's normal where
the mesh stores none), `metalness` as its scatter amount, and `roughness`. The clear coat and the cloth are their parameters (`clearcoat`,
`clearcoatRoughness`, `sheen`, `sheenColor`, `sheenRoughness`), the thin subsurface (`subsurface`, `twoSidedFoliage`) the `subsurfaceColor` of a
double-sided surface. `singleLayerWater` and `thinTranslucent` stay node-driven, as in the reference: their inputs are the water's and the thin
translucent's output nodes of the material's graph.

| Setting                                    | Meaning                                                                                                                   | Default |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| `subsurfaceScattering`                     | The master switch; off, such a surface is lit as a plain one                                                              | `true`  |
| `subsurfaceScale`                          | A scale on every profile's radius; 0 is off, below 1 narrower, above 1 wider                                              | `1`     |
| `subsurfaceHalfResolution`                 | Scatter at half the image's size: faster, of lower quality                                                                | `false` |
| `subsurfaceHalfResolutionSeparable`        | In half resolution, scatter every profile with the separable passes                                                       | `true`  |
| `subsurfaceRecombineQuality`               | How the lit image is rebuilt and recombined: 0 low, 1 high, -1 automatic (high); an accumulated image is always high      | `1`     |
| `subsurfaceFilter`                         | The scattered image is read with the bilinear filter (off: the nearest texel)                                             | `true`  |
| `subsurfaceSampleSet`                      | The separable passes' samples a side: 0 is 6, 1 is 9, 2 is 13                                                             | `2`     |
| `subsurfaceCheckerboard`                   | 0: the lit image's alpha holds the diffuse light's luminance; 1: a checkerboard of diffuse and specular; 2: automatic (0) | `2`     |
| `subsurfaceCheckerboardNeighborValidation` | With the checkerboard, a neighbour that is not a profile pixel adds nothing to the reconstruction                         | `false` |
| `subsurfaceBurleyQuality`                  | 0 scatters every profile with the separable passes; 1 the sampled scattering, the separable ones in half resolution       | `1`     |
| `subsurfaceBurleySamples`                  | A fixed count of samples a pixel for the sampled scattering; 0 lets the pixel's variance choose it                        | `0`     |
| `subsurfaceBurleyProfileIdCache`           | Each pixel's profile kept in a texture the passes read in place of the surfaces (a byte a pixel)                          | `true`  |
| `subsurfaceBurleyBilateralKernel`          | A sample weighs by depth alone (0) or depth and normal (1)                                                                | `1`     |
| `subsurfaceBurleyMipsMinTileCount`         | The count of tiles of sampled scattering from which the diffuse light's mip chain is made; 0 always                       | `4000`  |
| `subsurfaceSubpixelThreshold`              | The share of the scattering inside the pixel's own footprint above which a tile is not scattered                          | `1`     |
| `subsurfaceSamplingChannel`                | The channel that steers the sampled scattering: 0 the largest diffuse mean free path, 1 the largest mean free path        | `1`     |
| `subsurfaceColorTransmittanceDistance`     | The distance (0.05 to 1) at which a `subsurface` material's colour is read as the light's transmittance (its hue shift)   | `0.15`  |

The quality presets write the scale, the separable samples, the recombine's quality and the half resolution: `smooth` a scale
of 0, `balanced` 0.75, both with the lowest sample set, the low recombine and the half resolution; `fine` the scale 1, the
medium sample set, the automatic recombine and the half resolution; `cinematic` the defaults at the full resolution; `max`
writes nothing. A view pays its textures only while a resident surface may carry the model: at full resolution about 40 bytes a
pixel (the setup texture with its mips, two scattering targets, the history pair, the recombined image and the profile ids).

```js
const world = createWorld('viewer', { subsurfaceScale: 0.5 }) // a narrower scattering
world.subsurfaceScattering = { subsurfaceHalfResolution: true } // from the next frame, at half the size
world.subsurfaceScattering = { subsurfaceBurleySamples: 32 } // a fixed 32 samples a pixel
world.subsurfaceScattering = { subsurfaceColorTransmittanceDistance: 0.3 } // the `subsurface` model's hue shift, weaker
world.subsurfaceScattering = { subsurfaceScale: null } // given back to the preset
world.subsurfaceScattering = { subsurfaceScattering: false } // off: no pass, no texture, no byte
```

The explorer takes the same by field (`explorer.setSubsurfaceScattering('subsurfaceScale', 2)`), and an agent through
`trillion3d_set_subsurface_scattering`.

### The pass of the image a see-through surface is drawn in

A see-through surface is drawn apart from the scene and laid over the image once the depth of field has read it, so that
no blur reaches it (`translucencyPass: 'afterDepthOfField'`, the default). A surface that should be blurred with the
scene it lies in — a haze, a distant window — says `'beforeDepthOfField'`: it is laid onto the scene before the depth of
field. A surface that should stay as sharp as it was drawn — a hologram, a HUD element in the world — says
`'afterMotionBlur'`: it is laid over the image after the temporal anti-aliasing and the motion blur have read it, so
neither smears it (its edges are not anti-aliased by the temporal pass either). A particle pool takes the same setting in
its spec (`ParticlePoolSpec.translucencyPass`). Without a depth of field on the image the first two passes draw alike;
the third is its own pass whatever the image. The scene pays a second set of translucency targets and an image of the
display's size only while one of its surfaces or pools names `'afterMotionBlur'`.

```js
material.meshStandard({ transparent: true, opacity: 0.3, translucencyPass: 'beforeDepthOfField' }) // blurred with the scene
material.meshStandard({ transparent: true, opacity: 0.5, translucencyPass: 'afterMotionBlur' }) // never smeared by the temporal pass nor the motion blur
new ParticlePool({ capacity: 64, translucencyPass: 'afterMotionBlur' }) // a pool's, in its spec
```

### A lamp's source radius and its housing

`SceneLight.emitterRadius` (metres, positive, below `range`, point and spot only) is the radius of
the source sphere: it sets how soft the light's shadow is and how the lamp lights a surface. A
lamp's housing (a lantern glass, a shade) that must not put its own light out is a mesh with
`mesh.castShadow = false`, as any mesh. Imported lamps:
[COMPILER.md](COMPILER.md#lightsjson--the-lamps-of-the-source-file).

### A lamp's cone, fall-off and share of light

A spot light's edge is a fade, not a line. Its `innerConeAngle` is the half-angle, in radians, of the cone where the light is whole; it fades to nothing at its `outerConeAngle`, by the square of a ramp in the cosine between the two. The inner cone is `0` by default, so the light fades across the whole cone; an inner cone as wide as the outer one makes the edge sharp (the fade is a milliradian wide). The inner cone is held between 0 and 88.9 degrees, the outer one at least a milliradian past it.

```ts
light.spot({ outerConeAngle: 0.6, innerConeAngle: 0.3, distance: 20 }) // whole inside 0.3 rad, nothing at 0.6
light.spot({ outerConeAngle: 0.6, innerConeAngle: 0.6 }) // a sharp edge at 0.6 rad
```

A point or spot light falls off as the inverse square of the distance, a square centimetre longer, windowed to nothing at its `distance`: that is `inverseSquared: true`, the default. With `inverseSquared: false` it falls off by the range alone: its light is one less the square of the distance over the square of `distance`, to the power `radialExponent` (8 by default; greater is a tighter pool), and no weight by distance beyond that.

```ts
light.point({ distance: 12, inverseSquared: false }) // exponent 8
light.point({ distance: 12, inverseSquared: false, radialExponent: 2 }) // a wide soft pool
```

Every light, of any kind, takes two shares of what it gives: `diffuseShare` of its diffuse light (also its light through a thin surface and the light it gives the bounce) and `specularShare` of its specular light (the highlight), each from `0` to `1`, `1` by default. A fill light that must not make highlights is `specularShare: 0`; a light that must only make a highlight is `diffuseShare: 0`.

```ts
light.rectArea({ width: 2, height: 1, specularShare: 0 })
light.directional({ diffuseShare: 0.5, specularShare: 1 })
```

| Option           | Applies to  | Default | Meaning                                                                                |
| ---------------- | ----------- | ------- | -------------------------------------------------------------------------------------- |
| `outerConeAngle` | spot        | `44°`   | Half the outer cone's opening, in radians (44° is 0.7679): the light is nothing at it. |
| `innerConeAngle` | spot        | `0`     | Half the inner cone's opening, in radians: the light is whole inside it.               |
| `inverseSquared` | point, spot | `true`  | Falls off as the inverse square of the distance; `false` uses `radialExponent`.        |
| `radialExponent` | point, spot | `8`     | Exponent of the fall-off when `inverseSquared` is `false`; above 0.                    |
| `diffuseShare`   | every kind  | `1`     | Share of the diffuse light given, 0 to 1.                                              |
| `specularShare`  | every kind  | `1`     | Share of the specular light given, 0 to 1.                                             |

The compiler's lights (`lights.json`) and a scene file's lights take the defaults. A saved world keeps the options a light sets and nothing for the defaults; a world saved before version 5 keeps the cone it saved, its `angle` read as the outer cone and its inner cone that angle less its `penumbra` share.

### Lights imported from the source file

The compiler writes a source file's lights beside the manifest as `lights.json`
([COMPILER.md](COMPILER.md#lightsjson--the-lamps-of-the-source-file)): glTF from
`KHR_lights_punctual`, FBX through ufbx, USD from the `UsdLux` sphere, disk, rect and distant
schemas, Blender from `Lamp` blocks; OBJ declares none. Positions and directions are world space,
after instancing: a light instanced by three nodes is three entries.

**Units.** glTF's values (candela for `point` and `spot`, lux for `directional`) are the engine's
`intensity` as they stand: no luminous efficacy divides them, no hidden gain, and the exposure maps
the number to the picture. FBX's `Intensity`, a percentage, converts at **1000 lm / 4π ≈ 79.6 cd** for a point or
spot and **10 000 lux** for a directional. A `point` or `spot` without `range` gets
an unbounded one (1e20 m, as glTF defines it: the light reaches every cell of the light grid); a declared `range` is kept
as written, with no ceiling. A spot keeps the `innerConeAngle` and `outerConeAngle` the
file writes (glTF's defaults, 0 and π/4, where it names none), and a point or spot names its unit,
`candelas`. A light breaking
the contract is counted in `rejected` and left out.

A light casts when the file says so (glTF says nothing, so imported glTF lights cast). Every light
is read as `(await scene.load(url)).lights` in cache order (`imported-lights` counts them), each a
child of the model, changed like any light. A cache without `lights.json` has none.

## Memory budgets

What a host sets and reads; the pools' mechanics are [RESIDENCY.md](RESIDENCY.md).

| Setting                     | Default                      | What it is                                                                                                                                                   |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `world.budget.gpu`          | 2 007 MiB                    | every GPU pool together, divided by `world.budget.split`                                                                                                     |
| `world.budget.cpu`          | the page cache's own default | what the world keeps in CPU memory                                                                                                                           |
| `world.budget.geometryPool` | 512 MiB                      | slots of a 128 KiB streaming page each, the root pages held beside them in the root region; clamped to `geometryPoolCeiling`; the call a memory slider makes |
| `world.budget.texturePool`  | 512 MiB                      | virtual-texture tiles, every texture's tail always resident; clamped to `texturePoolCeiling`; the room the pool grows into, never bytes taken up front       |
| `world.budget.canvas`       | 3840 × 2160                  | the largest drawing buffer, `{ width, height }`, the effect targets are reserved at                                                                          |
| `world.budget.physics`      | `DEFAULT_PHYSICS_BUDGET`     | [PHYSICS.md](PHYSICS.md#budgets)                                                                                                                             |

- **GPU split.** The shadow pool, bounce probes and effect targets are reserved first (at
  their live descriptor bytes), then the geometry and texture pools up to their ceilings; root
  coverage and texture tails are mandatory, and admission never changes resolution or raises the
  declared total.
- **GPU total.** Unset, it only divides the pools — it grows with what the session holds, so the
  pools keep their defaults — and refuses nothing: the passes make their targets in the middle of a
  frame, and no allocation is ever refused for it. Set, it is also the ceiling on what the world
  allocates (`GPU_BUDGET_EXCEEDED` below).
- **CPU split.** The decoded-page cache takes the whole CPU total (`split.pageCache`): manifest
  tables, transfer queue and cut tables (sized by the view and the pool, never the world) are
  reserved off it, and its entries — pages, decoded baked texture levels and files read whole —
  share the rest under one budget. A change applies
  at once, entries leaving by last use, never one a frame keeps.
- **Live textures.** A video or a canvas redrawn every frame takes its working texture,
  `textureLiveBytes`, from the texture pool; the recorded budget stays the declared one.
- **Canvas.** Declared larger, it grows the default total, or takes room from the pools under a
  page-set total. A canvas drawn past it is never shrunk; the diagnostics say `effect targets over
budget` with the bytes past the reserve.
- **Pools.** A read gives what the engine holds; a write is clamped to `geometryPoolCeiling` /
  `texturePoolCeiling` and to what `gpu` leaves beside the shadows and the other pool, never under
  the floors (the root cover, the texture tails). On WebGPU `geometryAllocationBytes` counts the
  slots and the vertex buffers beside them. Two writes before the next frame settle in one
  rebalance, the image complete throughout; a budget set during prepare is the later word, its
  report (`durationMs`) waiting for prepare. The texture pool's floor, `minimum`, holds every tail
  (one tile per texture, 900 a layer) plus one tile to stream into, a layer more when the tails
  fill whole layers; a shrink never displaces a tail. The pool is made at that floor and grows where
  a lane runs out of places — its arriving tiles find none —, one layer at a time within the
  budget (`texture-pool-grown`), so `texturePoolBytes` is what is held, not the budget; a growth
  the device refuses keeps the pool and is asked again after a wait.

The low-level `createGpuPageCache` pins in tiers: `cache.pin(key, 'held')` for the root cover,
`cache.pin(key)` for ordinary pins; `cache.resize(slots)` keeps held pages, then pinned, then
unpinned, newest first in each; `cache.load(key, signal, 'held')` pins a page as it arrives;
repinning never lowers a held page; `cache.unpin(key)` releases both. Its `units` option names each
key's streaming page and offset there (`{ unit, offset }`): a slot of `pageBytes` holds one
streaming page, its pages packed at their offsets, a victim's slot given up with every page of it;
a key it names none of is a streaming page alone. Its `roots` option (`{ slots, bytes }`, counted
in `slots`) lays a root region behind the streaming slots: the streaming pages of the `rootUrls`
keys — the root pages — take its grains of `bytes`, never a streaming slot;
`cache.resize(slots, grown, roots)` lays it anew, the one in place kept when absent, and
`cache.rootRoom()` counts its free grains. `GeometryPool.roots` is the region the engine draws: it
opens at 2048 grains within the scene's root pages and grows as HLOD cells hold theirs.

**Coarser, never refused.** What a view asks beyond a pool is drawn coarser, by
the nearest resident ancestor or a texture tile's coarser level: `coverageBudgetLimited` and
`geometryPoolSaturated` say so. A value that cannot be held as given is brought to what can,
`geometryPoolClamp` / `texturePoolClamp` naming why (`root-cover`, `scene`, `page-cap`, `minimum`,
`device-limit`, `ceiling`, or `null`). Only this is refused, by name:

| Code                                                                                                      | When                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_GPU_BUDGET`, `INVALID_CPU_BUDGET`, `INVALID_GEOMETRY_POOL_BUDGET`, `INVALID_TEXTURE_POOL_BUDGET` | a value that is not a whole number of bytes above zero                                                                                                                                                                     |
| `INVALID_BUDGET_CANVAS`                                                                                   | a declared canvas that is not a whole number of pixels above zero                                                                                                                                                          |
| `GPU_BUDGET_UNDER_MINIMUM`                                                                                | a GPU total below the root coverage and texture-tail minima                                                                                                                                                                |
| `GPU_BUDGET_UNDER_SHADOW_POOL`                                                                            | a GPU total under its fixed shadow share                                                                                                                                                                                   |
| `GEOMETRY_POOL_DEVICE_LIMIT`                                                                              | a device whose limits cannot hold even the root cover                                                                                                                                                                      |
| `TEXTURE_POOL_DEVICE_LIMIT`                                                                               | a device whose limits cannot hold the tails of one texture lane                                                                                                                                                            |
| `WEBGPU_GEOMETRY_POOL_REFUSED`, `WEBGPU_TEXTURE_POOL_REFUSED`, `WEBGPU_FRAME_TARGETS_REFUSED`             | the device refuses a floor or the frame targets ([RESIDENCY.md](RESIDENCY.md#out-of-memory))                                                                                                                               |
| `GPU_BUDGET_EXCEEDED`                                                                                     | an allocation past a GPU total the page set (or an unknown format): no new image, flush and capture reject; terminal for the session, reopened with enough budget once every session sharing the refused cache is released |
| `SURFACE_DEVICE_LIMIT`                                                                                    | a device dimension limit                                                                                                                                                                                                   |

### Out of memory is absorbed

The browser may refuse an allocation the budget allows; no exception reaches the page. A refused
pool is drawn again at half its bytes, down to its floor, the frame going on coarser; a frame
waiting on a shadow pool or frame targets is held, never drawn without its shadows. The
`gpu-out-of-memory` diagnostic names the pool, bytes asked (`requestedBytes`) and granted
(`grantedBytes`, `null` when even the floor was refused). How it is detected and answered:
[RESIDENCY.md](RESIDENCY.md#out-of-memory); the shadow pool: [SHADOWS.md](SHADOWS.md#memory).

A lost device is recovered without a reload: the session reopens on a new
device and rebuilds from the decoded-page cache, fetching nothing it still holds, the canvas keeping
its last image. Each session reopen, a recovery included, is said once as `session-reopen`:
`cause` (`device-lost` or `option`, nothing else: no change to the scene's content opens a session
again), `durationMs` (from the loss, for a lost device), `framesWithoutImage`, `keptPages`. A mesh, a material, a model with its
cells or a world the scene gains joins the running session in place, and one it loses is parked.
What the session cannot take in place — a pool or a pass the device refuses, a picture that changed size where the atlas layout is fixed — is said by name,
once, as `content-refused` (`kind: 'error'`, `what`, `reason`); the rest of the scene is drawn as it
was.

## Captures and image checks

`capture.surface(world, { width, height })` and `capture.buffer(world, { width, height })` return
pixels taken aside from the view. A deterministic image: `world.camera.set(pose)`,
`await world.awaitPages()`, `world.render()`, then `await capture.buffer(...)`. `awaitPages()`
rejects a requested URL that failed to load (a background load is retried three times at most); it
waits for pages, not an image.

A capture draws its view `cutViewCaptureDelay` images (4 by default; less than 1 reads as 1), the first
being the one that finds its cut whole, and reads the last. The temporal antialiasing the world has on
runs in the capture from that first image, accumulating them from a history of its own that the
capture's view releases with it; under 4 images the last, the one that is read, is drawn without it.
One image is drawn without it. The capture shows no motion blur. The main view's history is untouched.

```ts
world.cut = { cutViewCaptureDelay: 8 } // eight images, the antialiasing accumulating all of them
const { data } = await capture.buffer(world, { width: 3840, height: 2160 })
world.cut = { cutViewCaptureDelay: 2 } // two images, the last drawn without temporal antialiasing
world.cut = { cutViewCaptureDelay: 1 } // one image, no temporal antialiasing in the capture
```

## Migration from Three.js

No Three.js adapter ships and no public API takes or returns a Three.js object: Three.js code is
rewritten with the [families](#families); [MATHS.md](MATHS.md) names each maths function's witness
call.

## GPU deformation

Imported glTF and FBX clips are `model.animations`. `animation.createMixer(root)` binds clips to
names below `root` (a loaded model: its tracks and morph weights); `mixer.clipAction(clip)` has
`play()`, `stop()`, `seek(seconds)` (the pose now, playing or not, kept by a stopped action until a
playing one writes over it), `weight`, `timeScale` and `blendMode`;
`animation.weightsTrack(path, times, values)` holds all morph weights at each key;
`animation.skeleton(bones, inverseBindMatrices?)` without matrices uses the current bind pose.

FBX clips are evaluated by ufbx, keys and span kept, curves subdivided to a chord error of 2.5e-7
and Euler steps of 15 degrees at most, so whole turns survive. `IMPORT_UNSUPPORTED_ANIMATION`
refuses skins with unbound vertices or more than 65,536 joints, stepped or extrapolated curves,
intermediate shapes, layered or constrained animation, sheared world transforms, more than 36,000
distinct keys and times colliding at float32; a clip is never truncated. Skin weights stay exact
float32 source values.

```ts
const model = await world.scene.load('/character/cache/native/full/manifest.json')
const mixer = animation.createMixer(model)
const walk = mixer.clipAction(model.animations[0]).play()
walk.weight = 0.8
walk.timeScale = 1.2
// Stop at a repeatable pose, for inspection or a reference comparison.
walk.stop().seek(0.5)
world.invalidate()
```

A page-created mesh uses `mesh.skeleton = animation.skeleton(bones, inverseBindMatrices)` with
four-component `skinIndex` / `skinWeight` attributes; morph targets go in
`geometry.morphAttributes.position` (optionally `.normal`), then `mesh.updateMorphTargets()`;
`node.morphTargetInfluences` is animated by `animation.weightsTrack` or written. Each placement of a
shared geometry reads its own palette and weights.

Actions blend by `weight`; `action.blendMode = 'additive'` adds the difference from the clip's first
key. `animation.twoBoneIK(root, mid, end, target, pole?, weight?)` solves a bone chain after
sampling; `animation.windClip(bones, options?)` loops bones (`direction: [x, z]`, `angle` in
radians, `frequency` in Hz). `mesh.waves` shares the physics' waves with a water mesh
([PHYSICS.md](PHYSICS.md)).

An instanced skinned object a compile named (`objectSettings.skinnedInstance`,
[COMPILER.md](COMPILER.md#object-settings)) plays its baked clip on the GPU by itself, from the
scene's load: no mixer moves it ([ENGINE.md](ENGINE.md#animation-banks)).

The GPU deforms vertices before culling and drawing
([ENGINE.md](ENGINE.md#gpu-deformation)). `metrics.gpuDeformationMs` is the
latest measured WebGPU deformation time, `null` without a timestamp sample.

## Sampled lighting: guide filter
`sampledLightsGuideByHistoryFilter` (`true`) joins the sets of lights each 8-pixel tile saw and did not see with its four neighbours' before they guide the next image of the sampled lighting; it works only while `sampledLightsGuideByHistory` is on.

```js
// Sampled lighting where each tile guides the draw by its own lights alone.
const world = createWorld('viewer', { sampledLights: true, sampledLightsGuideByHistoryFilter: false })
```

## Hair strands: coverage mapping
`hairVisibilityCoverageMapping` (`false`) takes the share of a pixel the strands cover from their count and their mean width, mapped through a table of the coverage of that many strands of that width placed at random, instead of the product of what each strand lets through. The strands are counted in a second pass over the ribbons; the tiles with strands and the coverage of their pixels follow the mapped transmittance. It needs `hairStrands`.

```js
// Strands whose pixel coverage comes from their count and mean width.
const world = createWorld('viewer', { hairStrands: true, hairVisibilityCoverageMapping: true })
```

## Heterogeneous volumes: preshading and level of detail
`heterogeneousVolumesPreshading` (`false`) bakes a volume's material into three 3D textures (extinction, albedo, emission) before the march, which then reads the textures instead of evaluating the material at each step. `heterogeneousVolumesCLOD` (`true`) makes a volume far from the view coarser: its lighting cache, occlusion and baked grid have fewer voxels and its march steps are longer.

| Setting | Default | Meaning |
| --- | --- | --- |
| `heterogeneousVolumesPreshadingMipLevel` | `0` | level of the baked textures the march reads; the levels are filtered from the first, which the reference never does |
| `heterogeneousVolumesPreshadingPixelFormat` | `2` | `0` keeps the red channel alone, `1` to `3` the colour channels |
| `heterogeneousVolumesPreshadingCLOD` | `1` | baked grid size: `0` the volume's, `1` over the level of detail's factor, `2` the lighting cache's |
| `heterogeneousVolumesCLODBias` | `0` | above `0` coarser, below `0` sharper |
| `heterogeneousVolumesVolumeResolutionX` / `Y` / `Z` | `0` | above `0`, replaces that axis of the resolution the bake, the lighting cache and the occlusion use |
| `heterogeneousVolumesAmbientOcclusionRayCountX` / `Y` | `4` | occlusion rays a side, `1` to `8` |

```js
// Baked volumes, sharper than the default level of detail, lit at 64 voxels on every axis.
const world = createWorld('viewer', {
  heterogeneousVolumesPreshading: true,
  heterogeneousVolumesCLODBias: -1,
  heterogeneousVolumesVolumeResolutionX: 64,
  heterogeneousVolumesVolumeResolutionY: 64,
  heterogeneousVolumesVolumeResolutionZ: 64,
})
```

## Hair strands: compute raster
`hairVisibilityComputeRaster` (`false`) makes a compute raster write the samples of the strands' visibility in place of the device's rasterizer. It bins the segments of the strands into tiles of the image, then draws each tile with a group of threads. The furthest opaque depth of each tile is found first, so that a segment behind every opaque pixel of a tile is not binned into it. The other settings choose how the segments reach their pixels; each default is the reference's.

| Setting | Default | Meaning |
| --- | --- | --- |
| `hairVisibilityNaiveRaster` | `false` | draw the segments a thread a segment, the ribbons that span more than a tile shared by a group of threads, instead of binning them |
| `hairVisibilityTileCompaction` | `false` | merge the partly filled tiles the binners made in the same cell into full tiles before they are drawn |
| `hairVisibilityClassification` | `false` | sort the segments first: the small ones go to the tiles (or to the naive raster), the larger ones are drawn a thread a segment |
| `hairVisibilityComputeRasterTileSize` | `32` | side in pixels of a tile, from `8` to `32`, rounded down to a power of two |
| `hairVisibilityComputeRasterNumBinners` | `32` | workgroups that bin the segments (`1` to `256`) |
| `hairVisibilityComputeRasterNumRasterizers` | `256` | workgroups that draw the tiles (`1` to `1024`) |
| `hairVisibilityComputeRasterNumRasterizersNaive` | `256` | workgroups of the naive raster (`1` to `1024`) |
| `hairVisibilityNumClassifiers` | `32` | workgroups of the classification (`1` to `256`) |
| `hairVisibilityComputeRasterMaxTiles` | `65536` | most tiles kept, from `1024` to `262144`; a tile holds 256 segments, and a device whose storage binding holds fewer tiles takes the most it holds; segments past them are not drawn |

```js
// Strands drawn by the compute raster, its tiles compacted and its segments classified.
const world = createWorld('viewer', {
  hairStrands: true,
  hairVisibilityComputeRaster: true,
  hairVisibilityTileCompaction: true,
  hairVisibilityClassification: true,
})
```

## Hair strands: velocity
`hairVelocityType` (`'closest'`) picks the velocity a pixel of strands writes over the surface's, from the velocity of the strands' samples in that pixel: `'closest'` the nearest sample's, `'average'` their mean, `'max'` the largest. `hairVisibilityWriteVelocityCoverageThreshold` (`0`, from 0 to 1) is the share of the pixel the strands must cover to write one; at `0` every pixel with strands does. `hairVelocityThreshold` (`1`, from 0 to 512) is the velocity, in the reference's pixel unit (the screen's -1 to 1 span over twice the larger side of the image), above which any sample of a pixel marks it to be resolved at once by the temporal pass: its history restarts, the pixel is sharper and noisier and does not smear.

```js
// Strands that write the mean velocity of their samples, only where they cover half a pixel, and resolve at once from a velocity of 3.
const world = createWorld('viewer', {
  hairStrands: true,
  hairVelocityType: 'average',
  hairVisibilityWriteVelocityCoverageThreshold: 0.5,
  hairVelocityThreshold: 3,
})
```

The surfaces the strands cover wholly are in the lighting channels of those strands (the union of the channels of the pixel's samples), so a pass that reads a surface's channels finds the strands'.

## Hair strands: custom depth
`hairRenderCustomDepth` (`false`) makes the strands render custom depth: for each pixel with strands, the depth of its first sample is written into a depth target of the view (`gpu.hair.customDepth.view`), which is 0 (reverse-Z, no strand) elsewhere. `hairCustomDepthCoverageThreshold` (`0`, from 0 to 1) is the share of the pixel the strands must cover to write it; at `0` every pixel with strands does, a higher value draws a finer outline.

```js
// Strands that write their custom depth where they cover at least a quarter of a pixel.
const world = createWorld('viewer', {
  hairStrands: true,
  hairRenderCustomDepth: true,
  hairCustomDepthCoverageThreshold: 0.25,
})
```

## Hair strands: curve raster
`renderCurve` (`false`, experimental) runs the curve raster pipeline over the strands. The strands are cut into curves of at most 16 points, grouped by position into clusters of 64 curves; each image the pipeline keeps the instances and clusters that lie in the view and in front of the scene's depth (a furthest-depth pyramid of the scene), counts the visible clusters, cuts their curves into segments that it bins into tiles of 32 pixels by the depth of the scene in each tile (`renderCurveRasterNumBinners`, `32`, from 1 to 256, binners each with counts of their own), and compacts the segments of each tile into depth slices, at most 16 groups of 1024 segments, with a piece of raster work per tile. The device has no mesh shader, so only the software path exists: `renderCurveSwRaster` (`true`) runs it, and with it off nothing runs. The raster that draws the compacted segments is not there yet, so the pipeline draws nothing for now. `renderCurveRasterNumRasterizers` (`256`, from 1 to 1024) and `renderCurveRasterMinCoverage` (`0.05`, from 0 to 1, the coverage under which a raster step stops) are for that raster. Images wider than 8192 pixels skip the pipeline.

```js
// The curve raster with sixteen binners, on its software path.
const world = createWorld('viewer', {
  hairStrands: true,
  renderCurve: true,
  renderCurveSwRaster: true,
  renderCurveRasterNumBinners: 16,
})
```

## Hair strands: forward raster
`hairVisibilityComputeRasterForward` (`false`) draws the strands without a visibility buffer. Every control point of the strands in view becomes a sample that is lit once (the material and the lights of the strands run over the points, not over the pixels), then a tiled compute raster shades the segments between the points straight into the image: the segments are cut to the view, binned in tiles of 32 pixels (only the tiles in front of the opaque depth), gathered and ordered by depth, and each tile of 8 pixels takes them front to back, mixing the colours of the lit points along each segment and stopping when its pixels are covered. It takes the place of `hairVisibilityComputeRaster` when both are on, keeps no sample a pixel (`hairVisibilitySamplesPerPixel`, `hairVisibilitySortByDepth`, `hairVisibilityCoverageMapping` do not apply) and needs `hairStrands`. The strands keep the surfaces' velocity, and a point off the image is lit as the nearest pixel of the edge. Its groups are the compute raster's own settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `hairVisibilityComputeRasterNumBinners` | `32` | workgroups that bin the segments into tiles, `1` to `256` |
| `hairVisibilityComputeRasterNumRasterizers` | `256` | workgroups that shade the tiles, `1` to `1024` |
| `hairVisibilityComputeRasterMaxTiles` | `65536` | lists of 1024 segments kept, `1024` to `262144`; a device whose storage binding holds fewer takes the most it holds, and the segments past them are not drawn |

```js
// Strands drawn by the forward raster, with fewer, larger groups for a small image.
const world = createWorld('viewer', {
  hairStrands: true,
  hairVisibilityComputeRasterForward: true,
  hairVisibilityComputeRasterNumBinners: 16,
  hairVisibilityComputeRasterNumRasterizers: 128,
})
```

## Hair strands: G-buffer write
`hairWriteGBufferData` (`1`, from 0 to 3) writes the strands into the surfaces once they are laid on the image, for the passes that read the surfaces next (the reflections and the occlusion of the following image, the passes that tell hair pixels apart). `0` writes nothing; `1` a placeholder: the tangent (0, 0, 1) as the normal, no roughness and the hair shading model, no colour; `2` the mean tangent of the pixel's strand samples as the normal and their mean roughness; `3` the whole surface, the mean base colour too, and takes the opaque depth to the nearest strand's. A pixel written is of the hair shading model, which has no specular lobe, so no reflection is traced for it. The strands' specular and backlit share stay in their samples: the surfaces hold no place for them. It needs `hairStrands`.

```js
// Strands that write their normal, roughness and colour into the surfaces and their depth into the opaque depth.
const world = createWorld('viewer', { hairStrands: true, hairWriteGBufferData: 3 })
```

## Sampled lighting: debug views
The sampled lighting (`sampledLights`) and the subsurface scattering have views that draw over the image, as the other diagnostic views do. They are chosen by `world.diagnostic.mode` or by a setting, and need the effect they show to be on.

| Mode | What it shows |
| --- | --- |
| `rect-light-atlas` | over the image, the atlas of the rectangle lights' pictures drawn small at the mip level `rectLightAtlasDebugMipLevel`, a green border round each slot in use, red round the packing's horizon lines, yellow round the free rectangles, and the figures as text (the same as `rectLightAtlasDebug`) |
| `sampled-lights-overview` | the shadow caster views side by side, in tiles with rounded corners, over the image |
| `sampled-lights-shadow-casters` | the surface under each pixel in grey, with the label `Shadow Casters, Materials:0, FarField:0, HairVoxels:0` (the traces are made through the distance field, which has no scene of its own to colour) |
| `sampled-lights-shadow-caster-quality` | the same, with the label that names red a missing caster and blue a mismatching one |
| `subsurface-profiles` | in the lower right quarter, the whole image's subsurface profile of each pixel: the default skin buff, then red, green, blue, magenta, cyan and yellow, 100 dark green, 255 white, any other mid grey; the profile's number or letter in each cell of eight pixels, all faded where the scattering stays inside a pixel; the title and the list of the profiles are written at the top left |

| Setting | Default | Meaning |
| --- | --- | --- |
| `sampledLightsVisualize` | `0` | A numbered view in place of a mode: 1 the overview, 2 the shadow casters, 3 their quality, 4 and 5 the denoiser overviews (4 by 4 tiles of the views below), 6 the shading confidence, 7 the frames accumulated (red invalid, yellow the first), 8 the upsample mask (yellow: no history), 9 and 10 the diffuse and specular demodulation, 11 and 12 the deviation of each light over its mean (red a disocclusion, blue the spatial filter, violet both), 13 and 14 the history's own deviation (blue above the threshold `sampledLightsSpatialHistoryDeviation`), 15 and 16 the clamp of the history (yellow fully rejected). Each view is labelled at its foot. The setting wins over the mode. |
| `sampledLightsVisualizeShadowCasterMissingDistance` | `0.5` | Metres a traced surface may lie behind the drawn one before it is called missing |
| `sampledLightsVisualizeShadowCasterPoorDistance` | `0.25` | Metres it may lie in front before it is called mismatching |
| `sampledLightsVisualizeTileClassification` | `0` | The tiles of the classification over the image: 1 the surfaces' tiles, 2 the downsampled tiles (3 to 6 the hair strands' and the nearest layer's, drawn with their own images); each type in its colour with a count table |
| `sampledLightsDebug` | `0` | The input the debug prints speak of: 1 the surfaces, 2 the volume, 3 the translucency volume, 4 the hair strands, 5 the nearest layer |
| `sampledLightsDebugTraceStats` | `false` | With `sampledLightsDebug`, the count of rays each trace method got, written at the right of the image |
| `sampledLightsDebugCursorX`, `sampledLightsDebugCursorY` | `-1` | The pixel the prints inspect; -1 is the middle of the image |
| `subsurfaceDebugPixel` | `false` | At full resolution, the lighting of the pixel under the cursor written as a table: its lit colour, the diffuse and specular light rebuilt from it, its profile, base colour, tint and scattered light, and the colour the recombine makes |

```js
// The frames each pixel's light has accumulated, the tiles of the classification, and the subsurface pixel at the middle.
const world = createWorld('viewer', {
  sampledLights: true,
  sampledLightsVisualize: 7, // the frames accumulated
  sampledLightsVisualizeTileClassification: 1,
  sampledLightsDebug: 1,
  sampledLightsDebugTraceStats: true,
  subsurfaceDebugPixel: true,
  sampledLightsDebugCursorX: 960,
  sampledLightsDebugCursorY: 540,
})
world.diagnostic.mode = 'subsurface-profiles'
```

## Hair strands: debug views
Four diagnostic views (`world.diagnostic.mode`) draw over the image: `hair-light-bounds` the statistics of the strands (the components of the fibre, the voxelization, the atlas of the deep shadows) and the bounds the settings ask for; `hair-deep-opacity-maps` the same, and the depth and the layers of a deep shadow side by side; `hair-macro-group-screen-rect` a green frame around the pixels each macro group of strands covers, and one around all of them; `hair-voxels-density` the strands' count along the ray of each pixel through the voxels, from blue to red, and the box of each volume. The name of the view is written at the bottom. They need `hairStrands` and a scene that carries strands (the deep shadows a light that casts them, `castHairDeepShadow`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `hairCastShadowWhenOutOfViewDebug` | `false` | in every view: the view frustum in blue, the bound of each directional light in purple, the box of each groom out of view in the light's space green where it reaches the frustum and yellow where it does not, and in the world in red |
| `hairDeepShadowDebugIndex` | `0` | rank of the deep shadow `hair-deep-opacity-maps` draws; it draws nothing past the slots the atlas holds |
| `hairDeepShadowDebugScale` | `20` | divisor of the layers' values in that view |
| `hairDeepShadowDebugMacroBounds` | `false` | the box of each macro group, in the views of the bounds and of the deep shadows |
| `hairDeepShadowDebugShadowBounds` | `false` | the frustum of each deep shadow, in the same views |
| `hairVoxelDebugTraversal` | `'linear'` | `'linear'` a voxel a step, `'mip'` through the levels of the pages |
| `hairVoxelDebugDrawVoxels` | `true` | draw the strands' count |
| `hairVoxelDebugDrawPages` | `false` | draw the first page that holds voxels along the ray instead, its coordinates over 12 as the colour |
| `hairVoxelDebugForcedMip` | `-1` | from 0 to 8, the level of the pages every step reads; below 0 the step picks it |

```js
// The voxels of the strands marched through their mip levels, with the macro groups' boxes drawn on the deep shadows view.
const world = createWorld('viewer', {
  hairStrands: true,
  hairVoxelDebugTraversal: 'mip',
  hairDeepShadowDebugMacroBounds: true,
})
world.diagnostic.mode = 'hair-voxels-density'
```
