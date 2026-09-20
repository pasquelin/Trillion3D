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
UV sets. Unsupported blend, transmission, physical extensions, shader hooks, material arrays and light
types select the complete scene-renderer fallback explicitly; #119 and #120 track their removal.

| Function or contract                                  | Computes                                                                                             | Replaces                                            | Proof                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `WebglClusterRenderer.draw(meshes, scene, camera, …)` | validated opaque/MASK batches, multi-draw submission, bounded light blocks and published geometric specular filtering | host-renderer submission of those cluster meshes    | analytic planar/curved/moving browser fixtures; real Emerald `autonomousClusterDrawsTotal` |
| `RenderBackend.drawHostGeometry(camera, output)`      | one raw geometry hook with explicit colour encoding and tone-mapping destination state               | cluster meshes attached to the temporary scene      | canvas and sRGB FBO cases in `rendu-clusters-webgl.browser.mjs`                |
| `createSceneDrawer(renderer, camera)`                 | shared display, render-target, capture, held-frame and restoration order                             | independent host-renderer calls in each output path | context loss/restore and FBO scissor cases in the browser proof                |
| `autonomousClusterDrawsTotal`                         | cumulative count of visible cluster batches whose owned submission completed                         | inference from host-renderer counters               | real Emerald counter; invisible and rejected browser cases count zero          |
