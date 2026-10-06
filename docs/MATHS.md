# Maths

The maths the engine computes with, exported by `trillion3d`, `packages/sdk-core` and
`packages/sdk-browser` alike; the rest of the public API is [SDK.md](SDK.md).

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
  `packages/sdk-core/src/math/batch/strides.ts`; `BOX_VALUES` 6 (min x, y, z then max x, y, z) in
  `packages/sdk-core/src/math/primitives/box.ts`; `FRUSTUM_PLANE_VALUES` 24 (six planes
  `a, b, c, d`, facing inward, in the order of `frustumPlanesFromMatrix`) in
  `packages/sdk-core/src/math/frustum/frustum.ts`. Matrices read one at a time travel as
  **sub-views** of sixteen numbers (`buffer.subarray(i * 16, (i + 1) * 16)`), built once at load,
  never per frame: `multiplyMatrix4` reads its operands at constant indices, and a computed offset
  costs 6 % of the product.

**Allocate once, reuse every frame.** Culling ten thousand boxes and bringing the survivors' centres
into view space is two calls (the kernels are proven by
`packages/sdk-core/src/math/batch/batch.test.ts`, run by `pnpm test`):

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

**Which path ran.** `hierarchyUpdateBatch`, `multiplyMatrix4Batch` and `boxTransformBatch` have
WebAssembly kernels (`packages/page-codec-wasm/src/math.rs`), bit-identical to the JavaScript loop;
a governor (`packages/sdk-core/src/math/path/governor.ts`) plays the faster measured, per operation.
`metric.frame(world).mathBatch` publishes `MathPathMetrics` (`MATH_PATH_CONTRACT` 1):
`operations[name].path` is the path the next call plays, `jsNsPerElement` and `wasmNsPerElement` the
sliding medians in nanoseconds per element (`null` while unmeasured — never zero), `switches` how
many times the decision changed, `elements` the total processed; `clockCoarse` says the thread clock
is too coarse to time one call (no cross-origin isolation), so the governor times pooled runs of ten
clock steps instead (#919). A host serving its page with the `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` headers gets the fine clock back, one sample per call. A kernel is
written only where a loop's measured share of the engine's frame passes 0.1 ms; no engine loop does,
so no other batch has one and none replaces an engine loop yet (#80): batches are for hosts until a
measured share says otherwise.

### Measured against the witness library

Each row names its witness call and proof:
`pnpm run perf:core` (`bench/perf/core/three-vs-core-*.perf.ts`; how a line reads:
[TESTS.md](TESTS.md#performance-benchmarks)) runs Three.js and the engine on the same seeded inputs,
compares bit for bit and refuses an engine slower than the witness. Ratios are the engine's speed-up
over the witness (best of three runs; Apple M2 Max, Node 26.8.2, 19 and 20 Sept. 2026); they say
where, not how much a frame gains. From Three.js, the witness calls are the migration table.

### Unit functions

Each unit function's page in the portal's [API reference](https://www.trillion3d.com/#/en/api) gives
what it computes, the witness call it replaces, its proof and ratio, written once in
`site/content/entries/` (`matrix.ts`, `vector.ts`, `camera.ts`). The functions live in
`packages/sdk-core/src/math/matrix/` (matrices), `packages/sdk-core/src/math/primitives/` (vectors,
colours, camera frame) and `packages/sdk-browser/src/camera/` (the engine camera).

The engine composes its own projection from the declared optics — **reversed depth, infinite far
plane**: `near` projects to 1, infinity to 0 (`depthConvention.ts`), a declared exception: the bench
compares the projection's x/y terms to the witness's, the depth terms being the engine's. `far` is
still read for the frustum far plane, the adaptive threshold and the shadow range.

#### Sides — `packages/sdk-browser/src/scene/materialSide.ts`

| Function | Computes | Witness call | Proof |
| --- | --- | --- | --- |
| `type Side = 'front' \| 'back' \| 'double'` | which faces of a surface are drawn; every raster, cone, pipeline and blend-plan decision compares against it | `FrontSide`, `BackSide`, `DoubleSide` | `materialSide.test.ts` |
| `sideOf(material)` | the `Side` a host material declares, the first of an array deciding, an empty array front — read once at the import boundary, the only place naming the host constants | the host's double-side test | `materialSide.test.ts` |
| `materialSide(material)` | the host constant itself, for the diagnostic materials still built with the host library | — | `materialSide.test.ts` |

### Batch functions

`packages/sdk-core/src/math/batch/batch.ts` and the `mathBatch*.ts` beside it. The proof is
`pnpm run perf:core` (`three-vs-core-batch-*.perf.ts`). Ratios are the batch's speed-up over the
witness's loop, rounded from the range of the per-run medians over three runs (PR #105); the three
exceptions are declared on their line.

| Function | Computes | Witness loop | Proof |
| --- | --- | --- | --- |
| `frustumKeepsBoxBatch(kept, planes, boxes, n)` | `kept[i]` 1 where `!frustumExcludesBox`, returns the count kept | `for … frustum.intersectsBox(box)` | bench `Frustum.intersectsBox batch` (×1.1) |
| `sphereFromBoundsBatch(out, boxes, n)` | four values per box, `sphereFromBounds` | `for … box.getBoundingSphere(s)` | bench `Box3.getBoundingSphere batch` (×2.2) |
| `boxUnionBatch(into, boxes, n)` | `into ∪ boxes[0] ∪ … ∪ boxes[n − 1]`, `boxUnion` | `for … box.union(b)` | bench `Box3.union batch` (×1.9) |
| `boxTransformBatch(out, boxes, mats[], n)` | `out[i] = boxTransform(boxes[i], mats[i])` | `for … box.applyMatrix4(m)` | `packages/sdk-core/src/math/batch/batch.test.ts` against `boxTransform`; WebAssembly kernel bit-identical (`math.rs`, `packages/sdk-browser/src/math/batchRuntime.test.ts`) |
| `boxTransformUnionBatch(into, boxes, mats[], n)` | transform then union, one pass, one scratch box | `Box3.setFromObject` | bench `Box3 transform and union batch` (×1.8) |
| `multiplyMatrix4Batch(out[], a[], b[], n)` | `out[i] = a[i] · b[i]`, sub-views | `for … m.multiplyMatrices(a, b)` | `packages/sdk-core/src/math/batch/transforms.test.ts`; WebAssembly kernel bit-identical (`math.rs`, `packages/sdk-browser/src/math/batchRuntime.test.ts`) |
| `invertMatrix4Batch(out[], mats[], n, singular?)` | `out[i] = mats[i]⁻¹`; a zero determinant writes the identity and sets `singular[i]` | `for … m.invert()` | bench `Matrix4.invert batch` (×0.9) — **declared exception**: the batch reads the determinant to flag singularity, the witness does less; ceiling 1.2 |
| `normalMatrix3Batch(out, mats[], n)` | nine values per matrix, `normalMatrix3` | `for … n.getNormalMatrix(m)` | bench `NormalMatrix3 batch` (×0.5) — **declared exception**: the engine's singularity policy (`packages/sdk-core/src/math/matrix/singular.ts`) is kept; ceiling 2.2 |
| `composeMatrix4Batch(out, positions, quaternions, scales, n)` | `T · R · S` per element, all flat or all sub-views | `for … m.compose(p, q, s)` | bench `Matrix4.compose batch` (×1.5) |
| `decomposeMatrix4Batch(positions[], quaternions[], scales[], mats[], n)` | the reverse, `decomposeMatrix4` | `for … m.decompose(p, q, s)` | bench `Matrix4.decompose batch` (×1.1) |
| `transformPointsBatch(out, m, points, n)` | `n` points by one affine matrix, `transformAffinePoint` | `for … v.applyMatrix4(m)` | bench `Vector3.applyMatrix4 batch` (×1.4) |
| `transformPointsByMatricesBatch(out, mats[], points, n)` | `n` points, one matrix each | `for … v[i].applyMatrix4(mats[i])` | bench `Vector3.applyMatrix4 per-instance batch` (×1.9) |
| `transformDirectionsBatch(out, m, dirs, n)` | upper 3×3 then normalize, `transformDirectionVector3` | `for … v.transformDirection(m)` | bench `Vector3.transformDirection batch` (×1.3) |
| `srgbToLinearBatch(out, values, n)`, `linearToSrgbBatch(out, values, n)` | one channel per element, the exact curves of `packages/sdk-core/src/math/primitives/color.ts` | `for … color.convertSRGBToLinear()` | bench `Color.convertSRGBToLinear batch`, `convertLinearToSRGB batch` (×1.0) — **declared exception**: the curve, gap ≤ 1.1e-11 forward, ≤ 6.3e-6 back; ceiling 1.1 |
| `hierarchyUpdateBatch(worldViews[], positions[], rotations[], scales[], parents, n, local)` | a whole hierarchy, parents before children, `composeMatrix4` then `multiplyMatrix4` | `Object3D.updateMatrixWorld` over a scene | `packages/sdk-core/src/math/transform-tree/hierarchy.test.ts`: the transform tree's parent and child rules on hostile hierarchies |
