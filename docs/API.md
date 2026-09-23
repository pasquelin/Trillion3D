# Engine maths API

The maths the engine computes with, exported by `web-geometry`, `packages/sdk-core` and
`packages/sdk-browser` alike. The public families a page writes against — `createWorld` and
everything it hands out — are [SDK.md](SDK.md); this file lists the functions underneath them.
Conventions shared by every entry:

- **Column-major 4×4 matrices** in sixteen consecutive numbers, `[12..14]` the translation.
- **Output first, allocation never.** A function writes into the `out` buffer it receives and
  returns it; one that writes in place or fills several named buffers — `normalizeVector3`,
  `decomposeMatrix4` — returns nothing, and its row says so. A call on a per-frame path allocates
  nothing. `outAt`/`aAt` offsets let one large buffer hold many operands.
- **`Float64Array` for what is computed**, `ArrayLike<number>` for what is only read: a host
  matrix, a plain array or a `Float32Array` enters as-is.

## Measured against the witness library

Every row names the witness call it is measured against, and its proof. The proof is
`pnpm run perf:core` (`bench/perf/core/three-vs-core-*.perf.ts`; how a line reads:
[TESTS.md](TESTS.md#performance-benchmarks)): each line runs Three.js and the engine on the same
seeded inputs, compares bit for bit and refuses an engine slower than the witness. The ratios are
the engine's speed-up over the witness, best of three runs on one machine (19 and 20 Sept. 2026,
Apple M2 Max, Node 26.8.2); they say where, not how much a frame gains. The declared exceptions are
named on their line. A host arriving from Three.js reads the "Witness call" column as its migration
table.

## Unit functions

### Matrices — `packages/sdk-core/src/math/matrix/matrix4.ts`, `packages/sdk-core/src/math/matrix/matrix4Inverse.ts`, `packages/sdk-core/src/math/matrix/matrix4Trs.ts`

| Function                                            | Computes                                                                            | Witness call                           | Proof                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| `multiplyMatrix4(out, a, b)`                        | `out = a · b`, each term in double then rounded once                                | `Matrix4.multiplyMatrices`             | bench `Matrix4.multiplyMatrices` (×1.2)             |
| `invertMatrix4(out, m)`                             | the inverse by cofactors; a singular `m` gives sixteen zeros, like the witness      | `Matrix4.invert`                       | bench `Matrix4.invert` (×1.3)                       |
| `copyMatrix4(out, m, outAt = 0, mAt = 0)`           | sixteen numbers copied at offsets, a loop rather than `set` so untyped outputs work | `Matrix4.copy`, `fromArray`, `toArray` | pure copy, bit equality in every bench line         |
| `IDENTITY_MATRIX4`                                  | the identity, read and never written                                                | `Matrix4.identity`                     | —                                                   |
| `composeMatrix4(out, position, quaternion, scale)`  | `out = T · R · S`, quaternion `(x, y, z, w)`                                        | `Matrix4.compose`                      | bench `Matrix4.compose` (×1.4)                      |
| `decomposeMatrix4(m, position, quaternion, scale)`  | the reverse, the sign of the determinant carried by the x scale, nothing returned   | `Matrix4.decompose`                    | bench `Matrix4.decompose` (×1.1)                    |
| `basisMatrix4(out, u, v, n, origin, outAt = 0)`     | columns `u`, `v`, `n`, then the origin, last row `(0, 0, 0, 1)`                     | `Matrix4.makeBasis` + `setPosition`    | bench `Matrix4.makeBasis` (×1.7)                    |
| `uniformScaleMatrix4(out, s, center, outAt = 0)`    | uniform scale `s` placed at `center`                                                | `Matrix4.makeScale` + `setPosition`    | bench `Matrix4.makeScale` (×2.3)                    |
| `determinantMatrix4(m)`, `linearPartDeterminant(m)` | the 4×4 determinant, and that of the upper 3×3 (sign of a reflection)               | `Matrix4.determinant`                  | `packages/sdk-core/src/math/matrix/matrix4.test.ts` |

### Vectors — `packages/sdk-core/src/math/primitives/vector.ts`

| Function                                               | Computes                                                                  | Witness call                    | Proof                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| `dotVector3(a, b, aAt = 0, bAt = 0)`                   | `a · b` on three components read at offsets                               | `Vector3.dot`                   | bench `Vector3.dot` (×3.9)                             |
| `crossVector3(out, a, b, outAt = 0, aAt = 0, bAt = 0)` | `out = a × b`; operands read before the first write, so `out` may alias   | `Vector3.crossVectors`          | bench `Vector3.crossVectors` (×5.0)                    |
| `lengthSqVector3(v, at = 0)`                           | `x² + y² + z²`; `Math.sqrt` of it is the witness's `length()` bit for bit | `Vector3.lengthSq`, `length`    | bench `Vector3.length` (×1.7)                          |
| `scaleVector3(out, s)`                                 | the three components multiplied in place                                  | `Vector3.multiplyScalar`        | bench `Vector3.multiplyScalar` (×4.3)                  |
| `copyScaledVector3(out, a, s, outAt = 0, aAt = 0)`     | `out = a · s`                                                             | `Vector3.copy().multiplyScalar` | same line                                              |
| `transformAffinePoint(out, m, x, y, z, outAt = 0)`     | `M · (x, y, z, 1)` for an affine `M`, three components                    | `Vector3.applyMatrix4`          | bench `Vector3.applyMatrix4` (×2.4)                    |
| `normalizeVector3(v)`                                  | `v / ‖v‖` in place, a zero vector left unchanged, nothing returned        | `Vector3.normalize`             | `packages/sdk-core/src/math/primitives/vector.test.ts` |

### Colours — `packages/sdk-core/src/math/primitives/color.ts`

| Function                           | Computes                                                                           | Witness call                                  | Proof                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `srgbToLinear(c)`                  | the exact sRGB curve, `c / 12.92` below 0.04045, `((c + 0.055) / 1.055)^2.4` above | `Color.convertSRGBToLinear`, `new Color(hex)` | bench `Color.convertSRGBToLinear` (×1.0) — **declared exception**: the witness multiplies by rounded constants, the engine writes the curve; gap ≤ 1e-11 per channel, invisible at 8 bits |
| `linearToSrgb(c)`                  | the inverse curve                                                                  | `Color.convertLinearToSRGB`                   | `packages/sdk-core/src/math/primitives/color.test.ts`                                                                                                                                     |
| `hslToLinearRgb(out, at, h, s, l)` | HSL to linear RGB, three stores at `at`                                            | `Color.setHSL`                                | bench `Color.setHSL` (×1.3)                                                                                                                                                               |

### Camera — `packages/sdk-core/src/math/primitives/camera.ts`, `packages/sdk-browser/src/camera/engineCamera.ts`, `packages/sdk-browser/src/camera/world.ts`

The engine composes its own projection from the declared optics — **reversed depth, infinite
far plane**: `near` projects to 1, infinity to 0 (`depthConvention.ts`). This is the second
declared exception: the bench compares the x/y terms of the projection to the witness's,
the depth terms are the engine's by design. `far` is still read for the frustum far plane,
the adaptive threshold and the shadow range.

| Function                                                                   | Computes                                                                                                                                          | Witness call                                            | Proof                                                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `perspectiveProjection(out, fov, aspect, near, zoom)`                      | the projection above; `fov` vertical, in degrees                                                                                                  | `PerspectiveCamera.updateProjectionMatrix`              | bench `Matrix4.makePerspective` (×1.1, x/y terms)                                                                     |
| `createCameraFrame()` / `updateCameraFrame(frame, projection, world, far)` | view = `world⁻¹`, view-projection, six frustum planes, once per frame                                                                             | `matrixWorldInverse`, `Frustum.setFromProjectionMatrix` | bench `Frustum.setFromProjectionMatrix` (×1.6, side planes)                                                           |
| `createEngineCamera()`                                                     | an `EngineCamera`: the frame above plus `world`, `projection`, `eye`, `near`, `far`, `fov`, `aspect`, allocated once                              | `new PerspectiveCamera()`                               | `engineCamera.test.ts`                                                                                                |
| `writeEngineCamera(into, { fov, aspect, near, far, zoom })`                | everything a frame reads, derived from `into.world` already set and the optics                                                                    | `updateProjectionMatrix` + `updateMatrixWorld`          | `engineCamera.test.ts`: same bits as a host camera read through `readCameraWorld`                                     |
| `defaultEngineCamera()`                                                    | the camera at the origin with fov 50, aspect 1, near 0.1, far 2000, zoom 1 — the fallback of oracles called before the first frame                | `new PerspectiveCamera()`                               | `engineCamera.test.ts`                                                                                                |
| `holdCameraWorld(into, from)`                                              | bit-for-bit copy of an engine camera, nothing recomputed                                                                                          | `PerspectiveCamera.copy`                                | `packages/sdk-browser/src/camera/world.test.ts`                                                                       |
| `readCameraWorld(into, hostCamera)`                                        | resolves the host camera's ancestors, copies its world matrix, then `writeEngineCamera` — the only translation from a host camera, once per frame | `updateWorldMatrix` + the reads above                   | `packages/sdk-browser/src/camera/world.test.ts` under a hostile rig; `tests/integration/engine-without-three.test.ts` |
| `enginePose(cam)`                                                          | `{ position, quaternion }` of the drawn frame, from the engine camera                                                                             | `getWorldPosition`, `getWorldQuaternion`                | `packages/sdk-browser/src/camera/world.test.ts`                                                                       |

### Sides — `packages/sdk-browser/src/scene/materialSide.ts`

| Function                                    | Computes                                                                                                                                                               | Witness call                          | Proof                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------- |
| `type Side = 'front' \| 'back' \| 'double'` | which faces of a surface are drawn; every raster, cone, pipeline and blend-plan decision compares against it                                                           | `FrontSide`, `BackSide`, `DoubleSide` | `materialSide.test.ts` |
| `sideOf(material)`                          | the `Side` a host material declares, the first of an array deciding, an empty array front — read once at the import boundary, the only place naming the host constants | the host's double-side test           | `materialSide.test.ts` |
| `materialSide(material)`                    | the host constant itself, for the diagnostic materials still built with the host library                                                                               | —                                     | `materialSide.test.ts` |

## Batch math for hosts

`packages/sdk-core/src/math/batch/batch.ts` and the `mathBatch*.ts` beside it: `n` elements per call, flat
typed arrays or sub-views of a fixed stride (`packages/sdk-core/src/math/batch/strides.ts`, `BOX_VALUES`,
`FRUSTUM_PLANE_VALUES`), output first, no allocation, a count as the only return value. Each batch
repeats its unit function, which stays the oracle; how to lay out and reuse the buffers is in the
[SDK guide](SDK.md#batch-math-for-hosts). The proof is `pnpm run perf:core`
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
