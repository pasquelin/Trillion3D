# Maths

The maths the engine computes with, exported by `trillion3d`, `packages/sdk-core` and
`packages/sdk-browser` alike; the rest of the public API is [SDK.md](SDK.md).

## The maths package

`packages/math` (`@trillion3d/math`) holds the engine's primitive maths, and every other package
imports it. Its contract:

- Pure functions: no state that outlives a call (module scratch buffers are reused within a call and never read across calls), no DOM, GPU API, clock or worker.
- Outputs go through an `out` argument or a flat array, never a fresh object per call.
- One function per formula: a second copy of a formula elsewhere in the tree is a defect.
- It imports nothing outside itself; `pnpm run check:cycles` fails when a module does.
- "No GPU" means no GPU API call: the WGSL twins of the primitives belong to the package, in
  `wgsl/` (below).
- `packages/sdk-core/src/world/math` holds the public value classes (`Vector3`, `Box3`…), which only
  call the package.

Its layout, under `packages/math/src/`: `float/` (`hypot`, `trig`, `splitDouble`), `vector/`,
`quaternion/`, `matrix/` (with `matrixElements.ts`, the pose comparisons), `geometry/` (boxes,
spheres, cones, slabs, `frustum/`), `projection/` (camera frame, render origin, projection oracles),
`color/`, `scalar/`, `sequence/` (`halton.ts`), `batch/` and `wgsl/` (below); `index.ts` is the
barrel `packages/sdk-core` re-exports, `wgsl/` left out of it. The path governor, the transform tree
and the shader programs are not primitives and live in `sdk-core` and `sdk-browser`.

`scalar/`: counting and range helpers; `constants.ts`: shared numbers.

### The WGSL library

`packages/math/src/wgsl/` holds the shader side of the maths: each function or constant shaders
share is one `WgslDecl` ([`decl.ts`](../packages/math/src/wgsl/decl.ts)), its name, its text and
the declarations it depends on, held as objects, never as names. A shader keeps its own text and
lists the declarations it uses; [`assemble.ts`](../packages/math/src/wgsl/assemble.ts) writes them
before that text, each once, its dependencies first:

```ts
const SHADER = wgslProgram(OWN_TEXT, [hashUnit, worldMatrix3])
```

A shader fragment that several programs share is a declaration too, a `wgslBlock`: its text as
written, its dependencies the library declarations and the fragments it uses. A template
interpolates parameters only — numbers, layout constants, binding indices, names —, never another
fragment's text. A fragment is named `X_WGSL` or `xWgsl(…)`; an expression or a statement a body
splices is named otherwise (`FULLSCREEN_XY`, `MIRROR_TERM`). A factory `xWgsl(…)` that takes a
provider, a function the fragment calls, lists it, and the assembler refuses a program holding two
of its variants. Only a whole program calls `wgslProgram` (or `wgslModule`), which writes the
program's own directives (`enable …;`) first; a declaration spliced into a template as text throws
when the module is read. A program others extend — the lit program at the screen's mirror radiance
(`withScreenReflections`), the blend module with the water's stage (`blendShader`) — takes what it
gains as a parameter and is assembled with it.

A function a fragment calls but its host provides — `mipRead` of a cell reduction,
`reflectionDepthAt` and `reflectionSize` of the screen walks, `vsmPoolLoad` of the shadow-map
sampling, `mirrorRadiance` of the mirror term — is a declaration under that function's name, which
the fragment takes as a parameter and lists: a missing provider fails when the program is written,
and two providers of one name are refused, never left to the shader compiler: the error names
the path through the dependents by which each came and the first line where the two texts differ.

A name written twice with two texts, or a dependency cycle, throws when the pipeline is described:
the text is built once a pipeline, never in a frame. Two operation orders of one formula round
apart, so each is its own declaration under its own name, never merged. The library writes a number
through [`wgslF32`](../packages/math/src/wgsl/number.ts), the literal of the exact `f32` TypeScript
holds, the engine's one helper that writes a number as WGSL; π, 1/π, 2π, 1/(2π), the greatest
finite `f32`, the golden ratio's fraction and the singularity threshold are `wgslConst`
declarations of [`constants.ts`](../packages/math/src/wgsl/constants.ts), written from the values of
[`packages/math/src/constants.ts`](../packages/math/src/constants.ts).
`library.test.ts` checks each declaration's header and dependencies, and its fixture refuses a
declaration file left out of the sweep; `packages/sdk-browser/src/gpu/core/engineShaders.test.ts`
finds no program declaring a module-scope name twice, whatever the texts, and
`wgslDeclarations.test.ts` no source declaring a library name and no fragment spliced as text.

## Batch math for hosts

A host moving ten thousand instances or culling ten thousand boxes would otherwise loop, one object
per call and a temporary per step; a **batch** takes `n` elements in one call. Every function, unit
or batch, follows these conventions:

- **Column-major 4×4 matrices** in sixteen consecutive numbers, `[12..14]` the translation.
- **Output first, allocation never.** A function writes into the `out` buffer it receives and
  returns it; one that writes in place or fills several named buffers — `normalizeVector3`,
  `decomposeMatrix4` — returns nothing, and its row says so. A call on a per-frame path allocates
  nothing. `outAt`/`aAt` offsets let one large buffer hold many operands. A batch returns a count
  as its only value and repeats the formula of its unit function, which stays the oracle.
- **`Float64Array` for what is computed**, `ArrayLike<number>` for what is only read: a host
  matrix, a plain array or a `Float32Array` enters as-is; a batch writes flags into a `Uint8Array`.
- **Layout.** One element occupies a fixed number of consecutive values, each declared once:
  `MATRIX_VALUES` 16, `POSITION_VALUES` 3, `QUATERNION_VALUES` 4 (`x, y, z, w`), `SPHERE_VALUES` 4
  (centre then radius) and `NORMAL_MATRIX_VALUES` 9 in
  `packages/math/src/batch/strides.ts`; `BOX_VALUES` 6 (min x, y, z then max x, y, z) in
  `packages/math/src/geometry/box.ts`; `FRUSTUM_PLANE_VALUES` 24 (six planes
  `a, b, c, d`, facing inward, in the order of `frustumPlanesFromMatrix`) in
  `packages/math/src/geometry/frustum/frustum.ts`. Matrices read one at a time travel as
  **sub-views** of sixteen numbers (`buffer.subarray(i * 16, (i + 1) * 16)`), built once at load,
  never per frame: `multiplyMatrix4` reads its operands at constant indices.

**Allocate once, reuse every frame.** Culling ten thousand boxes and bringing the survivors' centres
into view space is two calls (the batches' tests are `batch.test.ts` and `transforms.test.ts` in
`packages/math/src/batch/`):

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

**Which path ran.** `boxTransformBatch` and `multiplyMatrix4Batch` have WebAssembly kernels
(`packages/page-codec-wasm/src/math.rs` over `packages/math/rust/src/matrix.rs` and `box_transform.rs`), bit-identical to the
JavaScript loop; a governor (`packages/sdk-core/src/runtime/path/governor.ts`, wired in
`packages/sdk-browser/src/page/decode/batch/batchRuntime.ts`) plays the faster measured, per operation.
`metric.frame(world).mathBatch` publishes `MathPathMetrics` (`MATH_PATH_CONTRACT` 1):
`operations[name].path` is the path the next call plays, `jsNsPerElement` and `wasmNsPerElement` the
sliding medians in nanoseconds per element (`null` while unmeasured — never zero), `switches` how
many times the decision changed, `elements` the total processed; `clockCoarse` says the thread clock
is too coarse to time one call (no cross-origin isolation), so the governor times pooled runs of ten
clock steps instead. A host serving its page with the `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` headers gets the fine clock back, one sample per call. A kernel is
written only where a loop's measured share of the engine's frame passes 0.1 ms; batches serve hosts,
no engine loop runs through one.

### The Rust twins and their reference values

The Rust maths primitives live once in `packages/math/rust` (`trillion3d-math`, no dependency):
vectors, boxes, the 4×4 product in `f32` and `f64`, JavaScript's `Math.min`, `Math.max` and
`Math.hypot`, fdlibm's arc cosine and sine. The page codec (and through it the WebAssembly kernels)
and the compiler both depend on it and keep no copy. `packages/math/golden` holds the reference
values every twin of a mirrored primitive — Rust, TypeScript, WGSL — is tested against bit for bit:
the inputs and outputs of each case written by their bits, one JSON file per primitive, or per
encoder and its decoder with their round trip (`oct.json`, `quantize.json`), one case per line
(Prettier leaves the folder alone). The crate that owns a twin checks its files in one test
(`packages/math/rust/src/golden.rs`); after a deliberate change of a primitive, `pnpm run
golden:write` rewrites them all, the command each file names.

- TypeScript reader: `packages/math/src/golden.fixture.ts` (`assertGolden`).
- TypeScript twins: `matrix4.golden.test.ts`, `hypot.golden.test.ts`, `trig.golden.test.ts`,
  `quaternion.golden.test.ts` (`packages/math/src/`), `sample.golden.test.ts`
  (`packages/sdk-core/src/world/animation/`), `pageGrids.golden.test.ts` (`packages/page-codec/src/`).
- WebAssembly twin: `packages/sdk-browser/src/page/decode/batch/multiplyBatch.golden.test.ts`.
- The proxy BVH child box and albedo bytes are read by WGSL alone (`nodeWgsl.ts`): no CPU twin.
- The grid rule's TypeScript twin, `packages/page-codec/src/gridExponent.ts`, is held to the Rust
  rule's own cases (`gridExponent.test.ts`) and to `grid.json` (`gridExponent.golden.test.ts`); on
  every compiled scene, the run-time cut picks the grid the compiler wrote
  (`tests/integration/runtime-cut-grid.test.ts`).

### Measured against the witness library

Each row names its witness call and proof: `pnpm run perf:core`
(`bench/perf/core/three-vs-core-*.perf.ts`; how a line reads:
[TESTS.md](TESTS.md#performance-benchmarks)) runs Three.js and the engine on the same seeded inputs,
compares bit for bit and refuses an engine slower than the witness. Ratios are the engine's speed-up
over the witness (best of three runs); they say where, not how much a frame gains. From Three.js,
the witness calls are the migration table.

### Unit functions

Each unit function's page in the portal's [API reference](https://www.trillion3d.com/#/en/api) gives
what it computes, the witness call it replaces, its proof and ratio, written once in
`site/content/entries/` (`matrix.ts`, `vector.ts`, `camera.ts`). The functions live in
`packages/math/src/matrix/` (matrices), `packages/math/src/vector/` and
`packages/math/src/color/` (vectors, colours), `packages/math/src/projection/` (camera frame) and `packages/sdk-browser/src/camera/` (the engine camera).

The engine does not read the host's clip-depth convention. It composes its own projection from the
declared optics — field, aspect, near plane, zoom — in **reversed depth with an infinite far
plane**: `near` projects to 1, infinity to 0 (`packages/sdk-browser/src/camera/depthConvention.ts`,
`engineCamera.ts` beside it), one convention for the frustum planes, the GPU's view-projection, the
Hi-Z bounds and the CPU visibility raster. A declared exception: the bench compares the projection's
x/y terms to the witness's, the depth terms being the engine's. `far` is still read for the frustum
far plane, the adaptive threshold and the shadow range.

#### Sides — `packages/sdk-browser/src/scene/materialSide.ts`

| Function | Computes | Witness call | Proof |
| --- | --- | --- | --- |
| `type Side = 'front' \| 'back' \| 'double'` | which faces of a surface are drawn; every raster, cone, pipeline and blend-plan decision compares against it | `FrontSide`, `BackSide`, `DoubleSide` | `materialSide.test.ts` |
| `sideOf(material)` | the `Side` a host material declares, the first of an array deciding, an empty array front — read once at the import boundary, the only place naming the host constants | the host's double-side test | `materialSide.test.ts` |
| `materialSide(material)` | the host constant itself, for the diagnostic materials still built with the host library | — | `materialSide.test.ts` |

### Batch functions

`packages/math/src/batch/`: `batch.ts`, with `culling.ts`, `points.ts`, `transforms.ts`
and `color.ts` beside it. The proof is `pnpm run perf:core` (`three-vs-core-batch-*.perf.ts`).
Ratios are the batch's speed-up over the witness's loop, rounded from the range of the per-run
medians over three runs; the three exceptions are declared on their line.

| Function | Computes | Witness loop | Proof |
| --- | --- | --- | --- |
| `frustumKeepsBoxBatch(kept, planes, boxes, n)` | `kept[i]` 1 where `!frustumExcludesBox`, returns the count kept | `for … frustum.intersectsBox(box)` | bench `Frustum.intersectsBox batch` (×1.1) |
| `sphereFromBoundsBatch(out, boxes, n)` | four values per box, `sphereFromBounds` | `for … box.getBoundingSphere(s)` | bench `Box3.getBoundingSphere batch` (×2.2) |
| `boxUnionBatch(into, boxes, n)` | `into ∪ boxes[0] ∪ … ∪ boxes[n − 1]`, `boxUnion` | `for … box.union(b)` | bench `Box3.union batch` (×1.9) |
| `boxTransformBatch(out, boxes, mats[], n)` | `out[i] = boxTransform(boxes[i], mats[i])` | `for … box.applyMatrix4(m)` | `packages/math/src/batch/batch.test.ts` against `boxTransform`; WebAssembly kernel bit-identical (`math.rs`, `packages/sdk-browser/src/page/decode/batch/batchRuntime.test.ts`) |
| `boxTransformUnionBatch(into, boxes, mats[], n)` | transform then union, one pass, one scratch box | `Box3.setFromObject` | bench `Box3 transform and union batch` (×1.8) |
| `multiplyMatrix4Batch(out[], a[], b[], n)` | `out[i] = a[i] · b[i]`, sub-views | `for … m.multiplyMatrices(a, b)` | `packages/math/src/batch/transforms.test.ts`; WebAssembly kernel bit-identical (`packages/math/rust/src/matrix.rs`, `packages/sdk-browser/src/page/decode/batch/batchRuntime.test.ts`) |
| `invertMatrix4Batch(out[], mats[], n, singular?)` | `out[i] = mats[i]⁻¹`; a zero determinant writes the identity and sets `singular[i]` | `for … m.invert()` | bench `Matrix4.invert batch` (×0.9) — **declared exception**: the batch reads the determinant to flag singularity, the witness does less; ceiling 1.2 |
| `normalMatrix3Batch(out, mats[], n)` | nine values per matrix, `normalMatrix3` | `for … n.getNormalMatrix(m)` | bench `NormalMatrix3 batch` (×0.5) — **declared exception**: the engine's singularity policy (`packages/math/src/matrix/singular.ts`) is kept; ceiling 2.2 |
| `composeMatrix4Batch(out, positions, quaternions, scales, n)` | `T · R · S` per element, all flat or all sub-views | `for … m.compose(p, q, s)` | bench `Matrix4.compose batch` (×1.5) |
| `decomposeMatrix4Batch(positions[], quaternions[], scales[], mats[], n)` | the reverse, `decomposeMatrix4` | `for … m.decompose(p, q, s)` | bench `Matrix4.decompose batch` (×1.1) |
| `transformPointsBatch(out, m, points, n)` | `n` points by one affine matrix, `transformAffinePoint` | `for … v.applyMatrix4(m)` | bench `Vector3.applyMatrix4 batch` (×1.4) |
| `transformPointsByMatricesBatch(out, mats[], points, n)` | `n` points, one matrix each | `for … v[i].applyMatrix4(mats[i])` | bench `Vector3.applyMatrix4 per-instance batch` (×1.9) |
| `transformDirectionsBatch(out, m, dirs, n)` | upper 3×3 then normalize, `transformDirectionVector3` | `for … v.transformDirection(m)` | bench `Vector3.transformDirection batch` (×1.3) |
| `srgbToLinearBatch(out, values, n)`, `linearToSrgbBatch(out, values, n)` | one channel per element, the exact curves of `packages/math/src/color/color.ts` | `for … color.convertSRGBToLinear()` | bench `Color.convertSRGBToLinear batch`, `convertLinearToSRGB batch` (×1.0) — **declared exception**: the curve, gap ≤ 1.1e-11 forward, ≤ 6.3e-6 back; ceiling 1.1 |
| `hierarchyUpdateBatch(worldViews[], positions[], rotations[], scales[], parents, n, local)` | a whole hierarchy, parents before children, `composeMatrix4` then `multiplyMatrix4` | `Object3D.updateMatrixWorld` over a scene | `tests/integration/sdk-facade.test.ts` (parents before children); its Rust/WebAssembly kernel was removed, no host called it |
