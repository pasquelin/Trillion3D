# Create a world

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

| Phase | When |
| --- | --- |
| `{ phase: 'bytes', completed, total }` | from the manifest's read: `total` every file it declares, at once; each chunk read adds to `completed`, whatever the server says of length or compression; the ratio never goes down, and the last event, unneeded files dropped, has `completed === total` (a manifest declaring no file: one event, at the end) |
| `{ phase: 'manifest' }` | once the manifest is read |
| `{ phase: 'tables' }` | once the scene tables are |
| `{ phase: 'resources', completed, total }` | as each file the scene reads lands |

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

## Files over HTTP

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

The optional families ([README](../../README.md#public-sdk)), the world stream and each
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
