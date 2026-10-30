# Maths

The maths the engine computes with, exported by `trillion3d`, `packages/sdk-core` and
`packages/sdk-browser`; the rest of the public API is [SDK.md](SDK.md).

## The maths package

`packages/math` (`@trillion3d/math`) holds the primitive maths; every other package imports it.
Contract:

- Pure functions: no state outliving a call, no DOM, GPU API, clock or worker.
- Outputs go through an `out` argument or a flat array, never a fresh object per call.
- One function per formula: a second copy elsewhere is a defect.
- It imports nothing outside itself; `pnpm run check:cycles` fails otherwise.
- `packages/sdk-core/src/world/math` holds the public value classes (`Vector3`, `Box3`…), which call
  the package; per-component arithmetic (`multiply`, `min`, `addScalar`) stays there.

Layout, under `packages/math/src/`:

- `float/`: `hypot`, `trig`, `splitDouble`, `half` (float16 encode and decode).
- `vector/` (with `spherical.ts`), `quaternion/`, `matrix/` (with `matrixElements.ts`, pose
  comparisons), `geometry/` (boxes, spheres, slabs, triangles, `frustum/`), `color/`.
- `projection/`: `camera.ts` (camera frame, focal and pixel scales), `renderOrigin.ts`, `clip.ts`,
  `forwardZ.ts` (a light's shadow-map reversed-depth projections down +z), `projectionOracles.ts`.
- `scalar/`: `reals.ts`, `integers.ts`, `quantile.ts` (nearest and floor ranks; median = nearest
  rank at 0.5; mean), `search.ts`, `hermite.ts`, `uint64.ts` (two little-endian 32-bit words),
  `constants.ts`.
- `sequence/`: `halton.ts`; `random.ts` (seeded generators, twins of Rust `random.rs`);
  `sweep.fixture.ts` (Halton sweep and edge values for rewrite proofs).
- `batch/` and `wgsl/` (below). `index.ts` is the barrel `packages/sdk-core` re-exports, minus
  `wgsl/`.

### Lengths

One rule computes every length (`packages/math/src/vector/vector.ts`). `length3(x, y, z)` sums the
squares left to right (WGSL `length()` order) and returns `Math.sqrt` of the sum while it lies in
the normal band, 2^-969 up to the largest finite double. Outside it (zero vector, components below
about 1e-146 or past about 1e154) it returns `hypot3`, which scales first; a NaN component gives
NaN. `length2(x, y)` is the same with `hypot2`, `lengthQuaternion` on four terms with `hypot4`.
- A distance is that length of `a − b` per component (`distanceVector3`; `distanceSqVector3` without
  the root); a matrix column's length is the length of its three terms (`decomposeMatrix4`).
- A normalise multiplies each component by `1 / (length || 1)`; a zero vector stays zero; a vector
  shorter than 2^-1024 is first scaled by 2^1000 (`normalizeVector3`, `normalizeVector2`);
  1e200 and 1e-170 normalise to unit (`vector/lengthRange.test.ts`).
- The rule and `Math.hypot` differ in the last bit on many in-band inputs: a site moved from one to
  the other carries the proof that no 8-bit pixel moves. A site moved from the plain root gains the
  true length outside the band. Moved sites, under `packages/sdk-browser/src/`:
  `scene/host/prepared/geometry.ts`, `geometry/selection/projection.fixture.ts`,
  `session/world/lights.ts`, `vsmWorldToLightRotation` (`lighting/shadows/vsm/clipmap.ts`; within
  about 1e-146 of vertical it follows the direction instead of snapping to world Y,
  `lightRotation.test.ts`).

Declared exceptions, each held to bits the rule would change:

- `hypot` kept: `packages/math/rust/src/scalar/js.rs`; `length` of
  `packages/sdk-core/src/world/animation/ik.ts`; `closes` of
  `packages/sdk-core/src/world/math/curves.ts` (gap under 1e-12, `shapeClose.test.ts`); `spriteRow`
  of `packages/sdk-browser/src/session/world/poses/poses.ts`; normals of
  `scripts/dev/fixtures/garden-source.ts`.
- Plain root without the band, twin of the Rust vectors (`packages/math/rust/src/vector/vec2.rs`,
  `vec3.rs`): `plainLength3`, `plainLength2` (`vector/vector.ts`), the rule of every TypeScript twin
  of a Rust function; `clusterErrorAtDepth`, `clusterErrorPixels` of
  `packages/sdk-core/src/lod/screenErrorBound.ts` (`screenErrorBits.json`); the gap of `sphereUnion`
  (`geometry/sphere.ts`; `merge_spheres` of `packages/math/rust/src/geometry/sphere.rs`,
  `sphereUnion.test.ts`).
- Division by the length, each component correctly rounded: `normalizeQuaternion` (Kahan sum of the
  four squares, `hypot4` outside `2^-900..2^900`; `normalize` of
  `packages/math/rust/src/quaternion.rs`); the bend axis of `ik.ts`; `normalized` of
  `packages/sdk-core/src/scene/light/validate.ts`. `writeDividedVector3` (`vector/vector.ts`):
  `length3 || 1` then three quotients (camera axes of `packages/sdk-browser/src/blend/uniforms.ts`).
  Own forms: `axisOf` of `lighting/ao/params.ts` (`+ 0` per quotient), `yawWalk` of
  `camera/controls/math.ts`, `toward` of `geometry/partition/sourceShape.ts` (`length2`), `axisFor`
  of `geometry/partition/sourceRank.ts` (reciprocal of a plain root over a floor), the tint step of
  `lighting/whiteBalance.ts` (all under `packages/sdk-browser/src/`), and
  `packages/sdk-core/src/modules/sky/lightShafts.ts` (plain root, input kept when not positive).

### Declared variants

Where two forms of one quantity must both live, each has its own owner and name:

- Order-2 harmonics: `IRRADIANCE_TERMS` (`packages/sdk-core/src/scene/core/irradianceTerms.ts`)
  holds each term's 7-digit unsigned `basis` (irradiance, reflection lobes) and its `contract`, the
  6-digit signed value of the sky light's projection and the volumetric lightmap file (terms 1, 3,
  5, 7 negative). `harmonicsBasis` (`modules/sky/skyLight/cubeWgsl.ts`) and the lightmap's decode
  scales (`lighting/volumetricLightmap/sampleWgsl.ts`) are emitted from it; the bake writes the same
  digits (`packages/asset-compiler-rust/src/volumetric_lightmap/bake/accumulate.rs`). `contract` is
  written, not rounded: `0.4886025` rounds to `0.488602`, the file holds `0.488603`.
- Octahedral decode by what `z` lacks, `e ± lack`: `unproject_unfolded`
  (`packages/math/rust/src/vector/octahedral.rs`; `packages/page-codec-wasm/src/bits/oct.rs`;
  `oct.json`) and shader twin `octCellsDecode` (`wgsl/octahedral.ts`); `unproject` and `octDecode`
  fold instead.
- Cofactor inverse with the plain reciprocal of the determinant: `inverse3` of `wgsl/matrix.ts`,
  beside `inverse3` of `matrix/matrix3.ts` (singular rule of `adjugateFactor`); `inverseRows`
  (`color/color.ts`) divides each cofactor by the determinant (`XYZ_TO_SRGB`).
- Quaternion rotation row by row: `quaternionRows` (`wgsl/quaternion.ts`), `2·(y·y + z·z)`;
  `composeMatrix4At` applies the factor two on the vector first.
- HLOD transfer sRGB decode: table of `(v * (1 / 1.055) + 0.0521327)^2.4`, reciprocal multiplied
  (`packages/asset-compiler-rust/src/hlod/flatten/simplify/transfer/colour.rs`), beside
  `srgb_to_linear` of `packages/math/rust/src/color.rs`; Rec. 709 weights `0.2126, 0.7152, 0.0722`
  of the bake report's tone gap (`hlod/flatten/bake/appearance.rs`).
- Horizon-search noise: `interleavedGradientNoise` (`wgsl/sampling.ts`) at frame 0, `dot` form.

### The WGSL library

`packages/math/src/wgsl/` holds the shader side: each shared function or constant is one `WgslDecl`
([`decl.ts`](../packages/math/src/wgsl/decl.ts)) with name, text and dependencies (objects, not
names). A shader keeps its own text and lists the declarations it uses;
[`assemble.ts`](../packages/math/src/wgsl/assemble.ts) writes them before that text, each once,
dependencies first:

```ts
const SHADER = wgslProgram(OWN_TEXT, [hashUnit, worldMatrix3])
```

- A fragment several programs share is a `wgslBlock`; its dependencies are the declarations and
  fragments it uses. A template interpolates parameters only (numbers, layout constants, binding
  indices, names), never another fragment's text.
- Names: a fragment is `X_WGSL` or `xWgsl(…)`; a spliced expression or statement is named otherwise
  (`FULLSCREEN_XY`, `CAMERA_FOG`).
- A factory `xWgsl(…)` taking a provider (a function the fragment calls) lists it; a program holding
  two of its variants is refused.
- Only a whole program calls `wgslProgram` (or `wgslModule`), which writes its directives
  (`enable …;`) first; a declaration spliced into a template as text throws when the module is read.
  A program others extend (`blendShader`) takes what it gains as a parameter.
- A function or constant the host provides (`vsmPoolLoad`, `INF`) is a declaration under that name,
  taken as a parameter and listed: a missing provider fails when the program is written; two
  providers of one name are refused. Parts of one program (the DAG selection's `DAG_*_WGSL`) list
  the shared declarations they call; the program lists every part.
- A name written twice with two texts, or a dependency cycle, throws when the pipeline is described.
  Two operation orders of one formula are two declarations.
- Numbers are written through [`wgslF32`](../packages/math/src/wgsl/number.ts). `wgslConst`
  declarations ([`constants.ts`](../packages/math/src/wgsl/constants.ts), from
  [`packages/math/src/constants.ts`](../packages/math/src/constants.ts)): π, π/4, 1/π, 2π, 1/(2π),
  √2, greatest finite and least normal `f32`, `FINITE_SENTINEL` (3.4e38, never the greatest `f32`),
  the golden ratio's fraction and angle, the plastic steps, the half-float bounds, the singularity
  threshold; shader sentinels, one per value and meaning (`INFINITE_THRESHOLD`, `FAR_VALUE`,
  `GOLDEN_U32`, `DIVISOR_FLOOR`, `RANGE_BOUND`).
- Integer spellings (`a+31u` or `a+32u-1u`, `/32u` or `>>5u`) are one declaration
  ([`integer.ts`](../packages/math/src/wgsl/integer.ts)).
- Checks: `library.test.ts` (headers, dependencies, no declaration file left out of the sweep);
  `packages/sdk-browser/src/gpu/core/engineShaders.test.ts` (no module-scope name declared twice);
  `wgslDeclarations.test.ts` (library declarations only as library text, no fragment spliced as
  text); `check:wgsl-library` (below).

### The gates

Three gates, each run in `check:changed` and the CI's `validate`:

- the lint (`no-restricted-syntax`, selectors of
  [`scripts/lint/lint-maths.ts`](../scripts/lint/lint-maths.ts)) refuses, outside `packages/math`:
  `Math.ceil(a / b)` (`ceilDiv`), a clamp from `Math.min` and `Math.max` (`clamp`,
  `clampLowWins`), `Math.hypot` (`length2`, `length3`, or a `hypot` declared above), a
  sixteen-element copy loop (`copyMatrix4`), `Math.PI` times or over a number, negated or after
  another factor (`HALF_PI`, `QUARTER_PI`, `TAU`, `DEG2RAD`, `RAD2DEG`, `perspectiveSlope`), and
  `2 ** Math.ceil(Math.log2(v))` (`nextPow2`);
- `check:helpers` reports a free function of any tree whose signature and body match a
  `packages/math` function, and a Rust function of another crate matching a `packages/math/rust`
  function, whatever the names;
- `check:wgsl-library` reports a shader whose text declares a function, constant or structure the
  WGSL library holds; a standalone `.wgsl` file a crate loads may hold one only as its twin.

Declared oracles (bench references, image metric reference, before-forms, tests, fixtures, GPU
proofs) keep their forms: list `MATHS_ORACLES` of the same file, read by all three gates. Kept as
written: a texel's centre (`+ 0.5`), an all-ones "none" word, a division guard with its own floor
(`max(x, 1e-6)`), a sign flip, an expression whose rounding differs from the shared function's.

## Batch math for hosts

A **batch** takes `n` elements in one call. Conventions:

- **Column-major 4×4 matrices** in sixteen consecutive numbers, `[12..14]` the translation.
- **Output first, allocation never.** A function writes into the `out` buffer it receives and
  returns it; one writing in place or filling several named buffers (`normalizeVector3`,
  `decomposeMatrix4`) returns nothing, and its row says so. `outAt`/`aAt` offsets let one buffer
  hold many operands. A batch returns a count as its only value and repeats the formula of its unit
  function, which stays the oracle. The clone check (`check:duplicates`) skips only regions marked
  `jscpd:ignore` (a loop or a batch's one-plane test, with its measurement beside it); a rewrite is
  proved against its before-form, then that is deleted.
- **`Float64Array` for what is computed**, `ArrayLike<number>` for what is only read (host matrix,
  plain array or `Float32Array` enters as-is); a batch writes flags into a `Uint8Array`.
- **Layout.** `MATRIX_VALUES` 16, `POSITION_VALUES` 3, `QUATERNION_VALUES` 4 (`x, y, z, w`),
  `SPHERE_VALUES` 4 (centre then radius) in `packages/math/src/batch/strides.ts`; `BOX_VALUES` 6
  (min x, y, z then max x, y, z) in `packages/math/src/geometry/box.ts`; `FRUSTUM_PLANE_VALUES` 24
  (six planes `a, b, c, d`, facing inward, in `frustumPlanesFromMatrix` order) in
  `packages/math/src/geometry/frustum/frustum.ts`. Matrices read one at a time travel as
  **sub-views** (`buffer.subarray(i * 16, (i + 1) * 16)`), built once at load, never per frame.

**Allocate once, reuse every frame.** Culling ten thousand boxes and bringing the survivors' centres
into view space is two calls (test: `batch.test.ts` in `packages/math/src/batch/`):

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
} from 'trillion3d'

const N = 10_000
// Allocated once, at scene load.
const boxes = new Float64Array(N * BOX_VALUES) // min x, y, z then max x, y, z, per box
const kept = new Uint8Array(N) // 1 where the frustum keeps the box
const spheres = new Float64Array(N * SPHERE_VALUES) // centre x, y, z then radius, per box
const centres = new Float64Array(N * POSITION_VALUES) // survivors' centres, packed
const viewCentres = new Float64Array(N * POSITION_VALUES) // the same, in view space
const frame = createCameraFrame()
const projection = new Float64Array(16)
const cameraWorld = Float64Array.from(IDENTITY_MATRIX4) // the host's, moved between frames

// Every frame: the frustum, one cull, the survivors packed, one transform.
perspectiveProjection(projection, 60, 16 / 9, 0.1, 1)
updateCameraFrame(frame, projection, cameraWorld, 100)
const visible = frustumKeepsBoxBatch(kept, frame.planes, boxes, N)
sphereFromBoundsBatch(spheres, boxes, N)
let m = 0
for (let i = 0; i < N; i++) {
  if (!kept[i]) continue
  const at = i * SPHERE_VALUES
  centres.set(spheres.subarray(at, at + POSITION_VALUES), m++ * POSITION_VALUES)
}
transformPointsBatch(viewCentres, frame.view, centres, m) // m === visible
```

**One path.** Batched box transforms and matrix products are WebAssembly kernels only
(`packages/page-codec-wasm/src/wasm/math.rs` over `packages/math/rust/src/matrix.rs` and
`box_transform.rs`), bit-identical to the single-element functions (`boxTransform`,
`multiplyMatrix4`). The engine runs them in its lots
(`packages/sdk-browser/src/geometry/decode/batchRuntime.ts`); no timing picks a path. A lot no longer
holding the elements asked (released, or of another size) is remade at their count. Each element
alone is the tests' and bench's oracle (`batchOracles.fixture.ts`).

### The Rust twins and their reference values

The Rust maths primitives live once in `packages/math/rust` (`trillion3d-math`, no dependency):
vectors, boxes, the 4×4 product in `f32` and `f64`, JavaScript's `Math.min`, `Math.max` and
`Math.hypot`, fdlibm's arc cosine and sine. The page codec and the compiler depend on it.
`packages/math/golden` holds the reference values every twin of a mirrored primitive (Rust,
TypeScript, WGSL) is tested against bit for bit: inputs and outputs written by their bits, one JSON
file per primitive (or per encoder and decoder, `oct.json`), one case per line. The owning crate
checks its files in one test (`packages/math/rust/src/golden.rs`); after a deliberate change of a
primitive, `pnpm run golden:write` rewrites them all.

- TypeScript reader: `packages/math/src/golden.fixture.ts` (`assertGolden`).
- TypeScript twins (`packages/math/src/`): `matrix4.golden.test.ts`, `hypot.golden.test.ts`,
  `trig.golden.test.ts`, `quaternion.golden.test.ts`, `reals.golden.test.ts` (`interpolation.json`:
  `lerp`, `mix`), `vector.golden.test.ts` (`vec3_unit.json`: `normalizeVector3`, normal band),
  `sphere.golden.test.ts` (`sphere_union.json`). No TypeScript twin, no golden (compiler only):
  `remap`, `unit_to_byte`, Euler composition, box growth, the triangle's closest point.
- No TypeScript page decoder: `decodeGeometryPage` calls the Rust one in the SDK module.
- Single numbers, `packages/math/golden`: `mip_size` (TypeScript and WGSL `mipSize`, through
  `mipSize.golden.test.ts` of `packages/sdk-browser/src/gpu/shader/`), `srgb_to_linear`,
  `hermite_basis`, `xorshift32`, `lcg32`; `preview_levels` (`previewLevels.golden.test.ts` of
  `packages/sdk-core/src/texture/`).
- WebAssembly twin: `packages/sdk-browser/src/geometry/decode/multiplyBatch.golden.test.ts`.
- The grid rule (`PageGrid::of`, positions in centimetres on cells of one precision) has no
  TypeScript twin and no golden: the run-time cut runs the Rust rule in the SDK module
  (`wasm/grid.rs`), tested in `packages/asset-compiler-rust/src/tests/geometry_page/grid.rs`.

### Unit functions

Locations: `packages/math/src/matrix/` (matrices), `packages/math/src/vector/` and
`packages/math/src/color/` (vectors, colours), `packages/math/src/projection/` (camera frame),
`packages/sdk-browser/src/camera/` (engine camera).

The engine ignores the host's clip-depth convention. It composes its own projection from the
declared optics (field, aspect, near plane, zoom) in **reversed depth with an infinite far plane**:
`near` projects to 1, infinity to 0 (`packages/sdk-browser/src/camera/depthConvention.ts`,
`engineCamera.ts`), for frustum planes, GPU view-projection, Hi-Z bounds and CPU visibility raster.
`far` is read for the shadow range only; nothing is culled for its distance. A perspective field is
read as at least 0.001°, a near plane not above zero as 0.1 m, and a camera whose world matrix has
no inverse (scale of zero) is drawn from the origin looking down −z.

#### Sides — `packages/sdk-browser/src/materials/surface/materialSide.ts`

| Function | Computes | Proof |
| - | - | - |
| `type Side = 'front' \| 'back' \| 'double'` | which faces of a surface are drawn | `materialSide.test.ts` |
| `sideOf(material)` | the `Side` a mesh's surface record declares; first of an array decides, empty array front | `materialSide.test.ts` |

### Batch functions

`packages/math/src/batch/`: `batch.ts`, with `culling.ts` and `points.ts`, and `composeMatrix4Batch`
in `packages/math/src/matrix/matrix4Compose.ts`.

| Function | Computes |
| - | - |
| `frustumKeepsBoxBatch(kept, planes, boxes, n)` | `kept[i]` 1 where `!frustumExcludesBox`, returns the count kept |
| `sphereFromBoundsBatch(out, boxes, n)` | four values per box, `sphereFromBounds` |
| `boxUnionBatch(into, boxes, n)` | `into ∪ boxes[0] ∪ … ∪ boxes[n − 1]`, `boxUnion` |
| `composeMatrix4Batch(out, positions, quaternions, scales, n)` | `T · R · S` per element, all flat or all sub-views |
| `transformPointsBatch(out, m, points, n)` | `n` points by one affine matrix, `transformAffinePoint` |
| `transformPointsByMatricesBatch(out, mats[], points, n)` | `n` points, one matrix each |
| `transformDirectionsBatch(out, m, dirs, n)` | upper 3×3 then normalize, `transformDirectionVector3` |
