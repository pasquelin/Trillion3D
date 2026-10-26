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
  call the package: a method whose body re-derives a formula calls the package; per-component
  arithmetic (`multiply`, `min`, `addScalar`) stays.

Its layout, under `packages/math/src/`: `float/` (`hypot`, `trig`, `splitDouble`, `half` — the
float16 encode and decode), `vector/` (with `spherical.ts`),
`quaternion/`, `matrix/` (with `matrixElements.ts`, the pose comparisons), `geometry/` (boxes,
spheres, slabs, triangles, `frustum/`), `projection/` (`camera.ts`, the camera frame, focal
and pixel scales; `renderOrigin.ts`; `clip.ts`, a clip window laid over a projection; `forwardZ.ts`, the
reversed-depth projections down +z of a light's shadow map; `projectionOracles.ts`), `color/`,
`scalar/` (`reals.ts`, `integers.ts`, `quantile.ts` — the nearest and floor ranks, the one median (the nearest rank at 0.5) and the mean;
`search.ts`, the binary searches; `hermite.ts`), `sequence/`
(`halton.ts`; `random.ts`, the seeded generators, twins of the Rust crate's `random.rs`;
`sweep.fixture.ts`, the Halton sweep and edge values every rewrite proof runs its old expression
against), `batch/` and `wgsl/` (below); `index.ts` is the
barrel `packages/sdk-core` re-exports, `wgsl/` left out of it. The transform tree
and the shader programs are not primitives and live in `sdk-core` and `sdk-browser`.

`scalar/`: counting and range helpers, and `uint64.ts`, the integer two little-endian
32-bit words hold; `constants.ts`: shared numbers.

### Lengths

One rule computes every length (`packages/math/src/vector/vector.ts`). `length3(x, y, z)` sums
the squares left to right — the order of WGSL's `length()` — and returns `Math.sqrt` of that sum
while it lies in the normal band, from 2^-969 up to the largest finite double: there, every square
that underflowed is below half an ulp of the sum, and the plain root holds the length the squares
define. Outside the band — a zero vector, components below about 1e-146 or past about 1e154 —
it returns `hypot3`, which scales first and neither overflows nor underflows; a NaN component
gives NaN. `length2(x, y)` is the same rule in the plane with `hypot2`, `lengthQuaternion` on
four terms with `hypot4`. A distance is that length of `a − b`, component by component
(`distanceVector3`; `distanceSqVector3` without the root); a matrix column's length is the length
of its three terms (`decomposeMatrix4`). A normalise multiplies each component by
`1 / (length || 1)`, so a zero vector stays zero; a vector shorter than 2^-1024, whose inverse
would overflow, is first scaled by 2^1000, exactly (`normalizeVector3`, `normalizeVector2`). So a
host axis, a wave direction or a light direction of 1e200 or 1e-170 normalises to a unit vector
(`vector/lengthRange.test.ts`). The rule and `Math.hypot` differ in the last bit on many inputs
of the band: a site moved from one to the other carries the proof that no 8-bit pixel moves. A
site moved from the plain root keeps its bits inside the band and, declared, gains the true
length outside it where the plain root gave 0 or Infinity: under `packages/sdk-browser/src/`, the
bounding-sphere radius of `scene/host/prepared/geometry.ts`, the lateral distance of
`geometry/selection/projection.fixture.ts`, a light's far distance in `session/world/lights.ts`, and the
light's horizontal axis in `vsmWorldToLightRotation` (`lighting/shadows/vsm/clipmap.ts`), which for a direction
within about 1e-146 of vertical follows the direction where the 0 snapped it to world Y
(`lightRotation.test.ts`).

The declared exceptions, each held to bits the rule would change:

- `hypot` where a twin fixes other bits or an answer needs its last bit: the `hypot`
  of `packages/math/rust/src/scalar/js.rs`, which the page codec's kernels call; `length`
  of `packages/sdk-core/src/world/animation/ik.ts`, where the bend of a straight chain out of
  reach depends on the last bit; `closes` of `packages/sdk-core/src/world/math/curves.ts`, an
  outline's closing point dropped at a gap under 1e-12, where the rule's root would decide a gap
  within an ulp of 1e-12 the other way and change the triangulation (`shapeClose.test.ts`);
  `spriteRow` of `packages/sdk-browser/src/session/world/poses/poses.ts`, where a uniform scale's two
  axis lengths must round alike; and the generator whose committed files hold the builtin's bits,
  the normals of `scripts/dev/fixtures/garden-source.ts` (`hypot3`).
- The plain root without the band, the twin of the Rust vectors (`packages/math/rust/src/vector/vec2.rs`,
  `vec3.rs`): `plainLength3` and `plainLength2` (`vector/vector.ts`), `Math.sqrt` of the three (two) squares
  summed left to right, the rule of every TypeScript twin of a Rust function; `clusterErrorAtDepth` and
  `clusterErrorPixels` of `packages/sdk-core/src/lod/screenErrorBound.ts` (`plainLength2`), pinned
  by `screenErrorBits.json`, whose row at a 1e308 depth pins the plain sum's Infinity; the gap of
  `sphereUnion` (`geometry/sphere.ts`), held to `merge_spheres` of `packages/math/rust/src/geometry/sphere.rs`
  past the band too (`sphereUnion.test.ts`).
- A division by the length to normalise, which keeps each component correctly rounded:
  `normalizeQuaternion`, whose Kahan sum of the four squares, `hypot4` outside `2^-900..2^900`
  and division are held to `normalize` of `packages/math/rust/src/quaternion.rs`, the animation
  sampler's twin; the bend axis of
  `ik.ts`, for the reason of its length; `normalized` of
  `packages/sdk-core/src/scene/light/validate.ts`, a light direction divided by its `hypot3`,
  because the validated direction feeds the shadow clipmap's own normalise and basis in double and
  the rule's product differs from that quotient in the last bit on about two directions in three.
  `writeDividedVector3` (`vector/vector.ts`) is that division's one owner for a uniform axis,
  `length3 || 1` then three quotients (the camera axes of
  `packages/sdk-browser/src/blend/uniforms.ts`). Sites that keep a form of their own, each held
  to its bits: `axisOf` of `lighting/ao/params.ts` (a flipped axis, `+ 0` on each quotient),
  `yawWalk` of `camera/controls/math.ts` and `toward` of `geometry/partition/sourceShape.ts`
  (two components, `length2`), `axisFor` of `geometry/partition/sourceRank.ts` (the reciprocal of
  a plain root over a floor), the tint step of `lighting/whiteBalance.ts` (two components), and
  `packages/sdk-core/src/modules/sky/lightShafts.ts` (a plain root, the input kept when it is not
  positive), all under `packages/sdk-browser/src/` but the last.

### Declared variants

One formula, one owner; where two forms of one quantity must both live, each has its own owner
and its own name, and the reason is the bits a file or a twin pins:

- The order-2 harmonics: `IRRADIANCE_TERMS` (`packages/sdk-core/src/scene/core/irradianceTerms.ts`)
  holds each term's 7-digit `basis`, unsigned, for the irradiance and the reflection lobes, and its
  `contract`, the 6-digit signed value of the sky light's projection and of the volumetric
  lightmap's file format (terms 1, 3, 5 and 7 negative). The sky light's `harmonicsBasis`
  (`modules/sky/skyLight/cubeWgsl.ts`) and the lightmap's decode scales
  (`lighting/volumetricLightmap/sampleWgsl.ts`) are emitted from it; the bake writes the same six
  digits in Rust (`packages/asset-compiler-rust/src/volumetric_lightmap/bake/accumulate.rs`), the
  file's other side. `contract` is written, not rounded from `basis`: `0.4886025` rounds to
  `0.488602` in double, the file holds `0.488603`.
- The octahedral decode by what `z` lacks, `e ± lack`, of the page codec: `unproject_unfolded`
  (`packages/math/rust/src/vector/octahedral.rs`, called by
  `packages/page-codec-wasm/src/bits/oct.rs`, pinned by `oct.json`) and its shader twin
  `octCellsDecode` (`wgsl/octahedral.ts`); `unproject` and `octDecode` fold instead, the last bits
  apart.
- The cofactor inverse with the plain reciprocal of the determinant, `inverse3` of
  `wgsl/matrix.ts` (the tessellation's prism solve), beside the processor's `inverse3`
  (`matrix/matrix3.ts`), which takes the singular rule of `adjugateFactor`; and `inverseRows`
  (`color/color.ts`), each cofactor divided by the determinant, rows as written, which builds
  `XYZ_TO_SRGB` once at load: the reciprocal of `inverse3` would move its bits.
- The quaternion's rotation row by row, `quaternionRows` (`wgsl/quaternion.ts`, the deformation
  banks), `2·(y·y + z·z)`, where `composeMatrix4At` takes the factor two on the vector first.
- The sRGB decode of the HLOD transfer, a table of `(v * (1 / 1.055) + 0.0521327)^2.4`, the reciprocal
  multiplied as the code does (the quotient differs in the last bit on many inputs),
  (`packages/asset-compiler-rust/src/hlod/flatten/simplify/transfer/colour.rs`), the flattened
  materials' own conversion, beside `srgb_to_linear` of `packages/math/rust/src/color.rs`; and the
  Rec. 709 weights `0.2126, 0.7152, 0.0722` of the bake report's tone gap
  (`hlod/flatten/bake/appearance.rs`), a measure, beside the primaries' luminance of the engine.
- The gradient noise of the horizon search is `interleavedGradientNoise` (`wgsl/sampling.ts`) at
  frame 0, its `dot` form.

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
splices is named otherwise (`FULLSCREEN_XY`, `CAMERA_FOG`). A factory `xWgsl(…)` that takes a
provider, a function the fragment calls, lists it, and the assembler refuses a program holding two
of its variants. Only a whole program calls `wgslProgram` (or `wgslModule`), which writes the
program's own directives (`enable …;`) first; a declaration spliced into a template as text throws
when the module is read. A program others extend — the blend module with the water's stage
(`blendShader`) — takes what it gains as a parameter and is assembled with it.

A function or constant a fragment calls but its host provides — `vsmPoolLoad` of the shadow-map
sampling, `INF` of the projected bound — is a declaration under that name, which the fragment takes
as a parameter and lists: a missing provider fails when the program is written, and two providers of
one name are refused, never left to the shader compiler: the error names the path through the
dependents by which each came and the first line where the two texts differ.
The parts of one program — the DAG selection's `DAG_*_WGSL` fragments, which call one another and
the structures of the program's own text — list the shared declarations they call, and the program
lists every part.

A name written twice with two texts, or a dependency cycle, throws when the pipeline is described:
the text is built once a pipeline, never in a frame. Two operation orders of one formula round
apart, so each is its own declaration under its own name, never merged. The library writes a number
through [`wgslF32`](../packages/math/src/wgsl/number.ts), the literal of the exact `f32` TypeScript
holds, the engine's one helper that writes a number as WGSL; π, π/4, 1/π, 2π, 1/(2π), √2, the
greatest finite and the least normal `f32`, the finite stand-in for infinity (`FINITE_SENTINEL`,
3.4e38, never the greatest `f32`), the golden ratio's fraction and angle, the plastic steps, the
half-float bounds and the singularity threshold are `wgslConst` declarations of
[`constants.ts`](../packages/math/src/wgsl/constants.ts), written from the values of
[`packages/math/src/constants.ts`](../packages/math/src/constants.ts), beside the shaders' own
sentinels, one per value and meaning (`INFINITE_THRESHOLD`, `FAR_VALUE`, `GOLDEN_U32`,
`DIVISOR_FLOOR`, `RANGE_BOUND`). An integer
expression rounds nothing: its spellings (`a+31u` or `a+32u-1u`, `/32u` or `>>5u`) are one
declaration ([`integer.ts`](../packages/math/src/wgsl/integer.ts)).
`library.test.ts` checks each declaration's header and dependencies, and its fixture refuses a
declaration file left out of the sweep; `packages/sdk-browser/src/gpu/core/engineShaders.test.ts`
finds no program declaring a module-scope name twice, whatever the texts,
`wgslDeclarations.test.ts` no program holding a library declaration but as the library's text and
no fragment spliced as text, and `check:wgsl-library` (below) no source declaring a library name.

### The gates

Three gates keep a formula in its one home; each runs in `check:changed` and in the CI's
`validate`:

- the lint (`no-restricted-syntax`, the selectors of
  [`scripts/lint/lint-maths.ts`](../scripts/lint/lint-maths.ts)) refuses, outside `packages/math`, the
  inline forms the package holds: `Math.ceil(a / b)` (`ceilDiv`), a clamp written with
  `Math.min` and `Math.max` (`clamp`, `clampLowWins`), `Math.hypot` (`length2`, `length3`, or a
  `hypot` declared above), a sixteen-element copy loop (`copyMatrix4`), `Math.PI` times or over a
  number, negated or after another factor (`HALF_PI`, `QUARTER_PI`, `TAU`, `DEG2RAD`, `RAD2DEG`,
  `perspectiveSlope`) and
  `2 ** Math.ceil(Math.log2(v))` (`nextPow2`);
- `check:helpers` reports a free function of any tree whose signature and body are those of a
  `packages/math` function, whatever its name and its parameters' names, and a Rust function of
  another crate whose signature and body are those of a `packages/math/rust` function, whatever
  its name;
- `check:wgsl-library` reports a shader whose text declares a function, a constant or a structure
  the WGSL library holds; a standalone `.wgsl` file a crate loads, which cannot list the library,
  may hold such a declaration only as its twin — the library's text, comments, layout and the
  spelling of an `f32` literal aside.

The declared oracles — the bench's reference implementations, the image metric's
reference, the before-forms a rewrite is proved against, and the test
modules, fixtures and GPU proofs, whose expectations are their own arithmetic — keep their forms on
purpose: the list is `MATHS_ORACLES` of the same file, read by all three gates.

Some spellings are conventions, not formulas, and stay where they are written: a texel's centre
(`+ 0.5`), an all-ones "none" word, a division guard whose floor belongs to its site (`max(x, 1e-6)`:
one shared floor would move pixels), a sign flip, and an
expression whose rounding differs from the shared function's (it keeps its form, as the Lengths
section does for its own).

## Batch math for hosts

A host moving ten thousand instances or culling ten thousand boxes would otherwise loop, one object
per call and a temporary per step; a **batch** takes `n` elements in one call. Every function, unit
or batch, follows these conventions:

- **Column-major 4×4 matrices** in sixteen consecutive numbers, `[12..14]` the translation.
- **Output first, allocation never.** A function writes into the `out` buffer it receives and
  returns it; one that writes in place or fills several named buffers — `normalizeVector3`,
  `decomposeMatrix4` — returns nothing, and its row says so. A call on a per-frame path allocates
  nothing. `outAt`/`aAt` offsets let one large buffer hold many operands. A batch returns a count
  as its only value and repeats the formula of its unit function, which stays the oracle. The clone check
  (`check:duplicates`) skips only the regions marked `jscpd:ignore`, each one a loop, or a batch's
  one-plane test, that keeps its values in registers, with its measurement beside it; a rewrite is proved against its
  before-form while it lands, and the before-form is deleted with that proof.
- **`Float64Array` for what is computed**, `ArrayLike<number>` for what is only read: a host
  matrix, a plain array or a `Float32Array` enters as-is; a batch writes flags into a `Uint8Array`.
- **Layout.** One element occupies a fixed number of consecutive values, each declared once:
  `MATRIX_VALUES` 16, `POSITION_VALUES` 3, `QUATERNION_VALUES` 4 (`x, y, z, w`), `SPHERE_VALUES` 4
  (centre then radius) in
  `packages/math/src/batch/strides.ts`; `BOX_VALUES` 6 (min x, y, z then max x, y, z) in
  `packages/math/src/geometry/box.ts`; `FRUSTUM_PLANE_VALUES` 24 (six planes
  `a, b, c, d`, facing inward, in the order of `frustumPlanesFromMatrix`) in
  `packages/math/src/geometry/frustum/frustum.ts`. Matrices read one at a time travel as
  **sub-views** of sixteen numbers (`buffer.subarray(i * 16, (i + 1) * 16)`), built once at load,
  never per frame: `multiplyMatrix4` reads its operands at constant indices.

**Allocate once, reuse every frame.** Culling ten thousand boxes and bringing the survivors' centres
into view space is two calls (the batches' test is `batch.test.ts` in
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

**One path.** Boxes moved by their matrices and matrix products in batches are WebAssembly kernels
alone (`packages/page-codec-wasm/src/wasm/math.rs` over `packages/math/rust/src/matrix.rs` and
`box_transform.rs`), bit-identical to the single-element functions (`boxTransform`,
`multiplyMatrix4`). The engine runs them in its lots
(`packages/sdk-browser/src/geometry/decode/batchRuntime.ts`): no timing picks a path, so two plays
of one scene compute the same bits by the same code. A lot that no longer holds the elements asked —
released, or of another size — is remade at their count, and a run covers the elements written
alone, so a lot of every root moves the few that moved at their cost. Each element taken alone is the
tests' and the bench's oracle (`batchOracles.fixture.ts`); no engine loop and no public batch beside
the kernels.

### The Rust twins and their reference values

The Rust maths primitives live once in `packages/math/rust` (`trillion3d-math`, no dependency):
vectors, boxes, the 4×4 product in `f32` and `f64`, JavaScript's `Math.min`, `Math.max` and
`Math.hypot`, fdlibm's arc cosine and sine. The page codec (and through it the WebAssembly kernels)
and the compiler both depend on it and keep no copy. `packages/math/golden` holds the reference
values every twin of a mirrored primitive — Rust, TypeScript, WGSL — is tested against bit for bit:
the inputs and outputs of each case written by their bits, one JSON file per primitive, or per
encoder and its decoder with their round trip (`oct.json`), one case per line
(Prettier leaves the folder alone). The crate that owns a twin checks its files in one test
(`packages/math/rust/src/golden.rs`); after a deliberate change of a primitive, `pnpm run
golden:write` rewrites them all, the command each file names.

- TypeScript reader: `packages/math/src/golden.fixture.ts` (`assertGolden`).
- TypeScript twins: `matrix4.golden.test.ts`, `hypot.golden.test.ts`, `trig.golden.test.ts`,
  `quaternion.golden.test.ts`, `reals.golden.test.ts` (`interpolation.json`: `lerp`, `mix`),
  `vector.golden.test.ts` (`vec3_unit.json`: `normalizeVector3`, in the normal band),
  `sphere.golden.test.ts` (`sphere_union.json`) (`packages/math/src/`). The remaining Rust
  primitives (`remap`, `unit_to_byte`, Euler composition, box growth, the triangle's closest point)
  have no TypeScript twin: the compiler alone uses them, so no golden holds them.
- The page decoder has no TypeScript twin: `decodeGeometryPage` calls the Rust one in the SDK module.
- Single numbers, `packages/math/golden`: `mip_size` (TypeScript `mipSize`, WGSL `mipSize` through `mipSize.golden.test.ts` of `packages/sdk-browser/src/gpu/shader/`), `srgb_to_linear`, `hermite_basis`, `xorshift32`, `lcg32`; `preview_levels` (`previewLevels.golden.test.ts` of `packages/sdk-core/src/texture/`).
- WebAssembly twin: `packages/sdk-browser/src/geometry/decode/multiplyBatch.golden.test.ts`.
- The grid rule (`PageGrid::of`, positions in centimetres on cells of one precision) has no
  TypeScript twin and no golden: the run-time cut runs the Rust rule in the SDK module
  (`wasm/grid.rs`), the one the compiler runs, tested where it lives
  (`packages/asset-compiler-rust/src/tests/geometry_page/grid.rs`).

### Unit functions

The functions live in `packages/math/src/matrix/` (matrices), `packages/math/src/vector/` and
`packages/math/src/color/` (vectors, colours), `packages/math/src/projection/` (camera frame) and
`packages/sdk-browser/src/camera/` (the engine camera).

The engine does not read the host's clip-depth convention. It composes its own projection from the
declared optics — field, aspect, near plane, zoom — in **reversed depth with an infinite far
plane**: `near` projects to 1, infinity to 0 (`packages/sdk-browser/src/camera/depthConvention.ts`,
`engineCamera.ts` beside it), one convention for the frustum planes, the GPU's view-projection, the
Hi-Z bounds and the CPU visibility raster. `far` is still read for the shadow
range, never for the frustum: a perspective view has no far plane, so nothing is culled for its
distance alone. A perspective field is read as at least 0.001°, a near plane not above zero as 0.1 m,
and a camera whose world matrix has no inverse (a scale of zero) is drawn from the origin looking down −z.

#### Sides — `packages/sdk-browser/src/materials/surface/materialSide.ts`

| Function                                    | Computes                                                                                               | Proof                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| `type Side = 'front' \| 'back' \| 'double'` | which faces of a surface are drawn; every raster, pipeline and blend-plan decision compares against it | `materialSide.test.ts` |
| `sideOf(material)`                          | the `Side` a mesh's surface record declares, the first of an array deciding, an empty array front      | `materialSide.test.ts` |

### Batch functions

`packages/math/src/batch/`: `batch.ts`, with `culling.ts` and `points.ts` beside it,
and `composeMatrix4Batch` in `packages/math/src/matrix/matrix4Compose.ts`.

| Function                                                      | Computes                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| `frustumKeepsBoxBatch(kept, planes, boxes, n)`                | `kept[i]` 1 where `!frustumExcludesBox`, returns the count kept |
| `sphereFromBoundsBatch(out, boxes, n)`                        | four values per box, `sphereFromBounds`                         |
| `boxUnionBatch(into, boxes, n)`                               | `into ∪ boxes[0] ∪ … ∪ boxes[n − 1]`, `boxUnion`                |
| `composeMatrix4Batch(out, positions, quaternions, scales, n)` | `T · R · S` per element, all flat or all sub-views              |
| `transformPointsBatch(out, m, points, n)`                     | `n` points by one affine matrix, `transformAffinePoint`         |
| `transformPointsByMatricesBatch(out, mats[], points, n)`      | `n` points, one matrix each                                     |
| `transformDirectionsBatch(out, m, dirs, n)`                   | upper 3×3 then normalize, `transformDirectionVector3`           |
