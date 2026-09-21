# Engine API, batch by batch

One section per merged batch, listing the functions it delivers or puts to work: signature,
what it computes, the host-library call it replaces and the proof that it gives the same
numbers. Conventions shared by every entry:

- **Column-major 4×4 matrices** in sixteen consecutive numbers, `[12..14]` the translation —
  the layout of the reference library, so a host matrix copies without reordering.
- **Output first, allocation never.** A function writes into the `out` buffer it receives and
  returns it; one that writes in place or fills several named buffers — `normalizeVector3`,
  `decomposeMatrix4` — returns nothing, and its row says so. A call on a per-frame path allocates
  nothing. `outAt`/`aAt` offsets let one large buffer hold many operands.
- **`Float64Array` for what is computed**, `ArrayLike<number>` for what is only read: a host
  matrix, a plain array or a `Float32Array` enters as-is.
- **Same bits as the reference**, proven by `pnpm run perf:core`
  (`packages/sdk-core/bench/three-vs-core-*.perf.mjs`): each line runs the host library and
  the engine on the same seeded inputs, compares bit for bit and refuses an engine slower than
  the reference. The two declared exceptions are named where they apply. The ratios quoted are
  the engine's speed-up over the reference, best of three runs on the same machine (#72, #76,
  19 Sept. 2026); they say where, not how much a frame gains.

## Explorer startup (#111)

- `createExplorer(target: ExplorerTarget, options: ExplorerOptions)` and
  `createExplorerJob(id, target, options)` accept a canvas element or its literal document ID.
- `interactive: true` owns CSS/DPR sizing, OrbitControls and bounded demand-driven rendering;
  absent/false preserves manual sessions. Defaults to direct WebGPU, with explicit failure
  when unavailable. `invalidate()` requests a frame after programmatic edits.
- `RenderBackend.pendingFrame?()` waits for submitted work without image readback and returns
  whether interactive rendering should continue. Custom backends with progressive work should
  implement it. Disposal owns all interactive listeners and pending callbacks.
- Details, defaults and teardown: [SDK guide](SDK.md#simple-browser-startup). Proof:
  `explorerTarget.test.ts`, `explorerFrameScheduler.test.ts` and the browser startup proof.

## Batch A — maths and side enum (#76)

### Matrices — `packages/sdk-core/mathMatrix4.ts`, `mathMatrix4Inverse.ts`, `mathMatrix4Trs.ts`

| Function                                            | Computes                                                                            | Replaces                               | Proof                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------- |
| `multiplyMatrix4(out, a, b)`                        | `out = a · b`, each term in double then rounded once                                | `Matrix4.multiplyMatrices`             | bench `Matrix4.multiplyMatrices` (×1.2)     |
| `invertMatrix4(out, m)`                             | the inverse by cofactors; a singular `m` gives sixteen zeros, like the reference    | `Matrix4.invert`                       | bench `Matrix4.invert` (×1.3)               |
| `copyMatrix4(out, m, outAt = 0, mAt = 0)`           | sixteen numbers copied at offsets, a loop rather than `set` so untyped outputs work | `Matrix4.copy`, `fromArray`, `toArray` | pure copy, bit equality in every bench line |
| `IDENTITY_MATRIX4`                                  | the identity, read and never written                                                | `Matrix4.identity`                     | —                                           |
| `composeMatrix4(out, position, quaternion, scale)`  | `out = T · R · S`, quaternion `(x, y, z, w)`                                        | `Matrix4.compose`                      | bench `Matrix4.compose` (×1.4)              |
| `decomposeMatrix4(m, position, quaternion, scale)`  | the reverse, the sign of the determinant carried by the x scale, nothing returned   | `Matrix4.decompose`                    | bench `Matrix4.decompose` (×1.1)            |
| `basisMatrix4(out, u, v, n, origin, outAt = 0)`     | columns `u`, `v`, `n`, then the origin, last row `(0, 0, 0, 1)`                     | `Matrix4.makeBasis` + `setPosition`    | bench `Matrix4.makeBasis` (×1.7)            |
| `uniformScaleMatrix4(out, s, center, outAt = 0)`    | uniform scale `s` placed at `center`                                                | `Matrix4.makeScale` + `setPosition`    | bench `Matrix4.makeScale` (×2.3)            |
| `determinantMatrix4(m)`, `linearPartDeterminant(m)` | the 4×4 determinant, and that of the upper 3×3 (sign of a reflection)               | `Matrix4.determinant`                  | `mathMatrix4.test.ts`                       |

### Vectors — `packages/sdk-core/mathVector.ts`

| Function                                               | Computes                                                                    | Replaces                        | Proof                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------- | ------------------------------------- |
| `dotVector3(a, b, aAt = 0, bAt = 0)`                   | `a · b` on three components read at offsets                                 | `Vector3.dot`                   | bench `Vector3.dot` (×3.9)            |
| `crossVector3(out, a, b, outAt = 0, aAt = 0, bAt = 0)` | `out = a × b`; operands read before the first write, so `out` may alias     | `Vector3.crossVectors`          | bench `Vector3.crossVectors` (×5.0)   |
| `lengthSqVector3(v, at = 0)`                           | `x² + y² + z²`; `Math.sqrt` of it is the reference's `length()` bit for bit | `Vector3.lengthSq`, `length`    | bench `Vector3.length` (×1.7)         |
| `scaleVector3(out, s)`                                 | the three components multiplied in place                                    | `Vector3.multiplyScalar`        | bench `Vector3.multiplyScalar` (×4.3) |
| `copyScaledVector3(out, a, s, outAt = 0, aAt = 0)`     | `out = a · s`                                                               | `Vector3.copy().multiplyScalar` | same line                             |
| `transformAffinePoint(out, m, x, y, z, outAt = 0)`     | `M · (x, y, z, 1)` for an affine `M`, three components                      | `Vector3.applyMatrix4`          | bench `Vector3.applyMatrix4` (×2.4)   |
| `normalizeVector3(v)`                                  | `v / ‖v‖` in place, a zero vector left unchanged, nothing returned          | `Vector3.normalize`             | `mathVector.test.ts`                  |

### Colours — `packages/sdk-core/mathColor.ts`

| Function                           | Computes                                                                           | Replaces                                      | Proof                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `srgbToLinear(c)`                  | the exact sRGB curve, `c / 12.92` below 0.04045, `((c + 0.055) / 1.055)^2.4` above | `Color.convertSRGBToLinear`, `new Color(hex)` | bench `Color.convertSRGBToLinear` (×1.0) — **declared exception**: the reference multiplies by rounded constants, the engine writes the curve; gap ≤ 1e-11 per channel, invisible at 8 bits |
| `linearToSrgb(c)`                  | the inverse curve                                                                  | `Color.convertLinearToSRGB`                   | `mathColor.test.ts`                                                                                                                                                                         |
| `hslToLinearRgb(out, at, h, s, l)` | HSL to linear RGB, three stores at `at`                                            | `Color.setHSL`                                | bench `Color.setHSL` (×1.3)                                                                                                                                                                 |

### Camera — `packages/sdk-core/mathCamera.ts`, `packages/sdk-browser/engineCamera.ts`, `cameraWorld.ts`

The engine composes its own projection from the declared optics — **reversed depth, infinite
far plane**: `near` projects to 1, infinity to 0 (`depthConvention.ts`). This is the second
declared exception: the bench compares the x/y terms of the projection to the reference's,
the depth terms are the engine's by design. `far` is still read for the frustum far plane,
the adaptive threshold and the shadow range.

| Function                                                                   | Computes                                                                                                                                          | Replaces                                                | Proof                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `perspectiveProjection(out, fov, aspect, near, zoom)`                      | the projection above; `fov` vertical, in degrees                                                                                                  | `PerspectiveCamera.updateProjectionMatrix`              | bench `Matrix4.makePerspective` (×1.1, x/y terms)                                        |
| `createCameraFrame()` / `updateCameraFrame(frame, projection, world, far)` | view = `world⁻¹`, view-projection, six frustum planes, once per frame                                                                             | `matrixWorldInverse`, `Frustum.setFromProjectionMatrix` | bench `Frustum.setFromProjectionMatrix` (×1.6, side planes)                              |
| `createEngineCamera()`                                                     | an `EngineCamera`: the frame above plus `world`, `projection`, `eye`, `near`, `far`, `fov`, `aspect`, allocated once                              | `new PerspectiveCamera()`                               | `engineCamera.test.ts`                                                                   |
| `writeEngineCamera(into, { fov, aspect, near, far, zoom })`                | everything a frame reads, derived from `into.world` already set and the optics                                                                    | `updateProjectionMatrix` + `updateMatrixWorld`          | `engineCamera.test.ts`: same bits as a host camera read through `readCameraWorld`        |
| `defaultEngineCamera()`                                                    | the camera at the origin with fov 50, aspect 1, near 0.1, far 2000, zoom 1 — the fallback of oracles called before the first frame                | `new PerspectiveCamera()`                               | `engineCamera.test.ts`                                                                   |
| `holdCameraWorld(into, from)`                                              | bit-for-bit copy of an engine camera, nothing recomputed                                                                                          | `PerspectiveCamera.copy`                                | `cameraWorld.test.ts`                                                                    |
| `readCameraWorld(into, hostCamera)`                                        | resolves the host camera's ancestors, copies its world matrix, then `writeEngineCamera` — the only translation from a host camera, once per frame | `updateWorldMatrix` + the reads above                   | `cameraWorld.test.ts` under a hostile rig; `test/integration/moteur-sans-three.test.mjs` |
| `enginePose(cam)`                                                          | `{ position, quaternion }` of the drawn frame, from the engine camera                                                                             | `getWorldPosition`, `getWorldQuaternion`                | `cameraWorld.test.ts`                                                                    |

### Sides — `packages/sdk-browser/materialSide.ts`

| Function                                    | Computes                                                                                                                                                               | Replaces                              | Proof                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------- |
| `type Side = 'front' \| 'back' \| 'double'` | which faces of a surface are drawn; every raster, cone, pipeline and blend-plan decision compares against it                                                           | `FrontSide`, `BackSide`, `DoubleSide` | `materialSide.test.ts` |
| `sideOf(material)`                          | the `Side` a host material declares, the first of an array deciding, an empty array front — read once at the import boundary, the only place naming the host constants | `material.side === THREE.DoubleSide`  | `materialSide.test.ts` |
| `materialSide(material)`                    | the host constant itself, for the diagnostic materials still built with the host library                                                                               | —                                     | `materialSide.test.ts` |

## Batch E1 — the image reaches the surface (#77)

The WebGPU engine no longer hands its image to a host renderer to be displayed. With a host canvas
it presents into it directly; without one it presents into a canvas of its own and publishes it,
and the host copies that canvas with the program below. Nothing here is a performance claim: on the
direct path the presentation is fused into the composition pass, and on the composed path — which
the bench does not take — the copy's cost was not isolated above the run-to-run spread. That path
uploads the whole canvas every frame, held frames included; the engine counts `imageRevision` and
could spare it, and the lot that removes the WebGL composition host is where that belongs.

### Presentation — `packages/sdk-browser/webgpuPresentationSetup.ts`, `webglCanvasBlit.ts`, `explorerComposeSurface.ts`

| Function                                       | Computes                                                                                                                                                                                                       | Replaces                                                                         | Proof                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `prepareWebgpuPresentation(device, gpuCanvas)` | the engine's presenter on the host canvas, or on one it creates when the host gave none                                                                                                                        | `new CanvasTexture` + `new ShaderMaterial` + a blit mesh added to the host scene | `test/browser/presentation-composee.browser.mjs`, `explorerComposeSurface.test.ts`                   |
| `RenderBackend.presentedSurface`               | the canvas an engine presented into, published on the contract; such an engine does not use `scene` for display, and an engine drawing on the host surface publishes none                                      | `scene.children.find((o) => o.userData.blit).material.uniforms.image.value`      | `test/browser/presentation-composee.browser.mjs`, `explorerComposeSurface.test.ts`                   |
| `createCanvasBlit(gl)`                         | a full-screen copy program on the caller's context: uploads a canvas and draws it over the viewport, rows reversed once, and reads the source in the encoding the destination writes so nothing converts twice | `WebGLRenderer.render` of a blit mesh, `copyFramebufferToTexture`                | `test/browser/presentation-composee.browser.mjs`: 12 288 channels to each destination, not one apart |
| `createBackendPresenter(host)`                 | the one place that puts an engine's image on the host surface: copies a presented surface into the bound framebuffer and answers true, or answers false for an engine that hands over a scene                  | `WebGLRenderer.render(backend.scene, camera)` on the WebGPU path                 | `explorerComposeSurface.test.ts`, `test/browser/presentation-composee.browser.mjs`                   |

## Batch E2 — WebGL2 surface foundation (#108)

This first WebGL2-removal stage owns the host context and its lifecycle. The existing Three scene
renderer remains a temporary draw adapter over that context; no rendering-performance gain is
claimed by this stage.

| Function                                 | Computes                                                                                               | Replaces                                                                                             | Proof                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `createWebglSurface(canvas, lifecycle?)` | WebGL2 context, DPR-aware drawing-buffer size, loss/restoration state, and idempotent context disposal | implicit context creation and context loss in `new WebGLRenderer` / `WebGLRenderer.forceContextLoss` | `webglSurface.test.ts`, `test/browser/webgl-surface.browser.mjs` |

## Batch E3 — autonomous opaque cluster drawing (#113)

The prepared-page WebGL2 backend now submits supported opaque and alpha-masked cluster batches
through an engine-owned program. The same draw owner serves the displayed frame, held-frame refresh,
capture and fallback rendering. `autonomousClusterDrawsTotal` counts owned batch submissions. It is
cumulative evidence of routing, not a frame-time or draw-call metric.

The supported input is unextended `MeshStandardMaterial` and `MeshBasicMaterial`, including glTF base
colour, metallic-roughness, normal, occlusion and emissive textures and their samplers, transforms and
UV sets. At this stage, unsupported blend, transmission, physical extensions, shader hooks, material
arrays and light types selected a complete scene-renderer fallback; #119 then #120 removed it.

| Function or contract                                  | Computes                                                                                                              | Replaces                                            | Proof                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `WebglClusterRenderer.draw(meshes, scene, camera, …)` | validated opaque/MASK batches, multi-draw submission, bounded light blocks and published geometric specular filtering | host-renderer submission of those cluster meshes    | analytic planar/curved/moving browser fixtures; real Emerald `autonomousClusterDrawsTotal` |
| `RenderBackend.drawHostGeometry(camera, output)`      | one raw geometry hook with explicit colour encoding and tone-mapping destination state                                | cluster meshes attached to the temporary scene      | canvas and sRGB FBO cases in `rendu-clusters-webgl.browser.mjs`                            |
| `createSceneDrawer(renderer, camera)`                 | shared display, render-target, capture, held-frame and restoration order                                              | independent host-renderer calls in each output path | context loss/restore and FBO scissor cases in the browser proof                            |
| `autonomousClusterDrawsTotal`                         | cumulative count of visible cluster batches whose owned submission completed                                          | inference from host-renderer counters               | real Emerald counter; invisible and rejected browser cases count zero                      |

## Batch E5 — transmission over autonomous clusters, fallback removed (#120)

A transmissive source mesh is a scene copy the engine draws itself, after the paged clusters,
over a frozen backdrop of the frame in linear light — the glTF transmission model the WebGPU
pass already implements. With every supported material path owned, the temporary complete-scene
fallback is gone: paged clusters have one renderer, and a scene it cannot draw in full fails its
preparation by name.

| Function or contract                                          | Computes                                                                                                      | Replaces                                                        | Proof                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `WebglClusterRenderer.draw(meshes, scene, camera, …, copies)` | the frame into the backdrop, then to the target, then the transmissive copies reading the backdrop            | `WebGLRenderer.renderTransmissionPass` and the physical shader  | `transmission-clusters-webgl.browser.mjs`: through, occluded, blended, attenuated, lit |
| `WebglClusterBackdrop`                                        | half-float colour and 24-bit depth copies sized to the viewport, bound and restored around the frame          | `WebGLRenderer._transmissionRenderTarget`                       | sub-viewport, target and viewport restoration in the same proof                        |
| `clusterMaterialReason(material, attributes, transmissive)`   | the named reason a material cannot be preserved; the transmission volume is the one physical extension        | silent selection of the scene-renderer fallback                 | `webglClusterCompatibility.test.ts`                                                    |
| `submittedDraws(backend)`                                     | the batch records or diagnostic page meshes the owner submits for the cut; oracle and test access only        | reading `ClusterDrawMesh` objects off the host scene            | `pagesBackend*.test.ts`, `pageRaster.ts` oracle                                        |
| `EngineError('CLUSTER_MATERIAL_UNSUPPORTED')`                 | preparation and draw refusal, `details.reason` naming the input                                               | `cluster-webgl-fallback` diagnostic and the complete Three path | `transmission-explorateur-webgl.browser.mjs`                                           |
| `autonomousCopyDraws`, `transmissionBackdropBytes`            | submissions of the owned scene copies this frame, both passes; bytes the backdrop holds since the first glass | inference from host-renderer counters                           | explorer proof: one copy, 64 × 64 × 12 bytes, none in `WebGLRenderer.render`           |

## Batch E6 — the engine surface as the session's WebGL2 authority (#85, first pull request)

The engine's surface is the session's WebGL2 resource; the `WebGLRenderer` is no longer one. It
is mounted by the composition host, next to the compositor, the presenter and the scene drawer
it still serves, and nowhere else; capabilities, preparation, the loss fallback, the frame timer
and the pixel readback read the engine's surface. Measured first, on `exact-cluster-pages`
(Emerald Square, general view, moving camera, 1280 × 720, DPR 1, 0 px, three runs of 60 frames,
commit 8d7ad744, the split in the pull request): the host pass — clear, `render` of the light
group, held-frame copy — holds 0.0 ms p50 / 0.1 ms p95 of a 13 ms CPU frame (spread 0.5 ms)
and nothing of the 16.7 ms envelope, which sits on the display cap. **No gain is claimed:** the
batch is the removal, and the 5.7 ms of the submit are the engine's own program.

| Function or contract                                 | Computes                                                                                                                                | Replaces                                                                            | Proof                                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `configureExplorer(session, inputs)`                 | the engine surface, created and sized from the options, as the only WebGL2 resource of the session; no renderer returned                | `new THREE.WebGLRenderer({ canvas, context })` at capability time                   | `test/browser/*.browser.mjs` on the WebGL path, unchanged; `moteur-sans-three.test.mjs` |
| `WebglSurface.lost`                                  | the loss itself, read on the context, not only its event — which is queued behind the frame that hit the dead context                   | `renderer.getContext().isContextLost()`                                             | `webglSurface.test.ts`: a loss the context knows before its event arrives               |
| `handleExplorerRenderError(error, { webglSurface })` | `CONTEXT_LOST` when the engine surface is lost, drawing nothing; the baseline fallback otherwise                                        | `renderer.getContext().isContextLost()`                                             | `explorerRenderFallback.test.ts`                                                        |
| `createExplorerCapture({ context })`                 | the readback of the composed frame and of the first visible sample, on the engine's context                                             | `renderer.getContext()` before each `readPixels`                                    | `explorerComposeSurface.test.ts`: read, scene, read                                     |
| `createExplorerDraw({ webglSurface })`               | the whole-frame GPU timer mounted on the engine's context                                                                               | `renderer.getContext()` for `createWebglFrameTimer`                                 | `test:gpu` per-step profile, `gpuImageMs` published on the bench                        |
| `maxAnisotropy(gl)` (`explorerCapabilities.ts`)      | the anisotropy the context allows, from `EXT_texture_filter_anisotropic`                                                                | `renderer.capabilities.getMaxAnisotropy()`                                          | same read as the reference renderer; `detail: 'maximum'` path                           |
| `createExplorerHostState(…, webglSurface)`           | the composition host: mounts the temporary draw adapter on the surface, sized from it, and the compositor and presenter on that adapter | `configureExplorer` handing a renderer through `ExplorerResources` to every service | `explorerViewportApi.test.ts`, `test:gpu` on the composed path                          |

## Batch math for hosts (#104, #80)

`packages/sdk-core/mathBatch.ts` and the `mathBatch*.ts` beside it: `n` elements per call, flat
typed arrays or sub-views of a fixed stride (`mathBatchStrides.ts`, `BOX_VALUES`,
`FRUSTUM_PLANE_VALUES`), output first, no allocation, a count as the only return value. Each batch
repeats its unit function, which stays the oracle; how to lay out and reuse the buffers is in the
[SDK guide](SDK.md#batch-math-for-hosts). The proof is `pnpm run perf:core`
(`three-vs-core-batch-*.perf.mjs`; how a line reads: [TESTS.md](TESTS.md)). Ratios are the batch's
speed-up over the reference's loop, rounded from the range of the per-run medians over three runs
(PR #105, 20 Sept. 2026, Apple M2 Max, Node 26.8.2, the ranges in that pull request); the three
exceptions are declared on their line.

| Function                                                                                    | Computes                                                                            | Replaces the loop                         | Proof                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `frustumKeepsBoxBatch(kept, planes, boxes, n)`                                              | `kept[i]` 1 where `!frustumExcludesBox`, returns the count kept                     | `for … frustum.intersectsBox(box)`        | bench `Frustum.intersectsBox batch` (×1.1)                                                                                                                         |
| `sphereFromBoundsBatch(out, boxes, n)`                                                      | four values per box, `sphereFromBounds`                                             | `for … box.getBoundingSphere(s)`          | bench `Box3.getBoundingSphere batch` (×2.2)                                                                                                                        |
| `boxUnionBatch(into, boxes, n)`                                                             | `into ∪ boxes[0] ∪ … ∪ boxes[n − 1]`, `boxUnion`                                    | `for … box.union(b)`                      | bench `Box3.union batch` (×1.9)                                                                                                                                    |
| `boxTransformBatch(out, boxes, mats[], n)`                                                  | `out[i] = boxTransform(boxes[i], mats[i])`                                          | `for … box.applyMatrix4(m)`               | `mathBatch.test.ts` against `boxTransform`; WebAssembly kernel bit-identical (`math.rs`, `mathBatchRuntime.test.ts`)                                               |
| `boxTransformUnionBatch(into, boxes, mats[], n)`                                            | transform then union, one pass, one scratch box                                     | `Box3.setFromObject`                      | bench `Box3 transform and union batch` (×1.8)                                                                                                                      |
| `multiplyMatrix4Batch(out[], a[], b[], n)`                                                  | `out[i] = a[i] · b[i]`, sub-views                                                   | `for … m.multiplyMatrices(a, b)`          | `mathBatchTransforms.test.ts`; WebAssembly kernel bit-identical (`math.rs`, `mathBatchRuntime.test.ts`)                                                            |
| `invertMatrix4Batch(out[], mats[], n, singular?)`                                           | `out[i] = mats[i]⁻¹`; a zero determinant writes the identity and sets `singular[i]` | `for … m.invert()`                        | bench `Matrix4.invert batch` (×0.9) — **declared exception**: the batch reads the determinant to flag singularity, the reference does less; ceiling 1.2            |
| `normalMatrix3Batch(out, mats[], n)`                                                        | nine values per matrix, `normalMatrix3`                                             | `for … n.getNormalMatrix(m)`              | bench `NormalMatrix3 batch` (×0.5) — **declared exception**: the engine's singularity policy (`mathSingular.ts`) is kept; ceiling 2.2                              |
| `composeMatrix4Batch(out, positions, quaternions, scales, n)`                               | `T · R · S` per element, all flat or all sub-views                                  | `for … m.compose(p, q, s)`                | bench `Matrix4.compose batch` (×1.5)                                                                                                                               |
| `decomposeMatrix4Batch(positions[], quaternions[], scales[], mats[], n)`                    | the reverse, `decomposeMatrix4`                                                     | `for … m.decompose(p, q, s)`              | bench `Matrix4.decompose batch` (×1.1)                                                                                                                             |
| `transformPointsBatch(out, m, points, n)`                                                   | `n` points by one affine matrix, `transformAffinePoint`                             | `for … v.applyMatrix4(m)`                 | bench `Vector3.applyMatrix4 batch` (×1.4)                                                                                                                          |
| `transformPointsByMatricesBatch(out, mats[], points, n)`                                    | `n` points, one matrix each                                                         | `for … v[i].applyMatrix4(mats[i])`        | bench `Vector3.applyMatrix4 per-instance batch` (×1.9)                                                                                                             |
| `transformDirectionsBatch(out, m, dirs, n)`                                                 | upper 3×3 then normalize, `transformDirectionVector3`                               | `for … v.transformDirection(m)`           | bench `Vector3.transformDirection batch` (×1.3)                                                                                                                    |
| `srgbToLinearBatch(out, values, n)`, `linearToSrgbBatch(out, values, n)`                    | one channel per element, the exact curves of `mathColor.ts`                         | `for … color.convertSRGBToLinear()`       | bench `Color.convertSRGBToLinear batch`, `convertLinearToSRGB batch` (×1.0) — **declared exception**: the curve, gap ≤ 1.1e-11 forward, ≤ 6.3e-6 back; ceiling 1.1 |
| `hierarchyUpdateBatch(worldViews[], positions[], rotations[], scales[], parents, n, local)` | a whole hierarchy, parents before children, `composeMatrix4` then `multiplyMatrix4` | `Object3D.updateMatrixWorld` over a scene | `mathBatchHierarchy.test.ts`: JavaScript, WebAssembly (`math_hierarchy.rs`) and `three`'s `updateMatrixWorld`, same bits                                           |

What the engine's own frame pays for the loops these batches would replace is measured in the SDK
guide, same section: no engine loop was replaced by a batch in #80's third stage, each verdict
resting on a published share.
