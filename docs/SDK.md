# Trillion3D SDK

The public guide: what a page and a Node host write against. How the engine draws underneath is
[ENGINE.md](ENGINE.md), what stays in memory [RESIDENCY.md](RESIDENCY.md), the compiler
[COMPILER.md](COMPILER.md), the cache [FORMAT.md](FORMAT.md), physics [PHYSICS.md](PHYSICS.md),
the maths [MATHS.md](MATHS.md).

Every public import uses `trillion3d`; conditional exports select the common, browser or Node
API ([Entry points](#entry-points)). Do not import `packages/` internals. `SDK_VERSION` and
`FORMAT_VERSION` are independent.

## Terms

- **World** — what `createWorld` returns. It owns the scene, the camera, the renderer and the loop; nothing else is constructed.
- **Scene** — `world.scene`, the root objects are added to; a compiled model is loaded into it like any other addition.
- **Model** — a compiled manifest, loaded with `scene.load(manifestUrl)` and added to the scene.
- **Renderer** — the drawing path a world takes, `'webgpu'` or `'webgl2'`. A host never imports, names or holds one.
- **Host** — the page that creates a world: it owns the canvas, the layout and the disposal.
- **Pose** — a camera framing: `{ position, target, fov? }`.
- **Witness** — a comparison backend of the bench, named only through the measurement entry point; it never reaches a published world.

`explorer` and `backend` are not public vocabulary: a page creates a **world**, never an explorer,
and never names what draws.

## Principles

The rules the architecture and the product are held to. They are targets to validate, not a claim that every feature exists today: see the [current limits](#current-limits).

1. **Portable Core.** Engine algorithms, formats, oracles, and contracts remain independent of React and Electron. The interface controls and observes campaigns; it contains no core engine logic.
2. **Compiled and Versioned Preparation.** Expensive assets are built outside the interactive loop, versioned alongside their schemas, and loaded following manifest validation. No hidden preparation overhead is charged to current frame rendering.
3. **Standalone Generators.** Any Rust asset preparation or compilation core resides in a standalone package in the Trillion3D repository under `packages/`. A benchmark contains only its manifests, contracts, scenarios, adapters, and tests, consuming the public package API. Engine and generator packages import neither React, Vite, Electron, nor benchmark internals.
4. **Never Degrade the Host Application.** The SDK negotiates capabilities and maintains a standard baseline. It disables an optimization when measured overhead exceeds benefit and recovers from error, device loss, memory exhaustion, or thrashing on the renderer already in use. A world's `renderer` option (absent = best path the machine grants) is chosen once, from what the machine offers; forced and missing, it is refused by name, never silently swapped for the other. The UI exposes the active renderer, active level, fallback, and reason without inventing metrics.
5. **Seamless Fallback.** For the end user, fallback is automatic and silent: no technical warning appears during normal startup. Full diagnostic telemetry remains reserved for developer mode. A concise notification appears only when no compatible renderer is available. Recovering on the chosen renderer preserves scene state without flashing, blank screens, or visible restarts; it never switches to the other renderer under a host that did not ask for one.

Trillion3D owns every package it builds under `packages/` ([package architecture](../packages/README.md)). The SDK exposes public entry points producing JavaScript and type declarations. React and Electron adapters remain optional and are not shipped as dedicated packages. Hosts consume public exports only.

## Entry points

Version 0.2.0 exposes one consumer specifier, `trillion3d`, with three environment branches:

| Resolver context | Source facade | Public surface | Declaration constraints |
| --- | --- | --- | --- |
| Node ESM with NodeNext | `packages/sdk/node.mts` | Common and native compilation | Node types are allowed; DOM and WebGPU types are not introduced by the common branch. |
| Browser bundler with TypeScript Bundler | `packages/sdk/browser.ts` | Common and browser rendering | Browser and WebGPU declarations are allowed; no `node:*` module is reachable. |
| Worker or common code | `packages/sdk/index.ts` | Common maths and contracts | Compiles without DOM or WebGPU declarations. |
| Unknown environment or fallback | `packages/sdk/index.ts` | Common maths and contracts | The safe default never exposes browser or Node APIs by accident. |

Conditional JavaScript and declarations: `browser` precedes the Node and generic import/default
paths, the Node branch uses the standard `node` condition, the final default is the common branch.
A resolver that ignores `browser` or has no platform condition gets the safe common facade — no DOM,
WebGPU, filesystem or process API. SSR resolves the Node branch: native and common, no browser
rendering. Importing any branch creates no renderer, worker, DOM object, GPU object or compiler
process.

The measurement entry point (`packages/sdk-browser/src/measurement/measurement.ts`: the browser
branch plus `openMeasuredWorld`/`createMeasuredWorldJob`, the backend factories,
`chooseBackends`/`autonomousCacheReady`, `replicateInstances`; [ENGINE.md](ENGINE.md)) is no
resolver condition: `package.json`'s `exports` map has no subpath for it, so it never reaches a
package consumer. `bench/witnesses/measurement.ts` adds the witness factories (built into
`dist/witnesses/`, left out of the package).

`site/data/api-inventory.json` is generated with the TypeScript checker: it follows aliases and
transitive star exports, records binding identity, and lists every entry point and the documented
source-path imports the facade newly exposes; experimental comparison and oracle bindings stay
classified as experimental. Removed exports and what to write instead: the N-dimensional `dot` →
`dotVector3`, the one dot product, on three components; `GraphNode` and `GraphNodeKind` → `Light`
and its `kind`; `HostNode`, `HostTraversable`, `HostGraphNode` → `Object3D`; `GraphGeometry` →
`Geometry`; `GraphAttribute`, `GraphInterleavedBuffer`, `GraphInterleavedAttribute`,
`GraphElements`, `GraphArray` → `BufferAttribute`, `InterleavedBuffer`,
`InterleavedBufferAttribute`, `VertexAttribute`, `BufferTypedArray`.

Measured with esbuild 0.25.12 (ESM, browser platform, minification and tree shaking), a consumer
importing only `hierarchyUpdateBatch` weighs 1,780 bytes from the common facade and 3,289 bytes from
the browser facade, which sheds unrelated rendering code and every Node module. Bundle content,
not runtime performance.

## Create a world

```js
import { createWorld, object, geometry, material, light } from 'trillion3d';

const world = createWorld('viewer'); // the id of a canvas, or the element itself

const ground = object.mesh(geometry.plane(20, 20), material.meshStandard({ color: 0x8899aa }));
const ball = object.mesh(
  geometry.sphere(1, 64, 32),
  material.meshStandard({ metalness: 0.9, roughness: 0.1 }),
);
ball.position.set(0, 1, 0);

world.scene.add(ground, ball);
world.scene.add(light.directional({ intensity: 3, position: [5, 10, 2] }));
world.scene.add(light.ambient({ intensity: 0.2 }));

world.camera.position.set(0, 3, 8);
world.camera.lookAt(0, 1, 0);

await world.scene.load('assets/city/manifest.json'); // a compiled model, added like the rest
```

`world.ready` resolves once the renderer is prepared; earlier additions and loads are queued. There
is no asset URL default: pass a real `manifestUrl` to `scene.load`. The default scope is `slice`
(`scene.load(url, { scope: 'full' })` for a full cache); another scope's pointer or manifest is
rejected with `SCOPE_MISMATCH`.

**Progress.** `scene.load(url, { onProgress })` reports with `createJob`'s `JobProgress` shape:

| Phase | When |
| --- | --- |
| `{ phase: 'bytes', completed, total }` | from the manifest's read: `total` is every file it declares, at once; each chunk read adds to `completed`, whatever the server says of length or compression. `completed / total` never goes down; the last event, unneeded files dropped, has `completed === total`; a manifest declaring no file is heard once, whole, at the end |
| `{ phase: 'manifest' }` | once the manifest is read |
| `{ phase: 'tables' }` | once the scene tables are |
| `{ phase: 'resources', completed, total }` | as each file the scene reads lands |

`await world.awaitPages({ onProgress })` settles once the pages the view reads are resident:
`{ phase: 'session' }` while the drawing session opens, then `{ phase: 'pages', completed, total }`
— `total` each page the view reads, once (held already or read during the wait by the host's cut or
the WebGPU residency, a prefetch aside), `completed` those resident, the last event
`completed === total`. One callback for both drives a progress bar from first byte to first pages
(example `watch-a-world-load`). A session closed during the wait (a lost device, an option it cannot
take in place) never rejects it: the wait goes on with the reopened one.

**Vertices.** `scene.load` reads no vertex buffer (`source.bin`): pages draw the model. The buffer
is read once, on first need (a cluster no geometry page covers, a see-through copy drawn whole, a
witness renderer). Before `geometry.loadVertices()` resolves, `array`, `getX` and every synchronous
vertex read of a loaded mesh throw `VERTICES_NOT_LOADED`, never an empty array; `count` is known at
once.

```ts
await geometry.loadVertices(); // reads the model's buffer once, whichever mesh asks first
const x = geometry.attributes.position.getX(0);
```

**Probing a cache.** `assertCachePointer(pointer, scope)` and `assertCacheRoot(root, scope)` run
`scene.load`'s first checks on the pointer and `clusters.json`, downloading no page: the first
returns the cache URL named; both raise an `EngineError` (`INVALID_POINTER`, `CACHE_NOT_READY`,
`SCOPE_MISMATCH`, `UNSUPPORTED_FORMAT`, `INVALID_CACHE`) otherwise.

### Files over HTTP

Every model file read over HTTP — manifest, tables, binary, images, lights, pages, cooked physics —
goes through one loader. A failure that may pass (the network, 408, 429, 5xx) is asked again once
after its `Retry-After` wait (seconds or an HTTP date), or by the reader's own retry: the page
streamer's three attempts, the GPU page cache's two, a physics tile's next update. The wait is ten
seconds at most: only whole-file reads wait, while a user watches, some without an abort signal, and
past that a named failure serves better. Other 4xx are never asked twice; an aborted load rejects
with its reason. What still fails is `RESOURCE_HTTP_ERROR`, the address in its message and
`details.url`, the status in `details.status` (`null` for the network). `lights.json` and
`physics.json`, lacking in a cache compiled before them, are absent on a 404 or a hiding store's
403. `RESOURCE_HTTP_ERROR` replaces `Error('PAGE_HTTP_<status>')` for a page read
(`httpPageSource`), and `PHYSICS_FAILED` for a cooked tile, a soft body's settings and
`joltPhysics.wasm`; `PHYSICS_FAILED` stays for the simulation's own failures. `pageCodec.wasm` is
read the same way; unreadable, the JavaScript decoder decodes the pages.

## API rule

| Kind | Used for | Examples |
| --- | --- | --- |
| **property** | state that is read and written; a setter applies its own consequences — the projection update, the next frame — so a host never calls an update by hand | `camera.near = 0.1`, `light.intensity = 2`, `world.exposure`, `world.pixelError`, `world.controls.kind` |
| object with **`.set()`** | a value with several components | `position.set(0, 1, 0)`, `repeat.set(4, 4)`, `color.set(0xcc3344)` |
| **method** | an action or a computation | `lookAt`, `add`, `load`, `invalidate`, `render`, `world.stageProfile()`, `world.awaitPages()` |

## Naming rule

Families are **singular**. Inside one, a member that produces a thing of the scene is named after
the thing (`geometry.box`); a member that sets up machinery is `create` + its name
(`page.createStreamer`). This holds over four hundred entries: it is a rule, not a taste.

## Families

Thirteen families describe the scene:

| Family | What it is | Example |
| --- | --- | --- |
| `geometry` | the shape alone, with no matter | `geometry.sphere(1, 64, 32)`, `geometry.plane(20, 20)`, `geometry.tube(math.path([[0, 0, 0], [2, 1, 0], [4, 0, 2]]), 64, 0.2)` |
| `material` | the matter alone, with no shape | `material.meshStandard({ color: 0x8899aa, metalness: 0.9, roughness: 0.15 })`, `material.meshPhysical({ transmission: 1, ior: 1.5, thickness: 0.4 })` |
| `object` | shape and matter, placed in the scene | `const ball = object.mesh(geometry.sphere(1), steel)`, `object.group()`, `set.add(ball)`, `world.scene.add(set)` |
| `light` | lights | `light.ambient({ intensity: 0.2 })`, `light.directional({ intensity: 3, position: [5, 10, 2], castShadow: true })`, `light.spot({ angle: 0.4, penumbra: 0.3, distance: 30, decay: 2 })` |
| `camera` | cameras | `world.camera = camera.perspective({ fov: 55, near: 0.1, far: 500 })` |
| `math` | vectors, quaternions, boxes, paths | `math.vector3(0, 1, 0)`, `math.quaternion().setFromAxisAngle(axis, Math.PI / 4)`, `math.box3().setFromObject(set)` |
| `texture`, `loader` | pictures | `const albedo = await loader.texture('wood.jpg')`, `albedo.wrap = wrap.repeat`, `albedo.repeat.set(4, 4)` |
| `helper` | the marks you work with | `helper.grid(20, 20)`, `helper.axes(2)` |
| `controls` | handles that move an object with the mouse | `const gizmo = controls.transform(world).attach(ball)`, then `gizmo.addEventListener('dragEnd', () => history.push(ball.position.clone()))` |
| `animation` | clips and mixers | `animation.createMixer(set)`, `animation.clip('bob', 2, [animation.vectorTrack('.position', [0, 1, 2], [0, 1, 0, 0, 2, 0, 0, 1, 0])])`, `mixer.play(bob)`; `mixer.clipAction(bob).seek(0.5)` poses the clip at 0.5 s now, playing or not (a stopped action keeps it until a playing one writes over it) |
| `buffer` | a geometry built by hand | `geometry.createBuffer({ position: buffer.float32(vertices, 3), index: buffer.uint32(indices) })` |
| `effect` | post-processing | [Canvas, camera and teardown](#canvas-camera-and-teardown) |
| constants | `blending`, `side`, `wrap`, `filter`, `colorSpace`, `toneMapping`, one named value per constant | `steel.side = side.double`, `glass.blending = blending.normal`, `world.toneMapping = toneMapping.aces` |

Eight more exist because geometry is **cut into pages** the engine moves in and out of memory
according to what the frame reads:

| Family | Members | What it does | Example |
| --- | --- | --- | --- |
| `page` | `createStreamer`, `createCache`, `httpSource`, `decode` | geometry in pages | `page.createStreamer({ source: page.httpSource('assets/forest/'), workers: 4 })`, passed as `scene.load(url, { stream })` |
| `budget` | `memory`, `geometryPool`, `texturePool` | fixed envelopes, not wishes | `world.budget.geometryPool = 512 * 1024 * 1024` |
| `metric` | `frame`, `cpuSteps`, `gpuPasses`, `createProfiler` | what the image cost, never estimated | `metrics.selectedTriangles`, `metrics.residentPages` in `world.onFrame`; `metric.createProfiler(world)` |
| `diagnostic` | `createChannel`, `presentationColor`, `partitionAudit`, `transparentOcclusion`, `shadowAtlas` | watching the engine work | `world.diagnostic.mode = 'clusters'` (or `'wireframe'`, `'triangles'`, `'beauty'`) |
| `capability` | `detect`, `lighting` | what the machine grants, before an image is promised | `(await capability.detect()).webgpu` |
| `capture` | `surface`, `buffer` | an image aside, at another resolution, without touching the view | `capture.surface(world, { width: 3840, height: 2160 })` |
| `pose` | `fromBounds`, `runPath`, `pointOfInterest` | named poses, automatic framing, replaying a path | `world.camera.set(pose.fromBounds(math.box3().setFromObject(set)))` |
| `batch` | `transformPoints`, `composeMatrix4`, `frustumKeepsBox` | a thousand matrices at once instead of a loop | `batch.composeMatrix4(outputs, positions, quaternions, scales, 1000)` |

The world is not a family: it is the object `createWorld` returns, carrying `scene`, `camera`,
`budget`, `diagnostic`, `controls`, `onFrame`/`loop`, `render`, `invalidate` and `dispose`. There is
no level-of-detail object and no instanced or batched mesh type: one cut through a DAG per frame,
instancing and draw grouping are native.

In a compiled scene, moving a node or its parent updates its resident lighting proxy (the one
distant sun shadows use while bounce is off included) and restarts bounce probe convergence, with no
invalidation call. This needs a version-3 proxy cache (recompile older ones); motion keeps proxy
surfaces but cannot restore geometry discarded while cooking
([FORMAT.md](FORMAT.md#resident-lighting-proxy)).

## Loop

The world owns the loop and stops when the image is stable: after 120 frames with nothing changing
it pauses (`interactive-settle-limit`), and resumes on invalidation. A frame after which a page
landed does not count, so a streamed view is drawn to its last page. A still scene costs nothing.
`onFrame` is the per-frame hook; `loop` is its alias.

```js
// 1. The world leads; you give it work per frame.
world.onFrame(({ delta, metrics }) => {
  ball.position.y = 1 + Math.sin(performance.now() / 500);
  world.invalidate(); // I moved something: draw again
});

// 2. You lead; the world schedules nothing.
const world = createWorld('viewer', { interactive: false });
function tick() {
  ball.rotation.y += 0.01;
  world.render();
  requestAnimationFrame(tick);
}
tick();
```

`world.render()` runs the loop's frame — clips, physics and `beforeFrame` hooks advance; only the
camera's controller is left to the host. A value written on a node (`mesh.position.x = 100`,
`mesh.visible = false`, a light's intensity, colour or pose) and a light added or removed are seen
by the next frame, with no call. A node the page holds no handle to is moved by its name
(`object.name`): `world.setTransform(name, matrix)` writes its world pose, brought into its
parent's space, on the name-indexed path WebGPU and WebGL2 share. An asynchronous render failure
stops automatic work, emits `INTERACTIVE_RENDER_FAILED` as a diagnostic and reports the error as an
uncaught one (`reportError`), so the page's `error` listener sees it.

## What draws: the renderer option

Saying nothing is the normal case; there is no `auto` value:

```js
createWorld('viewer'); // the engine takes the best path the machine grants
createWorld('viewer', { renderer: 'webgpu' }); // forced; a machine without it is refused BY NAME
createWorld('viewer', { renderer: 'webgl2' });
```

Forcing one and being served the other silently is the one outcome this must never produce.
Unforced, WebGPU draws when the machine grants a device, the engine's WebGL2 page path otherwise;
granting neither raises `EngineError('NO_ENGINE_BACKEND')` (`NO_WEBGL2` from the capability probe
before it) ([ENGINE.md](ENGINE.md#which-backend-renders)).

## Canvas, camera and teardown

The drawing buffer follows the canvas's CSS box, and `pixelRatio` the browser's (later DPR changes
included), unless set; `world.resize(width, height)` sets a size, omitted arguments reading the CSS
box. A canvas hidden or zero-size at creation needs an explicit `resize()` or showing first; one
hidden later keeps its last size. The host keeps the canvas element and its layout.

`world.pixelError` is the DAG cut's screen error in pixels (`0` by default, the exact leaves; a
positive value selects coarser pages when the cache has them). `pose.fromBounds(box)` frames a box;
`pose.pointOfInterest(name, pose)` names one; `pose.runPath(world, poses, { images })` replays a
path — an exact A/A image gate, then timed blocks, not a general performance verdict.

`world.temporalAntialiasing` (`createWorld(target, { temporalAntialiasing })`, `true` by default)
jitters each image by a sub-pixel offset and accumulates; `false` draws pixel centres with no
history, as a pixel-exact capture needs. A write applies next frame, history dropped, no session
reopened; a read says what the image carries: `false` on WebGL2 (`temporal antialiasing`
unsupported).

`world.renderScale` (`createWorld(target, { renderScale })`, `'auto'` by default) is the per-axis
fraction of the display drawn before temporal antialiasing rebuilds the image: `'auto'` lets the
frame budget (the display's refresh interval) choose between 0.5 and 1, `{ min, max }` bounds it, a
number fixes it. A still image over budget is drawn below the display too, its jitter phases
rebuilding the display's detail; the controller learns from the whole-frame GPU time, or from the
frame interval without GPU timestamps. The render targets follow the drawn size on a ladder of
eighths of the display, the temporal history kept across a step. A write applies next frame; a read
is the last image's scale. WebGL2, without history, resamples to the display (Lanczos-2): its
`'auto'` holds 1, and only a `{ min }` below 1 or a fixed scale draws below the display
(`temporal upscaling` unsupported).

`world.effects` is the ordered chain of passes after temporal antialiasing, before the canvas, on
both renderers. `effect.bloom({ intensity, radius })` is a physically based, energy-conserving glow
on the linear image before tone mapping: `intensity` (0 to 1, `0.04` by default) the share of the
image it replaces, `radius` (`1` by default) the spread per level, in that level's texels.
`world.effects.add(pass, index?)`, `remove(pass)` and `clear()` change the chain; settings show next
frame. An empty chain costs nothing; a still image is post-processed once. On WebGL2 a frame with a
transparent surface in `multiply` or `subtractive` blending is drawn without the chain (its linear
target cannot hold them; WebGPU can), said once as `effects-refused-blending`, the chain back once
no such surface is drawn.

```js
const glow = effect.bloom({ intensity: 0.08 });
world.effects.add(glow);
glow.radius = 2;
```

Dispose in the component or page teardown, **not immediately after startup**: `world.dispose()`
removes owned controls, observers, queued frames and abort listeners and closes the engine, keeping
the canvas. `createJob` (from `trillion3d` and the portal's runtime) wraps
`scene.load(url, { signal, onProgress: progress })` for cancellation and an observable status, the
job's progress being the load's.

### Camera controllers

The engine's controllers read `PointerEvent`, `WheelEvent` and `KeyboardEvent` on the world's canvas
and write the camera's pose. A world asks for one at creation and drives it through the live
`world.controls` handle:

```js
const world = createWorld('viewer', { controls: 'orbit' }); // at creation
world.controls.kind = 'fly'; // switch live
world.controls.enabled = false; // pause input
world.controls.target.set(0, 1, 0); // orbit pivot
```

They live on the world because they read its canvas — a second listener would double the gestures —
and follow `world.camera` when it is replaced. Setting `kind` releases the previous controller and
builds the next; `.enabled` pauses the current one. Live examples, one world per controller:
[orbit](../site/examples/orbit-around-a-clockwork.html),
[panZoom](../site/examples/a-game-board-seen-from-above.html),
[trackball](../site/examples/spin-an-astrolabe.html),
[fly](../site/examples/fly-over-a-model-town.html),
[character](../site/examples/walk-through-a-temple.html) and [character with
physics](../site/examples/walk-with-collisions.html); `firstPerson` is the same head without a body.

| `world.controls.kind` | Motion | Gestures |
| --- | --- | --- |
| `'orbit'` | orbit around `target`, world up kept | drag turns, secondary drag or two fingers pan, wheel and pinch zoom |
| `'fly'` | six degrees of freedom | `W`/`S`, `A`/`D`, `R`/`F`, arrows, `Q`/`E` roll, drag to look |
| `'firstPerson'` | pointer-locked walk, horizon level | pointer turns the head, `W`/`S`/`A`/`D`, `Space`/`Shift` |
| `'character'` | a body that walks, runs, jumps and falls | pointer turns the head, `W`/`S`/`A`/`D`, `Shift` sprints, `Space` |
| `'vehicle'` | none: drives `world.controls.vehicle` | `W` throttle, `S` brake, `A`/`D` steer, `Space` handbrake |
| `'trackball'` | free spin about the screen axes, roll included | drag spins, secondary drag pans, wheel zooms |
| `'panZoom'` | planar view, no rotation | drag slides, wheel and pinch zoom, arrow keys pan |
| `'none'` (default) | camera posed by the host | none |

All publish `object.position`, `addEventListener('change')`, `removeEventListener` and `dispose()`;
the three with a pivot add `target`, `minDistance`, `maxDistance`, `enableZoom`, `enablePan` and
`update()`, which reads back and clamps a pose the host wrote. `change` fires only when the pose
moved, so a still scene schedules nothing.

**The character's body.** `'character'` moves an upright capsule with an adult human's values
(`HUMAN_BODY`: 1.75 m, a 3.5 m/s jog, a 0.5 m jump, 45° slopes, 0.5 m steps, 80 kg, a 250 N push),
each a setting of `world.controls`. It collides with:

- **without physics**, the static triangles of `world.controls.colliders` (meshes, built into a
  triangle tree once), or nothing: it walks level where it stands;
- **with physics on** (`world.physics`, [PHYSICS.md](PHYSICS.md)), everything: it is Jolt's
  virtual character in the physics worker, climbs steps and slopes, rides a moving platform, pushes
  dynamic bodies with at most `pushStrength` newtons and is pushed back. `colliders` is unused; give
  the level `mesh.physics = 'static'`. The keys reach the worker's next fixed step; the page draws
  the feet it last reported, moved on by their velocity, at most one step ahead.

Both read one drive (`characterDrive.ts`): speed gathered over `responseTime`, lost over `stopTime`,
jumps with a coyote time and a jump buffer. No leg changes ground speed faster than friction lets a
sole push, `μ g`, `μ` a rubber sole's grip on the matter underfoot (the geometric mean of the two
frictions, the physics' rule): with physics, that body's (`material.physics`, a body's `friction`);
without, declared stone. A jog reaches pace in 0.45 s on stone, 2.2 s on ice, and glides
`v² / (2 μ g)` to a stop, 0.8 m on stone, 3.8 m on ice; the two times only shape the last
centimetres. The triangle body catches up every tick, dropping only a stall past 0.25 s
(`MAX_CHARACTER_DELTA`); Jolt's steps on the worker's clock, drawn late but never slower by a slow
page, a stalled worker dropping what its catch-up ceiling cannot hold (`MAX_CATCH_UP_STEPS`).

```js
const world = createWorld('view', { controls: 'character', physics: true });
floor.physics = 'static';
crate.physics = { type: 'dynamic', mass: 12 };
world.controls.pushStrength = 400; // a stronger push
```

**Vehicles.** `'vehicle'` maps the keys to a `VehicleInput` (`throttle`, `brake`, `steer`,
`handbrake`) and hands it to `world.controls.vehicle.drive(input)` on each change. Any object with
`drive` can be driven, the physics' vehicles first (`vehicle.car`,
[PHYSICS.md](PHYSICS.md#vehicles)). `kind = 'vehicle'` while `vehicle` is `null` throws
`NO_VEHICLE`. The camera does not follow: the page moves it.

### Picking, moving and saving

`world.raycast(at)` returns the nearest object under a canvas point (CSS pixels,
`event.offsetX`/`offsetY`) or along a world `Ray`, or `null`: the node the page added, world `point`
and `normal`, `distance` (world units; the direction is normalised) and triangle rank `face`. It
runs on the CPU over the scene's own geometry: meshes triangle by triangle; lines, points and
sprites never; a loaded model (its triangles are GPU pages) on its box, or at the ray's origin from
inside (`distance` 0, `normal` back along the ray); hidden subtrees and `helper` marks skipped. A
canvas point is aimed at the drawing buffer's shape; `{ objects }` limits the subtrees; a sizeless
canvas refuses a point with `RAYCAST_NO_VIEW`. `raycast(roots, ray)` returns every hit on any
subtree, nearest first; `camera.rayThrough(x, y, aspect)` is the ray through a picture point; the
exact raycast is [PHYSICS.md](PHYSICS.md#exact-raycast). An orthographic camera made with
`fitAspect: true` (off by default) keeps its box's height and centre and takes its width from the
canvas, in frame and rays. Triangle trees are kept within `world.budget.raycastTrees` bytes (64 MiB
by default, settable, shared by every world on the page), the least recently cast dropped past it;
`geometry.dispose()` drops its own. Live example: [click to
pick](../site/examples/click-to-pick.html).

```js
world.canvas.addEventListener('click', (event) => {
  const hit = world.raycast({ x: event.offsetX, y: event.offsetY });
  hit?.object.material.color.set('#ffb347');
});
```

`controls.transform(world, options)` puts move, turn and scale handles on one object:
`attach(object)`, `detach()`, `setMode('translate' | 'rotate' | 'scale')`,
`setSpace('world' | 'local')`, `snap = { translate, rotate, scale }`, events `change`, `dragStart`,
`dragEnd` — one drag, one undo step. The handles are unlit, depth-tested `geometry` meshes at one
share of the canvas height (`size`, a quarter by default), marked as `helper`s, picked before the
camera controller hears the press, so an orbit rests during a drag. A drag writes the local pose
from the world pose asked, through the parents; a scale follows the object's axes; the centre cube
scales uniformly, up the screen by the handles' length multiplying the size by e, down dividing it
by e. `attach` or `detach` mid-drag ends it with its `dragEnd`. The handles follow the view after
each frame drawn. Live example: [move, rotate,
scale](../site/examples/move-rotate-scale-gizmo.html).

`scene.toJSON(camera)` writes plain, versioned JSON (`format: 'trillion3d-scene'`,
`formatVersion: 2`; version 1, whose meshes' `castShadow` no renderer read, is refused): hierarchy,
poses, each shape by the call that built it (`geometry.box(2, 1, 1)`; one changed after, or
hand-written, by its vertices), materials by parameters, bodies as `physics` declared them (type,
mass, shape, gravity scale, sensor, CCD, debris, matter overrides, damping, a soft body's settings;
at rest, no velocity), lights, background, fog, the camera's pose. Shared shapes and materials are
stored once, a loaded model by its manifest address, `helper` marks left out. A texture, a picture
environment, a shader material or a number JSON cannot hold (an `Infinity` other than a free bend's)
is refused (`SCENE_NOT_SAVABLE`). `await scene.fromJSON(json, camera)` replaces the content
(`helper` marks kept) and reloads the models; another format or version is refused
(`UNSUPPORTED_SCENE_FORMAT`) before anything is removed. Calls during a read wait and run in order,
each replacing the last: two saves never merge. A shape family builds at least the pieces it closes
with (a box one slice per side, a sphere three around and two down), its stored call giving the
count built. Live example: [save the scene](../site/examples/save-the-scene.html). The portal's
scene editor (`site/app/editor/`) is these three doors and nothing else: pick, move, recolour, save
and open a scene, the frame's cost read live.

### Live material values

A placed material written on `color`, `emissive`, `emissiveIntensity`, `metalness` or `roughness`
is repainted in place: the session rewrites the rows that read it and opens nothing (#335); a
colour picker dragged for ten seconds keeps one session. A change it cannot hold in place — a
texture, a kind, a side, transparency, a material object whose values another shares — is copied on
write and reopens the session, once per burst; `world.diagnostic.sessions` counts the sessions a
world opened.

`material.meshPhysical` accepts `anisotropy` (strength, 0–1), `anisotropyRotation` (direction,
radians), `clearcoat` and `clearcoatRoughness`. WebGL2 draws these lobes with `anisotropyMap`,
`clearcoatMap`, `clearcoatRoughnessMap` and `clearcoatNormalMap` with `clearcoatNormalScale`, each
map keeping its native dimensions, filtering, wrap, UV channel and transform; the anisotropy map's
RG direction and B strength, clearcoat R and roughness G are linear data. The brushed-metal and
car-paint examples select WebGL2 explicitly; the WebGPU page raster does not support them.

Lit materials can declare `subsurfaceColor` and an optional `subsurfaceMap` for thin
**double-sided** surfaces such as foliage: the color (black, disabled, by default; independent of
`color`) tints light arriving through the back, the texture multiplies it with its own UV
transform. Diffuse thin-surface transmission, not a volume random walk: a glass volume uses
physical `transmission`, `thickness`, `attenuationColor` and `attenuationDistance`.

With `transparentShadow: true`, normally blended glass tints the existing shadow-transmittance layer
by its base color and texture. A nonzero volume thickness applies Beer attenuation once at the
entrance of a closed mesh, scaled to world units along the light ray: the declared-thickness raster
approximation, not geometric entry/exit ray tracing. Thin sheets keep independent front and back
boundaries. Alpha-only blended shadows preserve their previous coverage behavior; BLEND/MASK
classification remains in the compiler. A shadow-casting point light with positive `radius` uses
contact-hardening PCSS, its penumbra widening with source radius and receiver separation; radius
zero keeps the existing PCF path.

### Geometry rewritten every frame

A shape rewritten every frame — a sea, a cloth, a flag, a procedural mesh, an editor handle —
declares `geometry.usage = 'dynamic'`. Its triangles are cut into pages once, index alone, and a
written list (`attributes.position.needsUpdate = true`) uploads in place the vertices from the first
changed to the last, the frame after, with no cut and no session reopened (#573). It is drawn by the
same visibility, Hi-Z, resolve, shadows and lighting as every paged mesh; a rewrite stales only the
shadow pages its moved vertices cover. A geometry changed on two consecutive frames turns dynamic by
itself, said under `geometry-dynamic` with the mesh named. A soft body's geometry is dynamic, drawn
where its last step left it; two soft bodies in one geometry are refused with `PHYSICS_FAILED` —
give each its own (`geometry.clone()`).

Culling reads a box the vertices never leave: `geometry.maxBounds` if declared, else the first
vertices' box widened by half its size; vertices leaving it serve the same pages in a larger box,
and changed corners are cut anew. A frame sends at most `DYNAMIC_UPLOAD_BUDGET_BYTES` (4 MiB), every
buffer written counted, as `metrics.dynamicUploadBytes` reports; a rewrite past it waits for the
next frame, in order, never dropped. Live example:
[floating crates](../site/examples/floating-crates.html).

```js
const sheet = geometry.plane(28, 20, 112, 80);
sheet.usage = 'dynamic';
world.onFrame(({ metrics }) => {
  for (let v = 0; v < sheet.attributes.position.count; v++)
    sheet.attributes.position.setY(v, wave(v));
  sheet.attributes.position.needsUpdate = true; // 9 000 vertices, uploaded in place
  console.log(metrics.dynamicUploadBytes);
});
```

### Guides: lines, points and helpers over the image

`world.guides` draws what a page shows _about_ its scene — an axis, a grid, a box, a measured
segment, a light's cone — without adding it to the scene: not paged, drawn by its own pass after the
image is composed, as quads of a fixed CSS-pixel width (`width × pixelRatio`, with the engine's line
corner, `lineClip`), hidden by what stands in front (depth read, never written), outside temporal
accumulation, so it neither smears nor shimmers.

```js
const grid = world.guides.add(helper.grid(20, 20), { width: 1.5 }); // any helper; it follows it
const cone = world.guides.add(helper.spotLight(spot)); // follows the light, no update() needed
const ruler = world.guides.lines({ positions: [0, 0, 0, 4, 0, 0], color: '#ffd24a', width: 3 });
const marks = world.guides.points({ positions: [0, 0, 0, 4, 0, 0], color: '#ffd24a', size: 8 });
ruler.setVisible(false); // kept, not drawn
grid.setTransform(model.matrixWorld); // placed by the page: it stops following its node
marks.remove();
```

- `add(object, { width, size })` reads an object's line and point meshes (every `helper` builds
  them) in their material colours; triangles, like an arrow's head, are not guides. The guide
  follows the object's world transform (a light's or camera's helper: that light's or camera's),
  read at each image and moved only on change; `setTransform` hands it to the page. `lines` takes
  two ends per segment, `points` one position per dot.
- Each call answers a handle: `setVisible(on)`, `setTransform(matrix)` (sixteen column-major
  numbers or a matrix), `remove()`; `world.guides.clear()` removes all. Re-placing a guide at its
  pose changes nothing, so a page may do it every frame and a still view stays held.
- A world's guides hold at most `GUIDE_VERTEX_CEILING` (65,536) vertices, two per segment, one per
  dot, hidden ones included; a call beyond throws `EngineError` `GUIDE_CEILING` and adds nothing.
  `world.guides.vertexCount` reads what is held.
- Off by default and free unused: with no guide shown the pass is neither built nor encoded. A
  guide change redraws one frame and leaves temporal accumulation as it was.
- WebGPU draws them over its display target with the reversed depth, WebGL2 over the composed frame
  with the forward depth. The WebGPU scene depth carries the temporal sub-pixel jitter and the
  guides do not, so a guide on a surface is tested with the depth that jitter moved there (the
  jitter times the surface's depth slope): a grid on a floor or a box's edges stay whole on a still
  view. Positions are packed relative to the first guide, in double precision, so a guide far from
  the origin keeps its detail.
- Text labels are not guides and are not drawn; a public `addLabel` is #1200.

## Installation and environment API

An application installs the package from npm, `npm install trillion3d`, which takes only its
machine's compiler package ([COMPILER.md](COMPILER.md#platform-packages)); the portal's
[Install page](https://www.trillion3d.com/#/en/learn/install) goes from the install to a drawn
model. Its export conditions are in [Entry points](#entry-points). The licence is PolyForm
Noncommercial 1.0.0 ([LICENSE](../LICENSE)): free for noncommercial use; a commercial use needs a
licence from the owner.

| Task | Examples |
| --- | --- |
| Common API | `SDK_VERSION`, `FORMAT_VERSION`, `assertFormat`, `EngineError`, batch maths, hierarchy, camera calculations, diagnostics, lighting contracts, jobs and safety policy |
| Native preparation | `prepare`, `prepareMany`, `createCompilationJob`, `createTerminalProgress`, `createBatchProgress`, `reviewCutouts`, `getSdkProvenance`, the `trillion3d-compile` CLI |
| Browser rendering | `createWorld` and the families it hands a page, plus `detectCapabilities` |

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

A Node TypeScript host uses `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` and
`"types": ["node"]`; NodeNext then selects the Node declarations from the same specifier.

The browser runtime is not a zero-configuration single-file bundle. Configure the bundler with
`trillion3d` as the application entry, the installed decode and integration worker files as
separate module-worker entries, and code splitting enabled. Copy the installed `pageCodec.wasm`
beside every emitted chunk that keeps its relative URL, and serve that output directory together
with the compiled scene cache. `pnpm run proof:package -- --browser` is the repository's executable
esbuild configuration and verifies both worker tasks and WASM selection; `-- --bundle` emits and
checks the same output, each module beside the chunk that fetches it, without a browser.
`pnpm run proof:install-page` walks the portal's Install page through in a clean folder: its
commands, the packed archive standing in for the registry, compile the example's morphing cube and
its page draws it in Chrome, served with the page's two headers.

### Install requirements: the package alone, the witnesses beside the bench

A browser host installs `trillion3d` and, for its types, `@webgpu/types`; nothing else. The package
declares, ships and pulls no rendering library: a clean install of the packed archive has no
`three` in its tree (`tests/integration/installed-package.test.ts`), and the runtime build refuses
an `engine.js` that folds one in (`scripts/docs/build-runtime.ts`). No public API takes or returns a
Three.js object. The witnesses live beside the bench (`bench/witnesses/`) and plug into the
measurement seam through its backend list; `three` is a development dependency of this repository
alone (#275).

## Compiling from Node

`prepare(input, output, scope, budget, options)`, `prepareMany(jobs, options)` and the
`trillion3d-compile` CLI relay to the native executable. Arguments, events, the pointer, batch mode,
cancellation, exit codes and the executable's selection (`options.executable`, then the installed
platform package, then `TRILLION3D_COMPILER_BIN`, then the development build) are in
[COMPILER.md](COMPILER.md#using-it-from-node). An installed `trillion3d` takes the compiler from its
platform package ([COMPILER.md](COMPILER.md#platform-packages)); elsewhere it needs
`options.executable` or `TRILLION3D_COMPILER_BIN`, and fails without them with
`COMPILER_EXECUTABLE_MISSING`, or `COMPILER_PLATFORM_UNSUPPORTED` on a machine the compiler is not
built for. Every error carries its public code and a link to its page
([COMPILER_ERRORS.md](COMPILER_ERRORS.md)).

## Scene hierarchy foundation

Below `world.scene`, the common facade publishes the DOM-free transform foundation, scene-model
version `SCENE_MODEL_VERSION` 1: `SceneRoot` and `createSceneRoot`, for a tree kept outside a world.
Nodes from `root.createNode({ id, visible })` have stable, root-unique ids; `add` and `reparent`
keep the local pose, `attach` the world pose (`shelf.attach(crate)` rewrites the crate's local pose
from its world matrix seen from the shelf; a sheared result loses its shear, as with the reference;
an `Object3D`'s `position`, `rotation`, `quaternion` and `scale` follow). `remove` and `clear`
detach; `destroy` permanently invalidates a subtree. `clone` gives a fresh id unless one is given,
`copy` keeps the destination's; both reproduce the local pose and optionally the descendants.
Copying an ancestor recursively into its descendant is rejected with `SCENE_COPY_OVERLAP`, nothing
changed. Nodes of different roots never combine, duplicate ids are rejected, a cycle leaves the
hierarchy unchanged. Setters mark the transform dirty: call `updateWorldMatrix()` before reading
`worldMatrix`; the matrix views are read-only by contract.

```javascript
import { createSceneRoot } from 'trillion3d';

const scene = createSceneRoot({ id: 'warehouse' });
const shelf = scene.createNode({ id: 'shelf' }).setPosition(2, 0, -4);
const crate = scene.createNode({ id: 'crate' }).setScale(0.5, 0.5, 0.5);
scene.add(shelf);
shelf.add(crate).updateWorldMatrix();
```

`TransformNode` (browser facade) reads that node through the reference's matrices: `matrix` and
`matrixWorld` view its slot, `matrixAutoUpdate` and `matrixWorldNeedsUpdate` are its flags,
`updateMatrixWorld(force)` the reference's rule. `Object3D` and the engine's graph extend it; each
node lists its children, so an update or walk costs its subtree only. The objects share one
hierarchy holding none of them: a dropped object frees its slot when collected, `destroy()` a
subtree at once.

The engine's graph uses the same classes — `Object3D`, `Group`, `Mesh` (or the core's instanced
mesh), `Scene`, `Camera`, `Light` (read its `kind`; a `rectArea` for a rectangle, a `probe` with its
27 coefficients in `sh`) — and every browser-facade function on graph nodes names `Object3D`. The
engine numbers its scenes, cameras, meshes and lights in one count kept beside them, so a page's
node carries none. A light hears its colours and target only while in a world. The WebGL2 cluster
path draws directional, point, spot, rectangle, ambient and probe lights and refuses a `hemisphere`
light by name (a world hands it the sky over a ground as the environment's irradiance). A `Scene`
built with no loader, as the engine's own, refuses `load` (`UNSUPPORTED_SCENE_UPDATE`); its
`onBeforeRender` and `onAfterRender` (none by default) run around each draw. A `Camera` publishes
its projection in the reference's convention, finite far plane, as `projectionMatrix` (made at
first read, recomposed at each optic write), and its world matrix's inverse as
`matrixWorldInverse`.

`clone(recursive)` returns the same class (`Group`, `Light`, `Camera`, a graph node its kind) with
name, pose, matrices, flags, `userData`, and a `clone` of each child unless `recursive` is `false`;
`copy(source, recursive)` writes the same into an existing node; a class whose constructor takes
arguments says how an empty one is made (`blank`). A `Light` also keeps colours, intensity, range,
cone, coefficients and target; a `Camera` its optics (`fov`, `near`, `far`, `aspect`, `zoom`, the
orthographic box); a `Mesh` its primitive, sharing geometry and material. Cloning a `Scene` or
`LoadedModel` throws `UNSUPPORTED_SCENE_UPDATE`. `cloneObject` is the deep copy, sharing nothing.

Attributes are a `BufferAttribute` owning its numbers (a `BufferTypedArray`) or an
`InterleavedBufferAttribute` viewing `itemSize` numbers at `offset` of each vertex of an
`InterleavedBuffer`; `VertexAttribute` names either.
`new BufferAttribute(array, itemSize, normalized)` reads and writes a normalised integer as its
value over its type's largest; `needsUpdate = true` bumps `version` (the buffer's, for a view),
compared before re-uploading; `addUpdateRange` limits the upload to the numbers written; `clone()`
copies numbers, type, normalisation and name, a view's clone owning its numbers.

The engine draws a world's `Geometry` itself: `attributes` of any `VertexAttribute`,
`morphAttributes` (one per morph target per morphed attribute), `morphTargetsRelative` (targets
hold displacements), `drawRange`, `name`, `userData`, `kind` (`'geometry'`). `computeBoundingBox()`
and `computeBoundingSphere()` span every vertex and morph shape, the sphere centred on the box and
reaching the farthest vertex.
Positions are used at the value they stand for: a normalised integer scaled back, a two-number
position in the plane z = 0. Setting an attribute other than `position`, the index or a group keeps
the bounds. `clone()` copies every list, morph target, group, range, data, bound and recipe;
`toNonIndexed()` gives each corner its own vertex; `dispose()` runs each `released` hook once. A
geometry no mesh wears gives back its pages and GPU memory on both backends, with no call; replacing
a mesh's geometry, as a slider does, disposes the former, raycast tree and host copies included.

## Batch math for hosts

Unit and batch maths (`n` elements per call, flat typed arrays, no allocation), their witness
ratios and declared exceptions: [MATHS.md](MATHS.md).

## Page materials

Once `await world.awaitPages()` has opened the drawing session, a page reads and edits a loaded
model's materials through its `world`:

| Call | Result |
| --- | --- |
| `world.materials()` | `SceneMaterial[]`: the current materials in cache table order, then the page's, as detached copies with `id`, `name`, `baseColor`, `opacity`, `metalness`, `roughness`, `emissive`, `side`, `alphaMode`, `alphaCutoff` and `tiling` (`null` without a map) |
| `world.material(id)` | one by listed ID; an unknown ID raises `UNKNOWN_MATERIAL` |
| `world.importedMaterials()` | the source file's values, whatever the page changed; created materials excluded |
| `world.setMaterial(id, patch)` | every surface built from it, next frame; `true` if every renderer took it in place, `false` if one needs a new session |
| `world.createMaterial(props?)` | a page-owned material, at most 256 per session (`MATERIAL_CEILING` past it, nothing created) |
| `world.dropMaterial(id)` | releases an unused created material, its variants, map and accounted bytes |
| `world.materialMapBytes()` | runtime map bytes held and pending, under the fixed 64 MiB ceiling |
| `world.assignMaterial('mesh/primitive', id)` | a created material on a compiled primitive — `world.assignMaterial('mesh/primitive', created.id)`, numbers from `metadata.primitives`; unknown: `UNKNOWN_SCENE_NODE` |

A patch sets `baseColor` (three linear channels, 0 to 1), `opacity`, `metalness`, `roughness` and
`alphaCutoff` (each 0 to 1), nonnegative linear `emissive`, `alphaMode` (`'opaque'`, `'mask'`, `'blend'`)
or nonzero finite `tiling`, which needs a map only that material uses (`MATERIAL_TEXTURE_SHARED`).
An invalid field or value raises `INVALID_MATERIAL` before any write. Changing between opaque,
masked and blended moves the drawables' draw class; a renderer unable to in place raises
`MATERIAL_CLASS_CHANGE` first, so the page can keep the old material.

`world.createMaterial({ name?, baseColor?, opacity?, metalness?, roughness?, emissive?, alphaMode?, alphaCutoff?, map? })`
returns its record synchronously; with an `ImageBitmap` `map`, a promise to await before assignment
(`const created = await world.createMaterial({ map: bitmap })`), a failed upload publishing nothing
and returning its reserved bytes. The bitmap is borrowed: decode with `premultiplyAlpha: 'none'` and
`colorSpaceConversion: 'none'`, and close it yourself once the material is dropped or the session
disposed and pending creations settled. Each material owns its texture, even two from one bitmap.
Runtime maps have a fixed 64 MiB decoded RGBA ceiling, checked before allocation (`TEXTURE_BUDGET`);
`material-texture-appended` reports upload bytes and CPU time, not GPU time. Created materials are
read and edited by ID like imported ones, `tiling` set-only. Dropping an assigned material raises
`UNSUPPORTED_SCENE_UPDATE`: assign a replacement first. Dropped IDs are never reused; GPU pools keep
reusable capacity within budget. [Live page-material example](../site/examples/page-materials.html).

## Lights

Only a light the host declared lights an opaque surface: no fixed ambient, constant sky or authored
scene lighting; a windowless corridor stays black at noon. Emission, a material property, is always
added. `world.exposure` is the camera exposure on linear radiance before tone mapping, not a light.
`material.meshNormal()` and `material.meshDepth()` surfaces are output as stored, without exposure
or `world.toneMapping`, as in the reference. A map a family's model never reads — a `meshToon`
`gradientMap`, a `meshMatcap` `map`, the `normalMap` of a `meshMatcap` or `meshNormal` surface — is
refused by name, never silently dropped; `meshMatcap`, `meshNormal` and `meshDepth` ignore an
`aoMap`, as the reference does.

`scene.background` is the colour behind every object (`null`: the default); set or written through
its methods (`scene.background.setHSL(...)`, `set`, `setRGB`, `setHex`), it shows next frame,
session kept; a direct `.r`, `.g` or `.b` write needs `scene.background` set again. A picture
background, or any value without `getHex`, is refused (`UNSUPPORTED_SCENE_UPDATE`): no path draws
one yet.

### Scene fog

`world.scene.fog` places distance or height fog over opaque and transparent surfaces on WebGPU and
WebGL2; its `color` is a linear-RGB `Color`, `null` (the default) none. Distance is from the camera;
height uses the scene's positive Y:

```js
import { Color } from 'trillion3d';

const color = new Color().setRGB(0.35, 0.45, 0.6);
world.scene.fog = { color, near: 10, far: 100 }; // Linear: clear before 10, all fog after 100.
world.scene.fog = { color, density: 0.02 }; // Exponential: uniform medium.
world.scene.fog = { color, density: 0.02, heightFalloff: 0.15, baseHeight: 0 }; // Height fog.
world.scene.fog = null; // No fog.
```

`near` and `far` are finite with `0 ≤ near < far`; `density`, `heightFalloff` and the colour
components finite and nonnegative; `baseHeight` finite; otherwise `INVALID_SCENE_ENVIRONMENT`. A
new fog, or a colour changed by a `Color` method, applies next frame; after writing `near`, `far`,
`density`, `heightFalloff` or `baseHeight` directly, assign `scene.fog` again. A `fog: false`
material stays unfogged on both renderers. The scene contract's `SceneEnvironment.fog` takes a
three-number linear colour and the same fields (omitted: no fog); `SavedScene.fog` stores the same
`SceneFog`, or `null`. How the renderers apply it: [fog lighting law](ENGINE.md#fog).

### Declared lights

Lights are declared like any object:
`scene.add(light.point({ intensity: 2, position: [0, 3, 0] }))`, `light.intensity = 2` afterwards,
`scene.remove(light)`. Each is a `SceneLight` (version 2): `point` and `spot` carry `position` and
`range` in metres, `spot` also `direction` and a `coneAngle` half-angle; `directional` (sun,
overcast sky) only `direction`, the propagation direction, refused with a `position`, a `range` or a
`coneAngle`. All carry linear `color`, a positive radiometric `intensity` and `castsShadow`.

No bound on the count: a 16×16 screen tile lists up to 64 lights reaching it, past that exactly
those reaching it from a pool sized from the view (#849); WebGL2 lights each fragment by the lights
reaching its light-grid cell (#835). 64 shadow slices, past which a caster lights without a shadow
(`shadowCastersUnsliced`); every stale page the image reads is drawn in its frame, with no
page cap ([SHADOWS.md](SHADOWS.md#when-a-page-is-stale-withdrawn-and-drawn)). The shadow pool is sized at
the first casting frame from its screen and shadowed lights — layers of 128² pages as wide as the
device draws, within the shadow share — and resized with the canvas, held pages kept (#1208).
`metric.frame(world)` publishes `shadowPoolBytes`, `shadowPoolLayers` and the pressure
(`shadowPeakBytes`, `shadowResolutionBias`, `shadowMemoryEvents`); internals:
[SHADOWS.md](SHADOWS.md).

### A lamp's range is authored, and no frame shortens it

`range` is the lamp's attenuation radius in metres, the reference engine `AttenuationRadius`: influence ends
there through the window `(1 − (d/range)⁴)²`, and a `point` or `spot` shadow map is built to it.
The page sets it (`light.distance`); unset, the world derives one from the scene's extent. Every
path — the world, a source file, `addLight`, `setLight` — stores it as-is: no exposure, curve or
threshold shortens it (#958). A cut that pays moves lamp-pool edges visibly at night; one held under
a display step pays under one per cent of the range.

`capability.lighting(world)` reports what the **active** renderer applies — `{ sceneLights,
lightingView, shadows, transforms, reason? }` — not what the contract accepts; `reason` names in one
sentence what is not applied.

### Every mesh casts a shadow unless it says `castShadow = false`

Under a casting light (the light's `castShadow: true`, `false` by default), every opaque mesh
casts, as in the reference engine (a mesh's `castShadow` defaults to `true`).
`mesh.castShadow = false`, written any time, leaves every shadow map; the mesh still receives
shadows. An outline drawn as a larger copy of its part wants it off, or it shades the part.

### A see-through surface casts no shadow unless it asks

A blended material (`transparent: true`) lets light pass, as glass, smoke and a light beam do in the
reference solution. `transparentShadow: true` asks for a shadow as dark as the surface is opaque:
`material.meshStandard({ transparent: true, opacity: 0.5, transparentShadow: true })` casts half a
shadow. An additive, transmissive or fully transparent surface never casts.

WebGL2 draws no shadow (`shadows: false` in its capability): a light set `castShadow: true` there —
sun, point or spot, a world's or the loaded scene's — is drawn unshadowed and named
`shadows-refused` on the world's diagnostic channel (the session's `onDiagnostic` when no world
opened it), `context.light` its store id or scene name; said once per light, again only after it
stopped casting (`castShadow` off, removed or hidden, the unlit view shown) and casts anew. WebGPU
draws it.

### A luminaire does not block its own light

A lamp's envelope — a lantern glass, a reflector, a shade — would put its own light out.
`SceneLight.emitterRadius` (metres, strictly positive, strictly below `range`, point and spot only)
declares it: **that light's** shadow pass writes no depth closer to its centre. The rejection is per
fragment, within that sphere only: a wall crossing it still occludes beyond, a receiver inside is
lit. None declared means zero. It belongs to the light, never to a name, scene or material class.
How an imported lamp gets it (`extras.emitterRadius`, source data, or the measured emissive body):
[COMPILER.md](COMPILER.md#lightsjson--the-lamps-of-the-source-file).

### Lights imported from the source file

The compiler writes a source file's lights beside the manifest as `lights.json`
([COMPILER.md](COMPILER.md#lightsjson--the-lamps-of-the-source-file)): glTF from
`KHR_lights_punctual`, FBX through ufbx, USD from the `UsdLux` sphere, disk, rect and distant
schemas, Blender from `Lamp` blocks; OBJ declares none. Positions and directions are world space,
after instancing: a light instanced by three nodes is three entries.

**Unit conversion, chosen and published.** glTF is photometric (candela for `point` and `spot`, lux
for `directional`), the engine radiometric (W/sr, W/m²): the compiler divides by **683 lm/W**, the
SI constant defining the candela, with no spectrum assumed and no hidden gain; exposure, never the
import, corrects a too dark or bright image (`world.exposure`). FBX's `Intensity` is a percentage,
so two published settings convert it: **1000 lm / 4π ≈ 79.6 cd** for a point or spot, **10 000
lux** for a directional. A `point` or `spot` without `range` gets `sqrt(I / 0.01 W·m⁻²)`, capped at
10 000 m. `innerConeAngle` has no equivalent; the engine softens a spot edge with its own
`spotEdgeSoftness`. A light breaking the contract is counted in the file's `rejected` map and left
out.

A light casts when the file says so (FBX carries the flag; glTF none, so imported glTF lights
cast). Every light is declared, however many (`imported-lights` counts them), read as
`(await scene.load(url)).lights` in cache order; each lamp is a child of the model, changed with
`light.visible = false`, `model.remove(light)` or `light.intensity = …`. A cache without
`lights.json` has none; one the server refuses otherwise fails the load
([Files over HTTP](#files-over-http)).

## Memory budgets

**Memory budgets are fixed reservoirs, never read from the machine**: free memory changes every
second (another application, another tab), so a budget measured at start-up would be wrong minutes
later. The pools' mechanics are [RESIDENCY.md](RESIDENCY.md); this is what a host sets and reads.

| Setting | Default | What it is |
| --- | --- | --- |
| `world.budget.gpu` | 2 179 MiB | every GPU pool together, divided by `world.budget.split` |
| `world.budget.cpu` | the shadow mirror plus the page cache's own default | what the world keeps in CPU memory |
| `world.budget.geometryPool` | 512 MiB | cluster page slots, the root cover always resident; clamped to `geometryPoolCeiling`; the call a memory slider makes |
| `world.budget.texturePool` | 512 MiB | virtual-texture tiles, every texture's tail always resident; clamped to `texturePoolCeiling`; `null` on WebGL2 |
| `world.budget.canvas` | 3840 × 2160 | the largest drawing buffer, `{ width, height }` in pixels, the effect targets are reserved at (`{ width: 7680, height: 4320 }` for an 8K display) |
| `world.budget.raycastTrees` | 64 MiB | [Picking](#picking-moving-and-saving) |
| `world.budget.physics` | `DEFAULT_PHYSICS_BUDGET` | [PHYSICS.md](PHYSICS.md#budgets) |

- **Live textures.** A video or a canvas redrawn every frame keeps a working texture of its size,
  `textureLiveBytes`, drawn from the texture budget: the pool (as a budget write reports it) is the
  declared budget less `textureLiveBytes`, redrawn with tiles kept when a texture turns live and at
  every later write; the recorded budget stays the declared one.
- **WebGL2** holds the same geometry budget by the same rule: its cut draws coarser beyond it and
  pages no frame keeps leave oldest first. While a view refines, the pool can pass its budget by at
  most the ancestors still drawn for the pages replacing them, back under it at the next cut once
  they arrived (`geometryAllocationBytes`; no pool reserved, so `geometryPoolAllocatedBytes` is
  `null`). No texture pool: `texturePoolBytes` and `world.budget.texturePool` read `null`.
- **GPU split.** Before opening, the shadow pool, bounce probes and effect targets are reserved at
  their declared maxima, then the geometry and texture pools up to their ceilings (the 2 179 MiB
  default includes 512 MiB for each streaming pool). Once WebGPU has active resources, their actual
  descriptor bytes — image targets, shared caches and other live views included — are reserved
  before the remainder is divided between geometry and textures. Root coverage and texture-tail
  minima are mandatory. Admission never changes resolution or raises the declared total.
- **CPU split.** The shadow page table's host mirror first (25.9 MiB, `SHADOW_HOST_BYTES`, whatever
  the screen), then the decoded-page cache (`split.pageCache`). In it: the session's manifest
  tables (a fixed reckoning per catalogue entry, not a measured heap) and transfer queue; the cut
  tables (group closure, residency readiness, residency sets, the cut's differences), sized by the
  view and the pool, never the world; the resident proxy, held from its request until another scene
  replaces it or kept pages need its room (`page-cache-kept-yielded`; read again after a device
  loss, on its own request, not counted among pages read); decoded baked texture levels, at most
  three quarters of the pages' share (`split.textureLevels`, 192 MiB at the default), yielding
  first to kept pages (`page-cache-levels-yielded`), a level that cannot fit left coarser. A change
  applies at once: pages and levels leave by last use, save the pages the frame keeps.
- **Canvas.** Declared larger, it grows the default total by the larger reserve, or takes room from
  the pools under a page-set total. A canvas drawn past it is never shrunk: the chain renders at
  full resolution, the diagnostics saying `effect targets over budget` with the bytes past the
  reserve.
- **Pools.** A read gives what the engine holds, not what was asked; a write is clamped to
  `world.budget.geometryPoolCeiling` / `texturePoolCeiling` and to what `gpu` leaves beside the
  shadows and the other pool, so pools never sum past the total, save a total below their floors
  (the root cover, the texture tails), which they never go under. On WebGPU the geometry pool pays
  first for the vertex buffers beside its slots (the float geometry no page covers, one placeholder
  vertex at least): `geometryAllocationBytes`, counting both, never passes `geometryPool` above that
  floor. Two writes before the next frame settle in one rebalance; pages and tiles are copied on the
  GPU into the new pool and only what no longer fits is evicted, the image complete throughout. The
  texture pool's floor, `minimum`, holds every tail (one tile per texture, 900 a layer) plus one
  tile to stream into when the lane streams: a lane whose tails fill whole layers pays one layer
  more (64 MiB lossless, a quarter of that in a block lane). A budget under the floor is raised to
  it; a shrink never displaces a tail.

The public low-level `createGpuPageCache` owns its pin priorities: `cache.pin(key, 'held')` for the
root cover, `cache.pin(key)` (or `'pinned'`) for ordinary pins. `cache.resize(slots)` keeps held
pages, then ordinary pins, then unpinned pages, newest first in each tier; pin as `'held'` what a
`resize(slots, held)` call named. `cache.load(key, signal, 'held')` pins a page in the cache's queue
as it arrives, so a resize queued behind never ranks it unpinned. Repinning never lowers a held
page; `cache.unpin(key)` releases its pin and held tier.

**Coarser, never refused.** What a view asks beyond a pool is drawn coarser on both renderers: pages
that do not fit stay out, their surface drawn by the nearest resident ancestor, finest detail given
up first; a texture tile shows its coarser level. `coverageBudgetLimited` and
`geometryPoolSaturated` (pages beyond the slots; lasting, the pool is too small for that view) say
so. A value that cannot be held as given is brought to what can, `geometryPoolClamp` /
`texturePoolClamp` naming why: `root-cover`, `scene`, `page-cap`, `minimum`, `device-limit`,
`ceiling`, or `null`. Only this is refused, by name:

| Code | When |
| --- | --- |
| `INVALID_GPU_BUDGET`, `INVALID_CPU_BUDGET`, `INVALID_GEOMETRY_POOL_BUDGET`, `INVALID_TEXTURE_POOL_BUDGET` | a value that is not a whole number of bytes above zero |
| `INVALID_BUDGET_CANVAS` | a declared canvas that is not a whole number of pixels above zero |
| `GPU_BUDGET_UNDER_MINIMUM` | a GPU total below the root coverage and texture-tail minima |
| `GPU_BUDGET_UNDER_SHADOW_POOL` | a GPU total under its fixed shadow share |
| `CPU_BUDGET_UNDER_SHADOW_MIRROR` | a CPU total not above the shadow mirror |
| `GEOMETRY_POOL_DEVICE_LIMIT` | a device whose limits cannot hold even the root cover |
| `TEXTURE_POOL_DEVICE_LIMIT` | a device whose limits cannot hold the tails of one texture lane |
| `WEBGPU_GEOMETRY_POOL_REFUSED` | the device refuses the root cover at prepare: the WebGPU backend fails, the world goes on with its others (`fallback`, `WEBGPU_UNAVAILABLE`); a GPU canvas rejects |
| `WEBGPU_TEXTURE_POOL_REFUSED` | the device refuses the texture pool's floor at prepare: pages draw with the fallback pass; a GPU canvas fails with `WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE` |
| `WEBGPU_FRAME_TARGETS_REFUSED` | frame targets the device refuses even without Hi-Z |
| `GPU_BUDGET_EXCEEDED` | an allocation past the GPU total (or an unknown format): no new image is submitted, flush and capture reject; terminal for the session, reopened with enough budget (every session sharing the refused cache released first) |
| `SURFACE_DEVICE_LIMIT` | a device dimension limit |

### Out of memory is absorbed

The browser may refuse an allocation the budget allows; no exception reaches the page. A refused
pool is drawn again at half its bytes, down to its floor (the root cover, the texture pool's
`minimum`, the smallest screen's shadow pool), the frame going on coarser. A frame waiting on a
shadow pool or frame targets is held — the canvas keeps its previous image, a capture waits — never
drawn without its shadows. Even the smallest shadow pool refused at the first frame: a
`shadows-off` error (`kind: 'error'`, `reason: 'gpu-out-of-memory'`), the session going on without
shadows ([SHADOWS.md](SHADOWS.md#memory)). The `gpu-out-of-memory` diagnostic names the pool, bytes
asked (`requestedBytes`) and granted (`grantedBytes`, `null` when even the floor was refused and the
pool in place stays); for frame targets, Hi-Z goes first (`pool: 'frame-targets'`,
`dropped: 'hi-z'`), then `frame-targets-refused` (`code: 'WEBGPU_FRAME_TARGETS_REFUSED'`,
`reason: 'gpu-out-of-memory'`, or `'gpu-error'` with its `error`, the size, `requestedBytes`),
rejecting prepare, a capture and its restore. A geometry or texture budget set during prepare is the
later word, its report waiting for prepare, its `durationMs` including the wait. How WebGPU and
WebGL2 (`OUT_OF_MEMORY`, by pool) detect and answer: [RESIDENCY.md](RESIDENCY.md#out-of-memory).

## Captures and image checks

`capture.surface(world, { width, height })` and `capture.buffer(world, { width, height })` return
plain pixels taken aside from the view. For a deterministic image, a page calls
`world.camera.set(pose)`, `await world.awaitPages()`, `world.render()`, then
`await capture.buffer(world, { width, height })`. `awaitPages()` rejects a requested URL that failed
to load; a failed background load is retried at most three times, then left until the world
reopens. It waits for pages, not an image: it settles on a world whose loop redraws every frame, and
the capture reads its own image.

## Integration: web, Electron and Node

- **Web**: `createWorld(canvasOrId)` and `await world.scene.load(manifestUrl)`
  ([Create a world](#create-a-world)); the application owns canvas layout and disposal, and with
  `interactive: false` frame scheduling (`world.render()`).
- **Electron**: `prepare` in the main process, `createWorld` in the renderer process. No Electron
  import in the SDK ([hosts](../packages/README.md#hosts)).
- **Node**: `prepare`, `prepareMany`, `createCompilationJob`, or the `trillion3d-compile` CLI
  ([COMPILER.md](COMPILER.md#using-it-from-node)).
- **Other languages**: spawn `trillion3d-compiler` and read the cache — JSON pointer,
  `clusters.json` and its pages, SHA-256 objects, `source.gltf` ([FORMAT.md](FORMAT.md)). The
  interface is the versioned manifest.

## Migration from Three.js

No Three.js adapter ships or is planned: Three.js code is rewritten with the [families](#families).
The portal's [migration page](https://www.trillion3d.com/#/en/learn/three-migration) sets a Three.js
program beside its engine equivalent
([`site/examples/migrating-from-three.html`](../site/examples/migrating-from-three.html)); each
maths function's page of the [API reference](https://www.trillion3d.com/#/en/api) names its witness
call. Three.js stays a bench witness, never mixed with a published world (#79).

## Physics

Jolt in a worker, every body an ordinary mesh with `physics` set: [PHYSICS.md](PHYSICS.md).

## GPU deformation

Imported glTF and FBX clips are `model.animations`. `animation.createMixer(root)` binds clips to
names below `root` (a loaded model: its tracks and morph weights); `mixer.clipAction(clip)` has
`play()`, `stop()`, `seek(seconds)`, `weight`, `timeScale` and `blendMode`;
`animation.weightsTrack(path, times, values)` holds all morph weights at each key;
`animation.skeleton(bones, inverseBindMatrices?)` without matrices uses the current bind pose. FBX
translation, Euler rotation, scale and blend-weight clips go through ufbx source evaluation,
original keys and full span kept: linear and cubic curves are subdivided by their Bezier control
hull (scalar chord error at most 2.5e-7 source units, or radians), Euler travel limited to 15
degrees per initial interval so whole turns cannot vanish between quaternion keys, world-space TRS
refined against ufbx at each interval's quarter, midpoint and three-quarter samples (emitted float32
endpoints, 2.5e-7 component threshold, relative above magnitude one), and regression oracles check
non-key times within 1e-6 — conversion checks, not an image-fidelity measurement. Single linear
skins and positive single-target blends keep non-unit full weights. `IMPORT_UNSUPPORTED_ANIMATION`
refuses skins with unbound vertices or more than 65,536 joints, stepped/extrapolated curves,
intermediate shapes, layered/constrained animation, sheared world transforms, more than 36,000
distinct keys and times colliding at float32; a clip is never truncated. glTF keeps its
interpolation contracts. Skin weights stay exact float32 source values, both GPU paths normalizing
their sum when blending, bind pose and conservative bounds intact. A deformed scene refuses the
untextured WebGPU fallback when its material pipeline is unavailable, so backend selection recovers
instead of showing rest geometry:

```ts
const model = await world.scene.load('/character/cache/native/full/manifest.json');
const mixer = animation.createMixer(model);
const walk = mixer.clipAction(model.animations[0]).play();
walk.weight = 0.8;
walk.timeScale = 1.2;
// Stop at a repeatable pose, for inspection or a reference comparison.
walk.stop().seek(0.5);
world.invalidate();
```

A page-created mesh uses `mesh.skeleton = animation.skeleton(bones, inverseBindMatrices)` and
four-component `skinIndex` / `skinWeight` attributes; morph displacements go in
`geometry.morphAttributes.position` (optionally `.normal`) with
`geometry.morphTargetsRelative = true` (absolute targets work too), then
`mesh.updateMorphTargets()`; `node.morphTargetInfluences` is animated by `animation.weightsTrack` or
written. Geometry and its pages are shared; each placement reads its own palette, weights and water
source.

Actions blend by `weight`; `action.blendMode = 'additive'` adds the difference from the clip's first
key. `animation.twoBoneIK(root, mid, end, target, pole?, weight?)` solves a bone chain after
sampling; `animation.windClip(bones, options?)` loops bones (`direction: [x, z]`, `angle` in
radians, `frequency` in Hz), never CPU vertices. A water mesh's `mesh.waves = waterSurface` is the
`WaterSurface` whose `waveModel` buoyancy reads: rendering and physics share waves.

WebGPU computes resident positions, previous positions and normals before selection and
rasterization; WebGL2 applies the same sources in its vertex stage. Culling bounds grow by the
deformation reach; the previous pose feeds temporal reprojection and settles the frame after a pose
stops. Cooked cloth uses its compiler-recorded simulation mapping. `metrics.gpuDeformationMs` is the
latest measured WebGPU deformation time, `null` without a timestamp sample; zero is a measured zero.
Examples: [the walking character](../site/examples/a-character-that-walks.html), [the morph
sample](../site/examples/a-shape-that-morphs.html), [the
crowd](../site/examples/a-crowd-of-characters.html) (`?count=1`, `10` or `100`; its fixed-time hook
serves the recette's source-pose and frame-envelope comparisons). Internals:
[ENGINE.md](ENGINE.md#gpu-deformation).

## Current limits

- The compiler refuses imported non-triangle primitives and unsupported glTF extensions; `scene.load`
  reads a versioned compiled manifest.
- Specular environment-map IBL is not implemented. Screen reflections read camera-visible opaque
  radiance; off-screen geometry needs the WebGPU bounce proxy/probe fallback, bounce enabled (rough
  filtering and bounded history: [ENGINE.md](ENGINE.md#light-that-bounces)); no off-screen geometry
  is reconstructed.
- WebGL2 draws physical transmission-volume factors, anisotropy and clearcoat (their maps
  included), but not sheen, iridescence, dispersion, a specular factor, an IOR without
  transmission, their maps, or the transmission and thickness maps: such a surface is drawn without
  the feature, the loop going on, and the channel says `material-degraded` once per surface and
  feature (`context.material`, `context.feature`). The WebGPU page raster lists material extensions
  among its unsupported capabilities and says nothing per surface. A surface the WebGL2 program
  cannot draw at all (an environment, light, bump, displacement or alpha map, wireframe, stencil
  writes, alpha hash, premultiplied alpha, alpha to coverage, clipping planes, object-space normals)
  is left out while everything else draws; the channel says `material-refused` once per surface and
  reason (`context.material`, `context.reason`).
- Transparent surfaces are lit from the source file's own light graph with a fixed ambient, not yet
  by the declared-light rule above.
- A lost device is recovered without a reload: the world asks for a device, reopens its session on
  it and rebuilds from its decoded-page cache, fetching no page, bundle or resident proxy it still
  holds (proxy and decoded texture levels stay inside `world.budget.cpu` unless they yielded).
  `gpu-device-recovered` gives the loss-to-first-frame time (`recoveryMs`); meanwhile the canvas
  keeps its last image. Each session reopen is said once as `session-reopen`: `cause`
  (`device-lost`, `option`, or a content change — `defect: true`, one the session should have taken
  in place), `durationMs`, and `framesWithoutImage`, the display frames without a new image.
  `lights.json` is read again; cross-API fallback is not implemented.
- Physics: measured scale, and what remains (#399), in [PHYSICS.md](PHYSICS.md#measured-and-what-remains).
