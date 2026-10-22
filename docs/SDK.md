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
`streamingNumRetries` times (3 by default, a negative value without end), the baked texture levels
for as long as the failure may pass, one request per step, after a wait of 0.5 s · 2^k (8 s at most,
never less than the server's `Retry-After`), never before; a 4xx refusal fails for good, and so does
a page past its last try, its object invalid: no page of it is asked for again. What
still fails is `RESOURCE_HTTP_ERROR` (`details.url`, `details.status`, `null`
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
| `light`             | lights                                                                                          | `light.ambient({ intensity: 0.2 })`, `light.spot({ angle: 0.4, penumbra: 0.3, distance: 30 })`                       |
| `camera`            | cameras                                                                                         | `world.camera = camera.perspective({ fov: 55, near: 0.1, far: 500 })`                                                |
| `math`              | vectors, quaternions, boxes, paths                                                              | `math.vector3(0, 1, 0)`, `math.box3().setFromObject(set)`                                                            |
| `texture`, `loader` | pictures                                                                                        | `const albedo = await loader.texture('wood.jpg')`, `albedo.wrap = wrap.repeat`                                       |
| `helper`            | the marks you work with                                                                         | `helper.grid(20, 20)`, `helper.axes(2)`                                                                              |
| `controls`          | handles that move an object with the mouse                                                      | `controls.transform(world).attach(ball)`                                                                             |
| `animation`         | clips and mixers                                                                                | `animation.createMixer(set)`, `animation.clip('bob', 2, [track])`, `mixer.play(bob)`                                 |
| `buffer`            | a geometry built by hand                                                                        | `geometry.createBuffer({ position: buffer.float32(vertices, 3), index: buffer.uint32(indices) })`                    |
| `effect`            | post-processing                                                                                 | [Canvas, camera and teardown](#canvas-camera-and-teardown)                                                           |
| constants           | `blending`, `side`, `wrap`, `filter`, `colorSpace`, `toneMapping`, one named value per constant | `steel.side = side.double`, `world.toneMapping = toneMapping.aces`                                                   |

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

In a compiled scene, moving a node or its parent updates its resident lighting proxy (the one
distant sun shadows use while bounce is off included) and restarts bounce probe convergence, with no
invalidation call. This needs a version-3 proxy cache; motion keeps proxy surfaces but cannot
restore geometry discarded while cooking ([FORMAT.md](FORMAT.md#resident-lighting-proxy)).

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
but `'off'`, for the cost of the finding in every image. A write names the settings it changes,
`null` one's default; a value of another kind is refused by name.

```js
const world = createWorld('viewer', { temporalThinGeometry: true })
world.temporal = { temporalThinGeometry: false } // back to the default, from the next frame
```

`world.softwareRaster` (option of `createWorld` too, `true` by default) rasters in compute each
cluster whose longest edge projects under `world.hardwareRasterEdgePixels` (option of `createWorld`
too, `32` by default, a finite number of pixels above zero) and whose box crosses neither clip
plane; every other cluster goes to the hardware rasterizer, and `false` hands it every one. Both are
render settings: the page's value holds over the quality preset, a write applies next frame, and a
value of another kind is refused by name.

```js
const world = createWorld('viewer', { softwareRaster: true, hardwareRasterEdgePixels: 32 })
world.softwareRaster = false // every cluster on the hardware rasterizer, from the next frame
world.hardwareRasterEdgePixels = 16 // fewer clusters on the software raster
```

`world.cut` holds the cut's settings, each an option of `createWorld` too: `cutTwoPassOcclusion`
(`true`: the main view tests what it cuts against the previous image's depth, then what that hid
against the depth it just drew), `cutOcclusionCulling`, `cutFrustumCulling` and `cutMinLodCulling`
(`true`: each test on), `cutDrawDistanceCulling` (`true`: an object that names a draw distance —
`drawDistance`, [COMPILER.md](COMPILER.md#object-settings) — is culled outside it, in the cut, in
the sun's shadows and in the rays' scene; `false`, every object is drawn at every distance),
`cutViewDistanceScale` (`1`, a finite number of at least 0: the scale every draw distance is
multiplied by; the quality levels write it, 0.4 at `smooth`, 0.6 at `balanced`, 0.8 at `fine`, 1 at
`max`), `cutLodBiasFollowsUpscale` (`true`: an upscaled image's screen error follows
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
```

`world.hiz` holds the depth pyramid's settings, each an option of `createWorld` too: `hizTrace`
(`'reference'`: the reflections' trace walks the closest opaque depth of each half-resolution texel,
mip by mip, down to the full-resolution depth, as the reference's does; `'planes'`: it reads each pixel as a plane, which keeps a hit on
a grazing surface that the centre alone passes over), `hizFoldTransparents` (`false`: the trace
layers hold the opaque depth alone; `true`, the nearest transparent surface of each pixel too, so a
ray stops at glass) and `hizTransparentTest` (`'finer'`: a transparent cluster is tested over up to
sixteen texels a side of a fine level; `'reference'`: over four texels a side of the lowest level
that holds it; the image is the same, `'finer'` rejects more clusters), `hizRelativeDepthThickness`
(`0.005`: in the `'reference'` walk, the reflections hit a surface a ray lies no further behind than
that share of the surface's depth, times the projection's depth scale; `'planes'` keeps its
thickness in pixels), `hizFullResDepth` (`true`: the screen probes' `'reference'` walk goes down to
the full-resolution depth; `false` stops at the half-resolution level, a little less exact and
cheaper; the reflections' walk always goes down) and `lightGridHizCull` (`true`: the light grid
leaves empty the cells behind the farthest depth of their column of the image, read from the pyramid
the image built; `false` lists every cell the lights reach). The cut's occlusion reads
the culling layer, which no setting changes. A write names the settings it changes, `null` one's
default; a value of another kind is refused by name.

```js
const world = createWorld('viewer', { hizTrace: 'planes' })
world.hiz = { hizTrace: null, hizFoldTransparents: true } // the default trace, glass in the pyramid
world.hiz = { hizRelativeDepthThickness: 0.01 } // thicker reflection hits
world.hiz = { hizFullResDepth: false, lightGridHizCull: false } // half-resolution probe walk, no cull
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

`world.volumetricLightmap` holds the setting of the precomputed indirect light a baked scene carries
(a `volumetric-lightmap.bin`, [FORMAT.md](FORMAT.md#volumetric-lightmapbin)), an option of
`createWorld` too: `volumetricLightmap` (`true`: the lightmap is read by the fog's static term and by
the lighting of movable objects; `false`: every read of it answers black, as in a scene without one;
it does nothing where the scene has no lightmap). The fog's static term is scaled by
the `heightFog` part's `volumetric.staticLightingScatteringIntensity` (`1`, never below `0`; `0` leaves the term
out). The fog's sky light follows the
sky light part's `mobility`: a `'static'` one lights the fog by none of its own harmonics (its light is the
lightmap's), a `'stationary'` one that casts shadows scatters multiplied by the lightmap's sky visibility (a lightmap
baked with a sky light; the compiler does not bake one yet), a `'movable'` one by the global distance field's. A write names the setting it changes, `null` its default; a value of another kind is refused
by name.

```js
const world = createWorld('viewer', { volumetricLightmap: false }) // the precomputed light off
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
`globalDistanceFieldMinMeshRadiusInVoxels` (`0.5`), and the atlas's `meshDistanceFieldMaxObjectRadius`
(`100000`), `meshDistanceFieldSurfaceBiasExpand` (`0.25`), `meshDistanceFieldBrickAtlasSize` (`128`, a power
of two, read when the atlas is made), `meshDistanceFieldBrickAtlasDepth` (`32`), `meshDistanceFieldUploadKiB`
(`8192`), `meshDistanceFieldBlockBricks` (`16`, read when the atlas is made), `meshDistanceFieldForceMips`
(`0`: follow the view; 1 to 3 loads that many mips of every mesh) and `meshDistanceFieldReverseAllocation`
(`false`). A write names the settings it changes, `null` one's default; a value of another kind is refused
by name. A scene whose meshes built no distance field is not touched.

```js
const world = createWorld('viewer', { globalDistanceFieldClipmaps: 5 }) // one more clipmap
world.globalDistanceField = {
  globalDistanceFieldViewDistance: 40000,
  meshDistanceFieldUploadKiB: 16384,
}
world.globalDistanceField = { globalDistanceFieldFastCameraMode: true } // follow a fast camera, lower quality
world.globalDistanceField = { globalDistanceFieldFastCameraMode: null } // back to the default, off
```

`world.distanceFieldOcclusion` holds the settings of the sky light's occlusion by the distance fields, an option of
`createWorld` too: how much of the sky each pixel sees, from cones traced against the global field and the meshes' own
fields ([ENGINE.md](ENGINE.md#distance-fields)), drawn when the sky light is movable and casts shadows, no screen
probes light the pixels and a mesh built a distance field. Each setting is the reference's console variable of that
name with its default; lengths are in centimetres: `distanceFieldOcclusion` (`true`), `distanceFieldOcclusionQuality`
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

`world.shading` holds the material pass's settings, each an option of `createWorld` too:
`shadeBinningMode` (`'auto'`: each material's pixels binned as its shading asks — one by one for
every material of the engine —, `'pixel'` one by one, `'quad'` by 2 × 2 quad). The image is the same
in each mode. A write names the settings it changes, `null` one's default; a value of another kind
is refused by name ([ENGINE.md](ENGINE.md#material-surfaces)).

```js
const world = createWorld('viewer', { shadeBinningMode: 'pixel' })
world.shading = { shadeBinningMode: 'quad' } // every material binned by quad, next frame
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
`exposureLuminanceMethod` (`'uniform'`, the mean of the channels; `'ntsc'`; `'workingSpace'`). They
apply where `world.exposure` is `'auto'`, from the next frame. The same object holds the
pre-exposure's two settings, which apply to a lit view whatever its exposure: `preExposure` (`true`:
every light is written to the image already multiplied by the exposure of the image before, and the
composition multiplies the image by the exposure over that number, so the picture is the same and
the half floats keep their range at any exposure; `false` writes every light as it is) and
`preExposureOverride` (`0`: above 0, the number every light is multiplied by, in place of the
exposure of the image before). It also holds the local exposure's settings, `localExposure…`, which
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

```js
const world = createWorld('viewer', { exposureBias: 0.5 })
world.exposure = 'auto' // the default: measured each frame
world.exposureSettings = { exposureSpeedUp: 8, exposureSpeedDown: 4 } // adapts faster, next frame
world.exposureSettings = { preExposure: false } // every light written as it is, the same picture
world.exposure = 1.5 // the manual multiplier, whatever the image holds
```

`world.renderScale` (option of `createWorld` too, `'auto'` by default) is the per-axis fraction of
the display drawn before temporal antialiasing rebuilds the image: `'auto'` is a dynamic
resolution, choosing between 0.5 and 1 from the GPU frame time against the frame time budget (the
display's refresh interval, or the frame cap's); without GPU timestamps it stays at 1. `{ min, max }`
bounds it, a number fixes it. A read is the last image's scale. Without temporal antialiasing the
scale is chosen the same way and the image upscaled to the display, each display pixel blending its
four nearest drawn pixels.

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
middle grey by how far the light around it is from it; contrasts and detail at `1` turn it off.

```js
const [bloom] = world.effects.passes // the bloom the world started with
bloom.intensity = 0.3 // a fainter glow; 0 turns it off, `world.effects.clear()` removes it
world.vignette = 0.2 // a lighter vignette; 0 none
world.exposureSettings = { localExposureHighlightContrast: 1, localExposureShadowContrast: 1 } // no local exposure
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
| `'character'`         | a body that walks, runs, jumps and falls       | pointer turns the head, `W`/`S`/`A`/`D`, `Shift` sprints, `Space`   |
| `'vehicle'`           | none: drives `world.controls.vehicle`          | `W` throttle, `S` brake, `A`/`D` steer, `Space` handbrake           |
| `'trackball'`         | free spin about the screen axes, roll included | drag spins, secondary drag pans, wheel zooms                        |
| `'panZoom'`           | planar view, no rotation                       | drag slides, wheel and pinch zoom, arrow keys pan                   |
| `'none'` (default)    | camera posed by the host                       | none                                                                |

All publish `object.position`, `addEventListener('change')`, `removeEventListener` and `dispose()`;
the three with a pivot add `target`, `minDistance`, `maxDistance`, `enableZoom`, `enablePan` and
`update()`, which clamps a pose the host wrote. `change` fires only when the pose moved.

**The character's body.** `'character'` moves an upright capsule with an adult's values
(`HUMAN_BODY`: 1.75 m, a 3.5 m/s jog, a 0.5 m jump, 45° slopes, 0.5 m steps, 80 kg, a 250 N push),
each a setting of `world.controls`. Its body is the physics' virtual character in its worker
([PHYSICS.md](PHYSICS.md)), so the world needs `physics: true`: it climbs steps and slopes, rides
a moving platform, pushes dynamic bodies with at most `pushStrength` newtons and is pushed back,
and the level is whatever carries `mesh.physics = 'static'`. The feet are drawn at the bodies' time.
Until the physics runs the character stands where it was put and hears no key.

The body reads one drive (`characterDrive.ts`): speed gathered over `responseTime`, lost over
`stopTime`, jumps with a coyote time and a jump buffer, and no ground speed changing faster than a
rubber sole's grip allows, `μ g` (the geometric mean of the sole's and the ground's frictions). The
physics takes at most four steps a frame (`MAX_CATCH_UP_STEPS`): a slower page shows slow motion,
never a jump.

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
3`): hierarchy, poses, each shape by the call that built it (`geometry.box(2, 1, 1)`; one changed
after, or hand-written, by its vertices), materials by parameters, bodies as `physics` declared them
(at rest), lights, background, the sky module's word (`sky`), the camera's pose; shared shapes and materials once, a loaded
model by its manifest address, `helper` marks left out. A texture, a picture environment, a shader
material or a number JSON cannot hold is refused (`SCENE_NOT_SAVABLE`). `await scene.fromJSON(json,
camera)` replaces the content (`helper` marks kept) and reloads the models; another format or
version (2 and 3 are read; 2's air, fog and sky light move into the sky module) is refused (`UNSUPPORTED_SCENE_FORMAT`) before anything is removed. Calls during a read run
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
`TEXCOORD_3`, from the compiled geometry page (four sets) or from the source geometry (two); a
geometry without that set reads the first. A transparent surface carries the first set and one
more, the first past it that one of its maps reads. The coat lies
over every light, the environment and bounced light, on an opaque surface as on a
blended or a transmissive one — whose transmitted light passes under it; a rectangle light
stretches its specular lobe along the anisotropy.

Lit materials can declare `subsurfaceColor` (black, off, by default) and an optional `subsurfaceMap`
for thin **double-sided** surfaces such as foliage: light arriving through the back, tinted.
Diffuse thin-surface transmission, not a volume: a glass volume uses physical `transmission`,
`thickness`, `attenuationColor` and `attenuationDistance`. The thickness is in the mesh's own units,
as glTF's: a placement scaled twice crosses, refracts and shadows through twice the path.

With `transparentShadow: true`, blended glass tints the shadow transmission atlas by its base color
and texture; a nonzero volume thickness applies Beer attenuation once at the entrance of a closed
mesh (a declared-thickness approximation, not ray tracing); alpha-only blended shadows are
coverage. A shadow-casting light with a source size — a point or spot `radius`, a sun's
`angularRadius` — casts penumbrae that harden at contact, traced through the shadow maps on opaque
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
package ships no rendering library (`tests/integration/installed-package.test.ts`); the bench's
witness library is a development dependency of this repository alone (`bench/witnesses/`).

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

| Output             | Type   | Default | `surface`                        | `lightFunction` | `volume`            |
| ------------------ | ------ | ------- | -------------------------------- | --------------- | ------------------- |
| `baseColor`        | float3 | 0, 0, 0 | read                             |                 | the albedo          |
| `metallic`         | float  | 0       | read                             |                 |                     |
| `specular`         | float  | 0.5     | read                             |                 |                     |
| `roughness`        | float  | 0.5     | read                             |                 |                     |
| `emissive`         | float3 | 0, 0, 0 | read                             | the colour      | the light given off |
| `opacity`          | float  | 1       | read when `transparent`          |                 |                     |
| `opacityMask`      | float  | 1       | read when `alphaTest` is above 0 |                 |                     |
| `normal`           | float3 | 0, 0, 1 | read (tangent space)             |                 |                     |
| `ambientOcclusion` | float  | 1       | read                             |                 | read                |
| `subsurfaceColor`  | float3 | 1, 1, 1 | read                             |                 | the extinction      |

An output the domain does not read is refused when it is wired (`INVALID_MATERIAL`). A light function has no world position, camera, normal or depth: it is drawn once into an atlas slot for every light and view, so `worldPosition`, `cameraPosition`, `vertexNormal` and `pixelNormal` are refused there (`INVALID_MATERIAL`, naming the node), and `objectPosition` is zero. The volume domain has no normal. `pixelNormal` cannot feed `normal`.

**Types.** A value is a float of one to four components (a texture object is a fifth kind, which only a sample reads). A scalar written as a constant fits any width. An operation between a scalar and a vector repeats the scalar; between two vectors of different widths it is an error ("arithmetic between float2 and float3 is undefined"). `min`, `max` and `clamp` make their other inputs the type of the first. Constants fold: the sum, product or sine of constants is a constant, a product by 0 or 1 and a quotient by 1 write no code, a `lerp` of equal values or at 0 or 1 is one of them, a quotient by a constant 0 stays a quotient.

**Nodes.** Where an input is not wired, a node uses its own constant (its default is in brackets).

| Group       | Calls                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constants   | `constant(x)` to `constant(x, y, z, w)`; `channel(wire, 'rgb' \| 'r' \| 'a'…)` picks an output of a node (a sample's rgb, r, g, b, a, rgba)                                                                                                                     |
| Parameters  | `scalarParameter(name, 0)`, `vectorParameter(name, [0, 0, 0, 1])`, `textureParameter(name, texture)`; `g.set(name, value)` gives them values                                                                                                                    |
| Textures    | `textureSample(texture, { uv, texture, mip, mipMode: 'none' \| 'level' \| 'bias', constCoordinate: 0, name })`, `textureObject(texture)`                                                                                                                        |
| Coordinates | `texCoord(index = 0, uTiling = 1, vTiling = 1)`, `time(period?)` (0 holds it still), `panner({ speed: [u, v], coordinate, time, fractionalPart })`, `rotator({ centerX: 0.5, centerY: 0.5, speed: 0.25, coordinate, time })`                                    |
| World       | `worldPosition(cameraRelative)`, `cameraPosition()`, `objectPosition()`, `vertexNormal()`, `pixelNormal()`, where the domain has them                                                                                                                           |
| Arithmetic  | `add(a, b)` (0, 1), `subtract` (1, 1), `multiply` (0, 1), `divide` (1, 2), `power(base, exponent = 2)`, `abs`, `min` (0, 1), `max` (0, 1), `clamp(x, min = 0, max = 1, mode)`, `saturate`, `lerp(a, b, alpha)` (0, 1, 0.5), `oneMinus`, `frac`, `floor`, `ceil` |
| Waves       | `sine(x, period = 1)`, `cosine(x, period = 1)`: `x` is in turns of `period` when it is above 0, in radians otherwise                                                                                                                                            |
| Vectors     | `dot`, `cross` (float3), `normalize`, `length`, `appendVector(a, b)` (four components at most), `componentMask(x, 'rg')`                                                                                                                                        |
| Choice      | `if(a, b, greater, equal, less, threshold = 0.00001)`: `greater` where `a >= b`, `less` below, `equal` within the threshold when wired                                                                                                                          |

A number passed where a wire goes is that node's own constant: `g.multiply(tex, 2)` and `g.lerp(a, b, 0.25)` need no constant node. A texture reads through the materials' colour atlas, with its own wrap, filters, repeat, offset and rotation; `mipMode` `'level'` reads the level in `mip` (0 is the full picture), `'bias'` adds `mip` to the level the footprint asks. A sample waits, like a map, until its texture has joined the atlas.

A graph worn by a light function is read now; one worn by a surface or a volume material compiles and is kept with it, and drives the image once the surface and the fog read it.

A graph that does not compile (a missing required input, a type error, a node the domain has no value for) raises `INVALID_MATERIAL` naming the node. A light function whose graph is refused is drawn from its parameters, as one with no graph is, and the engine names the refusal once (`light-function-graph-refused`). A light function that reads `time` is drawn again at each image; the time is the seconds since its atlas was made.

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
default), `false`, or an object naming the parts, each `true`, `false` or its settings:

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

| Part         | What it is                                                                                                  | Defaults, the level's                                                                                                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `atmosphere` | The planet's air: the sky, the haze, the sun's light tinted by it ([Atmosphere part](#atmosphere-part)).    | The component's: Earth-like.                                                                                                                                                                                                                                                                                                               |
| `sun`        | One directional light, the air's first light, with its shadows, light shafts and cloud shadow map.          | `intensity` 6 lux, `useTemperature` on at `temperatureKelvin` 6500, `angle` 0.7357° (the disk's diameter), `rotation` `[-16.2856, 43.7319, 112.3607]` (pitch, yaw, roll in degrees; the yaw turns about +y, a negative pitch shines down), `shadowDistance` 200 m, `castShadow`, `shadowsAir` and `shadowsClouds` on, `shaftOcclusion` on. |
| `skyLight`   | The sky's light on the scene, captured from the air and the clouds.                                         | `realTimeCapture` on, `mobility: 'movable'`; the other fields the component's.                                                                                                                                                                                                                                                             |
| `heightFog`  | Fog thinning out with height ([Height fog part](#height-fog-part)); its volume is its `volumetric` setting. | `baseDensity` 0.00436 per metre (0.0436 in the reference's centimetre numbers) at `baseHeight` −68.5 m; the other fields as below.                                                                                                                                                                                                         |
| `clouds`     | One layer of clouds, ray marched from the eye.                                                              | The layer's and the material's defaults; `reflectionSamplesScale` 0.1041667 and `reflectionShadowSamplesScale` 0.3.                                                                                                                                                                                                                        |

The sun's own fields are a light's (`intensity`, `color`, `useTemperature`, `temperatureKelvin`,
`angle`, `rotation`, `shadowDistance`, `castShadow`, `shadowsAir`, `shadowsFog`, `fogScattering`,
`atmosphereSunIndex`, `transmittancePerPixel`, `sunDiskTint`), its light shafts' (`shaftOcclusion`,
`shaftOcclusionDarkness`, `shaftOcclusionDepthRange`, `shaftOverrideDirection`, `shaftBloom`,
`shaftBloomScale`, `shaftBloomThreshold`, `shaftBloomMaxBrightness`, `shaftBloomTint`) and its cloud
shadow map's (`shadowsClouds`: the cloud march reads the sun's opaque shadow map, only for the air's
first light; `castCloudShadows`, `cloudShadowStrength`, `cloudShadowOnAtmosphereStrength`,
`cloudShadowOnSurfaceStrength`, `cloudShadowDepthBiasKm`, `cloudShadowExtentKm`,
`cloudShadowResolutionScale`, `cloudShadowRaySamplesScale`, `cloudScatteredLuminanceScale`). The
module's lights hang from no scene and are never saved: a directional light of the scene competes
with the sun by the air's rule (the brightest of each index is held). There is one sky light, the
part's: where a scene is made to hold more, the last shown lights it, the others give nothing.

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

The quality presets and the sky's quality settings reach the module through the effects and shadows
groups, as they reach the rest of the image:

```js
world.quality.preset = 'fine' // the effects' and shadows' level 2: fewer samples, smaller tables
world.skyQuality = { cloudShadowMap: false, lightShafts: false } // switch two passes off
world.skyQuality = { cloudShadowMap: null } // given back to the preset
```

A scene saved before the module (`formatVersion` 2) moves its `atmosphere`, its `fog` and its sky
light node into the module's parts once, when it is read; each part keeps the fields it had, the
fog the numbers it had by default and not the level's, and the sun and the clouds, which that scene
never had, are off. A scene is saved with its `sky` word (`formatVersion` 3).

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
world.scene.sky = { heightFog: false } // No fog.
```

The height fog's own fields are the reference's numbers in metres, each with its default (those of
the table, but `baseDensity` and `baseHeight`, which the level sets as above); the law
is [ENGINE.md](ENGINE.md#fog). A reference number in centimetres converts exactly: a density or
falloff is divided by 10 (they are per 1000 centimetres), a distance by 100.

| Field             | Default                                                 | Meaning (the reference's number → ours)                                                                                                                                |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color`           | black                                                   | The light the fog scatters by itself, linear RGB. With an atmosphere the sky's light is added to it.                                                                   |
| `baseDensity`     | `0.002`                                                 | Density at `baseHeight`, per metre, ≥ 0 (its `0.02` ÷ 10).                                                                                                             |
| `falloff`         | `0.02`                                                  | Per metre, ≥ 0: the density halves every `1 / falloff` metres up, 50 m (its `0.2` ÷ 10).                                                                               |
| `baseHeight`      | `0`                                                     | The height the density is `baseDensity` at, metres.                                                                                                                    |
| `maxOpacity`      | `1`                                                     | The most of a surface's light the fog may hide, in [0, 1].                                                                                                             |
| `startDistance`   | `0`                                                     | Metres from the eye where the fog starts, ≥ 0.                                                                                                                         |
| `cutoffDistance`  | `0`                                                     | Metres from the eye past which there is no fog, ≥ 0; 0 none.                                                                                                           |
| `directional`     | `{ exponent: 4, startDistance: 100, color: [0, 0, 0] }` | The sun's lobe: sharpness `exponent` > 0, metres before the sun's light is scattered (its `10 000` ÷ 100), the luminance scattered toward the sun times the sun's own. |
| `skyContribution` | `[1, 1, 1]`                                             | The factor of the atmosphere's sky radiance the fog takes on, per channel, ≥ 0.                                                                                        |

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

### Atmosphere part

The `atmosphere` part fills the sky, hazes the distance and tints the sun's light through the
air of a planet whose ground is the scene's plane `y = 0`. `true` is an Earth-like atmosphere, an
object sets any field over those defaults — planet radius and air thickness in kilometres,
scattering and absorption coefficients per kilometre, the ground's height in scene metres:

```js
world.scene.sky = { atmosphere: true } // the air alone: no sun, no clouds
world.scene.sky = {
  atmosphere: { planetRadius: 6360, height: 60, mieAnisotropy: 0.8, groundHeight: 0 },
}
world.scene.sky = { atmosphere: true, sun: { intensity: 10 }, skyLight: true } // the air, a sun, the sky's light
world.scene.sky = { atmosphere: false } // no atmosphere
```

The sun is the brightest directional light of index 0 (the second light is below), its colour times
its intensity weighed by the eye's sensitivity to each channel, held as lights are added and removed (with an atmosphere or none): a
light added replaces it only if brighter, and the sun removed gives its place to the brightest of
the others, the first added of equals; `atmosphereSun: false` leaves one out. Where it is on,
`background` is not shown, and the `skyLight` part lights the scene from the sky (without an
atmosphere, from the background colour; `lowerHemisphereColor`, black, from below). The bounce is on by default
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
averages them down, `skyLightCaptureLodDistanceScale` (1) asks more detail of the scene in the faces,
`skyLightCaptureReflections` (on) traces the scene's reflections in them. The model:
[sky light, captured scene](ENGINE.md#atmosphere-and-sky-light).

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
`skyTableFast` (the sky read from its table, else every sky pixel marched), `aerialDepthTest`,
`transmittanceTable`, `transmittanceSmallFormat` (the table in four 8-bit channels),
`distantSkyLightTable` and `distantSkyLightAltitudeKm` (the fog's sky, made every image),
`multiScatterHighQuality` (8 directions over the sphere), `skyTablesFullPrecision` (the haze
volume in 32-bit floats) and `atmosphereSampleLightShadowMap` —, whose defaults are the reference's
top level and which the `smooth`, `balanced` and `fine` presets set to its lower three:

```js
world.quality.preset = 'fine' // the effects' level 2: 2 samples a slice, 64 samples at most
world.skyQuality = { skyTableFast: false, atmosphereSamplesMax: 256 } // every sky pixel marched
world.scene.sky = { atmosphere: { sampleCountScale: 2 } } // twice the samples, within those caps
world.skyQuality = { skyTableFast: null } // given back to the preset
```

A field out of range is refused
(`INVALID_SCENE_ENVIRONMENT`); to change a field, write `scene.sky` again.
`SceneEnvironment.atmosphere` carries the same fields. The model:
[atmosphere and sky light](ENGINE.md#atmosphere-and-sky-light).

### Declared lights

Lights are added, changed and removed like any object. Each is a `SceneLight` (version 2): `point`
and `spot` carry `position` and `range` in metres, `spot` also `direction` and a `coneAngle`
half-angle; `directional` only `direction` (of propagation), refused with a `position`, `range` or
`coneAngle`. All carry linear `color`, a positive radiometric `intensity` and `castsShadow`. A `directional` may
also carry `shadowDistance` ([A sun's shadow distance](#a-suns-shadow-distance-and-its-far-casters))
and `atmosphereSunIndex` ([Atmosphere part](#atmosphere-part)), refused on any other kind.

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
(`INVALID_SCENE_LIGHT`), and so is `shadowsFog: true` on a `rect`, which casts no shadow.

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
const lamp = light.spot({ intensity: 60, position: [0, 4, 0], distance: 20, angle: 0.6 })
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
which passes read the atlas: `lightFunctionDeferred` (`true`, the lighting of the opaque image),
`lightFunctionFog` (`true`, the volumetric fog's local lights; its sun always reads it),
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

### A sun's shadow distance and its far casters

A directional light's shadows follow the eye, and a caster far past the distance they are asked to
reach costs a raster pass for a shadow nobody reads. A sun therefore has a **shadow distance**:
`shadowDistance`, in metres, `400` by default, `true` the same, `false` or `0` none (no caster is
left out for being far). 400 m is the distance the shadows are asked to reach; the test's edge lies
a little farther: the far edge of the last of the sun's near shadow levels, with the overlap that
level has into the next when a far-field shadow follows it — 427.0 m at the defaults (400 m, near
plane 0.05 m), the distance itself from 512 m on. A caster whose object lies past the edge (its
depth along the view, less the radius of its object's bounding sphere) is left out of the sun's
shadow maps, all of the object or nothing of it, unless the object says `castFarShadow = true`. The
object is the whole placement the caster belongs to (its root's box), or, for the merged far-field
shells of the coarser levels of detail, the actor (the HLOD cell's merged mesh) it belongs to.

By default the test reaches the merged far-field shells of the world's coarser levels alone: the
objects drawn as themselves keep casting at any distance. With `farShadowCullsAllMeshes` it reaches
every caster, and then `castFarShadow` is what keeps an object in. A compiled object — one of a
compiled world, drawn as itself — has no per-object setting of its own yet: its shells follow the
view's.

```js
const sun = light.directional({ castShadow: true, shadowDistance: 600 })
sun.shadowDistance = 250 // metres, from the next frame; no cached shadow page is redrawn for it
tower.castFarShadow = true // this object still casts past the edge (false by default, on every node)
```

Six settings of the view sit beside it, each an option of `createWorld` too, resolved over the
quality preset like the raster's: `shadowDistanceScale` (`1`, from 0 to 2) multiplies every sun's
distance, so `0.5` halves it and `0` leaves the culling nothing to test against: it culls nothing;
`farShadowCulling` (`true`) is the switch of the whole test; `farShadowCullsAllMeshes` (`false`) says
which casters the test reaches; and three shape the edge: `shadowNearLevels` (`10`, a whole number
from 0 to 10; the sun has at most four near levels, so more than four is four, and `0` leaves no
edge: nothing is culled), `shadowOverlapScale` (`1`, from 0 to 2) is the factor on the tenth of its
span the last near level overlaps into the next, and `shadowFarField` (`true`) says whether a
far-field shadow follows the near levels (only for a scaled distance under 512 m). The levels are
laid from the near plane to the scaled distance, each three times the span of the one before; the
edge is the distance plus `(distance - start of the last level) * 0.1 * shadowOverlapScale` when a
far field follows, the distance otherwise.

```js
const world = createWorld('viewer', { shadowDistanceScale: 0.85 })
world.shadows = { farShadowCullsAllMeshes: true } // every caster is tested, from the next frame
world.shadows = { farShadowCullsAllMeshes: null } // back to the default
```

The quality levels (the `shadows` group) write the four that shape the distance and its edge:

| level      | `shadowDistanceScale` | `shadowNearLevels` | `shadowOverlapScale` | `shadowFarField` | edge at 400 m |
| ---------- | --------------------- | ------------------ | -------------------- | ---------------- | ------------- |
| `smooth`   | 0.6                   | 1                  | 0                    | off              | 240.0 m       |
| `balanced` | 0.7                   | 1                  | 0.25                 | off              | 280.0 m       |
| `fine`     | 0.85                  | 4                  | 0.8                  | on               | 358.4 m       |
| `max`      | nothing (1)           | nothing (10)       | nothing (1)          | nothing (on)     | 427.0 m       |

(edge at a near plane of 0.05 m.) A value the page set holds over a preset. A value of another kind,
or out of its range, is refused by name. None of these settings, nor a light's `shadowDistance`,
redraws a cached shadow page by itself: the pages follow the casters, as before. An object's
`castFarShadow` flip does: the pages its rows were drawn into are drawn again.

A saved scene keeps each node's `castFarShadow` when it is `true` (a file saved before the field
loads, every node casting none far). An agent sets the same through `trillion3d_set_shadows`, and a
light's distance through the `shadowDistance` field of `trillion3d_add_light`. How the far casters
are left out of the maps: [SHADOWS.md](SHADOWS.md#far-casters).

### A see-through surface casts no shadow unless it asks

A blended material (`transparent: true`) lets light pass, as glass, smoke and a light beam do.
`transparentShadow: true` asks for a shadow as dark as the surface is opaque:
`material.meshStandard({ transparent: true, opacity: 0.5, transparentShadow: true })` casts half a
shadow. An additive, transmissive or fully transparent surface never casts.

### A luminaire does not block its own light

A lamp's envelope (a lantern glass, a shade) would put its own light out. `SceneLight.emitterRadius`
(metres, positive, below `range`, point and spot only) declares it: **that light's** shadow pass
writes no depth within that sphere of its centre, per fragment, so a wall crossing it still
occludes beyond. None declared means zero. Imported lamps:
[COMPILER.md](COMPILER.md#lightsjson--the-lamps-of-the-source-file).

### Lights imported from the source file

The compiler writes a source file's lights beside the manifest as `lights.json`
([COMPILER.md](COMPILER.md#lightsjson--the-lamps-of-the-source-file)): glTF from
`KHR_lights_punctual`, FBX through ufbx, USD from the `UsdLux` sphere, disk, rect and distant
schemas, Blender from `Lamp` blocks; OBJ declares none. Positions and directions are world space,
after instancing: a light instanced by three nodes is three entries.

**Units.** glTF's photometric values (candela for `point` and `spot`, lux for `directional`) are
divided by **683 lm/W** into the engine's radiometric ones (W/sr, W/m²), no spectrum assumed, no
hidden gain. FBX's `Intensity`, a percentage, converts at **1000 lm / 4π ≈ 79.6 cd** for a point or
spot and **10 000 lux** for a directional. A `point` or `spot` without `range` gets
`sqrt(I / 0.01 W·m⁻²)`, capped at 10 000 m. `innerConeAngle` is not carried (the engine's
`spotEdgeSoftness` softens a spot edge). A light breaking the contract is counted in `rejected`
and left out.

A light casts when the file says so (glTF says nothing, so imported glTF lights cast). Every light
is read as `(await scene.load(url)).lights` in cache order (`imported-lights` counts them), each a
child of the model, changed like any light. A cache without `lights.json` has none.

## Memory budgets

What a host sets and reads; the pools' mechanics are [RESIDENCY.md](RESIDENCY.md).

| Setting                     | Default                      | What it is                                                                                                                                                   |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `world.budget.gpu`          | 2 179 MiB                    | every GPU pool together, divided by `world.budget.split`                                                                                                     |
| `world.budget.cpu`          | the page cache's own default | what the world keeps in CPU memory                                                                                                                           |
| `world.budget.geometryPool` | 512 MiB                      | slots of a 128 KiB streaming page each, the root pages held beside them in the root region; clamped to `geometryPoolCeiling`; the call a memory slider makes |
| `world.budget.texturePool`  | 512 MiB                      | virtual-texture tiles, every texture's tail always resident; clamped to `texturePoolCeiling`                                                                 |
| `world.budget.canvas`       | 3840 × 2160                  | the largest drawing buffer, `{ width, height }`, the effect targets are reserved at                                                                          |
| `world.budget.physics`      | `DEFAULT_PHYSICS_BUDGET`     | [PHYSICS.md](PHYSICS.md#budgets)                                                                                                                             |

- **GPU split.** The shadow pool, bounce probes and effect targets are reserved first (at
  their live descriptor bytes), then the geometry and texture pools up to their ceilings; root
  coverage and texture tails are mandatory, and admission never changes resolution or raises the
  declared total.
- **CPU split.** The decoded-page cache takes the whole CPU total (`split.pageCache`): manifest
  tables, transfer queue and cut tables (sized by the view and the pool, never the world) are
  reserved off it, and its entries — pages, decoded baked texture levels, files read whole and
  the resident proxy — share the rest under one budget, the proxy leaving last. A change applies
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
  fill whole layers; a shrink never displaces a tail.

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

| Code                                                                                                      | When                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_GPU_BUDGET`, `INVALID_CPU_BUDGET`, `INVALID_GEOMETRY_POOL_BUDGET`, `INVALID_TEXTURE_POOL_BUDGET` | a value that is not a whole number of bytes above zero                                                                                                                                                          |
| `INVALID_BUDGET_CANVAS`                                                                                   | a declared canvas that is not a whole number of pixels above zero                                                                                                                                               |
| `GPU_BUDGET_UNDER_MINIMUM`                                                                                | a GPU total below the root coverage and texture-tail minima                                                                                                                                                     |
| `GPU_BUDGET_UNDER_SHADOW_POOL`                                                                            | a GPU total under its fixed shadow share                                                                                                                                                                        |
| `GEOMETRY_POOL_DEVICE_LIMIT`                                                                              | a device whose limits cannot hold even the root cover                                                                                                                                                           |
| `TEXTURE_POOL_DEVICE_LIMIT`                                                                               | a device whose limits cannot hold the tails of one texture lane                                                                                                                                                 |
| `WEBGPU_GEOMETRY_POOL_REFUSED`, `WEBGPU_TEXTURE_POOL_REFUSED`, `WEBGPU_FRAME_TARGETS_REFUSED`             | the device refuses a floor or the frame targets ([RESIDENCY.md](RESIDENCY.md#out-of-memory))                                                                                                                    |
| `GPU_BUDGET_EXCEEDED`                                                                                     | an allocation past the GPU total (or an unknown format): no new image, flush and capture reject; terminal for the session, reopened with enough budget once every session sharing the refused cache is released |
| `SURFACE_DEVICE_LIMIT`                                                                                    | a device dimension limit                                                                                                                                                                                        |

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
