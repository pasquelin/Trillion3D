# Web Geometry SDK

The public guide: what a page and a Node host write against. How the engine draws underneath —
the internal session, the passes, the budgets' mechanics and the diagnostics — is
[ENGINE.md](ENGINE.md); the compiler is [COMPILER.md](COMPILER.md); the cache is
[FORMAT.md](FORMAT.md).

Every public import uses `web-geometry`; conditional exports select the common, browser or Node
API ([SDK_FACADE.md](SDK_FACADE.md)). Do not import `packages/` internals. `SDK_VERSION` and
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

## Create a world

```js
const world = createWorld(canvas); // an element…
const world = createWorld('viewer'); // …or the id of one
```

```js
import { createWorld, object, geometry, material, light } from 'web-geometry';

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

Twelve families describe the scene; one example each:

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

| Family                                                                                                                                                                                                    | Members                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry`, `material`, `light`, `camera`, `object`, `math`, `texture`, `loader`, `helper`, `animation`, `buffer`, and the constant families `blending`/`side`/`wrap`/`filter`/`colorSpace`/`toneMapping` | the scene-graph types, one factory per type (`geometry.box`, `material.meshStandard`, `light.directional`, `math.vector3`, …) and one named value per constant (`side.double`, `toneMapping.aces`) — the blocks above show each family in use |

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
batch.multiplyMatrix4(outputs, parents, locals, 1000);
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
| `batch`      | `multiplyMatrix4`, `transformPoints`, `composeMatrix4`, `frustumKeepsBox`                     | a thousand matrices at once instead of a loop                                      |

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

Dispose in the actual component or page teardown, **not immediately after startup**:
`world.dispose()` removes owned controls, observers, queued frames and abort listeners and closes
the engine, without removing the canvas. A page that wants job semantics around a load — progress,
cancellation — wraps `scene.load(url, { signal })` with `createJob` from `web-geometry`.

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
Live example: [`site/examples/five-ways-to-move-the-camera.html`](../site/examples/five-ways-to-move-the-camera.html).

| `world.controls.kind` | Motion                                         | Gestures                                                            |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `'orbit'`             | orbit around `target`, world up kept           | drag turns, secondary drag or two fingers pan, wheel and pinch zoom |
| `'fly'`               | six degrees of freedom                         | `W`/`S`, `A`/`D`, `R`/`F`, arrows, `Q`/`E` roll, drag to look       |
| `'firstPerson'`       | pointer-locked walk, horizon level             | pointer turns the head, `W`/`S`/`A`/`D`, `Space`/`Shift`            |
| `'trackball'`         | free spin about the screen axes, roll included | drag spins, secondary drag pans, wheel zooms                        |
| `'panZoom'`           | planar view, no rotation                       | drag slides, wheel and pinch zoom, arrow keys pan                   |
| `'none'` (default)    | camera posed by the host                       | none                                                                |

All five publish `object.position`, `addEventListener('change')`, `removeEventListener` and
`dispose()`; the three that keep a pivot add `target`, `minDistance`, `maxDistance`, `enableZoom`,
`enablePan` and `update()`, which reads back a pose the host wrote and clamps it. A controller emits
`change` only when the pose moved, so a still scene schedules nothing.

## Installation and environment API

The package is private and installed from this repository or a local tarball; it is not published
to npm. Browser bundlers must honour the standard `browser` export condition. Node ESM and NodeNext
select the Node branch. A resolver with no platform condition receives the safe common branch, which
contains no DOM, WebGPU, filesystem or process API.

| Task               | Examples                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common API         | `SDK_VERSION`, `FORMAT_VERSION`, `assertFormat`, `EngineError`, batch maths, hierarchy, camera calculations, diagnostics, lighting contracts, jobs and safety policy   |
| Native preparation | `prepare`, `prepareMany`, `createCompilationJob`, `createTerminalProgress`, `createBatchProgress`, `reviewCutouts`, `getSdkProvenance`, the `web-geometry-compile` CLI |
| Browser rendering  | `createWorld` and the families it hands a page, plus `detectCapabilities`                                                                                              |

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
`web-geometry` as the application entry, the installed decode and integration worker files as
separate module-worker entries, and code splitting enabled. Copy the installed `pageCodec.wasm`
beside every emitted chunk that keeps its relative URL, and serve that output directory together
with the compiled scene cache. `pnpm run proof:package -- --browser` is the repository's executable
esbuild configuration and verifies both worker tasks and WASM selection.

### Migration note: the `three` peer dependency

Until the witnesses leave the published package (#275), `sdk-browser` still declares `three` as a
peer dependency, so a browser host installs `three` and `@types/three` beside `@webgpu/types`. No
public API takes or returns a Three.js object, and none of the batch maths needs it.

## Compiling from Node

`prepare(source, cache, scope, triangles, options)` and `prepareMany(jobs, options)` relay to the
native executable; the `web-geometry-compile` CLI is the same relay on the command line. Arguments,
events, the pointer, batch mode, cancellation, exit codes and the executable's selection
(`options.executable`, then `WEB_GEOMETRY_COMPILER_BIN`, then the development build) are in
[COMPILER.md](COMPILER.md#using-it-from-node). An installed tarball ships neither the executable nor
the Rust sources, so it needs one of the first two selections.

## Scene hierarchy foundation

`world.scene` is the graph a page writes into. Below it, `web-geometry` publishes the DOM-free
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
import { createSceneRoot } from 'web-geometry';

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
} from 'web-geometry';

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
once, in [API.md](API.md#batch-math-for-hosts).

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

## Lights

Nothing lights an opaque surface except a light the host declared. There is no fixed ambient term,
no constant sky and no authored scene lighting: a surface no declared light reaches is exactly zero,
so a windowless corridor stays black at noon. Emission is a material property and is always added.
`world.exposure` sets the camera exposure, applied to linear radiance before tone mapping; it is not
a light and cannot brighten a surface no light reaches.

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
(virtual-texture tiles, every texture's tail always resident).

```js
world.budget.geometryPool = 256 * 1024 * 1024; // the call a memory slider makes
world.budget.texturePool = 1024 * 1024 * 1024;
```

Reading either property back gives what the engine holds, not what was asked; writes are clamped to
`world.budget.geometryPoolCeiling` / `texturePoolCeiling`, and two writes before the next frame
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
reopened.

## Current limits

- `scene.load` reads a versioned compiled manifest; non-triangle primitives, skinning, morph targets
  and non-standard glTF extensions are not drawn.
- Specular environment-map IBL, area lights and screen-space reflections are not implemented; the
  bounce lighting exists but is off by default ([ENGINE.md](ENGINE.md#light-that-bounces)).
- Transparent surfaces are lit from the source file's own light graph with a fixed ambient, not yet
  by the declared-light rule above.
- A lost device is reported, not recovered: full device-loss recovery and cross-API fallback are not
  implemented.
