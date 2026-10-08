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

`site/data/api-inventory.json`, generated with the TypeScript checker, lists every entry point and
binding the facades expose.

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
drives a progress bar from first byte to first pages (example `watch-a-world-load`). A session
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
retry (the GPU page cache's two attempts, a physics tile's next update). The page streamer asks a
page again for as long as the failure may pass, one request per step, after a wait of 0.5 s · 2^k
(8 s at most, never less than the server's `Retry-After`); only a 4xx refusal fails for good. What
still fails is `RESOURCE_HTTP_ERROR` (`details.url`, `details.status`, `null`
for the network). `lights.json` and `physics.json` are absent, not failed, on a 404 or a hiding
store's 403. An unreadable `kernels.wasm` leaves the batch kernels to their JavaScript twins.

The optional families ([README](../README.md#public-sdk)), the world stream, the impostors and each
renderer are chunks imported on first use, a failed import tried once more at once; what still
fails is `FAMILY_LOAD_FAILED` (`T3D-E090`, `details.family`) on
`world.diagnostic.error` (and `world.physics.error`), asked again at the next use, ten seconds later
at the soonest. Frames that need a family wait for it, never draw without it; refused impostors
leave each object its mesh. A page downloads only the renderer it draws with.

**Debug mode** (`createWorld(target, { debug: true })`, `world.diagnostic.debug = true`, the
examples' stats corner, `?profile` in the address) files frames into `world.cpuSteps` and the frame
report and fetches the measurement's code (`EngineProfiler`, `gpuPassStageOf`, `gpuPassBlockOf`,
`gpuPassBlockTotals`, also fetched at their first call). Until it arrives, they report nothing
measured: a page reading them from its first frame turns debug mode on before it.

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

| Family       | Members                                                                        | What it does                                                     | Example                                                                                                       |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `page`       | `createStreamer`, `createCache`, `httpSource`, `decode`                        | geometry in pages                                                | `page.createStreamer({ source: page.httpSource('assets/forest/') })`, passed as `scene.load(url, { stream })` |
| `budget`     | `memory`, `geometryPool`, `texturePool`                                        | fixed envelopes, not wishes                                      | `world.budget.geometryPool = 512 * 1024 * 1024`                                                               |
| `metric`     | `frame`, `cpuSteps`, `gpuPasses`, `createProfiler`                             | what the image cost, never estimated                             | `metrics.selectedTriangles`, `metrics.residentPages` in `world.onFrame`; `metric.createProfiler(world)`       |
| `diagnostic` | `createChannel`, `presentationColor`, `partitionAudit`, `transparentOcclusion` | watching the engine work                                         | `world.diagnostic.mode = 'clusters'` (or `'wireframe'`, `'triangles'`, `'beauty'`)                            |
| `capability` | `detect`, `lighting`                                                           | what the machine grants, before an image is promised             | `(await capability.detect()).webgpu`                                                                          |
| `capture`    | `surface`, `buffer`                                                            | an image aside, at another resolution, without touching the view | `capture.surface(world, { width: 3840, height: 2160 })`                                                       |
| `pose`       | `fromBounds`, `runPath`, `pointOfInterest`                                     | named poses, automatic framing, replaying a path                 | `world.camera.set(pose.fromBounds(math.box3().setFromObject(set)))`                                           |
| `batch`      | `transformPoints`, `composeMatrix4`, `frustumKeepsBox`                         | a thousand matrices at once instead of a loop                    | `batch.composeMatrix4(outputs, positions, quaternions, scales, 1000)`                                         |

The world is not a family: it carries `scene`, `camera`, `budget`, `diagnostic`, `controls`,
`onFrame`/`loop`, `render`, `invalidate` and `dispose`. There is no level-of-detail object and no
instanced or batched mesh type: the DAG cut, instancing and draw grouping are native.

In a compiled scene, moving a node or its parent updates its resident lighting proxy (the one
distant sun shadows use while bounce is off included) and restarts bounce probe convergence, with no
invalidation call. This needs a version-3 proxy cache; motion keeps proxy surfaces but cannot
restore geometry discarded while cooking ([FORMAT.md](FORMAT.md#resident-lighting-proxy)).

## Loop

The world owns the loop and stops when the image is stable: after 120 frames with nothing changing
it pauses (`interactive-settle-limit`), and resumes on invalidation. A frame after which a page
landed does not count, so a streamed view is drawn to its last page. A still scene costs nothing.
`onFrame` is the per-frame hook; `loop` is its alias.

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

`world.pixelError` is the DAG cut's screen error in pixels (`0` by default, the exact leaves; a
positive value selects coarser pages when the cache has them). `pose.fromBounds(box)` frames a box,
`pose.pointOfInterest(name, pose)` names one, `pose.runPath(world, poses, { images })` replays a
path, one display frame per pose, and answers the frames drawn, their CPU time summarized and the
display cadence.

`world.temporalAntialiasing` (option of `createWorld` too, `true` by default) jitters each image by
a sub-pixel offset and accumulates; `false` draws pixel centres with no history, as a pixel-exact
capture needs. A write applies next frame, no session reopened; a read says what the image carries.

`world.renderScale` (option of `createWorld` too, `'auto'` by default) is the per-axis fraction of
the display drawn before temporal antialiasing rebuilds the image: `'auto'` lets the frame budget
(the display's refresh interval) choose between 0.5 and 1, from the GPU frame time or, without
timestamps, the frame interval; `{ min, max }` bounds it, a number fixes it. A read is the last
image's scale.

`world.effects` is the ordered chain of passes after temporal antialiasing, before the canvas.
`effect.bloom({ intensity, radius })` is an energy-conserving glow on the linear
image before tone mapping: `intensity` (0 to 1, `0.04` by default) the share of the image it
replaces, `radius` (`1` by default) the spread per level, in that level's texels.
`world.effects.add(pass, index?)`, `remove(pass)` and `clear()` change the chain; settings show next
frame. An empty chain costs nothing; a still image is post-processed once.

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
setting `kind` releases the current controller and builds the next. Live examples:
[orbit](../site/examples/orbit-around-a-clockwork.html),
[character with physics](../site/examples/walk-with-collisions.html). `firstPerson` is the
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
each a setting of `world.controls`. Without physics it collides with the static triangles of
`world.controls.colliders` (meshes, built into a triangle tree once), or walks level where it
stands. With physics on ([PHYSICS.md](PHYSICS.md)) it is the physics' virtual character in its
worker: it climbs steps and slopes, rides a moving platform, pushes dynamic bodies with at most
`pushStrength` newtons and is pushed back; `colliders` is unused (give the level
`mesh.physics = 'static'`), and the feet are drawn at the bodies' time.

Both read one drive (`characterDrive.ts`): speed gathered over `responseTime`, lost over `stopTime`,
jumps with a coyote time and a jump buffer, and no ground speed changing faster than a rubber sole's
grip allows, `μ g` (the geometric mean of the sole's and the ground's frictions; without physics,
stone). The triangle body drops a stall past 0.25 s (`MAX_CHARACTER_DELTA`); the physics' takes at
most four steps a frame (`MAX_CATCH_UP_STEPS`): a slower page shows slow motion, never a jump.

**Vehicles.** `'vehicle'` maps the keys to a `VehicleInput` (`throttle`, `brake`, `steer`,
`handbrake`) and hands it to `world.controls.vehicle.drive(input)` on each change. Any object with
`drive` can be driven, the physics' vehicles first (`vehicle.car`,
[PHYSICS.md](PHYSICS.md#vehicles)). `kind = 'vehicle'` while `vehicle` is `null` throws
`NO_VEHICLE`. The camera does not follow: the page moves it.

### Picking, moving and saving

`world.raycast(at)` returns the nearest hit under a canvas point (CSS pixels,
`event.offsetX`/`offsetY`) or along a world `Ray`, or `null`: the node the page added, world
`point` and `normal`, `distance` and triangle rank `face`. It runs on the CPU: meshes triangle by
triangle; lines, points and sprites never; a loaded model (GPU pages) on its box, or at the ray's
origin from inside (`distance` 0); hidden subtrees and `helper` marks skipped. `{ objects }` limits
the subtrees; a sizeless canvas refuses a point (`RAYCAST_NO_VIEW`). `raycast(roots, ray)` returns
every hit, nearest first; `camera.rayThrough(x, y, aspect)` is the ray through a picture point; the
exact raycast is [PHYSICS.md](PHYSICS.md#exact-raycast). An orthographic camera made with
`fitAspect: true` takes its width from the canvas. Triangle trees are kept within
`world.budget.raycastTrees` bytes (64 MiB by default, shared by every world on the page), the least
recently cast dropped past it. Live example: [click to pick](../site/examples/click-to-pick.html).

`controls.transform(world, options)` puts move, turn and scale handles on one object:
`attach(object)`, `detach()`, `setMode('translate' | 'rotate' | 'scale')`,
`setSpace('world' | 'local')`, `snap = { translate, rotate, scale }`, events `change`, `dragStart`,
`dragEnd` — one drag, one undo step. The handles are unlit `helper` meshes at a share of the canvas
height (`size`, a quarter by default), picked before the camera controller hears the press. A drag
writes the local pose through the parents; the centre cube scales uniformly, by e per handle length
up the screen. `attach` or `detach` mid-drag ends it with its `dragEnd`. Live example: [move,
rotate, scale](../site/examples/move-rotate-scale-gizmo.html).

`scene.toJSON(camera)` writes plain, versioned JSON (`format: 'trillion3d-scene'`, `formatVersion:
2`): hierarchy, poses, each shape by the call that built it (`geometry.box(2, 1, 1)`; one changed
after, or hand-written, by its vertices), materials by parameters, bodies as `physics` declared them
(at rest), lights, background, fog, the camera's pose; shared shapes and materials once, a loaded
model by its manifest address, `helper` marks left out. A texture, a picture environment, a shader
material or a number JSON cannot hold is refused (`SCENE_NOT_SAVABLE`). `await scene.fromJSON(json,
camera)` replaces the content (`helper` marks kept) and reloads the models; another format or
version is refused (`UNSUPPORTED_SCENE_FORMAT`) before anything is removed. Calls during a read run
in order, each replacing the last. Live example: [save the
scene](../site/examples/save-the-scene.html). The portal's scene editor (`site/app/editor/`) uses
these three doors and nothing else.

### Live material values

A material written on `color`, `emissive`, `emissiveIntensity`, `metalness` or `roughness` is
repainted in place, the session kept (a colour picker dragged for ten seconds keeps one session). A
change it cannot hold in place — a texture, a kind, a side, transparency, values another material
object shares — is copied on write and reopens the session, once per burst;
`world.diagnostic.sessions` counts the sessions a world opened.

`material.meshPhysical` accepts `anisotropy` (strength, 0–1), `anisotropyRotation` (radians),
`clearcoat` and `clearcoatRoughness`, drawn with `anisotropyMap` (RG the direction, B the
strength), `clearcoatMap` (R), `clearcoatRoughnessMap` (G) and `clearcoatNormalMap`
(`clearcoatNormalScale`), each map at its native size with its own filters, wrap, transform and UV
channel, read as linear data. The second UV channel (`TEXCOORD_1`) is read from the compiled
geometry page or from the source geometry; a geometry without one reads the first. The coat lies
over every light, the environment, bounced light and reflections, on an opaque surface as on a
blended or a transmissive one — whose transmitted light passes under it; a rectangle light
stretches its specular lobe along the anisotropy.

Lit materials can declare `subsurfaceColor` (black, off, by default) and an optional `subsurfaceMap`
for thin **double-sided** surfaces such as foliage: light arriving through the back, tinted.
Diffuse thin-surface transmission, not a volume: a glass volume uses physical `transmission`,
`thickness`, `attenuationColor` and `attenuationDistance`.

With `transparentShadow: true`, blended glass tints the shadow transmission atlas by its base color
and texture; a nonzero volume thickness applies Beer attenuation once at the entrance of a closed
mesh (a declared-thickness approximation, not ray tracing); alpha-only blended shadows are
coverage. A shadow-casting point light with positive `radius` uses contact-hardening PCSS; radius
zero uses PCF.

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
waits for the next frame, in order, never dropped. Live example:
[cloth and rope](../site/examples/cloth-and-rope.html). Water need not be rewritten: a mesh lying
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

Installing, the CDN `importmap` and the licence: [README](../README.md#quick-start) and the
portal's [Install page](https://www.trillion3d.com/#/en/learn/install). `npm install trillion3d`
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
installed workers (`pageWorker.js`, `pageIntegrationWorker.js`, `physicsWorker.js`,
`animationWorker.js`) as module-worker entries, and code splitting; copy each installed WebAssembly
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
An update or walk costs its subtree only; a dropped object frees its slot when collected.

The graph classes are `Object3D`, `Group`, `Mesh`, `Scene`, `Camera` and `Light` (its `kind`; a
`rectArea` for a rectangle, a `probe` with 27 coefficients in `sh`). A light hears its colours and
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
displacements), `drawRange`, `name`, `userData`; its bounds span every vertex and morph shape, at
the value each stands for (a normalised integer scaled back, a two-number position at z = 0).
`toNonIndexed()` gives each corner its own vertex. A geometry no mesh wears gives back its pages
and GPU memory, with no call; replacing a mesh's geometry disposes the one it
replaces, raycast tree and host copies included.

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
never reused. [Live example](../site/examples/page-materials.html).

## Lights

Only a light the host declared lights an opaque surface: no fixed ambient, constant sky or authored
scene lighting; a windowless corridor stays black at noon. Emission is always added.
`world.exposure` is the camera exposure on linear radiance before tone mapping. `meshNormal` and
`meshDepth` surfaces are output as stored. A map a family never reads (a `meshToon` `gradientMap`,
a `meshMatcap` `map`, a `meshMatcap` or `meshNormal` `normalMap`) is refused by name;
`meshMatcap`, `meshNormal` and `meshDepth` ignore an `aoMap`. Transparent surfaces follow another
lighting rule: [ENGINE.md](ENGINE.md#transparent-surfaces).

`scene.background` is the colour behind every object (`null` by default); set or written through
its methods (`set`, `setRGB`, `setHex`, `setHSL`), it shows next frame; a direct `.r`, `.g` or `.b`
write needs it set again. A picture background is refused (`UNSUPPORTED_SCENE_UPDATE`).

### Scene fog

`world.scene.fog` places distance or height fog over opaque and transparent surfaces; its `color` is a linear-RGB `Color`, `null` (the default) none. Distance is from the camera;
height uses the scene's positive Y:

```js
import { Color } from 'trillion3d'

const color = new Color().setRGB(0.35, 0.45, 0.6)
world.scene.fog = { color, near: 10, far: 100 } // Linear: clear before 10, all fog after 100.
world.scene.fog = { color, density: 0.02 } // Exponential: uniform medium.
world.scene.fog = { color, density: 0.02, heightFalloff: 0.15, baseHeight: 0 } // Height fog.
world.scene.fog = null // No fog.
```

`near` and `far` are finite with `0 ≤ near < far`; `density`, `heightFalloff` and the colour
components finite and nonnegative; `baseHeight` finite; otherwise `INVALID_SCENE_ENVIRONMENT`. After
writing a field directly, assign `scene.fog` again (a `Color` method applies by itself). A
`fog: false` material stays unfogged. `SceneEnvironment.fog` and `SavedScene.fog` carry the same
fields. The law: [fog lighting law](ENGINE.md#fog).

### Declared lights

Lights are added, changed and removed like any object. Each is a `SceneLight` (version 2): `point`
and `spot` carry `position` and `range` in metres, `spot` also `direction` and a `coneAngle`
half-angle; `directional` only `direction` (of propagation), refused with a `position`, `range` or
`coneAngle`. All carry linear `color`, a positive radiometric `intensity` and `castsShadow`.

No bound on the light count: a 16×16 screen tile lists up to 64 lights reaching it, past that
exactly those reaching it. Past 64 shadow
slices a caster lights without a shadow (`shadowCastersUnsliced`). The shadow pool and its metrics:
[SHADOWS.md](SHADOWS.md#memory).

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

| Setting                     | Default                      | What it is                                                                                                           |
| --------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `world.budget.gpu`          | 2 179 MiB                    | every GPU pool together, divided by `world.budget.split`                                                             |
| `world.budget.cpu`          | the page cache's own default | what the world keeps in CPU memory                                                                                   |
| `world.budget.geometryPool` | 512 MiB                      | cluster page slots, the root cover always resident; clamped to `geometryPoolCeiling`; the call a memory slider makes |
| `world.budget.texturePool`  | 512 MiB                      | virtual-texture tiles, every texture's tail always resident; clamped to `texturePoolCeiling`                         |
| `world.budget.canvas`       | 3840 × 2160                  | the largest drawing buffer, `{ width, height }`, the effect targets are reserved at                                  |
| `world.budget.raycastTrees` | 64 MiB                       | [Picking](#picking-moving-and-saving)                                                                                |
| `world.budget.physics`      | `DEFAULT_PHYSICS_BUDGET`     | [PHYSICS.md](PHYSICS.md#budgets)                                                                                     |

- **GPU split.** The shadow pool, bounce probes and effect targets are reserved first (at
  their live descriptor bytes), then the geometry and texture pools up to their ceilings; root
  coverage and texture tails are mandatory, and admission never changes resolution or raises the
  declared total.
- **CPU split.** The decoded-page cache takes the whole CPU total (`split.pageCache`): manifest
  tables, transfer queue, cut tables (sized by the view and the pool, never the world), the
  resident proxy (`page-cache-kept-yielded` when pages need its room) and decoded baked texture
  levels, at most three quarters of it (`split.textureLevels`), yielding first
  (`page-cache-levels-yielded`). A change applies at once, pages and levels leaving by last use.
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
repinning never lowers a held page; `cache.unpin(key)` releases both.

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
its last image (`gpu-device-recovered`, `recoveryMs`). Each session reopen is said once as
`session-reopen`: `cause` (`device-lost`, `option`, or a content change with `defect: true`),
`durationMs`, `framesWithoutImage`.

## Captures and image checks

`capture.surface(world, { width, height })` and `capture.buffer(world, { width, height })` return
pixels taken aside from the view. A deterministic image: `world.camera.set(pose)`,
`await world.awaitPages()`, `world.render()`, then `await capture.buffer(...)`. `awaitPages()`
rejects a requested URL that failed to load (a background load is retried three times at most); it
waits for pages, not an image.

## Migration from Three.js

No Three.js adapter ships and no public API takes or returns a Three.js object: Three.js code is
rewritten with the [families](#families), as the portal's
[migration page](https://www.trillion3d.com/#/en/learn/three-migration) shows; each maths
function's page of the [API reference](https://www.trillion3d.com/#/en/api) names its witness call.

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

The GPU deforms vertices before culling and drawing
([ENGINE.md](ENGINE.md#gpu-deformation)). `metrics.gpuDeformationMs` is the
latest measured WebGPU deformation time, `null` without a timestamp sample. Examples: [the walking
character](../site/examples/a-character-that-walks.html), [the morph
sample](../site/examples/a-shape-that-morphs.html), [the
crowd](../site/examples/a-crowd-of-characters.html) (`?count=1`, `10` or `100`).
