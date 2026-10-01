# Source format coverage — #356

This change adds bounded source readers to the existing compiler and repairs FBX
lights, material variants and image selection through that same pipeline. It does
not introduce a second cache, scene-table format or runtime geometry loader.

**Final native validation and `check:changed` passed.** The native gate finished
with exit 0; release measurements below are recorded separately.
Unsupported subformats and rendering constructs are refused or documented at the
reader boundary; the list of extensions does not promise universal format support.

## Scope and detailed evidence

| Area | Implemented scope and detailed report |
|---|---|
| PLY, STL, COLLADA, 3MF, 3DS, KMZ, IFC4 | [Surface readers](source-formats-356-surfaces.md): attribute/material identity, units, supported static scenes and shared geometry, guarded package dependencies; explicit geometry/shading limits, including a bounded IFC mesh/extrusion subset |
| AMF, LDraw/MPD, VRML97 | [Assembly and line readers](source-formats-356-amf-ldraw-vrml.md): materials, hierarchy, instances, transforms and source line semantics; real runtime line geometry and LDraw conditional visibility |
| FBX lights, VOX, Rhino 3DM | [Lights, voxel and Rhino mesh scenes](source-formats-356-rhino-vox-fbx.md): editable imported lamp identity and spot angles; static voxel palette/scenes; strict mesh-only Rhino decoding with authored attributes and reflected instances |
| AVIF, G-code and shared line admission | [Independent review](source-formats-356-avif-gcode.md): primary-image colour interpretation, consistent extension-image selection, bounded modal toolpaths and native line validation |

KHR_materials_variants additionally preserves the default material and named
alternate primitive bindings through native tables and prepared materials. Runtime
selection uses the same material construction and edit paths as ordinary surfaces;
variant identity does not depend on unique display names. The authored fixture is
`tests/fixtures/formats/gltf-material-variants/variants.gltf`; native and runtime
regressions cover alternate bindings and invalid references. Its release compile
measurement is included in the completed release timing batch below.

## Boundaries and identity

Readers retain source material ranks and stable object identities within their
supported domain. Geometry instances remain distinct placements with shared data
where their geometry/material binding agrees. Line records remain lines, not
invented triangles. Native coordinate/unit conversions and transparency conventions
are specified in the detailed reports. Source textures and package dependencies use
the existing image route and guarded local-file resolution.

The source-file size, decoded allocations and work estimates use the caller's RAM
budget, with cancellation at documented boundaries. These checks do not promise a
hard process RSS ceiling. Rhino's upstream decoder has no cancellation callback
inside its internal bounded decode; its adapter checks before/after that stage.

Rhino support is for mesh scenes, not a general NURBS/BRep tessellator. It refuses
active unsupported optics rather than silently approximating them. The pinned
Apache-2.0 reader has one vendored source correction for the CRC coverage of an
instance-definition wrapper; nested and parent corruption remain refused. See
[patch provenance](../../packages/asset-compiler-rust/vendor/cadmpeg-codec-rhino/PATCH.md)
and [third-party notices](../../THIRD_PARTY_NOTICES.md). The native implementation
fingerprint includes vendored source and manifest changes, preventing stale-cache
reuse after changes to this decoder.

The compiler's historical JSON parsing feature domain is separately isolated from
cadmpeg's `float_roundtrip` feature. Both parser source implementations are
unchanged; the packaging separation preserves legacy Maya/Unity golden bits and
Rhino's precise native metadata without weakening either contract. See
[JSON feature isolation](../../packages/asset-compiler-rust/vendor/serde-json-legacy/PATCH.md).

## Verification status

| Evidence | Status |
|---|---|
| FBX lights: native import and actual compiled-cache runtime identity | Passed focused checks; 2 native and 9 model-light/node tests recorded |
| VOX reader plus public cooked-scene/cache integration | 12 passed, 0 failed or ignored; included in final native release gate |
| Rhino reader, attributes, optical refusals, parent/child corruption and cooked-scene/cache integration | 7 passed, 0 failed or ignored; included in final native release gate |
| LDraw actual native-cache runtime loading, conditional lines and mixed deferred triangles | 2 integration tests passed, 0 skipped; detailed report records the check |
| Format prevalidation after JSON feature isolation | 127 passed, 0 failed, 8 ignored fixture generators; original Maya/Unity goldens unchanged; AVIF header and six Rhino reader tests also pass |
| `pnpm validate --group native` | Exit 0: 839 passed overall, 0 failed; 822 library tests plus 17 main/CLI tests; 14 ignored: 13 fixture generators and one external Sponza case; library run 374.48 s |
| SDK build (`pnpm run build`) | Passed after runtime line-colour corrections; declarations, resources and bundles emitted |
| Unused-code and documentation-link checks | Passed; 1,034 local documentation links checked, no errors |
| Final `pnpm check:changed` gate | Exit 0: 768 tests passed, 0 skipped; TypeScript, format and duplication checks passed |
| Release measurements for Rhino, VOX, FBX and glTF variants | Five cold/warm pairs: 10/10 processes exit 0, product identity stable; raw timings linked below |

The issue names `test:changed`, but this revision has no such package script.
`check:changed` selects and runs affected unit tests itself, in addition to its
format, lint, types, duplication and Rust checks. Its test totals are the proof
for that requested affected-test gate; no nonexistent command is claimed to pass.

No browser screenshot or GPU image equivalence is inferred from these results.
Browser evidence follows the repository's recette process. Tiny fixture timings
are correctness observations and overhead measurements, not throughput benchmarks.

## Measurements and reproduction

The [surface release measurements](source-formats-356-timings.json) and
[assembly/line debug measurements](source-formats-356-adapter-timings.json) record
binary/fixture hashes, exact commands, wall time and per-child memory usage. The
assembly/line debug batch predates the final release build; its release results
are recorded in the 14-format batch below.
Final release measurements are in the
[14-format batch](source-formats-356-final-timings.json) and the
[Rhino/VOX/FBX/variant batch](source-formats-356-rhino-vox-fbx-timings.json).
Both use CLI SHA-256
`82ee39079e17a8cc7737a93cdfdd26c38050b5eb79227e9629e729c1d6ce2057`.
The latter contains five fresh-cache compiles and five warm reuse checks, all
exit 0 with stable product identity. It uses one worker and a 64 MiB admission
budget; OS filesystem caches are not flushed. Cold wall times range from
6.46 to 28.12 ms, with 16,192–22,980 KiB child peak RSS. Warm wall times range
from 4.69 to 8.68 ms. Child usage comes from Linux `wait4`. Exact commands,
source/cooked counts and hashes remain in the raw records; these tiny samples
are overhead observations, not throughput comparisons or memory guarantees.


From the configured repository toolchain, the shared native gate is:

```sh
CMAKE_BUILD_PARALLEL_LEVEL=2 pnpm validate --group native
```

Reader regressions can be selected with the native commands in each detailed
report. Runtime witnesses use the real compiler output, including:

```sh
node --test tests/integration/ldraw-lines.test.ts
node --test packages/sdk-browser/src/world/core/modelLights.test.ts packages/sdk-browser/src/world/core/modelNodes.test.ts
```
