# Web Geometry SDK

Standalone compiler/runtime. Every public import uses `web-geometry`; conditional exports select
the common, browser or Node API. Do not import `packages/` internals.

Build: `pnpm install`, `pnpm run build`, `pnpm test`. Native: `pnpm run build:native` and `pnpm run test:native`. `SDK_VERSION` and `FORMAT_VERSION` are independent.

The generic SDK has no asset URL defaults. Hosts must pass `resourceBaseUrl` to `prepare` and a real `manifestUrl` to `scene.load`. The shared default scope is `slice`. Pointers and compiled manifests with another scope are rejected with `SCOPE_MISMATCH`.

A host that probes a cache before opening it — to enable a button, to tell a user to recompile — calls `assertCachePointer(pointer, scope)` and `assertCacheReady(metadata, scope)` on the two JSON documents it fetched: the first returns the cache URL the pointer names, the second returns the selected triangle count, and both raise an `EngineError` (`INVALID_POINTER`, `CACHE_NOT_READY`, `SCOPE_MISMATCH`, `UNSUPPORTED_FORMAT`, `INVALID_CACHE`, `STALE_CACHE`) otherwise. These are the same checks `scene.load` runs, so a host never has to read a format field itself. They deliberately require no cluster, and therefore no binary sidecar download; the identity of the clusters themselves is `assertCacheIdentity`, which the reader runs on the decoded manifest.

The compiler publishes under `native/<scope>/manifest.json`. See [the cache format](FORMAT.md).

The compiler rejects selected accessors that cross their `bufferView`, invalid strides, malformed sparse ranges/indices and invalid POSITION/index component contracts before publishing a ready pointer. Simplification error is meshoptimizer's reported relative error scaled to object space; it is not a certified global Hausdorff bound. Cache keys include the executed compiler implementation and its dependency lock. Recompile prepared assets to use these corrections; source files are never overwritten.

## Terms

- **World** — what `createWorld` returns. It owns the scene, the camera, the renderer and the loop; nothing else is constructed.
- **Scene** — `world.scene`, the root objects are added to; a compiled model is loaded into it like any other addition.
- **Model** — a compiled manifest, loaded with `scene.load(manifestUrl)` and added to the scene.
- **Renderer** — the drawing path a world takes, `'webgpu'` or `'webgl2'`. A host never imports, names or holds one.
- **Witness** — a comparison backend (bare Three.js, `THREE.LOD`, …), named only through the measurement entry point; it never reaches a published world.
- **Host** — the page that creates a world: it owns the canvas, the layout and the disposal.
- **Pose** — a camera framing: `{ position, target, fov? }`.

`explorer` and `backend` are not public vocabulary: a page creates a **world**, never an explorer,
and never names what draws. The two words stay in this guide only where they name an internal
session (see "Explorer sessions" below) or a measurement concept.

## Create a world

```js
const monde = createWorld(canvas);          // an element…
const monde = createWorld('id-canvas');     // …or the id of one
```

The world owns the scene, the camera, the renderer and the loop. Nothing else is constructed.

```js
import { createWorld, object, geometry, material, light } from 'web-geometry';

const monde = createWorld('mon-canvas');

const sol = object.mesh(geometry.plane(20, 20), material.meshStandard({ color: 0x8899aa }));
const bille = object.mesh(
  geometry.sphere(1, 64, 32),
  material.meshStandard({ metalness: 0.9, roughness: 0.1 }),
);
bille.position.set(0, 1, 0);

monde.scene.add(sol, bille);
monde.scene.add(light.directional({ intensity: 3, position: [5, 10, 2] }));
monde.scene.add(light.ambient({ intensity: 0.2 }));

monde.camera.position.set(0, 3, 8);
monde.camera.lookAt(0, 1, 0);

await monde.scene.load('assets/whisperwind/manifest.json'); // a compiled model, added like the rest
```

`world.ready` resolves once the renderer is prepared; an object added or a model loaded before it
resolves is queued and drawn once it does.

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

Twelve families come from the whole-mesh renderer a page already knows; one example each:

```js
// geometry — the shape alone, with no matter
const g = geometry.sphere(1, 64, 32);
const sol = geometry.plane(20, 20);
const tuyau = geometry.tube(math.path([[0, 0, 0], [2, 1, 0], [4, 0, 2]]), 64, 0.2);
```
```js
// material — the matter alone, with no shape
const acier = material.meshStandard({ color: 0x8899aa, metalness: 0.9, roughness: 0.15 });
const verre = material.meshPhysical({ transmission: 1, ior: 1.5, thickness: 0.4 });
```
```js
// object — shape and matter, placed in the scene
const bille = object.mesh(geometry.sphere(1), acier);
bille.position.set(0, 1, 0);
const decor = object.group();
decor.add(bille);
monde.scene.add(decor);
```
```js
// light
monde.scene.add(light.ambient({ intensity: 0.2 }));
monde.scene.add(light.directional({ intensity: 3, position: [5, 10, 2], castShadow: true }));
monde.scene.add(light.spot({ angle: 0.4, penumbra: 0.3, distance: 30, decay: 2 }));
```
```js
// camera
monde.camera = camera.perspective({ fov: 55, near: 0.1, far: 500 });
monde.camera.position.set(0, 3, 8);
monde.camera.lookAt(0, 1, 0);
```
```js
// math
const axe = math.vector3(0, 1, 0);
const rot = math.quaternion().setFromAxisAngle(axe, Math.PI / 4);
const boite = math.box3().setFromObject(decor);
```
```js
// texture + loader
const albedo = await loader.texture('bois.jpg');
albedo.wrap = wrap.repeat;
albedo.repeat.set(4, 4);
```
```js
// helper — the marks you work with
monde.scene.add(helper.grid(20, 20));
monde.scene.add(helper.axes(2));
```
```js
// animation
const mixeur = animation.createMixer(decor);
const vaEtVient = animation.clip('flotte', 2, [
  animation.vectorTrack('.position', [0, 1, 2], [0, 1, 0, 0, 2, 0, 0, 1, 0]),
]);
mixeur.play(vaEtVient);
```
```js
// buffer — a geometry built by hand
const g2 = geometry.createBuffer({ position: buffer.float32(sommets, 3), index: buffer.uint32(indices) });
```
```js
// the constants, each in its own family
acier.side = side.double;
verre.blending = blending.normal;
monde.toneMapping = toneMapping.aces;
```

| Family | Members |
|---|---|
| `geometry`, `material`, `light`, `camera`, `object`, `math`, `texture`, `loader`, `helper`, `animation`, `buffer`, and the constant families `blending`/`side`/`wrap`/`filter`/`colorSpace`/`toneMapping` | the scene-graph types a Three.js page already knows, one factory per type (`geometry.box`, `material.meshStandard`, `light.directional`, `math.vector3`, …) and one named value per constant (`side.double`, `toneMapping.aces`) — the blocks above show each family in use |

Eight families are ours: they exist because geometry here is **cut into pages** the engine moves
in and out of memory according to what the frame reads. A whole-mesh renderer has no equivalent —
these are not parity, they are what this engine is.

```js
// page — the geometry that enters and leaves according to what the frame reads
const flux = page.createStreamer({ source: page.httpSource('assets/foret/'), workers: 4 });
monde.scene.load('assets/foret/manifest.json', { stream: flux });
```
```js
// budget — fixed envelopes, not wishes
monde.budget.geometryPool = 512 * 1024 * 1024;
monde.budget.texturePool = 256 * 1024 * 1024;
```
```js
// metric — what the image cost, never estimated
monde.onFrame(({ metrics }) => console.log(metrics.selectedTriangles, metrics.residentPages));
const profil = metric.createProfiler(monde);
```
```js
// diagnostic — watching the engine work
monde.diagnostic.mode = 'clusters'; // or 'wireframe', 'triangles', 'beauty'
```
```js
// capability — what the machine grants, before an image is promised
const quoi = await capability.detect();
if (!quoi.webgpu) message('fallback rendering, without indirect lighting');
```
```js
// capture — an image aside, without touching the view
const png = await capture.surface(monde, { width: 3840, height: 2160 });
```
```js
// pose — framing, named poses, replaying a path
monde.camera.set(pose.fromBounds(math.box3().setFromObject(decor)));
```
```js
// batch — a thousand matrices at once instead of a loop
batch.multiplyMatrix4(sorties, parents, locales, 1000);
```

| Family | Members | What it does |
|---|---|---|
| `page` | `createStreamer`, `createCache`, `httpSource`, `decode` | geometry in pages: what enters and leaves memory according to what the frame reads |
| `budget` | `memory`, `geometryPool`, `texturePool` | the fixed envelopes that are not exceeded |
| `metric` | `frame`, `cpuSteps`, `gpuPasses`, `createProfiler` | what the image cost, never estimated |
| `diagnostic` | `createChannel`, `presentationColor`, `partitionAudit`, `transparentOcclusion`, `shadowAtlas` | watching the engine work |
| `capability` | `detect`, `lighting` | what the machine grants, before an image is promised |
| `capture` | `surface`, `buffer` | an image taken aside, at another resolution, without touching the view |
| `pose` | `fromBounds`, `runPath`, `pointOfInterest` | named poses, automatic framing, replaying a path |
| `batch` | `multiplyMatrix4`, `transformPoints`, `composeMatrix4`, `frustumKeepsBox` | a thousand matrices at once instead of a loop |

The world is not a family: it is the object `createWorld` returns, carrying `scene`, `camera`,
`budget`, `diagnostic`, `onFrame`/`loop`, `render`, `invalidate` and `dispose`.

`LOD`, `InstancedMesh` and `BatchedMesh` have no counterpart here: they exist in a whole-mesh
renderer to work around what this engine does natively — one cut through a DAG per frame,
instances, and draw grouping.

## Loop

The world owns the loop, and it stops when the image is stable: after 120 frames with nothing
changing it pauses (`interactive-settle-limit`), and resumes on invalidation. A still scene costs
nothing. `onFrame` is the per-frame hook; `loop` is its alias, for readers coming from a renderer
where the loop is written by hand.

```js
// 1. The world leads; you give it work per frame.
monde.onFrame(({ delta, metrics }) => {
  bille.position.y = 1 + Math.sin(performance.now() / 500);
  monde.invalidate();                 // I moved something: draw again
});

// 2. You lead; the world schedules nothing.
const monde = createWorld('mon-canvas', { interactive: false });
function boucle() {
  bille.rotation.y += 0.01;
  monde.render();
  requestAnimationFrame(boucle);
}
boucle();
```

Form 2 is the host-led form: `interactive: false` plus `render()`.

## What draws: the renderer option

One option, and saying nothing is the normal case — automatic is the absence of a choice, not a
word to write, so there is no `auto` value:

```js
createWorld('mon-canvas');                          // the engine takes the best path the machine grants
createWorld('mon-canvas', { renderer: 'webgpu' });  // forced; a machine without it is refused BY NAME
createWorld('mon-canvas', { renderer: 'webgl2' });
```

Forcing one and being served the other silently is the one outcome this must never produce. A host
never imports, names or holds a backend factory: `options.backends` and the backend factories are
not part of the published entry point (`web-geometry`). The bench and the proofs name their
witnesses (bare Three.js, `THREE.LOD`, …) through a separate measurement entry point
(`packages/sdk-browser/src/measurement/measurement.ts`, `openMeasuredWorld` and the witnesses) — that is their job,
never a host's. See "Which backend renders by default" below for the decision the world takes
internally.

## Installation and environment API

The package remains private and is installed from this repository or a local tarball; it is not
published to npm. Browser bundlers must honor the standard `browser` export condition. Node ESM and
NodeNext select the Node branch. A resolver with no platform condition receives the safe common
branch, which contains no DOM, WebGPU, filesystem or process API.

| Task                | Examples                                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common API          | `SDK_VERSION`, `FORMAT_VERSION`, `assertFormat`, `EngineError`, batch maths, hierarchy, camera calculations, diagnostics, lighting contracts, jobs and safety policy                                       |
| Native preparation  | `prepare`, `prepareMany`, `createCompilationJob`, `createTerminalProgress`, `createBatchProgress`, `reviewCutouts`, `getSdkProvenance`, CLI                                                                |
| Browser rendering | `createWorld` and the families it hands a page — `geometry`, `material`, `light`, `camera`, `object`, `math`, `texture`, `loader`, `helper`, `animation`, `buffer`, `page`, `budget`, `metric`, `diagnostic`, `capability`, `capture`, `pose`, `batch`, the constant families — plus `detectCapabilities`. Witnesses, `chooseBackends`, `replicateInstances` and internal sessions (`openMeasuredWorld` and the backend factories) live behind the separate measurement entry point, not here. |

Version 0.2.0 is the breaking import boundary. Replace `@web-geometry/sdk`,
`@web-geometry/sdk/core`, `@web-geometry/sdk/browser` and `@web-geometry/sdk/node` with
`web-geometry`. The former package name and subpaths are no longer exported. `SDK_VERSION` advances
to `0.2.0`; `FORMAT_VERSION` and compiler/cache identity do not change.

For a strict browser TypeScript project, enable the `browser` condition explicitly. Without it,
Bundler resolution deliberately selects the platform-neutral common declarations, which do not
contain `createWorld` or browser-only types.

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

Install the SDK's browser type dependencies in the host project: `three` is a peer dependency, and
`@types/three` plus `@webgpu/types` are development dependencies. A Node TypeScript host instead
uses `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` and `"types": ["node"]`; NodeNext
then selects the Node declarations from the same `web-geometry` specifier.

The browser runtime is not a zero-configuration single-file bundle. Configure the bundler with the
public `web-geometry` import as the application entry, the installed decode and integration worker
files as separate module-worker entries, and code splitting enabled. Copy the installed
`pageCodec.wasm` beside every emitted chunk that retains its relative URL. Serve only that output
directory together with the compiled scene cache. `pnpm run proof:package -- --browser` is the
repository's executable esbuild configuration and verifies both worker tasks and WASM selection.

`replicateInstances` is a helper that instances the source 1, 4 or 9 times while sharing geometry and materials — a measurement helper, reached through the measurement entry point, not part of `web-geometry`'s published entry.

## CLI

```
web-geometry-compile SOURCE CACHE [slice|full] [triangle-budget] RESOURCE_BASE_URL [threads] [RAM_MB] [none|qem-endpoints]
```

`SOURCE` is a directory with `manifest.json`, a directory with exactly one `.gltf`/`.glb`, a `.gltf`/`.glb` file, a `.fbx`/`.obj` file, or a directory of `.fbx`/`.obj` files (merged into one scene). `WEB_GEOMETRY_COMPILER_BIN` (or `PrepareOptions.executable`) selects the native executable.

Compiler selection uses `PrepareOptions.executable` first, then `WEB_GEOMETRY_COMPILER_BIN`, then
the package-relative development build. The packed artifact contains neither that native executable
nor the Rust sources needed to build it, so an installed tarball requires one of the first two
explicit selections. The installed-package proof supplies a repository-built executable and does
not claim that the tarball ships it.

### Native executable

`web-geometry-compiler` is the only place work happens; Node, Electron or any other host just launches it and relays what it says. It has no runtime dependency: FBX and OBJ are read by ufbx compiled into the binary, so no Blender or converter is required.

```
web-geometry-compiler SOURCE CACHE [slice|full] [triangles] RESOURCE_BASE_URL
web-geometry-compiler SOURCE CACHE [slice|full] [triangles] [threads] [RAM_MB] RESOURCE_BASE_URL [none|qem-endpoints]
web-geometry-compiler --jobs FILE|-
web-geometry-compiler --version
```

Three streams, nothing else:

- **stderr**: one JSON object per line, `{"event": ..., "job": ...}` with `event` in `queued`, `accepted`, `progress` (with `phase`, `completed`, `total`), `complete` (with `pointer`), `cancelled`, `error` (with `code`, `message`), plus `batch` and `done` for `--jobs`.
- **stdout**: for one job, the pointer only (`status`, `key`, `scope`, `url`, `pointer` path, `cache`, headline counts and `metrics`); for `--jobs`, a summary `{status, completed, failed, cancelled, jobs:[...]}`. The compiled manifest is never printed: it is on disk at `<cache>/native/<scope>/<key>/clusters.json` (+ `clusters.bin`), and `<cache>/native/<scope>/manifest.json` points at it.
- **stdin**: a JSON line `{"cancel":"*"}` or `{"cancel":"<job>"}` cancels cooperatively; the process exits with the job marked `CANCELLED`. Killing the process is also safe because every file is written atomically.

Exit code 0 when every job is ready, 2 otherwise. `--jobs` reads `{"workers":N,"ramBudgetMb":total,"threads":default,"jobs":[{"id","source","cache","resourceBaseUrl","scope","triangles","threads","ramBudgetMb","simplification"}]}` and runs `workers` jobs at a time, each with `ramBudgetMb/workers` unless the job says otherwise. `ramBudgetMb` is the budget of the whole batch: the admitted concurrency is lowered until the jobs running together fit in it, and a job asking for more than the total is refused as `INVALID_BATCH`.

FBX/OBJ sources are first imported into `<cache>/native/imports/<key>/` as `model.gltf` + `model.bin` + `manifest.json` (keyed by the input hashes and the importer version, reused when unchanged); the import manifest lists what the importer could not carry (`unsupported`) and ufbx warnings (`notes`). Units are converted to metres and axes to glTF (right-handed, Y up); geometry is copied as-is; materials map to `pbrMetallicRoughness` (a bound texture replaces the colour); textures resolve to PNG/JPEG files inside the source directory (served under `RESOURCE_BASE_URL`) or to embedded bytes; punctual lights become `KHR_lights_punctual`. Animation, skinning, blend shapes, cameras and GPU-only texture formats are not carried.

`prepare()` always sends the eight-argument form (defaults: 2 threads, 256 MB admission, `none` simplification), reads the pointer from stdout and returns the manifest read from disk, its `metrics` completed by the measurements only the pointer holds — `wallMs` and `pruneMs`, taken after the manifest was written. The manifest stays authoritative for every measurement it carries; the pointer only fills in what is missing. `prepareMany(jobs, {workers, ramBudgetMb, threads, onEvent})` runs one `--jobs` process and returns its summary (pointers only).

`prepareMany` resolves with the `BatchSummary` whenever the compiler printed one, and the compiler prints one whether or not every job succeeded: `{status: 'ready' | 'partial' | 'failed', completed, failed, cancelled, jobs}`. A partly successful batch exits 2 and is a resolved `partial` summary, not a rejection — read `jobs` to see which entries carry a `pointer` and which carry a `code`. It rejects only when no summary came back: a batch the compiler refused outright (`INVALID_BATCH`), a missing pointer, a cancelled run, or a spawn failure.

## Scene hierarchy foundation

The scene graph a page writes into is `world.scene` — `scene.add(object, …)`, described in "Create
a world" above. What follows is the transform foundation that graph is built on. `SceneRoot` and
`createSceneRoot` are exported by the common facade `web-geometry`, but are not members of the
`world` object itself — they are the lower-level hierarchy a page reaches for when it manages a
transform tree of its own, outside a world.

`web-geometry` publishes scene-model version `SCENE_MODEL_VERSION` 1. A
`SceneRoot` owns one transform hierarchy; nodes created by `root.createNode({ id, visible })`
have stable, root-unique identifiers and can be attached with `add` or `reparent`. `remove` and
`clear` detach live nodes, while `destroy` permanently invalidates a whole subtree. `clone` gives
the new node a fresh identifier unless one is supplied; `copy` retains the destination identifier.
Both reproduce the local pose and optionally the descendants.
Recursive copying from an ancestor into its descendant is rejected with
`SCENE_COPY_OVERLAP` before either node changes; non-recursive copying remains allowed.

```javascript
import { createSceneRoot } from 'web-geometry';

const scene = createSceneRoot({ id: 'warehouse' });
const shelf = scene.createNode({ id: 'shelf' }).setPosition(2, 0, -4);
const crate = scene.createNode({ id: 'crate' }).setScale(0.5, 0.5, 0.5);
scene.add(shelf);
shelf.add(crate).updateWorldMatrix();
```

Nodes from different roots cannot be combined, duplicate ids are rejected, and a cycle leaves the
hierarchy unchanged. Pose setters mark the data-oriented transform dirty; call
`updateWorldMatrix()` before reading `worldMatrix`. The matrix views are read-only by contract;
write through the setters so dirty tracking remains correct.

This first #78 lot is the hierarchy foundation only. `openMeasuredWorld` does not accept a
`SceneRoot` yet. Engine materials, texture references, frame hooks, and browser-contract migration
remain later #78 lots; lights continue to use the existing `SceneLight` version 2 contract.

The same transform tree already carries the frame. A prepared host subtree is mirrored into one
engine tree when the scene index is built; every later pass enters only the pose numbers the host
moved — each compared bit for bit against what the tree holds — and then runs the world update
without `force`, so a node moved out of two thousand costs the chain under it instead of the
scene. The pose a page record, a cluster root or a transparent copy carries is a sixteen-number
view on that tree's world buffer: a pass rewrites it in place, nothing is copied and nothing can
go stale.

## Batch math for hosts

A host that moves ten thousand instances or culls ten thousand boxes writes the loop itself with a
per-object library, one `Vector3` or `Matrix4` per call and a temporary per step. The engine's
**batches** take `n` elements in one call: flat typed arrays, no allocation, the same formula as the
unit function they repeat — which stays the oracle — and a count as the only return value. They are
exported by `web-geometry`, `packages/sdk-core` and `packages/sdk-browser` alike, so a host imports
one entry point, and none of them needs `three`.

**Layout.** One element occupies a fixed number of consecutive values, each declared once:
`MATRIX_VALUES` 16 (column-major, `[12..14]` the translation), `POSITION_VALUES` 3,
`QUATERNION_VALUES` 4 (`x, y, z, w`), `SPHERE_VALUES` 4 (centre then radius) and
`NORMAL_MATRIX_VALUES` 9 in `mathBatchStrides.ts`; `BOX_VALUES` 6 (min x, y, z then max x, y, z)
in `mathBox.ts`; `FRUSTUM_PLANE_VALUES` 24 (six planes `a, b, c, d`, facing inward, in the order
of `frustumPlanesFromMatrix`) in `mathFrustum.ts`. Flat inputs are read as `ArrayLike<number>` — a `Float32Array`, a plain
array or a host buffer enters as-is; outputs are `Float64Array` (or a `Uint8Array` of flags).
Matrices that are read one at a time — `mats[i]` — travel as **sub-views** of sixteen numbers
(`buffer.subarray(i * 16, (i + 1) * 16)`), built once at load, never per frame: `multiplyMatrix4`
reads its operands at constant indices, and a computed offset costs 6 % of the product.

**Allocate once, reuse every frame.** The buffers below are the host's; a call writes into `out`
and nothing else. Culling ten thousand boxes and bringing the survivors' centres into view space is
two calls — this is `packages/sdk-core/src/math/batch/host.test.ts`, run by `pnpm test`:

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

**The batches**, each named after the unit function it repeats, with the reference loop it
replaces, its measured ratio and the exceptions it declares, are listed once, in
[`docs/API.md`](API.md#batch-math-for-hosts-104-80).

**Which path ran.** Three of them — `hierarchyUpdateBatch`, `multiplyMatrix4Batch`,
`boxTransformBatch` — also exist as WebAssembly kernels (`packages/page-codec-wasm/src/math.rs`),
bit-identical to the JavaScript loop, and the governor (`mathPathGovernor.ts`) plays whichever it
measured faster, operation by operation. `mathPath` is an internal explorer option (`'auto'` by
default, `'js'` or `'wasm'` — `'wasm'` falls back on `'js'` where the module is missing and says
so), reached through the measurement entry point; a world always runs `'auto'`. What a page reads
through `world` is `metric.frame(world).mathBatch`, which publishes `MathPathMetrics` (`MATH_PATH_CONTRACT` 1):
`operations[name].path` is the path the next call plays, `jsNsPerElement` and `wasmNsPerElement`
the sliding medians in nanoseconds per element (`null` while unmeasured — never zero), `switches`
how many times the decision changed, `elements` the total processed; `clockCoarse` says the thread
clock is too coarse to arbitrate, and everything then stays on JavaScript. The other batches have no
kernel: none of their loops was measured above 0.1 ms in the engine's own frame (below), and a
kernel for a cost that is not measured is refused by AGENTS.md.

**What the engine's own frame pays for them** (#80 stage 1, `bench/runner/banc.ts --moteur
webgpu --apres dist --pixelError 1`, WebGPU, 1280×720, DPR 1, Emerald Square `generale` and `rue`
over 180 measured frames, Whisperwind Village `generale` over 60, each line run three times with
its A/A witness — six series per line — on commits `805450a2`–`2713f646` of the branch, Apple M2
Max, the machine shared and its load average kept per series under `charge`: 3 to 25 during these
runs). The values are the run-to-run range of the p50 / p95; the per-step bounds were read from
the `cpu-timing` reports the engine published inside the measured loop, on a 0.1 ms clock — a
step that reads `0.000 / 0.100` is under it, not zero. The bench has since read them from the
profile window instead (`explorer.cpuSteps()`, `bornesCpu` in the bench README): the same bounds,
over the profiled images only, so a rerun re-reads them there — and a still image, held, files a
row of zeros in that window (its tile pump alone unmeasured) where the reports below published
nothing. `null` is unmeasured,
never an estimate.

| scene · camera                      | `gateMs` p50 / p95 | `worldMs` p50 / p95 | `lightsMs`            | `selectionDispatchMs`             | CPU frame p50 | rAF p50    | roots                                                                                                                                                                              | verdict                                                                                                        |
| ----------------------------------- | ------------------ | ------------------- | --------------------- | --------------------------------- | ------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Emerald Square · still              | null               | null                | 0.000 / 0.000 (stage) | 0.000 / 0.000 (stage)             | 0.2–0.7 ms    | 16.7 ms    | 2 479, none rebased                                                                                                                                                                | held image: no loop runs                                                                                       |
| Emerald Square · moving, `generale` | 0.2–0.3 / 0.3–0.4  | 0.4–0.5 / 0.5–0.6   | 0.000 / 0.000         | 0.000 / 0.100                     | 2.7–3.3 ms    | 16.7 ms    | 2 479 (`racines`); rebased on every moved image by construction — the published `racinesRebasees` is the 0 of the last image that ran the step with neither origin nor scene moved | world step at the clock's edge; its loops under 0.1 ms (below)                                                 |
| Emerald Square · moving, `rue`      | 0.3 / 0.3–0.4      | 0.0–0.5 / 0.5–0.6   | 0.000 / 0.000         | 0.000 / 0.100                     | 2.5–2.8 ms    | 16.7 ms    | 2 479, as above                                                                                                                                                                    | same                                                                                                           |
| Whisperwind Village · still         | null (CPU cut)     | null (CPU cut)      | 0.000 (sample)        | `selectionMs` 181–245 ms (sample) | 386–420 ms    | 383–417 ms | 11 263                                                                                                                                                                             | the CPU reference cut over 2 022 678 resident pages, `cpuSelectMs` p50 94–103 ms: the cut's cost, not a loop's |
| Whisperwind Village · moving        | null (CPU cut)     | null (CPU cut)      | 0.000 (sample)        | `selectionMs` 117–272 ms (sample) | 843–856 ms    | 850–867 ms | 11 263                                                                                                                                                                             | same, `cpuSelectMs` p50 111–115 ms                                                                             |

The reading, loop by loop (the list of #80): on the GPU-cut path (Emerald Square) `lightsMs` is
zero by construction — declared lamps live in a store the frame does not walk (`hostSceneWatch.ts`
only reads the host graph at a scene revision) — and `blendWorldMs` is zero, as are the transparent steps
(`transparentPrepareMs`, `transparentEncodeMs`) under which the frustum × box loops of
`webgpuBlendOrder.ts` and `webgpuBlendSelection.ts` run — on the transparent path only, and only
where a scene has transparents. `invertMatrix4` (`webgpuPagesTransform.ts`,
`lightingObservationMeshes.ts` at the lighting experiment's creation) and `boxTransform` +
`boxUnion` (`mathBatchBoxes.ts`, `webgpuPagesTransform.ts`, `pageSelectionCollect.ts` at setup)
run at a host write or at `prepare()`, never per image; `normalMatrix3` (`pageCone.ts`) at prepare, and in the CPU
visibility oracle (`visibilityShadingNormal.ts`) that no frame calls; `sphereFromBounds`
(`threeBounds.ts`) at import; the `frameCostAudit.ts` and `gpuDagOracleMath.ts` loops belong to a
diagnostic and to the GPU-cut oracle, outside a measured beauty pass. What remains every moving
image is the world step: the root rebase (`rootWorldsToRenderOrigin`, sixteen floats per root),
the change scan (`worldsChanged`) and the stretch scan (`refreshWorldStretch`) — timed on the
nanosecond clock by `bench/perf/browser/rebase-racines.perf.ts` (`pnpm run
perf:browser`) on the same 2 479 roots: **0.031–0.032 ms**, 0.000 ms (a moved first root ends the
scan; 0.041–0.043 ms when nothing moved, a case the held image never reaches) and
**0.025–0.026 ms** per image,
three runs, spread under 2 µs on a quiet machine, 6 µs under load. The rest of `worldMs` is the 158 KB world upload and the pyramid
invalidation, not a math loop. On Whisperwind Village the GPU cut is unavailable
(visibility-identifier capacity) and the frame runs the CPU reference cut, where
`frustumExcludesBox` is called per DAG node visited (`pageSelectionCut.ts`) and
`transformAffinePoint` per sphere (`streamingPriority.ts`); that traversal is not a batch — a node
is tested only if its parent was kept — and its cost is the cut's, published as `cpuSelectMs`. No
engine loop was replaced by a batch in this stage, and no WebAssembly kernel was written for the
host batches: the rule stays that a kernel is written only where a loop's share is measured above
0.1 ms in the engine's own frame, and no loop above reaches it.

## Explorer sessions

A page creates a **world** ("Create a world" above); it never creates an explorer. What follows is
the internal session a world opens on itself — `openMeasuredWorld` and its options — kept nameable
for the measurement entry point (`packages/sdk-browser/src/measurement/measurement.ts`) and for the parts of this
guide that document its lighting, memory and diagnostic behaviour in depth. A host reads them
through the `world` families above (`world.exposure`, `world.diagnostic.mode`, `metric.frame(world)`,
…), never by importing `openMeasuredWorld` itself.

### Camera controllers

The engine owns its controllers: they read `PointerEvent`, `WheelEvent` and `KeyboardEvent`,
write the camera's pose, and bring no host-library addon into the page. A session hands out five,
each disposed with the session.

A world asks for one at creation, and reads or drives it afterward through the live `world.controls`
handle:

```js
const world = createWorld('viewer', { controls: 'orbit' }); // at creation
world.controls.kind = 'fly';          // switch live
world.controls.enabled = false;       // pause input
world.controls.target.set(0, 1, 0);   // orbit pivot
```

Controls live on the world, never held or driven by the host directly, for two reasons: they read
input on the canvas the world already owns — a second listener would double the gestures — and
they follow `world.camera` when it is replaced, so a host that swaps the camera never has to
rebuild its controller by hand. `kind` is one of `'orbit'` | `'fly'` | `'firstPerson'` |
`'trackball'` | `'panZoom'` | `'none'` (the default); setting it applies its own consequence — the
previous controller is released and the next one built, following the world's own camera — and
`.enabled` turns the current one off without losing it. Live example:
[`site/examples/five-ways-to-move-the-camera.html`](../site/examples/five-ways-to-move-the-camera.html).
The table below is the contract each one implements underneath.

| `world.controls.kind` | Motion                                         | Gestures                                                            |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `'orbit'`               | orbit around `target`, world up kept           | drag turns, secondary drag or two fingers pan, wheel and pinch zoom |
| `'fly'`                 | six degrees of freedom                         | `W`/`S`, `A`/`D`, `R`/`F`, arrows, `Q`/`E` roll, drag to look       |
| `'firstPerson'`         | pointer-locked walk, horizon level             | pointer turns the head, `W`/`S`/`A`/`D`, `Space`/`Shift`            |
| `'trackball'`           | free spin about the screen axes, roll included | drag spins, secondary drag pans, wheel zooms                        |
| `'panZoom'`             | planar view, no rotation                       | drag slides, wheel and pinch zoom, arrow keys pan                   |
| `'none'`                | camera posed by the host                       | none                                                                 |

All five publish `object.position`, `addEventListener('change')`, `removeEventListener` and
`dispose()`; the three that keep a pivot add `target`, `minDistance`, `maxDistance`, `enableZoom`,
`enablePan` and `update()`, which reads back a pose the host wrote and clamps it. The two steered
ones are integrated by the host: `update(seconds)`. A controller emits `change` only when the pose
moved, so a still scene schedules nothing, and `dispose()` removes every listener it installed.

A value written directly on a source node — `mesh.position.x = 100`, `mesh.visible = false`, a
light's intensity, colour or pose — needs no call to be seen by the next frame. The local pose
of the drawn nodes, the lights and their ancestors is hooked: `position` and `scale` become
twins whose accessors live on a prototype (a reference kept from before still drives the
node), and the write itself increments the scene revision, so a frame compares one integer.
Their other fields — visibility, parent, a matrix set by hand on a frozen node, a light's
numbers — are the node's own data fields, which no hook may touch without slowing Three's
walk: they are compared per frame, a few values per node. One rule remains: a light added to
or removed from the graph changes its shape; the world re-syncs its light store from the scene
itself, on the next frame, so a host never calls anything to announce the change.

The canvas drawing-buffer follows its CSS box: a world sized by CSS needs no option at creation,
and `pixelRatio` follows the browser, including later DPR changes, unless set explicitly.
`world.resize(width, height)` sets an explicit size — omitted arguments read the canvas's current
CSS box. An initially hidden/zero-size canvas needs an explicit `resize()` or must be shown before
creation; a canvas hidden later retains its last dimensions until visible. The host retains
ownership of CSS layout and the canvas element.

A world's session prepares only the engine's own path, chosen from the machine (see "What draws"
above and "Which backend renders by default" below); `options.backends` is not part of `WorldOptions`
— it is an internal explorer option, reached only through the measurement entry point — a world that
is forced to `'webgpu'` and gets no device is refused by that name, never silently switched, exactly
as an explicit `backends: [webgpuPagesBackend]` list is on the internal session.
`scope` still defaults to `slice`: `scene.load(url, { scope: 'full' })` for a full cache. Memory
pools retain their bounded 512 MiB geometry / 512 MiB texture defaults, read and written through
`world.budget.geometryPool` / `world.budget.texturePool`.

The loop's own pausing rule — 120 stable frames, `interactive-settle-limit`, resumed by
`invalidate()` — is described once in "Loop" above. An asynchronous render failure stops automatic
work and emits `INTERACTIVE_RENDER_FAILED` through the internal session's diagnostics; explicit
capture and measurement work should use the measurement entry's manual session to avoid competing
rendering.

Dispose in the actual component/page teardown, **not immediately after startup**:

```javascript
function unmountViewer() {
  monde.dispose();
}
```

`world.dispose()` removes owned controls, observers, queued frames and abort listeners, and closes
the internal session, without removing the canvas. A page that wants job semantics — progress,
cancellation — around a load wraps `scene.load(url, { signal })` itself with `createJob` from
`web-geometry`; `createMeasuredWorldJob` is the internal session's own adapter, used by the
measurement entry.

### Manual rendering and explicit configuration

A world's public surface for this is `createWorld(target, { renderer, interactive: false, controls,
pixelRatio, signal })` (`renderer`, `interactive`, `pixelRatio`, `controls`, `signal` — "What draws"
above) plus `world.pixelError`, the DAG cut's screen error in pixels (`0` by default, the exact
leaves; a positive value selects coarser pages when the cache includes them). `world.render()` draws
one frame and owns neither the loop nor the canvas when `interactive: false`; `world.dispose()` when
finished. `pose.fromBounds(box)` frames a box the same way the default camera used to on open;
`pose.pointOfInterest(name, pose)` names one. The internal session's remaining options —
`maxResidentPages`, `pageFetchWorkers`, `replicaCount`, `backends`, `preload`, `comparisonLayout`,
`comparisonPair`, `gpu`, … — stay on `openMeasuredWorld`, reached only through the measurement entry
point: comparison layouts (`single`, `side-by-side`, `wipe`, `toggle`, `difference`) that render two
witnesses to detached targets with the same camera are a bench and proof tool, not an official
performance verdict, and never part of a published world.

What the engine computes for itself — matrices, vectors, colours, its camera, the side of a material — it builds on `sdk-core` (`engineCamera.ts`, `materialSide.ts`), not on host-library objects — since #78 without exception, the second capture view of `webgpuPagesSurfaceCapture.ts` included, which is the host camera itself read at the aspect ratio of the surface written into (`readCameraWorld`); the functions and their proofs are listed batch by batch in [`docs/API.md`](API.md). Since #269 the contract itself no longer names that library: a material, a texture, a geometry attribute, a mesh and a scene node cross it as the shapes of `hostResources.ts` (`HostMaterial`, `HostTexture`, `HostAttributes`, `HostMesh`, `HostNode`, `HostScene`), a placement as a `Float64Array(16)`, and `explorer.updateMaterial` as the engine's own `Material` (`sdk-core/materialContract.ts`) — parameters imported from the manifest, no shader and no program hook. Since #271 the resources themselves stop at that boundary too: `hostSurfaceImport.ts` reads a host material and its textures in one place into the engine's `Material` and `Texture` (`sdk-core/materialContract.ts`, `sdk-core/textureContract.ts`), addressing and filtering in the engine's own words, and every pass, page row, tile pool and transparent item computes on those records alone. The material is re-read at every call, so a reassigned material or a replaced map is seen as it stands; a texture, addressed by the identity of its record, is read once and refilled when the host bumps `texture.version`. **A host that changes anything a sampler declares — its wrap modes, its filters, its anisotropy, its colour space, or the `KHR_texture_transform` offset, repeat and rotation the engine composes into `transform` — bumps that version**, exactly as it already must for the texels; the host library does it through `needsUpdate` for everything but the UV transform, which the host composes itself. Since #288 no pass, cut, row or plan of the page path reads a host material: a page, a visibility page, a batch page and a transparent item carry `PageSurface` (`pageSurface.ts`), one record per declaration refilled in place, and the cut's normal cones, the page rows, the software raster, the coplanar layer batches, the transparent plan and the frame audit compute on it. Two host reads are left beside it, and they are named rather than implied: the transparent prepare still takes its index buffer from the source geometry (`webgpuBlendPrepare.ts`), and the WebGL2 admission gate still reads the declaration it refuses before anything is drawn (`webglClusterCompatibility.ts`). The host object stays reachable as `PageRec.declaration` for the single use that needs it — handing a surface back to the library that owns it, which is the WebGL2 witness draw, the transparent copy and the diagnostic materials — and `tests/integration/moteur-sans-three.test.ts` holds the closed list of files allowed to read that field. **A host that rewrites a surface in place keeps the same contract as for a texture**, and what is seen without a version bump is stated field by field: the **side** is reread at every look, since every reader of it goes through `surfaceSide`/`surfaceFrontOnly`, which ask the declaration — that is what keeps a surface opened to double-sided in place from losing its pages to their own normal cones; `alphaTest`, `opacity` and the blend flags are reread where they are read, the software raster once per page and per image and the transparent plan at every plan build, while the page row reads them when it writes a row, as it already did. Everything else the record holds — the colours, the six map slots, the transmission — follows `material.version`. The same batch stops the collection from reading the source index buffer: a page is checked against the index count its manifest entry declares, and the page/source identity is proved where it is produced, by the compiler's golden fixtures. Vertex attributes are still the host geometry's — the cache carries index pages over them — and they leave with the loader. A host still hands its own display graph and its perspective camera to `openMeasuredWorld`, and the witnesses convert at their own boundary through `asHostLibrary`; since lot 2 of #78 the engine no longer NAMES that library to read them — the graph it walks and the camera it copies are the shapes of `hostGraphNodes.ts` and `cameraWorld.ts`, and building a host object is gathered in `hostGraphObjects.ts`. The engine-owned scene model is the following lot. Since #273 the lights of a source graph and the diagnostic views (`clusters`, `pages`, `lod`, `visibility`, `screen-error`, `materials`, `tri`) are on those shapes too — `HostTraversable`, `HostColour`, `HostLight`, `HostDiagnosticMesh` — so placing a light and repainting a mesh are the engine's, while building the host material or geometry a view hangs on a mesh stays the witness adapter's.

The engine does not read the host's clip-depth convention, and `HostCamera` does not declare one. It composes its own projection from the optics the camera declares — field, aspect, near plane, zoom — in reversed depth with an infinite far plane (`engineCamera.ts`, `depthConvention.ts`), and that single convention applies to the frustum planes, the view-projection the GPU consumes, the Hi-Z bounds and the CPU visibility raster alike; a camera reaching the engine through `restoreAfterCampaign` or a backend's own `render(camera)` is read the same way, whatever its own renderer draws in. The host's `projectionMatrix` is read in one place only, `readHostDrawCamera`, for a draw the host renderer itself owns — and there it is copied as it stands, never rewritten.

`autonomousGeometry: true` selects the prepared-page WebGL2 backend for wholly static opaque/masked assets. It reads `scene.gltf` and verified geometry pages without downloading the full source geometry buffer; a complete root cover is resident before rendering and useful detail streams afterward. The mode rejects caches without `autonomousScene`, BLEND/skinned/morph scenes and custom backend lists. The WebGPU engine draws every opaque and masked cluster from its own quantized geometry page, read in place in the page pool, and uploads no float geometry for those primitives; it still reads `source.gltf` for the scene graph, the materials and the placements, and keeps the source buffers for what no page covers — transparent clustered meshes (`transparentClusters`), a cache whose pages carry no geometry (`fromSourceGeometry`), and the meshes the cut never sees at all, `shared-blend` and transmissive primitives drawn whole in the forward pass (`sharedBlendMeshes`) — all three counted in the `geometry-pages` diagnostic, beside `fromGeometryPage`, the slot width and `drawCorners`, the corner count every page draw is bounded by. The Three comparison path still uses `source.gltf` and its complete geometry buffer. Material images remain eager in this mode, and GPU-driven selection, indirect drawing and hybrid rasterization are not provided by this WebGL2 path.

### Which backend renders by default

`openMeasuredWorld({ manifestUrl })` with no `backends` option renders through the engine's own path,
whichever one the machine allows. The choice is made once, before the scene is read, from what the
machine offers, and is reported by the `backend-choice` diagnostic: `origin` (`default` or
`host`), `renderer` (the backend id that draws), `autonomous` (true when the session reads the
cache's prepared scene rather than `source.gltf`), the `reason` that decided it and the
`textureSource` it settled on — whether the loader opens the source images, which follows the
chosen path and not the option alone (below).

| Machine                             | Backend that renders                                                                                          | Scene file read            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------- |
| A WebGPU device was granted         | `webgpu-page-raster`                                                                                          | `source.gltf`              |
| WebGL2, cache with a prepared scene | `autonomous-pages-webgl`                                                                                      | `metadata.autonomousScene` |
| WebGL2, cache without one           | `autonomous-pages-webgl`                                                                                      | `source.gltf`              |
| Neither WebGPU nor WebGL2           | none — `EngineError('NO_ENGINE_BACKEND')`, and `EngineError('NO_WEBGL2')` from the capability probe before it | —                          |

Since #297 both WebGL2 rows end in an image: `autonomous-pages-webgl` decodes the cache's
geometry pages itself, draws every page the cut selects — `submittedTriangles` equals
`selectedTriangles` on the frame — and lights the scene from the cache's light table, radiometric
as `lights.json` records it. The compiler writes a prepared scene only when every primitive is
`exact-clusters`; a cache holding a `clustered-blend` primitive carries none, and the same path
then takes its materials and placements from `source.gltf` — `autonomous: false` in
`backend-choice`, an image rather than a refusal. `NO_ENGINE_BACKEND` is left to the machine that
granted neither API. No witness is mounted in any row: `explorer.backends` holds the chosen path
alone.

`referenceBackend`, `exactPagesBackend` and `threeLodBackend` are the Three witnesses of the
comparison views and the bench: they are opt-in through `options.backends`, on the internal session
opened by `openMeasuredWorld`, reached only through the measurement entry point — the engine never
reaches for one on its own, and a published world never sees this option.
`chooseBackends(options, metadata, gpuDevice, webgl2)`, also reached only through the measurement
entry point, is exported so a bench or a proof can read the same decision before opening a session,
and `autonomousCacheReady(metadata)` answers whether a cache carries the prepared autonomous scene.

The public form is `pose.runPath(world, poses, { images })`, `poses` an array of `{ position, target, fov? }`; internally it is a campaign helper (`runCameraPath`): exact A/A image gate, then timed blocks. It is not a general performance verdict. A bench that already switches renderers should replay the same pose list per renderer; do not mix engines inside one timed block.

The `wireframe` diagnostic is a filled unique color per submitted triangle, not `MeshBasicMaterial.wireframe` / GL_LINES. Cluster, page and LOD diagnostics stay on the selected backend's actual cut. The `materials` diagnostic colours each pixel by the material class that resolved it and exists on the WebGPU visibility path only: `world.diagnostic.mode = 'materials'` on another renderer, or switching renderer under it, throws by name.

`createGpuPageCache` is a bounded WebGPU buffer/queue adapter. `webgpuPagesBackend` (`webgpu-page-raster`) consumes the same pages and LOD settings. For opaque pages, selection computes the current camera's drawable resident cut on the GPU, retaining complete coarse coverage until every required child is resident. Draw compaction consumes that mask, counts and scatters in parallel groups, and the visibility shader consumes the resulting instance indices and slot offsets against the original page table. No CPU compaction or CPU opaque selection repeats that work. Asynchronous selection readback serves streaming requests and diagnostics; busy readbacks do not block current-camera selection. Selection/submission counters stay `null` until the matching GPU result is available. Transparency keeps its existing forward path; secondary-camera surface captures and unsupported GPU paths retain the CPU selection fallback. `capabilities.gpuDriven` denotes this opaque selection-to-draw path, not a completely GPU-autonomous engine. The visibility path issues at most six geometry `drawIndirect` commands (cull mode × Hi-Z pass); material, lighting, transparency and presentation add their own draw commands.

### Separated surfaces and lighting (pipeline version 1)

The opaque/masked path writes visibility, then reconstructs material properties into three `rgba16float` textures and one `r32uint` texture (28 logical bytes per pixel): base color/metalness, world normal/roughness, emission/AO, and surface flags. Depth uses `depth32float`. Lighting consumes these surfaces and reconstructs world position from depth and the inverse view-projection matrix. Transparency is shaded separately into the HDR target; a transmissive material — `KHR_materials_transmission` with its IOR and volume — is composed after it by the water pass, the same surface buffer written again once lighting consumed it and one fullscreen composite on a frozen copy of the lit image, the volume bounded by the opaque depth. ACES and sRGB conversion occur at final composition. This changes transparent compositing between drawn surfaces relative to the previous display-encoded blend — a blend surface over the display background is still composed in display space, as the witness does it. The material proof measures the two: to the level over the background, 45 levels against the witness on red at half opacity over an opaque blue, and holds the engine to that declared gap.

The reconstruction runs one pass per **material class**, the published visibility-buffer design, instead of one full-screen program that tests every material feature per pixel. A class is the set of features the resolve shader would otherwise branch on — UV, base map, alpha cut-out, roughness, metalness, occlusion, emissive and normal maps, vertex normals, double-sidedness, tangents — as a word of eleven bits; every page carries its class in its row, and the scene's classes are known once the atlases are laid out, so their pipelines are compiled at preparation, never on the frame that first draws one (a material the host changes into a new class compiles on its first draw). Each frame, the `WG material depth` pass writes every pixel's class as an exact `depth32float` value (`(class + 1) / 4096`, zero on the background); the `WG material surfaces v1` pass then draws one full-screen triangle per class that has a drawable row, at that class's depth under `depthCompare: 'equal'`, so the hardware depth test keeps the class's pixels and its fragment stage — compiled with the class's feature bits as pipeline overrides — reads only the maps that class has. Lighting is unchanged: the surfaces are the same, and there is no per-class lighting model. The `material-classes-ready` diagnostic publishes the classes found and their keys; the `materials` diagnostic view colours each pixel by the class that resolved it; `stageProfile()` reports both passes under the `materials` block. Not done: classifying screen tiles per class, so a class present anywhere costs one full-screen triangle, rejected pixel by pixel where it is absent.

When a WebGPU canvas is present, final composition writes the same display value to the persistent `rgba8unorm` capture target and the canvas `bgra8unorm` attachment in one pass (`WG HDR composition + present`). This removes the separate fullscreen presentation draw and its logical RGBA8 read (4 bytes per pixel); it does not reduce frame-target allocation or change HDR blending, material precision, or surface captures. Texture-only and secondary-camera renders keep single-target composition. Explicit synchronous capture and main-view restoration may still copy the persistent target to the canvas outside normal rendering.

### Temporal antialiasing

The engine has no MSAA: the visibility buffer cannot be multisampled, and the reference does not multisample either — it recovers the edge temporally, and so does this engine. Each rendered image is projected with a sub-pixel jitter (a Halton (2,3) sequence of eight positions, applied as a clip-space translation to the render matrix only) and then resolved by a fullscreen pass, `WG temporal antialiasing`, between the transparent pass and composition: the lit-and-blended image is refiltered on its 3×3 neighbours with a one-pixel Blackman-Harris window centred on the unjittered pixel centre, the history is read where that unjittered centre was in the previous image, clamped to the YCoCg box of those neighbours, and blended in, each side weighted by its inverse luminance. Two `rgba16float` history targets ping-pong (16 bytes per pixel, counted in the frame allocation budget); composition reads the one just written.

Motion vectors are derived, not rasterised: the visibility buffer already names the page row of every pixel, and the row names its placement, so a pixel is reprojected through `previous · current⁻¹` of that placement — the identity for an object that has not moved, written only for the roots that moved since the last accumulated image and reset the image after — then through the previous unjittered view-projection. Both matrices are anchored on the eye of the image, as the occlusion partition anchors its projection, so a large-coordinate model keeps single-precision reprojection. The background, at depth zero, reprojects as a direction, which keeps silhouettes stable when the camera turns.

Two regimes. While something moves — camera, scene, resources, or work in flight — the current image weighs one eighth, the exponential accumulation of the reference. When an image is _quiet_ (nothing changed, nothing in flight: the conditions of a held frame), the history is dropped, the jitter restarts at phase zero and the k-th quiet image weighs 1/k: after a full cycle of sixteen the held image is the uniform average of sixteen images that depend on the final state only, so two executions render it bit-identically (`0 px` A/A measured on the Emerald cache, both views, with the option on). The exponential regime would have kept 12 % of what the image was while pages and textures were still landing, in an order that is never the same twice — 24 % of the ground-view pixels at up to 61 levels between two executions, measured before this rule. The declared cost of the rule: when everything stops, edges stiffen for an image or two before reconverging. A still scene is held only after those sixteen images.

The jitter never reaches the engine camera: the cluster selection, its frustum planes and its screen-error threshold read the unjittered camera, and the selection proofs are unchanged by construction. The occlusion partition, whose margins are ulp-tight, projects with the same jittered matrix that rasterised the pyramid it reads. A surface capture and a diagnostic view render unjittered and unaccumulated.

`temporalAntialiasing` (`true` by default, `false` to opt out) is an internal session option, reached only through the measurement entry point — it is not a member of `WorldOptions`, so a published world always accumulates history; with `false` the image is sampled at the pixel centre with no history — the "before" of a comparison, and what pixel-exact benches of the raster itself ask for. `render-capabilities` reports `temporalAntialiasing` and `motionVectors: 'derived'`. The pass is timed under its own label, but on apple metal-3 the timestamps of the last passes absorb the ones before them (the label reads ~7.5 ms, the whole lighting group), so its cost reads only as a difference of the whole-image envelope with the option off and on (`bench/runner/README.md`, `--antialiasing`). Measured on the Emerald cache at 2496×1404, sun and shadows, moving camera, two series each side: whole-image GPU envelope p50 on the ground view 10.57 → 11.09 ms (+0.5; the four samples per side span 10.22–11.01 and 10.95–11.29, so the difference is of the order of the spread), on the general view 9.08 → 9.48 ms (+0.4; spans 8.96–9.30 and 9.26–9.92, above the spread); p95 +1.5 and +1.4 ms — the price of one fullscreen pass reading ten texels and writing one at 3.5 Mpx, with the filter weights and the motion lookups taken out of the per-pixel path. The pass label itself reads 7.5 ms and means nothing. Image, still camera, converged and held: 27.1 % of the ground-view pixels differ from the unaccumulated image (852 926 of them by one level, 42 by more than 64), 12.2 % of the general view (191 775 by one level, 5 363 by more than 64) — edges and texture shimmer, the intended change, published with the captures under `.mesure/out/l16-fixe-*` on the measuring machine.

### No light without a declared source (opaque path)

Nothing lights an opaque surface except a light the host declared. The deferred resolve has no fixed ambient term, no constant sky and no authored scene lighting: a surface no declared light reaches is exactly zero, so a windowless corridor stays black at noon. Emission is a material property and is added as before.

A world declares lights the same way as any other object: `scene.add(light.point({ intensity: 2,
position: [0, 3, 0] }))`, `light.intensity = 2` afterward, `scene.remove(light)` to drop it — the
`light` family builds every kind the internal session accepts. What follows is that session's own
contract, `addLight`/`setLight`/`removeLight`. `SceneLight` (version 2) has three kinds. `point` and `spot` carry `position` and `range` in metres, `spot` also `direction` and a `coneAngle` half-angle; `directional` (sun, overcast sky) carries only `direction` — the propagation direction — and is refused if given a `position`, a `range` or a `coneAngle`, because it has none. All three carry linear `color`, a positive radiometric `intensity` and `castsShadow`. Bounds (`explorer.lightSettings`): 64 lights, 32 per 16x16 screen tile, a 4096-square depth atlas, and at most `shadowUpdatesPerFrame * 6` (24) shadow regions redrawn per frame.

#### A moving image shades a drawn subset of each pixel's lights

The per-tile list bounds what a pixel may walk; what it walks depends on the image. A **moving** image — one temporal antialiasing accumulates on a history, at one eighth — weighs every light of its tile without its shadow (incidence, attenuation, the cosine and the light's luminance: the cheap part) and shades in full, shadow read included, only `samplesPerPixel` (4, `explorer.lightSettings`) of them. A light worth a sample's share of the pixel's weight is shaded exactly and leaves the pool — it would be drawn every image anyway, and drawing it a varying number of times is what would make a sunlit wall flicker; the remaining samples are drawn from the rest, evenly spaced along the cumulative weight from a per-pixel offset that advances by the golden ratio every image, each drawn light divided by its probability. The estimate is unbiased, so the history averages it toward the sum over every light; a list of four lights or fewer is summed in full. A **still** image — the sixteen quiet ones the hold waits for, and any image nothing averages: a capture, a diagnostic view, `temporalAntialiasing: false`, the first moving image after the history was dropped — shades every light of the tile, character for character the loop from before, so the held image is the exact sum and two runs give it to the bit (`0 px` A/A, Emerald ground view, thirty-two shadowed lights of three-cell range). The blend pass keeps shading its lights in full: a forward surface has no history to average.

Measured (Emerald cache, 2496×1404, DPR 1, `pixelError` 1, ground view, `--lampes 32 --portee 3`: thirty-two shadowed point lights whose ranges reach one pixel, moving camera, 60 Hz display cap, the before side built from `develop` 3e6508b7 and the after side from the batch's shader at 99d1e9c3, both measured in one execution): whole-image GPU envelope p50 39.9 → 17.9 ms, the after side's two runs at 17.9 and 19.3; without any light the same image reads 5.0 ms, without shadows and with every light shaded 10.3. `metric.frame(world).lightsSampled` is the mode flag: `true` when the resolve ran in its sampled mode — a moving image on a history, where a pixel with more lights than samples draws a subset —, `false` when it ran the full loop. The declared cost: a moving image carries a faint grain on lit surfaces where lights of different colours overlap — on a plane under eight lamps of two colours built so that two draws differ as much as they can, the interior settles within 2.4 levels of the still image on average and 27 at worst after twenty-four moving frames (`tests/browser/renders/eclairage-echantillonne.browser.ts`); the still image differs from the one before this rule by 52 pixels of one level over 3.5 million, scattered single pixels; the rank-zero loop is the same text, the compiled module is not, and the cause is not isolated further. What remains, where the reference has one: a spatial denoise before the history.

#### Shadow maps are invalidated page by page, under a millisecond budget

The atlas is cut into `shadowPage` (128) texel pages. A light that moves invalidates its whole map; an object that moves — a transform, a page entering or leaving residence — invalidates only the pages of each face its projected box covers, and only those are redrawn. The frame is the whole face's, only the scissor is the region's, so a page redrawn this way carries **exactly the depth a full redraw would write**, bit for bit. `diagnostic.shadowAtlas(world)` returns the raw depth hash so a host can check that for itself; `openMeasuredWorld({ shadowPageInvalidation: false })` turns the rule off and redraws whole faces, which is how the two are compared.

What a frame redraws is bounded by `shadowBudgetMs` (an internal explorer option reached through the measurement entry point, 1.0 ms by default), measured on the shadow pass's own GPU timestamps and smoothed across frames. Pages the budget refuses wait for the next frame, ordered by the light's screen coverage and by how long they have already waited; they are never dropped, and the frame's `shadowPagesDrawn`, `shadowPagesTotal` (cumulative, `flush()` drains included), `shadowPagesPending` and `shadowWaitMs` publish the work, the queue and the oldest page's delay; the per-stage profile adds, under Shadows, the clusters the region culls kept (`occludeursGardes`, with `regionsRelevees` and `imageRelevee`), sampled on the device one frame in fifteen and read after submission — the frame it describes is named, never the current one. Without GPU timestamps there is no budget at all, only the region ceiling. The cost of one region — rejection, depth reset, indirect draw — is folded into an averaged per-page cost: a named approximation, published in the `direct-lighting` diagnostic.

A directional light's shadows are `sunCascades` (4) cascades following the camera, stored in the same atlas slice mechanism as a point light's six faces, under the same rules: the map is reused while neither the light nor the world inside its extent has moved, and while the cascade still describes the same world extent. That extent is a whole number of `shadowPage` pages on the light plane, addressed by absolute page modulo the face — a ring, as the published virtual shadow maps do —, so a camera that moves less than a page changes nothing, and a camera that moves by whole pages keeps every page still inside and redraws **only the strip that entered**; a move of an extent side or more, or a step of the depth anchor — snapped to a grid of one sphere diameter along the light axis — redraws the cascade whole. Each region drawn rejects, before drawing, the clusters outside the box it cuts in the extent — its page rectangle by the map's depth bounds; alpha-masked materials keep their real cutout; no resolution or detail reduction. Cascades cover `sunShadowFarFraction` (0.2) of the camera's far plane. Their splits are a geometric series of ratio `sunCascadeRatioMax` (4), so texel density changes by exactly that ratio at every seam; the near end of the series is `shadow distance / ratio^cascades`, not the camera's near plane, while the first cascade still covers from that near plane.

Beyond the last cascade the sun's shadow is one ray per pixel against the resident proxy (`proxy.bin`), traced by the same bounded traversal the bounce uses. It is deterministic — the ray direction is the sun's — so nothing is accumulated across frames. The ray starts `sunFarShadowStartCells` (1) proxy cells along its own direction, so a blocker nearer than one proxy cell carries no far shadow; the proxy's certified geometric error moves the shadow edge; a ray that exhausts the published traversal bound reports no blocker, which lights. All of these are published in the `sun-far-shadow` diagnostic, together with the pixels tested and darkened on one sampled image out of fifteen. Without a resident proxy in the cache, the diagnostic says the far shadow is unavailable and the surface stays lit with no cast shadow, as before: the last cascade is never stretched to cover the far plane, which would divide the texel density of every near shadow by five on each axis. The blend pass that lights transparent surfaces binds the same proxy and traces the same ray through the same WGSL, so a distant transparent surface darkens exactly like the opaque one beside it; it binds the proxy read-only, so the two sampled counters come from the deferred pass alone, and the blend fragment stage keeps early depth rejection, which a writable storage binding would cost it. The resident proxy lives in a single storage buffer (a twelve-word header, then the three columns) so that both passes stay within the eight storage buffers guaranteed per shader stage.

`setLightingView(view)` selects what the opaque path outputs. `'lit'` is real lighting and nothing else. `'unlit'` is the raw-albedo diagnostic view: base colour as authored, with no light, no ambient and no emission, for geometry benchmarks that compare images pixel by pixel. It is a diagnostic view, not a light. `'auto'` is the default: the unlit view while no light is declared, real lighting as soon as one is. Declaring a light therefore changes the image; declaring none never leaves a black frame. A world always opens its session on `'lit'`: the auto/unlit distinction, and `'bounce'` below, are internal explorer views reached only through the measurement entry point.

### What a backend actually does with the lights

`capability.lighting(world)` (internally `explorer.lightingCapabilities()`) reports what the **active** renderer applies, not what the contract publishes: `{ sceneLights, lightingView, shadows, transforms, reason? }`. A call the store accepts is not proof of lighting — the store belongs to the session and every backend shares it, so a backend that never reads it leaves the image exactly as it was. `sceneLights` and `lightingView` are read from the backend itself (it reads the store, or it does not); `transforms` is read from `setTransform`; `shadows` is declared by the backend, because no signature says it. `reason` names in one sentence what is not applied. Selecting another backend changes the answer.

The first `addLight`, `setLight` or `setLightingView` made against a backend without `sceneLights` emits one `scene-lights-unsupported` diagnostic per session — the store still accepts the light, because the host may select a backend that applies it later.

`webgpu-page-raster` applies everything, shadow atlas included. `exact-cluster-pages` (Three.js WebGL2) applies the contract lights and the lighting view, without cast shadows: Three would need one shadow map per light — six faces for a point light — far outside any frame budget, and `'bounce'` there renders the lit view. `reference` and `three-lod` apply none.

### The contract lights on the witness path

`exact-cluster-pages` translates the same `SceneLight` store into Three lights, refreshed on every store revision — and since lot 5 of #78 that translation is the witness's own boundary (`exactPagesContractLights.ts`). The engine side names no rendering library: the lights a source graph declares are placed through the host shapes of `hostResources.ts` (`sceneLighting.ts`), and the diagnostic views build their overrides the same way. A `point` becomes a `PointLight` with `decay = 2` and `distance = range`, a `spot` a `SpotLight` with the same plus `angle = coneAngle` and the `penumbra` whose inner cosine equals `cos(coneAngle) + spotEdgeSoftness`, a `directional` a `DirectionalLight` placed at `-direction` with its target at the origin. The radiometric convention is carried unchanged, not approximated: `intensity` stays W/sr for a point and a spot, and Three with `decay = 2` and `distance = range` evaluates `pow(clamp(1 - (d/range)^4, 0, 1), 2) / d^2` — term for term the attenuation of the deferred lighting shader (`directLightWgsl.ts`); a directional light carries irradiance on both paths. Colours are written in the linear working space, so no sRGB transfer is applied on the way in. What is **not** equal is the surface model: Three evaluates its own Cook-Torrance, the WebGPU path its own. Same incident irradiance, different image.

`'unlit'` on that path is obtained by lighting, not by substituting materials: a standard material returns `irradiance * albedo / pi` in diffuse, so one white ambient light of irradiance pi returns exactly the albedo — provided nothing else scales that response. For the length of each frame the view zeroes the material factors that would, whatever the surface: `metalness`, because a diffuse response of `albedo * (1 - metalness)` sends a pure metal to black; `aoMapIntensity` and `lightMapIntensity`, two maps that scale or add irradiance; `transmission`, because what shows through would stand in for the base colour. Every one of them is a uniform, so no program is recompiled, and every one is given back its value as soon as the frame is drawn: returning to `'lit'` restores the previous state property by property. The zeroing runs on every frame rather than once at the switch, because pages enter and leave residency between frames. Named deviation from the WebGPU `'unlit'`: a material's own emission is still added, because the materials themselves are never substituted.

The contract only takes over once the host has used it — one light declared, or one view requested. Until then the source light graph lights alone and the image is the one from before, pixel for pixel. From then on the source graph's lights are switched off: two superimposed sets of lights would be nobody's lighting.

### A luminaire does not block its own light

A real light always sits inside something — a lantern glass, a reflector, a shade — and that envelope is geometry like any other: it enters its own light's shadow map and puts the light out. `SceneLight.emitterRadius` (metres, strictly positive and strictly below `range`, point and spot only, refused on a directional which has no position) declares the radius of that envelope. The excluded region is that sphere and nothing beyond it: **that light's** shadow depth pass writes no depth for a surface whose distance to the light's centre is below the radius, and the projection of its faces does not move. Raising a face's near plane instead would exclude a cube — up to sqrt(3) times the radius along the diagonals — and reject occluders the envelope never contained. The cost is one squared distance per fragment of the shadow pass, on a stage that already exists for alpha-masked cutouts; a light that declares no radius carries a radius of zero and nothing is rejected. The rejection is per fragment, so a triangle that starts inside the radius and extends beyond it still occludes beyond it, which is what a wall crossing the envelope should do. A receiver inside the envelope is lit, because the envelope around it wrote nothing into the map.

It is a property of the light, never a name, a scene or a material class: the engine only knows surfaces. Without the field nothing changes and the current behaviour — an envelope 0.15 m from a 30 m-range source falls inside the 0.15 m near plane and occludes — stands as documented. `lights.json` carries the field from two places, in that order. A source that declares a radius on the lamp itself puts it in the light's `extras.emitterRadius`, in metres — the same `extras` channel `castsShadow` already travels on. USD and Blender fill it from their own data: the `inputs:radius` of a `UsdLux` sphere or disk light and the diagonal of a rect light's `inputs:width` × `inputs:height`, the `radius` — `shadow_soft_size` in the files that still name it so — of a Blender `Lamp` and the emitting surface of an area lamp, each carried to world metres by the layer unit and the object's scale. glTF `KHR_lights_punctual` has no radius field, and `ufbx_light`, which every FBX lamp comes through, carries colour, intensity, direction, decay, area shape and cone angles but no size; Maya, Alembic and Unity lamps are counted unsupported and never reach the contract at all. For those the channel is only fed by a glTF authored with it. Otherwise the compiler measures the luminaire: when the lamp's parent node, or one of its direct siblings, carries a mesh whose material emits — a non-zero emissive factor or an emissive texture, a material property and nothing else — the radius is the greatest distance from the lamp's centre to one of that body's vertices, so the sphere contains the envelope and no more. The body is walked vertex by vertex, never by its bounding box, for the same reason the near plane was refused: a sphere's box overruns by sqrt(3). Several emissive bodies bound to one lamp: the tightest sphere wins. The value is written only when it is finite, strictly positive and strictly below `range`, never on a directional; a radius that fails the contract is counted `light-emitter-radius-invalid` and omitted, and a measured one is counted `light-emitter-radius-derived` so the report says where it came from.

### Lights imported from the source file

An imported scene arrives with its own lights. The native compiler reads the lights the source file
declares and writes them beside the manifest as `lights.json`, a cache product of its own: the
manifest format number does not move, and a reader that ignores the file loads the cache exactly as
before. glTF lights come from `KHR_lights_punctual` (`point`, `spot`, `directional`, with colour,
intensity, optional range and cone angles); FBX lights come through ufbx, USD lights from the
`UsdLux` sphere, disk, rect and distant schemas, Blender lights from the `Lamp` blocks of the SDNA,
each driver rewriting them under the same extension, so one reader serves every format. OBJ declares
no light, and the file is empty.
Positions and directions are world space, after instancing: a light instanced by three nodes becomes
three entries, each with the world transform of its node.

**Unit conversion, chosen and published.** glTF is photometric — candela (lm/sr) for `point` and
`spot`, lux (lm/m²) for `directional` — while the engine is radiometric (P1), in W/sr and W/m². The
compiler divides by **683 lm/W**, `K_cd`, the SI constant that defines the candela; no spectrum is
assumed, and no hidden gain is applied. A source whose image is then too dark or too bright is
corrected by `world.exposure`, never by the import. FBX carries no photometric unit at
all — its `Intensity` is a percentage — so two published settings convert it: one unit is
**1000 lm / 4π ≈ 79.6 cd** for a point or spot (a domestic bulb radiating in every direction), and
**10 000 lux** for a directional (an overcast day). A `point` or `spot` with no `range` gets one
derived from its intensity, `sqrt(I / 0.01 W·m⁻²)`, capped at 10 000 m: the contract needs a finite
range, glTF allows an infinite one. `innerConeAngle` has no equivalent in the contract; the engine
softens a spot edge with its own published `spotEdgeSoftness`. A light whose type, transform or
intensity does not hold the contract is counted in the file's `rejected` map and left out — a
compile never dies on a light, it says so.

`prepare()` and `openMeasuredWorld()` declare these lights on open, before the first backend prepares,
so the `auto` view knows from its first frame that it has a source. A light casts a shadow when the
file says so (FBX carries the flag; glTF has none, so imported glTF lights cast one) — the per-frame
cap of `shadowUpdatesPerFrame` (4) already bounds what that costs. If a file declares more than the
64 lights the contract accepts, the ones that carry furthest are kept — directionals first, then by
peak channel intensity — and the rest are counted in the `imported-lights` diagnostic, never
silently lost. A world reads them as `(await scene.load(url)).lights`, in cache order, for the host to
change with `light.visible = false`, `model.remove(light)` or `light.intensity = …` — each lamp is a
child of the model, not of the scene directly; `explorer.importedLights()` and
`importedLights: false` are the internal session's own form, reached only through the measurement
entry point, for a session that must open a scene with none of them. A scene with no imported light
behaves exactly as before: no light, `auto` resolves to `unlit`. The measurement harness carries the
same switch as `--lampes-fichier on|off`.

### Light that bounces (opaque path)

An opaque surface also receives the light that bounced off other surfaces before reaching it. The
bounce is dynamic: it carries no baked lighting, it depends on no camera, and it follows a light
that moves or a door that closes.

It rests on a **resident proxy** the native compiler writes beside the cache, as `proxy.bin`. The
proxy is the coarse cut of the cluster DAG whose certified geometric error stays under
`proxyErrorMetres` (5 cm), raised per primitive until the whole scene fits `proxyTriangleBudget`
(300 000 triangles, every instance placed), plus a BVH over it and one linear diffuse albedo per
triangle. It carries geometry and materials, never light. The threshold it actually reached is
published in the manifest as `proxy.errorMetres`; on a scene whose DAG does not simplify that far,
the proxy is the DAG's root level and says so. A cache compiled before this change carries no `proxy`
field and stays readable: the bounce is then unavailable and declares it.

At run time two compute passes carry it (`explorer.bounceSettings` publishes every bound below).

**Cascades of probes.** Irradiance lives in up to `cascadeLevels` (4) nested cubes of
`cascadeSize` (16) probes per axis. Each level's spacing doubles, the last one is fixed in the world
and covers the whole proxy extent, and every finer level follows the camera. The finest spacing is
at most `cascadeSpacingMetres` (2 m), narrowed further so that the thinnest dimension of the scene
keeps at least `cascadeLayersAcross` (3) layers of probes, and widened if the coarsest level would
not otherwise reach across the scene. A small scene therefore ends up with a single fixed level; a
city gets four. Probes live on a global lattice at cell centres, so a probe never moves: a level
that follows the camera only exchanges the cells it holds, and a cell is stored by its remainder
modulo the cube side, so sliding by one cell only invalidates the slab that enters. Every probe
carries the cell it holds, and a probe that does not hold the cell you ask for contributes nothing.

**Where the probes go.** An occupancy map, built once from the proxy, says which cells touch
geometry — plus one ring around them, so the eight corners of a useful cell are always held. The
scheduler skips the rest: empty sky and the solid core of a block cost no ray. A probe that turns
out to be buried in a surface, or lost in open sky, also puts itself to sleep until a light changes
or it changes cell.

**A budget in milliseconds, not in rays.** `bounceBudgetMs` (an internal explorer option, reached
through the measurement entry point) sets the GPU time
the `bounce` stage should take per frame (0.8 ms by default). The engine reads the stage's own
timestamp from the per-pass GPU profile and corrects, with smoothing, the fraction of its published
ceilings — `raysPerFrame` (49 152 probe rays) and `surfaceTexelsPerFrame` (16 384 cache cells) — that
the next frame will encode. The frame rate never gives; convergence stretches instead. The timestamp
comes back several frames late and only every third or twelfth frame, and a device that cannot time
its passes keeps the fraction at one: both are declared in the `bounce-lighting` diagnostic, which
publishes the target, the fraction held and the last duration seen.

**What a probe does.** A probe traces `raysPerProbe` (64) rays against the proxy, at most
`traversalSteps` (128) BVH nodes visited per ray, and reads at the cell it hits the outgoing radiance
the surface cache already holds — direct, shadows included, plus the indirect the cascades converged
on the previous round. One ray, one traversal, one read. It accumulates the result in **order-2
spherical harmonics** (nine coefficients) with an adaptive hysteresis, and the cascades are read from
a snapshot frozen before the pass, so the steady image does not depend on the order the device
scheduled its threads. The surface cache holds one radiance per proxy triangle and face and is swept
on the same budget; each full round adds one bounce order to the series. Once the scene has been
swept `settledSweeps` (16) times with no declared light changing and no cascade sliding, neither pass
is encoded at all: a still scene pays nothing, and the `bounce` stage then reads "not measured",
never zero.

The deferred resolve adds the interpolated irradiance of the eight surrounding probes of the finest
level that reaches the point, multiplied by the pixel's diffuse albedo over pi. Three weights guard
the interpolation: the trilinear weight of the cell, the surface's own facing — a probe behind it
knows nothing about it — and each probe's six measured mean distances, which close the leaks through
a wall. Where no level reaches the point the term is exactly zero: a leak would be light without a
source.

Measured on a control room (8 x 3 x 8 m, one red wall, one shadowing point light) against the
compiler's path tracer at eight bounces: mean error **18.6 %** of the oracle, median 14.4 %, p95
49.9 %, engine mean 1.03x the oracle. The same cascades with an order-1 basis give 25.1 %: order 2
is what buys the accuracy, and the remaining error is the interpolation, not the basis. The published
error target is 10 %, so it is not met. Convergence after a light jumps: **22 frames, 367 ms** at
60 Hz, of which 16 frames are the mandated closure of the bounce series.

The bounce stays **off by default**: measured on Emerald with eight point lights, the `bounce`
stage costs **1.12 / 1.18 / 1.26 ms** (p50, the three bench views) against 2.22 / 2.22 / 2.26 ms
before this change, which is still above the one-millisecond bar that would have made it the default.
Most of that is fixed cost, not work: the millisecond budget drives the fraction down to its floor
(2 %, 15 probes and 328 cache cells per frame) and the stage still reads 1.1 ms.
`bounce: true` (also reached only through the measurement entry point) turns it on for the session. A published world does not expose it yet. Left off, the deferred resolve
compiles the direct-only program, exactly the shader of the previous change, and the bounce declares
itself unavailable rather than appearing silently. Emission, transparency and specular are not
bounced; the proxy carries diffuse albedo only.

`setLightingView('bounce')` is the measurement view: the indirect irradiance alone, multiplied by
exposure, in linear values with no ACES and no sRGB. It is not an image to look at — it is the
quantity `bench/runner/oracle.ts` compares against the compiler's own path tracer
(`web-geometry-oracle`, built by `pnpm run build:native`), which traces the source triangles with the
same light and diffuse-material model. The oracle truncates the bounce series at its `bounces`
count while the engine carries the whole series, so a comparison only means something at a matching
order.

`world.exposure` sets camera exposure, applied to linear radiance immediately before ACES. It is not a light: it cannot brighten a surface no declared light reaches, and a scene without lights stays black whatever its value.

The transparent path still uses the authored Three.js light graph and its fixed ambient, so `sceneLighting?: HostTraversable` still supplies that graph (falling back to the loaded glTF graph, then to a hemisphere/sun rig), still adapts directional, point, spot, hemisphere and ambient lights to a bounded buffer (maximum 256 visible lights; excess and unsupported types fail explicitly), and `explorer.refreshSceneLighting()` still applies after adding or removing lights there. Extending the no-implicit-light rule to transparents is later work. Environment-map lighting, area lights, probes and global illumination are not implemented.

For `renderer: 'webgpu'` (or, internally, `backends: [webgpuPagesBackend]`), the session configures the host canvas with its own `GPUCanvasContext` and the engine writes the final image into it; no WebGL renderer is created. A mixed-backend internal session — reached only through the measurement entry point, never a published world — composes on a WebGL2 surface instead: the engine presents into a canvas of its own, publishes it as `presentedSurface` on the backend, and the host copies it there with the engine's own full-screen program (`createBackendPresenter`) — no texture, material or mesh of a rendering library takes part, and the bytes go through unchanged. `presentedSurface` is published only while its image is current: a lost or disposed device withdraws it and blanks the canvas, on either path, before the next call raises `WEBGPU_LOST`, and the loss is announced once, after that withdrawal, by the `gpu-device-lost` diagnostic (`code: 'WEBGPU_LOST'`, `reason`: the device's own, `unknown` when its `lost` promise rejected, `uncaptured-error` or `residency`) — no host composes a frame older than the device. The browser proof (`tests/browser/renders/surface-appareil-perdu.browser.ts`) covers the composed path; the direct path shares the presenter code that blanks the canvas. This cross-API composition has a separate cost and must not be conflated with direct presentation. Neither normal path calls `copyTextureToBuffer` for the image. No physical zero-copy or performance gain is claimed without browser measurements. Geometry-selection feedback is separate from image readback and still exists.

For every WebGL2-hosted session, `createWebglSurface` creates and owns the context before
anything else exists. It fixes the context attributes, computes drawing-buffer dimensions from
logical size and DPR, avoids resetting the buffer on an unchanged size, observes context loss and
restoration, and releases the context once. That surface is the session's only WebGL2 resource,
and the composition host holds no renderer: targets, held frame, comparison compositor and
presenter are engine objects on that context, the frame composer asks every engine to draw its
whole image through `drawHostGeometry`, and only the Three witnesses draw a Three scene, through
the one adapter they share. A comparison side is the single view of its engine, byte for byte.
Each function, what it replaces and its proof:
[API.md](API.md#batch-e7--composition-host-and-captures-on-engine-owned-framebuffers-85-second-pull-request)
for the composition host,
[API.md](API.md#batch-e8--draw-records-and-observation-meshes-on-engine-buffers-85-third-pull-request)
for the draw records, the scene copies and the transport experiment's observation.
Pure direct-WebGPU sessions never bind the host canvas to a WebGL context.

`exact-cluster-pages` draws every paged cluster — opaque, alpha-masked and blended
`MeshStandardMaterial` and `MeshBasicMaterial` batches — through an engine-owned WebGL2 program,
and nothing else draws them. The program reads base colour, metallic-roughness, normal, occlusion and emissive maps,
including each map's UV set, transform, sampler and colour space, according to the
[Khronos glTF 2.0 material specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#materials).
Direct light adds Lambert diffuse to a Cook-Torrance GGX distribution, correlated Smith visibility
and Schlick Fresnel, the published model described in Brian Karis's
[Real Shading course notes](https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf).
This is not glTF Appendix B's Fresnel mixture: its diffuse term does not multiply by `(1 - F)`.
The scene copies — the transmissive meshes over the frozen backdrop, then the blended ones — are
submitted by the same owner, in the order the reference draws a scene, and nothing of this engine
enters a host renderer. A draw record is an engine object: the primitive's resident index buffer,
the host material as declared, the placement and the ranges of the visible clusters; a two-sided
transparent surface draws back faces then front faces, read at the draw, and a coplanar layer
carries its depth offset as a number, so no host material is cloned or frozen. What the engine
still reads of the host library on this path is its data model — geometry attributes, materials,
textures — through the contract types, until the engine-owned scene model (#78) replaces it.
`autonomousClusterDrawsTotal` is the session counter that
proves the cluster draws came from the owned program. It is cumulative and therefore is not a
per-frame draw-call measurement.

A transmissive source mesh (`KHR_materials_transmission`, with `KHR_materials_ior` and
`KHR_materials_volume` factors) is not paged: the engine keeps it as a scene copy of its own and
composes it after the clusters, through the same program. What the glass lets through is the
engine's own image: the frame is first drawn into a frozen backdrop — linear half-float colour and
depth, cleared to the scene background colour, black for a background that is not a colour — then
drawn to the display target, and the copy reads the backdrop at the refracted, thickness-advanced
position, falls back to the unbent sample when the copied depth would put an object in front of
the glass, and attenuates by the volume colour. The composition is the glTF one and the engine's
WebGPU one (`webgpuTransmissionWgsl.ts`): the transmitted share replaces alpha blending,
`a = alpha + t (1 - alpha)`, the specular of the declared lights stays on a null albedo, no light
of the pass's own. A two-sided transparent copy draws its back faces then its front faces, as
the batches do. The copy shares the frame's depth buffer, target encoding and tone mapping, and
reaches captures, comparison targets and held frames through the same owner;
`autonomousCopyDraws` counts the copies' submissions per frame and `transmissionBackdropBytes`
publishes the two copies' cost, kept until a resize, zero before the first transmissive copy in
view. The second cluster pass is the cost of the backdrop, paid only by a frame with a transmissive
copy in view — copies are frustum-tested like the host renderer tests them — and counted in
`drawCalls` and `submittedTriangles`, not in the session counter `autonomousClusterDrawsTotal`,
as the reference renderer pays its transmission target. A material that declares an IOR without
transmission is refused by name: the cluster BRDF keeps its dielectric F0.
A copy a diagnostic mode paints, or whose material stops transmitting, draws as a whole mesh
through the same program. The copies draw in source order after the clusters and before the
host's own blended copies: no back-to-front sort. The backdrop is a plain copy: roughness does
not blur what comes through, and one transmissive surface does not see through another.

There is no other renderer for paged clusters. A scene whose material, light or texture the
program cannot preserve — material arrays, blend states other than normal alpha, physical
extensions beyond the transmission volume, environment/light/bump/displacement/alpha maps, flat
shading, custom shader hooks, non-image textures, unsupported UV channels or lights, a context
without a half-float backdrop — fails its preparation with `EngineError`
`CLUSTER_MATERIAL_UNSUPPORTED`, whose `details.reason` names the input; a later mutation into one of
those states raises the same named error before any draw, never a partial image. No
bit-identical Cook-Torrance result is claimed: the owned implementation follows the published
Lambert and GGX/Smith/Schlick model rather than another renderer's shader. Image comparisons publish
the resulting delta. Geometric roughness filtering uses the less-conservative variance from equation
5 of Tokuyoshi and Kaplanyan's
[Improved Geometric Specular Antialiasing](https://yusuketokuyoshi.com/papers/2019/ImprovedGeometricSpecularAA.pdf),
with the paper's 0.5 pixel radius and 0.18 variance cap. Against the same curved witness, this reduced
the maximum channel delta from 37/25/13 to 33/19/10 at 64/128/256 px without changing the planar
analytic fixture. Across five subpixel translations at 128 px, the centre highlight spans six channel
levels on both implementations (owned 51 to 45; witness 53 to 47), and silhouette coverage matches on
every frame. This proves the tested spatial and motion stability; it does not claim temporal quality
for every material or camera path.

The independent full-surface fixture uses the same 32×16 tessellated sphere and a test-only glTF
Fresnel-mix BRDF (§B.3.5), rendered at 8× and box-resolved to 128 px after decoding the quantised
sRGB samples to linear light and re-encoding the average. Its five-pose 4× to 8× convergence is RMS
0.135 and maximum 4 channel levels. Across the same five subpixel poses, owned spatial error is RMS
1.338/max 24 against the common oracle, versus 2.107/max 40 for the witness; temporal-difference
error is 1.148/max 36 versus 1.461/max 47. The oracle is independent of both production programs.
OPAQUE ignores source alpha and surviving MASK fragments write alpha one, as required by glTF.

On the 1 px Emerald street path at 1280×720 and DPR 1, with one 40-intensity point light, shadows
off, 20 warm-up frames and 60 moving-camera frames, earlier synchronous submission-burst readings
were 5.6/5.6/5.6 ms against 5.6/5.5/5.7 ms for the temporary adapter.
They led to the texture and bounded-light reductions described above, but are not a frame-performance
verdict because that old loop did not yield to the browser. At candidate `c2315306` versus witness
`48c90c4e` (the same runtime as the integrated base), three diagnostic-free moving runs measured rAF p50/p95 intervals of
16.7/33.3, 16.7/16.8 and 16.7/16.8 ms, versus 16.7/83.4, 16.7/83.3 and 16.7/83.3 ms. The headless
display cap was 60 Hz. Synchronous CPU submission p50 was 4.7/5.0/4.9 ms versus 5.0/5.2/4.9 ms;
it is reported separately and never added to the frame interval. Every repeat kept the same cut and
had zero A/A pixels. This establishes better whole-frame cadence for this path, not a general speed
claim; GPU timestamps remained unavailable.

**Memory budgets are fixed reservoirs, as in the reference, never read from the machine.** Free memory changes every second — another application, another tab —, so a budget measured at start-up would be wrong five minutes later. The WebGPU engine keeps two byte-sized pools, both host-set and both defaulting to 512 MiB like `r.Nanite.Streaming.StreamingPoolSize`: `geometryPoolBytes` (cluster page slots: `floor(bytes / pageBytes)` slots, the root cover always resident) and `texturePoolBytes` (virtual-texture tiles, split between the colour and data atlases in 63.5 MiB layers, every texture's tail always resident). What a view asks beyond a pool is shown coarser — the cut raises its screen error until the cover fits (`coverageBudgetLimited`), a tile shows its coarser level — and nothing is refused, nothing stops. The cut's screen error climbs a ladder that doubles what the image was drawn at (1 px at least on a first overflow, up to 4096) and comes back down rung by rung to 0.125 px once the requested cut fits under 70 % of the slots; `budgetPixelError` publishes the rung the image is drawn at, `0` when the requested detail fits. The ladder moves only on a cut sampled at the rung currently in force — the GPU cut's readback lags the frame by a few images, and an adaptive host threshold is not what it is matched on — and a rung whose requested cut overflowed for the current view and pool is not asked again until the view or the pool changes: a still camera settles in a few samples and holds its frame instead of alternating between two cuts. A value that cannot be held as given is brought to what can be and the reason is published: `geometryPoolClamp` / `texturePoolClamp` read `root-cover` (raised to the root cover), `scene` (the scene is smaller), `page-cap` (`maxResidentPages`, the page-count cap tests and benches use), `minimum` (one layer per atlas), `device-limit`, `ceiling`, or `null`. `geometryPoolSaturated` counts the pages the image holds — root cover, cut and drawn ancestors — beyond the pool's slots; zero is normal, a lasting count says the pool is too small for that view, and the cut coarsens until it fits. The only true refusal is `GEOMETRY_POOL_DEVICE_LIMIT`: the device cannot hold even the root cover.

Frame targets are **not** budgeted: colour, depth, visibility, HDR, material surfaces, Hi-Z, the temporal history and a surface capture follow the resolution, as the reference's do, and `gpuFrameTargetBytes` says what they cost. Only a size the device cannot make is refused (`SURFACE_DEVICE_LIMIT`). The previous 288 MiB frame cap refused 4K on machines that held it; it is gone.

**Budgets change during the session** — the call an application's memory slider makes — through `world.budget.geometryPool = bytes` / `world.budget.texturePool = bytes` (clamped to `world.budget.geometryPoolCeiling` / `texturePoolCeiling`; reading either property back gives what the engine actually holds, not what was asked); internally the write resolves through `explorer.setMemoryBudgets({ geometryPoolBytes?, texturePoolBytes? })` to what the engine holds afterwards (`geometryPool`, `texturePool` with their `clamp`, `evictedPages`, `evictedTiles`, `durationMs`; `texturePool` is `null` before `prepare()` has drawn the lane pools — the budget is kept and prepare draws them at it). Two writes made before the next frame settle in one rebalance. Unlike the reference, which flushes its pools when their size changes, the engine keeps what fits: pages and tiles are copied on the GPU into the new pool, the root cover keeping its place before any other page, then the pinned pages, then the most recent; only what no longer fits is evicted, and the image stays complete throughout. Every bind group that named the old pool is rebuilt on the next image from the identity of what it names, in every pass. The geometry pool can grow up to `geometryPoolCeilingBytes` (the slider's maximum; the initial budget when absent), because the per-drawable-row tables are sized once, at that ceiling; a request above it is clamped `ceiling`. Backends without pools throw `UNSUPPORTED_MEMORY_BUDGETS`.

WebGPU pins the root cover for the lifetime of the backend, including its CPU index bytes. A region keeps a complete resident representation until all replacement pages have been uploaded; queue writes precede subsequent draws on the same GPU queue. If old and new detail cannot coexist, the renderer returns to the root cover before reclaiming old slots. Shared URLs occupy one slot across instances. The pool always holds the pinned cover: a budget under it is raised to it (`geometryPoolClamp: 'root-cover'`), never refused. If requested detail plus the cover cannot fit, rendering retains a complete available cut and reports `coverageBudgetLimited: true`; it may therefore be coarser than the requested pixel error. This does not bound total scene memory or certify the compiler's simplification quality. Standalone backends must supply validated `readPage(url)` or preload the root bytes; otherwise they submit no image until the complete initial cover is available.

`FrameMetrics.coverageReady` reports initial GPU coverage, `coverageBudgetLimited` reports blocked detail admission, `budgetPixelError` the coarser threshold the page budget imposes (`0` when none), and `streamingError` preserves the latest page-loading failure (`null` when absent). Other backends report coverage as `null`.

Two counters say different things about pages, and a host that confuses them reads thrashing where there is none:

| Field            | Meaning                                                                                                                                                                                                                                   | Reported by                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `pagesDetached`  | Clusters that left the drawn cut since the backend was created. A moving camera detaches clusters on every frame; this is a measure of cut churn, not of memory pressure.                                                                 | `exact-cluster-pages` (WebGL). `null` elsewhere. |
| `cacheEvictions` | Pages actually evicted from the cache that feeds the drawn geometry — the backend's own GPU page cache when it owns one (`webgpu-page-raster`, `autonomous-pages`), the host page streamer otherwise. This is the memory-pressure signal. | every backend                                    |

A bounded cache evicting nothing while `pagesDetached` climbs is the normal state of an exploration. Background loads attempt a failed URL at most three times per explorer, then stop retrying it; reload the explorer to retry after repairing the source. `awaitPages()` rejects a failed requested URL. Initial cover read failures reject preparation. Diagnostics include `coverage-bootstrap-start`, `coverage-bootstrap-ready`/`coverage-bootstrap-failed`, `coverage-budget` (delivered during `flush()`), `coverage-upload-failed`, and `coverage-streaming-failed`. The `render-progress.coverage` object uses version 1. CPU cache eviction cannot remove an active GPU fallback; deferred evictions apply when its detail pages are released.

This is an internal GI capture, distinct from the `capture` family a world reads (`capture.surface(world, { width, height })` and `capture.buffer(world, { width, height })`, plain pixels aside from the view): `await explorer.captureSurfaceView(pose, {width, height, signal})` returns an owned `SurfaceCapture` version 1 with the four material textures, depth, inverse view-projection, camera position and selected triangle count. The host must serialize this operation with ordinary rendering and call `capture.dispose()` before requesting another capture. It reuses the engine's geometry and page cache, selects for the requested camera, rejects missing pages/insufficient budgets, and restores the main viewport and camera afterward. Translucency is excluded from these surface textures. The current implementation executes views sequentially and reallocates frame targets when dimensions change; it is not a batched multi-view renderer. It provides a concrete surface interface for future GI work, not Lumen cards, distance fields, ray tracing, velocity or a populated Surface Cache.

If visibility/material initialization fails in a direct WebGPU session, the engine fails visibly. It also rejects transmission rather than silently leaving it out. Mixed sessions retain the earlier reported fallback path; inspect `unsupported` and diagnostics and reject fallbacks for quality/performance comparisons. Per-texture transforms/UV channels/sampler modes, skinning, morph targets and the full material contract remain unsupported. No compiler/cache-format migration or new LOD algorithm is part of this integration.

### WebGPU visual checks and diagnostics

`diagnosticDetail: "trace" | "summary"` controls event detail. An `onDiagnostic` observer defaults to trace; omit the observer to disable collection. The repository's model bench enables debug mode by default and records that choice in its report. Debug frames are marked `measurementKind: "diagnostic"`, including beauty renders. Turn debug off before collecting performance evidence.

Trace covers host frames and camera poses, selection decisions and fallback reasons, complete coverage/admission, residency queues and protections, CPU cache reads and hash verification, retries/errors, GPU slot generations/uploads, actual cache eviction, draw-list detachments, target allocations, rendering steps, and capture/disposal boundaries. Page catalogues and numeric page references avoid repeating long URLs in every snapshot. Missing physical measurements remain `null`; a successful image or coverage flag does not certify compiler correctness or visual parity.

Explorer events carry a session ID, a monotonic sequence and their creation timestamp. The host queues observer delivery outside the measured call, with a 65,536-event pending limit and an explicit `diagnostic-loss` record on overflow. `createDiagnosticChannel` exposes `flush()`, `flushSync()`, `pending()` and `dropped()` for standalone hosts. Do not discard a loss record. A host that streams the full report to a compressed archive extracts its complete JSONL journal plus capture gallery, and does not mark the pending archive successful until writing finishes; such a host archives sequence/session metadata alongside the event context, file export and observer work can still affect scheduling and the next frame.

Every SDK build records SHA-256 hashes of distributed JavaScript modules in its configuration event. A direct source import has `hash: null`; it must not claim a compiled build identity. These hashes identify code, while the cache's compiler/format metadata identifies prepared assets.

CPU scheduling, asynchronous elapsed time, command encoding and GPU pass execution have distinct scopes. GPU trace status records unavailable instrumentation, busy/skipped frames, invalid timestamps and discarded output. A pass-duration sum excludes separate selection dispatches, transfers and display latency. No total VRAM measurement is inferred from allocated buffers.

`onDiagnostic(event)` receives structured phases with `pipelineVersion: 1`: `gpu-presentation` (direct, mixed composition or texture-only), `frame-allocation` (dimensions/reserved bytes/budget), `material-textures`, `material-textures-ready`, `material-classes-ready` (the resolve classes of the scene and their keys), `material-surfaces-ready`, `scene-lighting`, `render-capabilities`, and the first readback/presentation samples. `render-progress` reports selected/resident pages, triangles and pending pages during explicit `flush()` calls. In `diagnosticDetail: "summary"`, progress and CPU samples retain the two-second cadence. In `"trace"`, each render also produces detailed records; observers are deferred outside the synchronous measured render call. Surface capture emits start, ready/failure, restoration and release phases. Failures include their phase and error and are deduplicated. Device loss is reported under `gpu-device-lost`, an uncaptured GPU error included (`reason: 'uncaptured-error'`, the error's text as `message`), never twice for one error. Observer exceptions cannot interrupt this backend. These diagnostic durations are not frame-performance measurements.

The browser requests `timestamp-query` when the adapter advertises it. `gpu-timing-status` reports availability. In summary mode, at most one submission per 60 render calls is instrumented; trace mode requests instrumentation on every render call, with one outstanding readback, at most 64 pass pairs, two fixed 1 KiB buffers and 128 queries allocated lazily. Busy samples are skipped; retained results are bounded to eight. Readback maps asynchronously, and `flush()` publishes `gpu-timing` events outside the beauty loop. Each result carries its render frame, submission number, camera, viewport and per-pass milliseconds, including Hi-Z, draw compaction, visibility, materials, lighting, transparents, HDR composition and direct presentation when those passes execute. `sumPassMs` sums timed pass intervals; it is not end-to-end GPU frame latency and excludes separate GPU selection dispatches, transfers and presentation latency. The host's per-frame `gpuMs` remains null rather than assigning a delayed sample to a different frame. Missing/reversed timestamps are null with their raw pair and reason; any invalid or truncated pass makes the sum null. Actual map/allocation failures disable profiling, emit `gpu-timing-unavailable` and leave rendering available. Timestamp resolution depends on the browser/device.

`cpu-timing` reports backend render duration, light updates, selection, residency scheduling/target management, and command encoding/submission. `transparentEncodeMs` is a subset of `encodeSubmitMs`, not an extra duration to add. CPU logs carry their own frame/submission identifiers. Summary mode publishes at most once every two seconds during `flush()`; trace mode preserves each frame. Async residency waiting and GPU execution are not counted as CPU work. Profiling introduces overhead, so its samples are diagnostic evidence rather than a controlled performance verdict.

WebGPU filters transparent meshes against the current camera frustum before uploading their per-frame uniforms or issuing their draws. Bounds cover the complete transformed geometry, preserving objects that intersect the frustum. Source transforms are baked during preparation, as with the existing geometry path. `frustumCulled: false` and unavailable/nonfinite bounds conservatively retain a mesh. This does not add transparent LOD, occlusion culling or transparency sorting. `FrameMetrics` exposes `transparentMeshes` (retained meshes), `transparentFrustumRejected`, `transparentDrawCalls` and `transparentSubmittedTriangles`; the latter two include both passes of double-sided materials when required. Unsupported backends leave these metrics null. The bounded `render-progress` event includes the same counters in `transparent`, with `version: 1`, total candidates and `gpuMs: null`: command counts do not measure GPU duration.

For image checks, a world calls `world.camera.set(pose)`, `await world.awaitPages()`, `world.render()`, then `await capture.buffer(world, { width, height })` — the equivalent of the internal session's `setPose()`, `awaitPages()`, `render()`, `await flush()` and `capture()`. The WebGPU `flush()` performs an explicit asynchronous image readback outside the beauty loop; `capture()` returns bottom-left RGBA bytes for that submitted frame. If a browser host renders again and immediately calls the existing synchronous `capture()` API, an isolated WebGL2 canvas copies the current GPU canvas with the same engine-owned program and reads its pixels on demand; `capture-synchronous` identifies this expensive compatibility path. It is never used by normal `render()`. A texture-only backend rejects unavailable/stale captures. Serialize `flush()` with explicit host rendering; a frame changed by a host render during readback is rejected rather than returned as current. Streaming completion during readback retains the accepted page bytes and defers its automatic redraw to the next render, preserving the captured frame. The first such deferral emits `capture-streaming-deferred`. The WebGL backends continue reading their rendered default framebuffer so pinned Three r174 tone mapping matches the displayed image.

`pnpm run test:gpu` runs every hardware proof (`tests/browser/probes/`, `tests/browser/renders/`) with the repository's own Playwright and esbuild, the machine's Chrome and its actual WebGPU device, and the assets under `.mesure/assets/` (see `bench/runner/README.md` § Assets). Nothing outside this repository is read. The material and Emerald visual proofs run standalone on the test harness server:

```sh
node tests/browser/renders/materiaux-temoin.browser.ts
node tests/browser/renders/scene-webgpu.browser.ts
```

The material check renders twelve fixtures (`tests/browser/support/materialFixtures.ts`) with `three-webgl-reference` and `webgpu-page-raster`, both from `dist/`, and compares four or five pixels of each — base colour and its map, alpha MASK at the two 8-bit alphas around its cutoff, BLEND over the background and over an opaque surface, single- and double-sided back faces, rough dielectric, polished metal, emissive and normal map under one declared sun — within one level per channel, except the blend over an opaque surface, where the engine blends in linear radiance and the witness in display space: the fixture declares the 45-level gap of that pair, one level either side, and the proof holds the engine inside it. It fails on a gap outside a fixture's window, on a missing render diagnostic, on a GPU failure and on an engine image that never holds — the blend over the background excepted, since a view with no opaque cluster publishes no held frame (#198) — and writes both images and the readings under `benchmark-runs/material-pixels/`. The reference-scene check replays ten bench poses on the same source, camera, pixel error 1, and a 2496×1404 viewport — the internal resolution of the published profile `docs/REFERENCE_UE5.md` compares pass shapes against, declared once as `MEASURE_WIDTH`/`MEASURE_HEIGHT` in `tests/browser/support/sceneProvenance.ts` and recorded in the provenance. What is matched is the internal render size, not their 4K output: that comes from a temporal upscale this engine does not have. It saves PNGs, per-view differences, source fingerprints and logs under `benchmark-runs/webgpu-visual/`. A successful runner execution is **not** a full-scene visual-parity verdict: inspect the measured differences and screenshots. The runner measures no performance and proves no memory stability.

The current WebGPU path still lacks per-texture transforms/UV channels/filter modes, environment maps and the full material contract; shadow maps are applied (see "Shadow maps are invalidated page by page" above). Padded texture-array boundaries and full-scene pixel differences still need dedicated parity checks; transparent compositing has its material fixtures. The CPU shading oracle encodes linear lighting to sRGB without ACES; it is not a substitute for the displayed-image comparisons.

The separated pipeline has completed real render paths, A/A checks and the material fixtures above; full-scene parity and a controlled performance verdict remain unvalidated. Next is the reference scene with fixed camera, resolution, lights, pixel error and warmup. Verify actual direct-presentation logs, independent A/A captures, foreground coverage, transparent compositing and second-view restoration before timing. Preserve raw source hashes and results; old reports do not validate this code. Node tests validate orchestration/CPU contracts with GPU doubles and do not execute WGSL.

For prepared WebGPU scenes, material textures are virtual: every texture is cut into 128×128 tiles (plus a 4-texel border) that live in two fixed-size physical pools (sRGB colour, linear data), one page table per texture says which pool tile serves each tile of each mip level, and only the tiles the image reads are resident. `texturePoolBytes` (512 MiB by default, split evenly between the two atlases, in layers of 30×30 tiles — 63.5 MiB in RGBA8, 15.9 MiB in a block lane) is the texture memory of the session whatever the scene; a budget under one layer per lane is raised to one layer, named `texturePoolClamp: 'minimum'`, never refused. Residency is driven by the rendered image itself: the material resolution counts, for one pixel in sixteen (a rotating phase, every pixel during `flush()`), the tile each map needs at the mip level the pixel's derivatives select; transparents write their request into their own `r32uint` target, reduced to the same counters by a compute pass, so the blend fragment stage writes no memory and keeps early depth rejection. The counters come back one frame late through `mapAsync`. `maxTextureTransferBytesPerFrame` (16 MiB by default) bounds the tile bytes copied per frame, most-requested tiles first, and `maxTextureUploadMsPerFrame` (1.0 ms by default, the reference's fixed number of tile uploads per frame in the frame's own unit) bounds the CPU milliseconds the pass spends copying them, read between copies: once either budget is spent the pass stops — after the copy that crossed it, which the peak shows —, the remainder is deferred to the next frames — offered again in the same order until fresh feedback replaces it — and shows its coarser resident level meanwhile, so a cold traversal streams at a fixed cadence instead of stalling the frame; the first tile of a pass is always copied, so even a zero budget makes progress. The worst budgeted pass since the start is published as `textureUploadPeakMs` and the last pass as `textureUploadMs` (`null` when it had nothing to serve, or under a barrier) — a stutter is read on the peak and the p95 of the profile's "Textures" stage, never on the median — and what a pass deferred as `textureTilesDeferred`. Measured on the Emerald cache at commit 8c20f71b, general view, cold cache and moving camera (1280×720, DPR 1, threshold 1 px, 120 frames, two runs, Apple M2 Max, Chrome 153, `--budget-textures` in `bench/runner/README.md`): the "Textures" stage p95 went from 4.2–9.3 ms to 1.1–1.2 ms and the browser frame interval p99 from 33–133 ms to 16.8 ms; the declared cost is a coarser image while tiles land — 8–12 tiles per frame, 1.2–1.8 missing levels on average at the end of the traversal against 0.6–0.7 before — and a still pose converges to the same 0 px capture on both sides. Since 619e34fb the pass clock also covers the shadow follow of the landed colour tiles (`onColorChanged`): remeasured there on the same command, two runs, the "Textures" stage reads 1.0 / 1.2 ms p50/p95, the session peak 5.1–16.6 ms over the four sessions (the two runs and their A/A repeats) — frame 7 every time, the first pass that lands a colour tile, whose shadow follow is not measured apart — and 1.1–1.3 missing levels at the end of the traversal. When a pool is full, the least recently read tile gives its place, and a tile nothing can accommodate is counted in `textureTilesRefused`, never silently dropped. A tile that is not yet resident is served by its finest resident ancestor, down to the texture's tail (every level of 64 texels or less, pinned from the sidecar at `prepare()`): a missing tile shows a coarser level, never a fill texel. `flush()` renders the pose until nothing it reads is missing, redraws the pending shadow pages, and alternates the two until a drain redraws nothing, replaying the temporal accumulation identically; nothing is released there — a tile stays until a full pool evicts the least recently read one, as in the reference — so a flushed pose is deterministic and the held image returns once the pose is quiet (`pose-settle` diagnostic: rounds, tiles served, shadow frames, what still moves). Frame metrics expose the nineteen `texture*` counters of `TextureFrameMetrics` (pool bytes and layers, resident tiles and bytes, tiles requested / served at level / missing levels / pending / deferred, served / evicted / refused, last and worst pass milliseconds, level reads and decodes, host level cache bytes, scratch builds).

**The engine reads the levels the compiler baked, always.** As soon as the cache declares texture chains, the WebGPU backend reads each baked level on demand (decoded by the browser, held in a 192 MiB host cache to cut further tiles from it) and cuts the requested tiles from it. It regenerates a chain of its own only for a texture the cache carries none for — an image the cook skipped, or texels the page itself built: it then builds a scratch texture with its mip chain (mean colour, median alpha) each time one of its tiles is requested and copies the tiles out of it, so the resident memory stays that of the pool and the price is paid in transfers, measured. Reading instead of regenerating keeps the image within rounding, the envelope [FORMAT.md](FORMAT.md) declares for that same substitution: measured at 1280×720, DPR 1, threshold 0, TAA off, at most 2 of 255 on a channel of any pixel of the four Emerald views (one channel of one frame at 3), mean absolute channel error 0.009 to 0.049 of 255, 5 pixels on Whisperwind, against an A/A witness of 0 px on every view.

`textureSource` (`'cache'` by default, `'host'` to opt in) therefore no longer says where the engine's texels come from — it says whether the **loader** opens the source images. Under `'cache'` an image whose chain the cache carries is neither fetched nor decoded: nothing would read it. Under `'host'` the glTF loader fetches and decodes every source image, which a backend that draws the host scene (the Three witness) requires; the engine still reads the baked levels, so such a session pays for those images twice and asks for them on purpose. `'cache'` is honoured only where every backend the session mounts reads those levels — the WebGPU page raster: where one of them draws the host scene (the engine's WebGL2 page path, taken by default on a machine that grants no WebGPU device, or a Three witness the host named), or where the runtime has no `createImageBitmap` to read a level with, the session reads its images as under `'host'` and the `backend-choice` diagnostic publishes the `textureSource` it settled on.

**Block-compressed lanes (`textureCompression`).** Each atlas is in fact one pool per _lane_: `lossless` (RGBA8, four bytes a texel), `rgba` (BC7 or ASTC 4×4 blocks, one byte a texel) and `two-channel` (BC5 or ASTC luminance-alpha blocks, one byte a texel — a normal map's X and Y, Z rebuilt by the shader). `textureCompression` (`'auto'` by default, `'bc7'`, `'astc'`, `'none'`) names the block family the session samples: `'auto'` takes the first family the device samples (`texture-compression-bc` before `texture-compression-astc`) **and** the cache holds kept chains in — a cache cooked in ASTC alone takes ASTC on a device with both —, RGBA8 when the device has neither or no chain was kept in a family it has, the reason named in the `material-textures-ready` diagnostic; `'none'` keeps every pool RGBA8, the lossless "before" of a comparison. A texture takes the lane its baked chain was **kept** in by the compiler's quality gate for that family (`docs/FORMAT.md`, "Block layouts and the quality gate"): a chain the gate left lossless, a texture without a whole chain, a host image, all read from the `lossless` lane, so the engine never trades a pixel for memory on its own — the loss, when the gate allows one, is bounded at cook time (48 dB, 3 levels of 255 on a texel, no mask flip) and measured on the still captures of the batch (at most 3 of 255 on any channel of any pixel on the three Emerald views, with either family). The budget is split in half between the atlases, then within an atlas every lane that has textures gets one layer (63.5 MiB in RGBA8, 15.9 MiB in blocks) and the rest by the bytes its tiles would take resident, a lane never above what its tiles need (`texturePoolClamp: 'scene'`): a scene whose every chain is kept opens no RGBA8 layer beyond the white fill texel. `texturePoolFormat` publishes the family held (`bc7`, `astc` or `rgba8`), `texturePoolLayers` and `texturePoolBytes` add every lane pool of both atlases, and the `material-textures-ready` diagnostic lists each pool and how many textures each lane holds. Measured on Emerald (`bench/runner/banc.ts`, `--compression-avant none --compression-apres bc7`, three views, 1280×720, DPR 1): resident texture bytes 25.5 → 19.7 MB, 56.1 → 40.3 MB and 76.4 → 64.3 MB for the same tiles (ASTC: 21.6, 43.2 and 71.1 MB); under the three-level bar none of the colour texels and 32 % of the data texels are in BC blocks (ASTC: 14 %), the rest stays lossless by the gate's own reading.

When a colour tile arrives, the shadow pages of the masked surfaces that read its texture are invalidated — a shadow map drawn with the previous alpha would describe foliage the image no longer shows —, and those alone: a tile of a texture no cut-out reads, or a colour change on an opaque material, leaves the depth maps as they are. A pool resize or an eviction, which names no texture, invalidates every page. Pages are redrawn under the ordinary shadow budget, and `flush()` drains the pending ones — up to sixty-four frames per round, replaying the temporal accumulation so the number of frames does not change the image — so a flushed pose is settled, shadows included; what remains pending is published by the `pose-settle` diagnostic and `shadowPagesPending`, never assumed zero. A masked material's cut-out is read at the mip level the reading texel's footprint selects — the camera's derivatives in the visibility raster, the shadow texel's in the shadow depth pass — exactly as the material resolution reads its colour, and the material resolution requests, for every masked pixel of its phase, the tiles each sun cascade that draws that point will read, projected into the cascade with the same affine derivative the shadow pass computes. Known limit: a caster the camera never sees has no one to request its tiles; the shadow pass then reads the finest tile resident under that texel, which is whatever the trajectory left in the pool.
