# Trillion3D SDK

The public guide: what a page and a Node host write against. How the engine draws underneath —
the internal session, the passes, the budgets' mechanics and the diagnostics — is
[ENGINE.md](ENGINE.md); the compiler is [COMPILER.md](COMPILER.md); the cache is
[FORMAT.md](FORMAT.md).

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

Version 0.2.0 exposes one consumer specifier, `trillion3d`. The source facade has three
environment branches:

| Resolver context                        | Source facade             | Public surface                | Declaration constraints                                                               |
| --------------------------------------- | ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| Node ESM with NodeNext                  | `packages/sdk/node.mts`   | Common and native compilation | Node types are allowed; DOM and WebGPU types are not introduced by the common branch. |
| Browser bundler with TypeScript Bundler | `packages/sdk/browser.ts` | Common and browser rendering  | Browser and WebGPU declarations are allowed; no `node:*` module is reachable.         |
| Worker or common code                   | `packages/sdk/index.ts`   | Common maths and contracts    | Compiles without DOM or WebGPU declarations.                                          |
| Unknown environment or fallback         | `packages/sdk/index.ts`   | Common maths and contracts    | The safe default never exposes browser or Node APIs by accident.                      |

SSR resolves the Node branch. It therefore exposes native and common APIs, and does not expose
browser rendering APIs. Importing any branch has no startup action: it does not create a renderer,
worker, DOM object, GPU object or compiler process.

A fourth branch exists beside these three, and it is not a `trillion3d` resolver condition: the
measurement entry point, `packages/sdk-browser/src/measurement/measurement.ts`. It re-exports everything the
browser branch does, plus `openMeasuredWorld`/`createMeasuredWorldJob` (the internal session a
world opens on itself), the engine's own backend factories, `chooseBackends`/`autonomousCacheReady`
and `replicateInstances`. `package.json`'s `exports` map has no subpath for it — the bench, the
proofs and the comparison views import it by its source path inside this repository, never through
the published `trillion3d` specifier, so none of it reaches a consumer of the package. The witness
backend factories are not in it: they live beside the bench, and `bench/witnesses/measurement.ts`
re-exports the measurement entry point with them added (built into `dist/witnesses/`, which the
package leaves out).

The package maps these built files with conditional JavaScript and matching conditional
declarations. The `browser` condition precedes the Node and generic import/default paths; the Node
branch uses the standard `node` condition, and the final default remains the common branch.
Resolvers that ignore `browser` therefore receive the safe common facade instead of browser code.

`api-inventory.json` is generated with the TypeScript checker. It follows aliases and transitive
star exports, records binding identity and lists every current entry point. It also records the
documented source-path imports that the facade newly exposes. Experimental comparison and oracle
bindings stay classified as experimental.

Measured with esbuild 0.25.12 (ESM, browser platform, minification and tree shaking), a consumer
importing only `hierarchyUpdateBatch` weighs 1,780 bytes from the common facade and 3,289 bytes from
the browser facade, which keeps its public maths surface while shedding unrelated rendering code and
every Node module. This is a bundle-content measurement, not a runtime-performance claim.

## Create a world

```js
const world = createWorld(canvas); // an element…
const world = createWorld('viewer'); // …or the id of one
```

```js
import { createWorld, object, geometry, material, light } from 'trillion3d';

const world = createWorld('viewer');

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

`world.ready` resolves once the renderer is prepared; an object added or a model loaded before it
resolves is queued and drawn once it does. The SDK has no asset URL default: a host passes a real
`manifestUrl` to `scene.load`. The default scope is `slice` (`scene.load(url, { scope: 'full' })`
for a full cache); a pointer or manifest of another scope is rejected with `SCOPE_MISMATCH`.

`scene.load(url, { onProgress })` reports how far a load has got, with the `JobProgress` shape
`createJob` uses: `{ phase: 'manifest' }` once the manifest is read, then
`{ phase: 'resources', completed, total, message }` as each file the scene reads lands — `total`
grows as the scene finds files to read, and the last event has `completed === total`. The first
pages follow the load: `await world.awaitPages()` settles once they are resident.

A host that probes a cache before opening it — to enable a button, to tell a user to recompile —
calls `assertCachePointer(pointer, scope)` and `assertCacheReady(metadata, scope)` on the two JSON
documents it fetched: the first returns the cache URL the pointer names, the second the selected
triangle count, and both raise an `EngineError` (`INVALID_POINTER`, `CACHE_NOT_READY`,
`SCOPE_MISMATCH`, `UNSUPPORTED_FORMAT`, `INVALID_CACHE`, `STALE_CACHE`) otherwise. They are the
checks `scene.load` runs, and download no binary sidecar.

## API rule

State that is read and written is a **property** (`camera.near = 0.1`, `light.intensity = 2`,
`world.exposure`, `world.pixelError`, `world.controls.kind`); a value with several components is an
object with **`.set()`** (`position.set(0, 1, 0)`, `repeat.set(4, 4)`, `color.set(0xcc3344)`); a
**method** is an action or a computation (`lookAt`, `add`, `load`, `invalidate`, `render`,
`world.stageProfile()`, `world.awaitPages()`). A setter applies its own consequences — the
projection update, the next frame — so a host never calls an update by hand.

## Naming rule

Families are **singular**. Inside one, a member that produces a thing of the scene is named after
the thing (`geometry.box`); a member that sets up machinery is `create` + its name
(`page.createStreamer`). This holds over four hundred entries: it is a rule, not a taste.

## Families

Thirteen families describe the scene; one example each:

```js
// geometry — the shape alone, with no matter
const g = geometry.sphere(1, 64, 32);
const floor = geometry.plane(20, 20);
const pipe = geometry.tube(
  math.path([
    [0, 0, 0],
    [2, 1, 0],
    [4, 0, 2],
  ]),
  64,
  0.2,
);
```

```js
// material — the matter alone, with no shape
const steel = material.meshStandard({ color: 0x8899aa, metalness: 0.9, roughness: 0.15 });
const glass = material.meshPhysical({ transmission: 1, ior: 1.5, thickness: 0.4 });
```

```js
// object — shape and matter, placed in the scene
const ball = object.mesh(geometry.sphere(1), steel);
ball.position.set(0, 1, 0);
const set = object.group();
set.add(ball);
world.scene.add(set);
```

```js
// light
world.scene.add(light.ambient({ intensity: 0.2 }));
world.scene.add(light.directional({ intensity: 3, position: [5, 10, 2], castShadow: true }));
world.scene.add(light.spot({ angle: 0.4, penumbra: 0.3, distance: 30, decay: 2 }));
```

```js
// camera
world.camera = camera.perspective({ fov: 55, near: 0.1, far: 500 });
world.camera.position.set(0, 3, 8);
world.camera.lookAt(0, 1, 0);
```

```js
// math
const axis = math.vector3(0, 1, 0);
const turn = math.quaternion().setFromAxisAngle(axis, Math.PI / 4);
const box = math.box3().setFromObject(set);
```

```js
// texture + loader
const albedo = await loader.texture('wood.jpg');
albedo.wrap = wrap.repeat;
albedo.repeat.set(4, 4);
```

```js
// helper — the marks you work with
world.scene.add(helper.grid(20, 20));
world.scene.add(helper.axes(2));
```

```js
// controls — handles that move an object with the mouse
const gizmo = controls.transform(world).attach(ball);
gizmo.addEventListener('dragEnd', () => history.push(ball.position.clone()));
```

```js
// animation
const mixer = animation.createMixer(set);
const bob = animation.clip('bob', 2, [
  animation.vectorTrack('.position', [0, 1, 2], [0, 1, 0, 0, 2, 0, 0, 1, 0]),
]);
mixer.play(bob);
```

```js
// buffer — a geometry built by hand
const g2 = geometry.createBuffer({
  position: buffer.float32(vertices, 3),
  index: buffer.uint32(indices),
});
```

```js
// the constants, each in its own family
steel.side = side.double;
glass.blending = blending.normal;
world.toneMapping = toneMapping.aces;
```

| Family                                                                                                                                                                                                                | Members                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry`, `material`, `light`, `camera`, `object`, `math`, `texture`, `loader`, `helper`, `controls`, `animation`, `buffer`, and the constant families `blending`/`side`/`wrap`/`filter`/`colorSpace`/`toneMapping` | the scene-graph types, one factory per type (`geometry.box`, `material.meshStandard`, `light.directional`, `math.vector3`, …) and one named value per constant (`side.double`, `toneMapping.aces`) — the blocks above show each family in use |

Eight families exist because geometry here is **cut into pages** the engine moves in and out of
memory according to what the frame reads:

```js
// page — the geometry that enters and leaves according to what the frame reads
const stream = page.createStreamer({ source: page.httpSource('assets/forest/'), workers: 4 });
world.scene.load('assets/forest/manifest.json', { stream });
```

```js
// budget — fixed envelopes, not wishes
world.budget.geometryPool = 512 * 1024 * 1024;
world.budget.texturePool = 256 * 1024 * 1024;
```

```js
// metric — what the image cost, never estimated
world.onFrame(({ metrics }) => console.log(metrics.selectedTriangles, metrics.residentPages));
const profiler = metric.createProfiler(world);
```

```js
// diagnostic — watching the engine work
world.diagnostic.mode = 'clusters'; // or 'wireframe', 'triangles', 'beauty'
```

```js
// capability — what the machine grants, before an image is promised
const granted = await capability.detect();
if (!granted.webgpu) showNotice('fallback rendering, without indirect lighting');
```

```js
// capture — an image aside, without touching the view
const png = await capture.surface(world, { width: 3840, height: 2160 });
```

```js
// pose — framing, named poses, replaying a path
world.camera.set(pose.fromBounds(math.box3().setFromObject(set)));
```

```js
// batch — a thousand matrices at once instead of a loop
batch.composeMatrix4(outputs, positions, quaternions, scales, 1000);
```

| Family       | Members                                                                                       | What it does                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `page`       | `createStreamer`, `createCache`, `httpSource`, `decode`                                       | geometry in pages: what enters and leaves memory according to what the frame reads |
| `budget`     | `memory`, `geometryPool`, `texturePool`                                                       | the fixed envelopes that are not exceeded                                          |
| `metric`     | `frame`, `cpuSteps`, `gpuPasses`, `createProfiler`                                            | what the image cost, never estimated                                               |
| `diagnostic` | `createChannel`, `presentationColor`, `partitionAudit`, `transparentOcclusion`, `shadowAtlas` | watching the engine work                                                           |
| `capability` | `detect`, `lighting`                                                                          | what the machine grants, before an image is promised                               |
| `capture`    | `surface`, `buffer`                                                                           | an image taken aside, at another resolution, without touching the view             |
| `pose`       | `fromBounds`, `runPath`, `pointOfInterest`                                                    | named poses, automatic framing, replaying a path                                   |
| `batch`      | `transformPoints`, `composeMatrix4`, `frustumKeepsBox`                                        | a thousand matrices at once instead of a loop                                      |

The world is not a family: it is the object `createWorld` returns, carrying `scene`, `camera`,
`budget`, `diagnostic`, `controls`, `onFrame`/`loop`, `render`, `invalidate` and `dispose`.

There is no level-of-detail object and no instanced or batched mesh type: one cut through a DAG
per frame, instancing and draw grouping are what the engine does natively.

## Loop

The world owns the loop, and it stops when the image is stable: after 120 frames with nothing
changing it pauses (`interactive-settle-limit`), and resumes on invalidation. A still scene costs
nothing. `onFrame` is the per-frame hook; `loop` is its alias.

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

A value written directly on a node — `mesh.position.x = 100`, `mesh.visible = false`, a light's
intensity, colour or pose — needs no call to be seen by the next frame, and a light added to or
removed from the graph is picked up on the next frame too. An asynchronous render failure stops
automatic work and emits `INTERACTIVE_RENDER_FAILED` as a diagnostic.

## What draws: the renderer option

One option, and saying nothing is the normal case — automatic is the absence of a choice, not a
word to write, so there is no `auto` value:

```js
createWorld('viewer'); // the engine takes the best path the machine grants
createWorld('viewer', { renderer: 'webgpu' }); // forced; a machine without it is refused BY NAME
createWorld('viewer', { renderer: 'webgl2' });
```

Forcing one and being served the other silently is the one outcome this must never produce. With
nothing forced, a world draws through WebGPU when the machine grants a device, through the engine's
WebGL2 page path otherwise, and raises `EngineError('NO_ENGINE_BACKEND')` when it grants neither
(`NO_WEBGL2` from the capability probe before it). The decision is described in
[ENGINE.md](ENGINE.md#which-backend-renders).

## Canvas, camera and teardown

The canvas drawing buffer follows its CSS box, and `pixelRatio` follows the browser, including later
DPR changes, unless set explicitly. `world.resize(width, height)` sets an explicit size — omitted
arguments read the canvas's current CSS box. An initially hidden or zero-size canvas needs an
explicit `resize()` or must be shown before creation; a canvas hidden later keeps its last
dimensions until visible. The host keeps the canvas element and its CSS layout.

`world.pixelError` is the DAG cut's screen error in pixels (`0` by default, the exact leaves; a
positive value selects coarser pages when the cache includes them). `pose.fromBounds(box)` frames a
box; `pose.pointOfInterest(name, pose)` names one; `pose.runPath(world, poses, { images })` replays a
path — an exact A/A image gate, then timed blocks, not a general performance verdict.

`world.temporalAntialiasing` (`createWorld(target, { temporalAntialiasing })`, `true` by default)
jitters each image by a fraction of a pixel and accumulates it over the previous ones; `false` draws
each pixel at its centre with no history, what a pixel-exact capture asks. Written, it takes effect
at the next frame, history dropped, no session reopened. Read, it is what the image carries: `false`
on WebGL2, which has none (its capabilities list `temporal antialiasing` as unsupported).

Dispose in the actual component or page teardown, **not immediately after startup**:
`world.dispose()` removes owned controls, observers, queued frames and abort listeners and closes
the engine, without removing the canvas. A page that wants job semantics around a load —
cancellation, a status it can observe — wraps `scene.load(url, { signal, onProgress: progress })` with
`createJob`, exported by `trillion3d` and by the portal's runtime: the job's progress is the load's.

### Camera controllers

The engine owns its camera controllers: they read `PointerEvent`, `WheelEvent` and `KeyboardEvent`
on the world's canvas and write the camera's pose. A world asks for one at creation and drives it
through the live `world.controls` handle:

```js
const world = createWorld('viewer', { controls: 'orbit' }); // at creation
world.controls.kind = 'fly'; // switch live
world.controls.enabled = false; // pause input
world.controls.target.set(0, 1, 0); // orbit pivot
```

Controls live on the world because they read input on the canvas it owns — a second listener would
double the gestures — and they follow `world.camera` when it is replaced. Setting `kind` releases the
previous controller and builds the next; `.enabled` turns the current one off without losing it.
Live examples, one world per controller: [orbit](../site/examples/orbit-around-a-clockwork.html), [panZoom](../site/examples/a-game-board-seen-from-above.html), [trackball](../site/examples/spin-an-astrolabe.html), [fly](../site/examples/fly-over-a-model-town.html), [character](../site/examples/walk-through-a-temple.html) and [character with physics](../site/examples/walk-with-collisions.html); `firstPerson` is the same head without a body.

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

All of them publish `object.position`, `addEventListener('change')`, `removeEventListener` and
`dispose()`; the three that keep a pivot add `target`, `minDistance`, `maxDistance`, `enableZoom`,
`enablePan` and `update()`, which reads back a pose the host wrote and clamps it. A controller emits
`change` only when the pose moved, so a still scene schedules nothing.

**The character's body.** `'character'` moves an upright capsule with the values of an adult human
(`HUMAN_BODY`: 1.75 m, a 3.5 m/s jog, a 0.5 m jump, 45° slopes, 0.5 m steps, 80 kg, a 250 N push),
each one a setting of `world.controls`. What it collides with depends on the world:

- **Without physics**, the static triangles of `world.controls.colliders` (meshes, built into a
  triangle tree once), or nothing: the body then walks level where it stands.
- **With physics on** (`world.physics`), the body is the physics' own character, Jolt's virtual
  character in the physics worker: it meets every body of the simulation, climbs steps and slopes,
  rides a moving platform, pushes dynamic bodies with at most `pushStrength` newtons and is pushed
  back. `colliders` is unused; give the level `mesh.physics = 'static'` instead. The keys reach the
  worker's next fixed step, and the page draws the feet the worker last reported moved on by their
  velocity, at most one step ahead.

Both bodies read the same drive (`characterDrive.ts`): speed gathered over `responseTime`, lost over
`stopTime`, jumps with a coyote time and a jump buffer. The triangle body catches up every tick
of a frame, however slow the page; only a stall past 0.25 s is dropped (`MAX_CHARACTER_DELTA`), and
the body resumes where it stopped. Jolt's body steps on the physics worker's own clock, never on the
page's frames: a slow page draws it late, never slower; a stalled worker drops what its catch-up
ceiling cannot hold (`MAX_CATCH_UP_STEPS`), as every body of the simulation does.

```js
const world = createWorld('view', { controls: 'character', physics: true });
floor.physics = 'static';
crate.physics = { type: 'dynamic', mass: 12 };
world.controls.pushStrength = 400; // a stronger push
```

**Vehicles.** `'vehicle'` maps the keys to a `VehicleInput` — `throttle`, `brake`, `steer`,
`handbrake` — and hands it to `world.controls.vehicle.drive(input)` each time it changes. Any object
with `drive` can be driven; the physics' own vehicles arrive with #398. Setting `kind = 'vehicle'`
while `vehicle` is `null` throws `NO_VEHICLE`. The controls do not move the camera.

### Picking, moving and saving

`world.raycast(at)` returns the nearest object under a canvas point — CSS pixels from its top-left
corner, `event.offsetX`/`offsetY` — or along a world `Ray`, or `null`: the very node the page added,
the world `point` and `normal` hit, the `distance` and the triangle rank `face`. It runs on the CPU
over the scene's own geometry: triangle meshes are tested triangle by triangle, lines, points and
sprites have no area and are never hit, a loaded model — its triangles live in GPU pages — is hit on
its box where the ray enters it, or at the ray's origin (`distance` 0, `normal` facing back along
the ray) when the ray starts inside it; hidden subtrees and `helper` marks are skipped, a root under
a hidden ancestor too. A ray's direction is made a unit vector at the door, so `distance` is in
world units whatever its length. A canvas point is read on the CSS box and aimed at the shape the
frame is drawn at, the drawing buffer's. `{ objects }` limits the test to some
subtrees; a canvas with no size refuses a point with `RAYCAST_NO_VIEW`. `raycast(roots, ray)` is
the same test on any subtree, every hit nearest first, and `camera.rayThrough(x, y, aspect)` the
ray through a point of the picture. A mesh's triangle tree is kept for the next ray, within
`world.budget.raycastTrees` bytes (64 MiB by default, settable, shared by every world on the
page): past it the tree cast at least
recently is dropped, and `geometry.dispose()` drops its own at once. Live example:
[click to pick](../site/examples/click-to-pick.html).

```js
world.canvas.addEventListener('click', (event) => {
  const hit = world.raycast({ x: event.offsetX, y: event.offsetY });
  hit?.object.material.color.set('#ffb347');
});
```

`controls.transform(world, options)` puts handles on one object that move, turn and scale it with
the mouse: `attach(object)`, `detach()`, `setMode('translate' | 'rotate' | 'scale')`,
`setSpace('world' | 'local')`, `snap = { translate, rotate, scale }`, events `change`, `dragStart`,
`dragEnd` — one drag, one undo step. The handles are meshes of the `geometry` family in unlit
materials, depth-tested like any object, kept at one share of the canvas height (`size`, a quarter by
default) and marked as `helper`s. A press is picked on them before the camera controller hears it,
so an orbit rests while a handle is dragged and resumes after, with no page code. A drag writes the
object's local pose from the world pose it asks for, through its parents; a scale always follows the
object's own axes. The centre cube scales uniformly by the drag up the screen, wherever it was
pressed, in the handles' own length: up by that length multiplies the size by e, down divides it by
e. `attach` or `detach` during a drag ends it first, with its `dragEnd`. The handles follow the view after each frame the world draws; a still scene
draws none. Live example: [move, rotate, scale](../site/examples/move-rotate-scale-gizmo.html).

`scene.toJSON(camera)` writes the scene as plain, versioned JSON (`format: 'trillion3d-scene'`,
`formatVersion: 1`): its hierarchy and poses, each shape by the family call that built it
(`geometry.box(2, 1, 1)` is stored as that call; a shape changed after it was built, or written by
hand, stores its vertices), each material by its parameters, lights, background, fog and the
camera's pose; shapes and materials worn by several meshes are stored once; a loaded model is
stored by its manifest address, never inlined; `helper` marks are left out. A texture, a picture
environment or a shader material cannot be stored and is refused by name (`SCENE_NOT_SAVABLE`).
`await scene.fromJSON(json, camera)` replaces the content — the `helper` marks stay — loads the
models again, and refuses another format or version (`UNSUPPORTED_SCENE_FORMAT`) before removing
anything. Calls made while one is reading wait for it and run in order, each replacing what the one
before left: two saved scenes never merge. A shape family builds at least the pieces it closes with
(a box one slice per side, a sphere three around and two down) and its stored call says the count
it built. Live example: [save the scene](../site/examples/save-the-scene.html).

The portal's scene editor (`site/app/editor/`) is these three doors and nothing else: pick,
move, recolour, save and open a scene, the frame's cost read live.

### Live material values

A material already placed, written on its values — `color`, `emissive`, `emissiveIntensity`,
`metalness`, `roughness` — is repainted in place: the session rewrites the rows that read it and
opens nothing (#335). A colour picker dragged for ten seconds keeps one session. A change the
session cannot hold in place — a texture, a kind, a side, transparency, a material object whose
values another material shares — is copied on write and opens the session again, once per burst.
`world.diagnostic.sessions` counts the sessions a world has opened, so a page and a test see a
reopen.

## Installation and environment API

The package is private and installed from this repository or a local tarball; it is not published
to npm. Browser bundlers must honour the standard `browser` export condition. Node ESM and NodeNext
select the Node branch. A resolver with no platform condition receives the safe common branch, which
contains no DOM, WebGPU, filesystem or process API.

| Task               | Examples                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common API         | `SDK_VERSION`, `FORMAT_VERSION`, `assertFormat`, `EngineError`, batch maths, hierarchy, camera calculations, diagnostics, lighting contracts, jobs and safety policy |
| Native preparation | `prepare`, `prepareMany`, `createCompilationJob`, `createTerminalProgress`, `createBatchProgress`, `reviewCutouts`, `getSdkProvenance`, the `trillion3d-compile` CLI |
| Browser rendering  | `createWorld` and the families it hands a page, plus `detectCapabilities`                                                                                            |

For a strict browser TypeScript project, enable the `browser` condition explicitly; without it,
Bundler resolution selects the platform-neutral common declarations, which do not contain
`createWorld`.

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
esbuild configuration and verifies both worker tasks and WASM selection.

### Install requirements: the package alone, the witnesses beside the bench

A browser host installs `trillion3d` and, for its types, `@webgpu/types`; nothing else. The package
declares no rendering library, ships none and pulls none: a clean install of the packed archive has
no `three` in its tree (`tests/integration/installed-package.test.ts`), and the runtime build refuses
an `engine.js` that folds one in (`scripts/docs/build-runtime.ts`). No public API takes or returns a
Three.js object. The witnesses the bench compares the engine against live beside the bench
(`bench/witnesses/`) and plug into the measurement seam through its backend list; `three` is a
development dependency of this repository alone (#275).

## Compiling from Node

`prepare(input, output, scope, budget, options)` and `prepareMany(jobs, options)` relay to the
native executable; the `trillion3d-compile` CLI is the same relay on the command line. Arguments,
events, the pointer, batch mode, cancellation, exit codes and the executable's selection
(`options.executable`, then `TRILLION3D_COMPILER_BIN`, then the development build) are in
[COMPILER.md](COMPILER.md#using-it-from-node). An installed tarball ships neither the executable nor
the Rust sources, so it needs one of the first two selections.

## Scene hierarchy foundation

`world.scene` is the graph a page writes into. Below it, `trillion3d` publishes the DOM-free
transform foundation, scene-model version `SCENE_MODEL_VERSION` 1: `SceneRoot` and
`createSceneRoot`, exported by the common facade, for a page that manages a transform tree of its
own outside a world.

A `SceneRoot` owns one transform hierarchy; nodes created by `root.createNode({ id, visible })`
have stable, root-unique identifiers and are attached with `add` or `reparent`. `remove` and `clear`
detach live nodes, while `destroy` permanently invalidates a whole subtree. `clone` gives the new
node a fresh identifier unless one is supplied; `copy` keeps the destination identifier. Both
reproduce the local pose and optionally the descendants. Recursive copying from an ancestor into its
descendant is rejected with `SCENE_COPY_OVERLAP` before either node changes.

```javascript
import { createSceneRoot } from 'trillion3d';

const scene = createSceneRoot({ id: 'warehouse' });
const shelf = scene.createNode({ id: 'shelf' }).setPosition(2, 0, -4);
const crate = scene.createNode({ id: 'crate' }).setScale(0.5, 0.5, 0.5);
scene.add(shelf);
shelf.add(crate).updateWorldMatrix();
```

Nodes from different roots cannot be combined, duplicate ids are rejected, and a cycle leaves the
hierarchy unchanged. Pose setters mark the transform dirty; call `updateWorldMatrix()` before
reading `worldMatrix`. The matrix views are read-only by contract; write through the setters.

## Batch math for hosts

A host that moves ten thousand instances or culls ten thousand boxes would otherwise write the loop
itself, one object per call and a temporary per step. The engine's **batches** take `n` elements in
one call: flat typed arrays, no allocation, the same formula as the unit function they repeat —
which stays the oracle — and a count as the only return value.

**Layout.** One element occupies a fixed number of consecutive values, each declared once:
`MATRIX_VALUES` 16 (column-major, `[12..14]` the translation), `POSITION_VALUES` 3,
`QUATERNION_VALUES` 4 (`x, y, z, w`), `SPHERE_VALUES` 4 (centre then radius) and
`NORMAL_MATRIX_VALUES` 9 in `packages/sdk-core/src/math/batch/strides.ts`; `BOX_VALUES` 6 (min x, y,
z then max x, y, z) in `packages/sdk-core/src/math/primitives/box.ts`; `FRUSTUM_PLANE_VALUES` 24 (six
planes `a, b, c, d`, facing inward, in the order of `frustumPlanesFromMatrix`) in
`packages/sdk-core/src/math/frustum/frustum.ts`. Flat inputs are read as `ArrayLike<number>`;
outputs are `Float64Array` (or a `Uint8Array` of flags). Matrices read one at a time travel as
**sub-views** of sixteen numbers (`buffer.subarray(i * 16, (i + 1) * 16)`), built once at load,
never per frame: `multiplyMatrix4` reads its operands at constant indices, and a computed offset
costs 6 % of the product.

**Allocate once, reuse every frame.** Culling ten thousand boxes and bringing the survivors' centres
into view space is two calls — this is `packages/sdk-core/src/math/batch/host.test.ts`, run by
`pnpm test`:

```javascript
import {
  BOX_VALUES,
  IDENTITY_MATRIX4,
  POSITION_VALUES,
  SPHERE_VALUES,
  createCameraFrame,
  perspectiveProjection,
  updateCameraFrame,
  frustumKeepsBoxBatch,
  sphereFromBoundsBatch,
  transformPointsBatch,
} from 'trillion3d';

const N = 10_000;
// Allocated once, at scene load.
const boxes = new Float64Array(N * BOX_VALUES); // min x, y, z then max x, y, z, per box
const kept = new Uint8Array(N); // 1 where the frustum keeps the box
const spheres = new Float64Array(N * SPHERE_VALUES); // centre x, y, z then radius, per box
const centres = new Float64Array(N * POSITION_VALUES); // survivors' centres, packed
const viewCentres = new Float64Array(N * POSITION_VALUES); // the same, in view space
const frame = createCameraFrame();
const projection = new Float64Array(16);
const cameraWorld = Float64Array.from(IDENTITY_MATRIX4); // the host's, moved between frames

// Every frame: the frustum, one cull, the survivors packed, one transform.
perspectiveProjection(projection, 60, 16 / 9, 0.1, 1);
updateCameraFrame(frame, projection, cameraWorld, 100);
const visible = frustumKeepsBoxBatch(kept, frame.planes, boxes, N);
sphereFromBoundsBatch(spheres, boxes, N);
let m = 0;
for (let i = 0; i < N; i++) {
  if (!kept[i]) continue;
  const at = i * SPHERE_VALUES;
  centres.set(spheres.subarray(at, at + POSITION_VALUES), m++ * POSITION_VALUES);
}
transformPointsBatch(viewCentres, frame.view, centres, m); // m === visible
```

Every batch, with its unit function, its measured ratio and the exceptions it declares, is listed
once, in [Batch functions](#batch-functions).

**Which path ran.** `hierarchyUpdateBatch`, `multiplyMatrix4Batch` and `boxTransformBatch` also
exist as WebAssembly kernels (`packages/page-codec-wasm/src/math.rs`), bit-identical to the
JavaScript loop, and a governor (`packages/sdk-core/src/math/path/governor.ts`) plays whichever it
measured faster, operation by operation. `metric.frame(world).mathBatch` publishes
`MathPathMetrics` (`MATH_PATH_CONTRACT` 1): `operations[name].path` is the path the next call
plays, `jsNsPerElement` and `wasmNsPerElement` the sliding medians in nanoseconds per element
(`null` while unmeasured — never zero), `switches` how many times the decision changed, `elements`
the total processed; `clockCoarse` says the thread clock is too coarse to arbitrate, and everything
then stays on JavaScript. The other batches have no kernel: a kernel is written only where a loop's
share of the engine's own frame is measured above 0.1 ms, and none of their loops reaches it (#80).

## Maths reference

The maths the engine computes with, exported by `trillion3d`, `packages/sdk-core` and
`packages/sdk-browser` alike. The public families a page writes against — `createWorld` and
everything it hands out — are the sections above; this section lists the functions underneath them.
Conventions shared by every entry:

- **Column-major 4×4 matrices** in sixteen consecutive numbers, `[12..14]` the translation.
- **Output first, allocation never.** A function writes into the `out` buffer it receives and
  returns it; one that writes in place or fills several named buffers — `normalizeVector3`,
  `decomposeMatrix4` — returns nothing, and its row says so. A call on a per-frame path allocates
  nothing. `outAt`/`aAt` offsets let one large buffer hold many operands.
- **`Float64Array` for what is computed**, `ArrayLike<number>` for what is only read: a host
  matrix, a plain array or a `Float32Array` enters as-is.

### Measured against the witness library

Every row names the witness call it is measured against, and its proof. The proof is
`pnpm run perf:core` (`bench/perf/core/three-vs-core-*.perf.ts`; how a line reads:
[TESTS.md](TESTS.md#performance-benchmarks)): each line runs Three.js and the engine on the same
seeded inputs, compares bit for bit and refuses an engine slower than the witness. The ratios are
the engine's speed-up over the witness, best of three runs on one machine (19 and 20 Sept. 2026,
Apple M2 Max, Node 26.8.2); they say where, not how much a frame gains. The declared exceptions are
named on their line. A host arriving from Three.js reads the witness calls as its migration
table.

### Unit functions

Each unit function has its page in the portal's
[API reference](https://www.trillion3d.com/#/en/api): what it computes, the witness call it
replaces and its proof, with the measured ratio. Those rows are written once, in
`site/content/entries/` (`matrix.ts`, `vector.ts`, `camera.ts`), and never copied here. The
functions live in `packages/sdk-core/src/math/matrix/` (matrices),
`packages/sdk-core/src/math/primitives/` (vectors, colours, camera frame) and
`packages/sdk-browser/src/camera/` (the engine camera).

The engine composes its own projection from the declared optics — **reversed depth, infinite
far plane**: `near` projects to 1, infinity to 0 (`depthConvention.ts`). This is a
declared exception: the bench compares the x/y terms of the projection to the witness's,
the depth terms are the engine's by design. `far` is still read for the frustum far plane,
the adaptive threshold and the shadow range.

#### Sides — `packages/sdk-browser/src/scene/materialSide.ts`

| Function                                    | Computes                                                                                                                                                               | Witness call                          | Proof                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------- |
| `type Side = 'front' \| 'back' \| 'double'` | which faces of a surface are drawn; every raster, cone, pipeline and blend-plan decision compares against it                                                           | `FrontSide`, `BackSide`, `DoubleSide` | `materialSide.test.ts` |
| `sideOf(material)`                          | the `Side` a host material declares, the first of an array deciding, an empty array front — read once at the import boundary, the only place naming the host constants | the host's double-side test           | `materialSide.test.ts` |
| `materialSide(material)`                    | the host constant itself, for the diagnostic materials still built with the host library                                                                               | —                                     | `materialSide.test.ts` |

### Batch functions

`packages/sdk-core/src/math/batch/batch.ts` and the `mathBatch*.ts` beside it: `n` elements per call, flat
typed arrays or sub-views of a fixed stride (`packages/sdk-core/src/math/batch/strides.ts`, `BOX_VALUES`,
`FRUSTUM_PLANE_VALUES`), output first, no allocation, a count as the only return value. Each batch
repeats its unit function, which stays the oracle; how to lay out and reuse the buffers is in the
[Batch math for hosts](#batch-math-for-hosts). The proof is `pnpm run perf:core`
(`three-vs-core-batch-*.perf.ts`). Ratios are the batch's speed-up over the witness's loop, rounded
from the range of the per-run medians over three runs (PR #105); the three exceptions are declared
on their line.

| Function                                                                                    | Computes                                                                                      | Witness loop                              | Proof                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frustumKeepsBoxBatch(kept, planes, boxes, n)`                                              | `kept[i]` 1 where `!frustumExcludesBox`, returns the count kept                               | `for … frustum.intersectsBox(box)`        | bench `Frustum.intersectsBox batch` (×1.1)                                                                                                                                  |
| `sphereFromBoundsBatch(out, boxes, n)`                                                      | four values per box, `sphereFromBounds`                                                       | `for … box.getBoundingSphere(s)`          | bench `Box3.getBoundingSphere batch` (×2.2)                                                                                                                                 |
| `boxUnionBatch(into, boxes, n)`                                                             | `into ∪ boxes[0] ∪ … ∪ boxes[n − 1]`, `boxUnion`                                              | `for … box.union(b)`                      | bench `Box3.union batch` (×1.9)                                                                                                                                             |
| `boxTransformBatch(out, boxes, mats[], n)`                                                  | `out[i] = boxTransform(boxes[i], mats[i])`                                                    | `for … box.applyMatrix4(m)`               | `packages/sdk-core/src/math/batch/batch.test.ts` against `boxTransform`; WebAssembly kernel bit-identical (`math.rs`, `packages/sdk-browser/src/math/batchRuntime.test.ts`) |
| `boxTransformUnionBatch(into, boxes, mats[], n)`                                            | transform then union, one pass, one scratch box                                               | `Box3.setFromObject`                      | bench `Box3 transform and union batch` (×1.8)                                                                                                                               |
| `multiplyMatrix4Batch(out[], a[], b[], n)`                                                  | `out[i] = a[i] · b[i]`, sub-views                                                             | `for … m.multiplyMatrices(a, b)`          | `packages/sdk-core/src/math/batch/transforms.test.ts`; WebAssembly kernel bit-identical (`math.rs`, `packages/sdk-browser/src/math/batchRuntime.test.ts`)                   |
| `invertMatrix4Batch(out[], mats[], n, singular?)`                                           | `out[i] = mats[i]⁻¹`; a zero determinant writes the identity and sets `singular[i]`           | `for … m.invert()`                        | bench `Matrix4.invert batch` (×0.9) — **declared exception**: the batch reads the determinant to flag singularity, the witness does less; ceiling 1.2                       |
| `normalMatrix3Batch(out, mats[], n)`                                                        | nine values per matrix, `normalMatrix3`                                                       | `for … n.getNormalMatrix(m)`              | bench `NormalMatrix3 batch` (×0.5) — **declared exception**: the engine's singularity policy (`packages/sdk-core/src/math/matrix/singular.ts`) is kept; ceiling 2.2         |
| `composeMatrix4Batch(out, positions, quaternions, scales, n)`                               | `T · R · S` per element, all flat or all sub-views                                            | `for … m.compose(p, q, s)`                | bench `Matrix4.compose batch` (×1.5)                                                                                                                                        |
| `decomposeMatrix4Batch(positions[], quaternions[], scales[], mats[], n)`                    | the reverse, `decomposeMatrix4`                                                               | `for … m.decompose(p, q, s)`              | bench `Matrix4.decompose batch` (×1.1)                                                                                                                                      |
| `transformPointsBatch(out, m, points, n)`                                                   | `n` points by one affine matrix, `transformAffinePoint`                                       | `for … v.applyMatrix4(m)`                 | bench `Vector3.applyMatrix4 batch` (×1.4)                                                                                                                                   |
| `transformPointsByMatricesBatch(out, mats[], points, n)`                                    | `n` points, one matrix each                                                                   | `for … v[i].applyMatrix4(mats[i])`        | bench `Vector3.applyMatrix4 per-instance batch` (×1.9)                                                                                                                      |
| `transformDirectionsBatch(out, m, dirs, n)`                                                 | upper 3×3 then normalize, `transformDirectionVector3`                                         | `for … v.transformDirection(m)`           | bench `Vector3.transformDirection batch` (×1.3)                                                                                                                             |
| `srgbToLinearBatch(out, values, n)`, `linearToSrgbBatch(out, values, n)`                    | one channel per element, the exact curves of `packages/sdk-core/src/math/primitives/color.ts` | `for … color.convertSRGBToLinear()`       | bench `Color.convertSRGBToLinear batch`, `convertLinearToSRGB batch` (×1.0) — **declared exception**: the curve, gap ≤ 1.1e-11 forward, ≤ 6.3e-6 back; ceiling 1.1          |
| `hierarchyUpdateBatch(worldViews[], positions[], rotations[], scales[], parents, n, local)` | a whole hierarchy, parents before children, `composeMatrix4` then `multiplyMatrix4`           | `Object3D.updateMatrixWorld` over a scene | `packages/sdk-browser/src/math/batchHierarchy.test.ts`: JavaScript, WebAssembly (`math_hierarchy.rs`) and the witness's `updateMatrixWorld`, same bits                      |

No engine loop runs above 0.1 ms of the engine's own frame, so no batch replaces one yet (#80): the
batches are for hosts until a measured share says otherwise.

## Lights

Nothing lights an opaque surface except a light the host declared. There is no fixed ambient term,
no constant sky and no authored scene lighting: a surface no declared light reaches is exactly zero,
so a windowless corridor stays black at noon. Emission is a material property and is always added.
`world.exposure` sets the camera exposure, applied to linear radiance before tone mapping; it is not
a light and cannot brighten a surface no light reaches. `scene.background` is the colour behind every
object, `null` for the default; set, or written through its methods (`scene.background.setHSL(...)`,
`set`, `setRGB`, `setHex`), it shows at the next frame on every renderer, the session kept. A direct
write of `.r`, `.g` or `.b` is not heard: set `scene.background` again after one. A picture
background, or any value without `getHex`, is refused (`UNSUPPORTED_SCENE_UPDATE`): no path draws
one yet.

A world declares lights like any other object: `scene.add(light.point({ intensity: 2, position:
[0, 3, 0] }))`, `light.intensity = 2` afterwards, `scene.remove(light)` to drop it. Underneath, every
light is a `SceneLight` (version 2) of one of three kinds. `point` and `spot` carry `position` and
`range` in metres, `spot` also `direction` and a `coneAngle` half-angle; `directional` (sun,
overcast sky) carries only `direction` — the propagation direction — and is refused if given a
`position`, a `range` or a `coneAngle`. All three carry linear `color`, a positive radiometric
`intensity` and `castsShadow`. Bounds: 64 lights, 32 per 16×16 screen tile, a 4096-square shadow
atlas, and at most 24 shadow regions redrawn per frame.

`capability.lighting(world)` reports what the **active** renderer applies — `{ sceneLights,
lightingView, shadows, transforms, reason? }` — not what the contract accepts: a call the light
store accepts is not proof of lighting. `reason` names in one sentence what is not applied.

### A luminaire does not block its own light

A real light sits inside something — a lantern glass, a reflector, a shade — and that envelope is
geometry that would enter its own light's shadow map and put the light out.
`SceneLight.emitterRadius` (metres, strictly positive and strictly below `range`, point and spot
only) declares the radius of that envelope: **that light's** shadow pass writes no depth for a
surface closer to the light's centre than the radius. The excluded region is that sphere and
nothing beyond it; the rejection is per fragment, so a wall crossing the envelope still occludes
beyond it, and a receiver inside the envelope is lit. A light that declares no radius carries zero
and nothing is rejected. It is a property of the light, never of a name, a scene or a material
class.

`lights.json` carries the field from two places, in that order. A source that declares a radius on
the lamp puts it in the light's `extras.emitterRadius`; USD and Blender fill it from their own data
(the `inputs:radius` of a `UsdLux` sphere or disk, the diagonal of a rect light, the `radius` of a
Blender `Lamp`, the emitting surface of an area lamp), carried to world metres. glTF
`KHR_lights_punctual` and FBX carry no size. Otherwise the compiler measures the luminaire: when the
lamp's parent node, or one of its direct siblings, carries a mesh whose material emits, the radius
is the greatest distance from the lamp's centre to one of that body's vertices — walked vertex by
vertex, never by its bounding box, which would overrun by √3. Several emissive bodies: the tightest
sphere wins. A radius that fails the contract is counted `light-emitter-radius-invalid` and
omitted; a measured one is counted `light-emitter-radius-derived`.

### Lights imported from the source file

The compiler writes the lights a source file declares beside the manifest as `lights.json`, a cache
product of its own: the manifest format does not move, and a reader that ignores the file loads the
cache as before. glTF lights come from `KHR_lights_punctual`; FBX lights through ufbx; USD lights
from the `UsdLux` sphere, disk, rect and distant schemas; Blender lights from the `Lamp` blocks.
OBJ declares none. Positions and directions are world space, after instancing: a light instanced by
three nodes becomes three entries.

**Unit conversion, chosen and published.** glTF is photometric — candela for `point` and `spot`,
lux for `directional` — while the engine is radiometric, in W/sr and W/m². The compiler divides by
**683 lm/W**, the SI constant that defines the candela; no spectrum is assumed and no hidden gain
applied. A source whose image is then too dark or too bright is corrected by `world.exposure`, never
by the import. FBX carries no photometric unit — its `Intensity` is a percentage — so two published
settings convert it: **1000 lm / 4π ≈ 79.6 cd** for a point or spot, **10 000 lux** for a
directional. A `point` or `spot` with no `range` gets `sqrt(I / 0.01 W·m⁻²)`, capped at 10 000 m.
`innerConeAngle` has no equivalent; the engine softens a spot edge with its own `spotEdgeSoftness`.
A light that does not hold the contract is counted in the file's `rejected` map and left out.

A light casts a shadow when the file says so (FBX carries the flag; glTF has none, so imported glTF
lights cast one). Beyond 64 lights, the ones that carry furthest are kept — directionals first, then
by peak channel intensity — and the rest are counted in the `imported-lights` diagnostic. A world
reads them as `(await scene.load(url)).lights`, in cache order; each lamp is a child of the model,
changed with `light.visible = false`, `model.remove(light)` or `light.intensity = …`.

## Memory budgets

**Memory budgets are fixed reservoirs, never read from the machine.** Free memory changes every
second — another application, another tab —, so a budget measured at start-up would be wrong five
minutes later. The WebGPU engine keeps two byte-sized pools, both host-set and both 512 MiB by
default: the geometry pool (cluster page slots, the root cover always resident) and the texture pool
(virtual-texture tiles, every texture's tail always resident). The WebGL2 engine holds the same
geometry budget, drawn by the same rule: its cut draws coarser beyond it, and the pages no frame
keeps leave oldest first. While a view refines, the pool can go past its budget by at most the
ancestors still drawn in place of the pages replacing them, and is back under it at the next cut
once they arrived (`geometryAllocationBytes` shows it; no pool is reserved, so
`geometryPoolAllocatedBytes` is `null`). It has no texture pool:
`texturePoolBytes` is `null` in its metrics, and `world.budget.texturePool` reads `null`.

**One GPU total, one CPU total.** `world.budget.gpu` is every GPU pool together, and
`world.budget.cpu` the decoded pages the world keeps in CPU memory. A fixed rule splits them, published
as `world.budget.split`:

- GPU: the shadow pool first, at its largest (the largest screen's side and its static layer); the rest
  in two halves, geometry and textures, each capped at its ceiling. At the defaults the split gives
  each pool its own default, so a page that sets nothing sees no change. The shadows never shrink:
  a total under the shadow pool is refused (`GPU_BUDGET_UNDER_SHADOW_POOL`).
- CPU: the decoded-page cache takes the whole total, taken by the next scene load.

```js
world.budget.gpu = 1024 * 1024 * 1024; // one total: every pool redrawn by the split
world.budget.cpu = 128 * 1024 * 1024;
world.budget.geometryPool = 256 * 1024 * 1024; // the call a memory slider makes
```

Reading a pool back gives what the engine holds, not what was asked; a pool write is clamped to
`world.budget.geometryPoolCeiling` / `texturePoolCeiling` and to what `gpu` leaves beside the
shadows and the other pool, so the pools never sum past the total — save a total too small for
their floors (the root cover, one texture layer per lane), which they never go below. Two writes before the next frame
settle in one rebalance. The engine keeps what fits: pages and tiles are copied on the GPU into the
new pool and only what no longer fits is evicted, so the image stays complete throughout.

What a view asks beyond a pool is shown **coarser**, never refused: the cut raises its screen error
until the cover fits, a texture tile shows its coarser level. The frame metrics say so —
`coverageBudgetLimited`, `budgetPixelError` (the rung the image is drawn at, `0` when the requested
detail fits), `geometryPoolSaturated` (pages beyond the pool's slots; a lasting count says the pool
is too small for that view). A value that cannot be held as given is brought to what can be, and
`geometryPoolClamp` / `texturePoolClamp` name why: `root-cover`, `scene`, `page-cap`, `minimum`,
`device-limit`, `ceiling`, or `null`. The only true refusal is `GEOMETRY_POOL_DEVICE_LIMIT`: the
device cannot hold even the root cover.

**Out of memory is absorbed.** The browser may refuse an allocation the budget allows. Each pool is
allocated under an out-of-memory check at prepare, and probed before every rebalance. When the
device refuses it, the pool
is drawn again at half its bytes, down to its floor (the root cover, one layer per lane). The pool
in place is only ever replaced by one the device grants. The frame goes on, coarser where the
smaller pool no longer holds the view, and no exception reaches the page. The
`gpu-out-of-memory` diagnostic names the pool, the bytes asked (`requestedBytes`) and the bytes
granted (`grantedBytes`, `null` when even the floor was refused and the pool in place stays).

Frame targets are **not** budgeted: colour, depth, visibility, HDR, material surfaces, Hi-Z, the
temporal history and a capture follow the resolution, and `gpuFrameTargetBytes` says what they cost.
Only a size the device cannot make is refused (`SURFACE_DEVICE_LIMIT`). How the pools are laid out,
filled and rebalanced: [ENGINE.md](ENGINE.md#memory).

## Captures and image checks

`capture.surface(world, { width, height })` and `capture.buffer(world, { width, height })` return
plain pixels taken aside from the view. For a deterministic image, a page calls
`world.camera.set(pose)`, `await world.awaitPages()`, `world.render()`, then
`await capture.buffer(world, { width, height })`. `awaitPages()` rejects a requested URL that failed
to load; a failed background load is retried at most three times, then left until the world is
reopened. It waits for pages, not for an image: it settles on a world whose loop redraws every
frame, and the capture reads its own image.

## Integration: web, Electron and Node

- **Web**: `createWorld(canvasOrId)` owns the scene, the camera, the renderer and the loop;
  `await world.scene.load(manifestUrl)` adds a compiled model to it like anything else. The
  application owns canvas layout and disposal. With `interactive: false`, the host owns frame
  scheduling (`world.render()`). See [Create a world](#create-a-world).
- **Electron**: `prepare` in the main process, `createWorld` in the renderer process. No Electron
  import in the SDK ([hosts](../packages/README.md#hosts)).
- **Node**: `prepare`, `prepareMany`, `createCompilationJob`, or the `trillion3d-compile` CLI
  ([COMPILER.md](COMPILER.md#using-it-from-node)).
- **Other languages**: spawn `trillion3d-compiler` and read the cache — JSON pointer,
  `clusters.json` and its sidecar, SHA-256 objects, `source.gltf` ([FORMAT.md](FORMAT.md)). The
  interface is the versioned manifest.

## Migration from Three.js

No Three.js adapter ships or is planned: a host that already writes Three.js code writes the same
shapes with this engine's [families](#families) instead. The portal's
[migration page](https://www.trillion3d.com/#/en/learn/three-migration) sets one
complete Three.js program beside the engine program that draws the same scene
([`site/examples/migrating-from-three.html`](../site/examples/migrating-from-three.html)); the
maths map through the witness call each function's page of the
[API reference](https://www.trillion3d.com/#/en/api) names.
Three.js stays a comparison witness of the bench, never mixed with a published world (#79).

## Physics

Physics is an option of the world, not a second world: [Jolt Physics](https://github.com/jrouwe/JoltPhysics)
runs in a worker, and every body is an ordinary mesh with `physics` set.

```js
const world = createWorld('view', { physics: true }); // or world.physics.enabled = true
const floor = object.mesh(geometry.box(20, 1, 20), material.meshStandard({ physics: 'stone' }));
floor.physics = 'static';
const crate = object.mesh(geometry.box(1, 1, 1), material.meshStandard({ physics: 'wood' }));
crate.physics = 'dynamic';
crate.position.y = 5;
world.scene.add(floor, crate);
crate.physics.on('contact', ({ other, impulse }) => console.log(other?.name, impulse));
```

- **Loading.** A world without physics fetches no byte of Jolt, nor the page's code that drives
  it. That code, the worker and its WebAssembly module are fetched the first time physics is
  enabled; bodies set before then are queued.
- **World.** `world.physics.enabled`, `gravity` (a live vector, or `'earth'`, `'moon'`, `'mars'`,
  `'none'`), `paused`, `timeScale` (0.25 is slow motion, 0 stands still; a negative or infinite
  scale throws `RangeError`), `stats` and `error`. `world.physics.water = { level, waves, density,
linearDrag, angularDrag, current }` (or `null`) is the water the bodies float in: each step, the
  worker fits a plane of the waves to every piece under water and pushes it by the weight of the
  water it displaces, so a body lighter than the water floats; the drags set how fast it settles,
  never where; setting or removing it wakes every dynamic body. A wave out of range throws
  `RangeError`. `world.physics.waterSurface` reads those same waves at the simulation's time, to
  draw them (they run on while every body sleeps, and stand still when paused): `height(x, z)`, `point(x, z, out)` (where a rest point of a grid is carried),
  `normal(x, z, out)`, and `wavesNow()`, the waves with their phases carried, so water set again
  goes on from where it is. Live: [floating crates](../site/examples/floating-crates.html).
  `createWorld(canvas, { physics: { gravity, budget } })` sets them at creation.
- **Bodies.** `mesh.physics = 'static' | 'dynamic' | 'kinematic'` or options `{ type, mass, shape,
gravityScale, sensor, ccd, decorative, friction, restitution }`. The shape is read from the
  geometry: a box, sphere, capsule or cylinder is that exact primitive (scaled); any other mesh is
  its triangles when static and its convex hull, computed in the worker, when it moves; a dynamic
  body declared `{ type: 'triangles' }` is refused (no volume, no mass), and a shape the worker
  cannot build fails that body alone (`PHYSICS_FAILED`, the mesh named).
  `{ type: 'compound', parts }` makes one rigid body of primitives, each with its `position` and
  `quaternion` in the object's frame; its scale must be the same on all axes. A dynamic
  body must be a direct child of the scene (`PHYSICS_NESTED`). `position.set` on a dynamic body
  teleports it; on a kinematic one it drives it there over the next step, pushing what it meets.
- **Mass and matter.** `mass` in kilograms, or the material's density times the shape's volume.
  A material carries `physics: 'wood' | 'metal' | 'rubber' | 'ice' | 'stone' | 'glass'` and its own
  `density`, `friction` and `restitution` over the preset; a body's `friction` and `restitution`
  override both.
- **Motion and events.** `mesh.physics.velocity` (read as the last step left it, written to launch
  the body), `applyImpulse(x, y, z)`, `wake()`, `asleep`, and `on('contact' | 'enter' | 'leave')`:
  the other object, an impulse estimate (approach speed times the pair's reduced mass) and the
  point.
- **Joints.** `joint.fixed | point | hinge | slider | distance | cone(a, b, options)` connects two
  bodies, or a body and the world (`b` is `null`), with Jolt's own constraints; `world.physics.add(j)`
  puts it in the simulation and `remove(j)` takes it out. It is made once both bodies are simulated,
  taken out with either, and made again when the body returns. `anchor` (where they connect; the
  end on `a` for a distance, `anchorB` the end on `b`) and `axis` (the hinge's pin, the slider's
  rail, the cone's middle) are world points read when the joint is first made, then kept in each
  body's frame. `limits: { min, max }` stop it — radians for a hinge (−π to π), metres for a slider
  or a distance (whose default is its length), the half angle `max` for a cone —; `spring:
{ frequency, damping }` makes the stop of a hinge, slider or distance soft. `motor: { mode:
'velocity' | 'position', target, maxForce }` drives a hinge or a slider, the position measured
  from where the joint was made; `j.motor` changes it at any time. `breakForce` is the pull in
  newtons past which the joint breaks after a step: `j.broken` turns true, `j.on('break', fn)` is
  called, and the bodies part. A tuning a kind lacks (a motor on a fixed joint) throws
  `RangeError`. Live example: [hinges and joints](../site/examples/hinges-and-joints.html).
- **Stillness.** A body that sleeps sends nothing: once every body sleeps, the worker stops
  ticking and the world draws no frame.
- **Distance and view.** Beyond the camera's draw distance (`camera.far`), a body is frozen with its
  velocities kept, and thaws when it returns. Out of view, or hidden, it sends no pose and keeps
  falling; the pose it has when it falls asleep is sent all the same. `decorative` bodies meet the
  static world only, are simulated only in range and in view, and leave the simulation once asleep:
  their mesh stays where it came to rest (set `physics` again to simulate it anew).
- **Budgets.** `world.budget.physics`, read when the physics starts: bodies, static triangles,
  decorative bodies, memory (a hard ceiling: the module's memory cannot grow past it), body pairs
  and contacts per step, contact events per step, and threads (Jolt's thread pool, the worker's
  included, when the page is cross-origin isolated; never more than the logical cores minus the
  page's own; one elsewhere). The defaults are `DEFAULT_PHYSICS_BUDGET`. A request past one is
  refused with `PHYSICS_BUDGET` on `world.physics.error`; a step that finds more pairs or contacts
  than its budget says so the same way, and an `enter` past the events budget is counted in
  `stats.droppedEvents` (its `leave` is then never sent). The soft-body budget arrives with soft
  bodies.
- **Cost.** The `physics` CPU stage is the page's share (`stats.mainMs`); the worker's step is
  `stats.stepMs`, on its own clock: the two are never added.
- **Compiled models.** A model loaded with `scene.load()` collides with its own triangles once the
  physics is on: the compiler cooked them (`physics.json`, [FORMAT.md](FORMAT.md)) and the physics
  streams its tiles in, restored from Jolt's binary state, around the eye up to `camera.far` and
  around every moving body, nearest first, within `budget.physics.triangles`; past it, the nearest
  stay and `PHYSICS_BUDGET` names the triangles asked. A file of another format or cooked by
  another Jolt is refused (`PHYSICS_FORMAT`); a model compiled before the cook collides nowhere.
  Its tiles grip and bounce as the source's `KHR_physics_rigid_bodies` collider declares, else with
  the default matter (`DEFAULT_MATTER`); every drawn node is static, as drawn.
- **Exact raycast.** `await world.raycast(at, { exact: true })` asks the physics: a compiled model
  is hit on its cooked triangles (the hit names the model and the glTF `material` of the triangle),
  any body on its shape. `{ shape: { type: 'sphere', radius } }` (or `box` with `halfExtents`,
  `capsule` with `halfHeight` and `radius`) sweeps that shape instead; `maxDistance` defaults to
  `camera.far`. Without these options `world.raycast` answers at once, from the scene's own
  geometry, a model on its box. With the physics off, an exact raycast throws `PHYSICS_OFF`.
- **Character.** With physics on, `world.controls` `'character'` is the physics' own character
  (see [Camera controllers](#camera-controllers)): it pushes, rides and is pushed.

## Current limits

- `scene.load` reads a versioned compiled manifest; non-triangle primitives, skinning, morph targets
  and non-standard glTF extensions are not drawn.
- Specular environment-map IBL, area lights and screen-space reflections are not implemented; the
  bounce lighting exists but is off by default ([ENGINE.md](ENGINE.md#light-that-bounces)).
- Transparent surfaces are lit from the source file's own light graph with a fixed ambient, not yet
  by the declared-light rule above.
- A lost device is reported, not recovered: full device-loss recovery and cross-API fallback are not
  implemented.
- Physics, `ten-thousand-bodies` (10,000 boxes landing at once; headed Chrome, 1280×720, DPR 1,
  cross-origin isolated, eight threads, 120 Hz display; load average 8–14, not a quiet machine;
  commit f56d2dd57; three runs): the worker's step is 3.7–4.2 ms p50 and 20–25 ms p95 during the
  landing, which then runs in slow motion for a short moment; the page's `physics` stage is
  0.40 ms p50, 0.59–0.71 ms p95 a frame, and the rAF interval 8.8–10.4 ms p50, 10–13.4 ms p99.
  The renderer's own work for 10,000 moved instances is measured apart (#432). Joints, vehicles, soft bodies, cooked colliders and
  loaded models as bodies arrive with the next physics issues (#396, #398–#400).
