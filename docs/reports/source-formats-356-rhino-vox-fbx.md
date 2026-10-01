# Source formats #356: FBX lights, VOX and Rhino mesh scenes

This report covers three parts of #356. Completion of these parts alone does not
claim completion of the whole issue. Each uses the existing native scene pipeline,
its material tables, cooked output and cache identity.

## FBX light corrections

Existing ufbx import now excludes light nodes with `Visibility=0` or `CastLight=0`.
FBX full spot openings become glTF half angles: the fixture's 20°/60° becomes
10°/30°, and its cooked outer cone is π/6. Model lookup returns the actual carried
Light for the imported lamp ID, preserving identity and independent edits.

The authored ASCII FBX7400 fixture `import-fbx/lights.fbx` (3,520 bytes) includes a
translated/rotated parent, two occurrences of one point-light attribute, spot,
sun, disabled and hidden lights, plus a triangle. Tests check positions, directions,
colours, shadow flag, radiometry, canonical light tables and repeatable identity.
An actual compiled-cache load additionally verified four editable lamps and a
moved/rotated spot at [-20,12,33] pointing +X with cone π/6.

Scope: this adds no light animation binding. Imported lamp poses follow the model;
runtime inner-edge behaviour remains the existing documented engine setting.
No new ancestor-visibility inheritance or browser image result is claimed.

## MagicaVoxel 150/200

The reader handles SIZE/XYZI/RGBA/MATL/PACK and static nTRN/nGRP/nSHP/LAYR scenes.
Palette slots retain distinct identity even when colours match. Geometry uses
indexed cube surfaces; a neighbour face is removed only when both materials are
opaque and non-transmissive. Glass/alpha interfaces retain their boundaries.

Names, signed-axis transforms, hierarchy, hidden layers and shared meshes survive.
One voxel is one world unit, SIZE boxes are centred on their pivots, and a root
converts Z-up to Y-up. MATL diffuse/metal/glass/emission properties are represented;
unmapped optical properties remain in extras and diagnostics. This is not a claim
to reproduce MagicaVoxel's complete optical renderer.

Animated frame sets, MATT, IMAP and nested non-MAIN chunks are refused. Unknown
metadata chunks are reported. Malformed sizes, duplicate coordinates/IDs, graph
cycles, missing references and multiple parents are rejected. Admission includes
cumulative voxel output, nodes, references, dictionaries and copied strings;
cancellation is polled during chunks and voxel processing. These estimates are not
an OS resident-memory cap.

The authored binary fixtures `vox/default.vox` (64 bytes) and `scene.vox`
(1,747 bytes) follow the published MagicaVoxel grammar and scene extensions.
They include default palette values, adjacent differently coloured voxels,
metal/emission, shared instances, parent transforms and a hidden layer.

## Rhino 3DM mesh scenes

The pinned Apache-2.0 cadmpeg 0.5.5 decoder runs in strict mode. The adapter supports
standalone mesh geometry, positions, normals, UVs, vertex colours, authored material
indices, hidden objects and transformed/reflected instances. Instances share local
mesh data when their effective material matches. Native UUIDs and occurrence paths
remain in extras. Occurrences are flattened into placed leaves, not independently
editable nested block groups. Native millimetres become metres with a Z-up conversion.

Assigned textures, non-vertex/unknown mesh channels, face texture assignments,
corner normals, lights/external references and exact BRep/surface/curve/point/SubD
carriers are refused. It does not tessellate exact CAD geometry. Curvature, surface
parameters and original n-gon grouping do not change the emitted triangulated
surface. Simple matte/emissive material properties and their native identity are retained,
including the original record in extras. Active glossy, reflective, refractive or
ambient legacy properties and advanced PBR materials are explicitly refused;
no unsupported optical lobe is silently approximated.

Decode policy limits input, expansion, retained/materialized bytes, entities,
collections, recursion and work. Adapter admission additionally estimates metadata
and output geometry. Cancellation is checked before/after decoding and in adapter
loops; the upstream decode API has no cancellation callback during its internal
work. Budget checks do not claim a strict process RSS cap or instantaneous abort.

The seven `.3dm` fixtures were authored here with the independent official McNeel
`rhino3dm==8.17.0` encoder. `tests/fixtures/formats/rhino/generate.py` records their
construction. Meshes cover two authored materials and hidden objects; instances
cover shared geometry, translations and reflection; attributes cover UV/colour/
normal channels; an untessellated sphere must be refused. No external artwork is
included; fixtures are under the repository licence. Three additional files with
active gloss, transparency and PBR clearcoat exercise named material refusals.

### Strict checksum fix

The vendored codec differs by one production match arm: instance-definition
records join other wrapper records whose checksum covers only direct bytes.
OpenNURBS writes a nested object in that wrapper, and updates CRC only on the
current chunk; the parent's empty direct payload therefore has CRC zero. Hashing
all child bytes falsely rejected the independently encoded valid fixture.

`vendor/cadmpeg-codec-rhino/PATCH.md` records provenance and the source reference.
Strict mode remains enabled. The adapter also rejects the codec diagnostic
`container.instance-definition-degraded`: upstream treats it as tolerable even
when it reports a damaged nested checksum. Regression tests cover a valid archive and corrupted
parent checksum, nested checksum and nested UUID payload. No checksum is rewritten
to make a fixture pass.

### JSON feature isolation

Adding cadmpeg also enabled serde_json's `float_roundtrip` feature transitively.
Independent linkage witnesses confirmed that this changed old decimal parsing by
one bit in unrelated Maya/Unity imports; their original golden assertions caught
the change. The compiler's existing serde_json feature domain is now isolated
under a distinct vendored package name. Its parser sources are unchanged, while
cadmpeg retains upstream precise parsing. See
[provenance and exact packaging delta](../../packages/asset-compiler-rust/vendor/serde-json-legacy/PATCH.md).
The original Maya/Unity references are not altered. Debug prevalidation passes
127 format tests (0 failed, 8 ignored fixture generators), the image-header test
and all six Rhino reader tests. This includes Maya/Unity and cooked Rhino output;
the final shared release gate also passes (839 tests, 0 failures; 13 manual fixture generators and one external Sponza case ignored).

## Verification

| Check | Observed result |
|---|---|
| FBX native light tests | 2 pass; original implementation failed |
| Model light identity + existing model-node tests | 9 pass; identity regression failed before correction |
| Actual freshly compiled FBX cache loaded through `loadModel` | Pass, four lights and transformed spot checked |
| VOX reader cases | 11 pass in shared native run |
| Existing reflection/raster normal-path tests | 9 pass |
| Public VOX cooked-scene/cache integration | Pass; 12/12 VOX tests together, 0.20 s |
| Rhino meshes, attributes and refusal cases | Pass, including real glossy/glass/PBR refusal fixtures |
| Rhino block instances and strict corruption regressions with local codec patch | Pass, including parent and child CRC/payload corruption |
| Public Rhino cooked-scene/cache integration | Pass; 7/7 Rhino tests together, 0.03 s |
| Final native gate | Exit 0: 822 library + 17 main/CLI tests pass; 0 failures; 13 manual fixture generators and one external Sponza case ignored |
| Final affected-change gate | Exit 0: 768 tests pass, 0 skipped; types/format/duplication and documentation links pass |

The final debug Rhino invocation rebuilt in 48.43 s; its seven tests took 0.03 s.
The freshly built same test executable ran twelve VOX tests in 0.20 s. These are
observed local test-run timings, not import throughput benchmarks.

No browser screenshot, GPU image comparison or performance claim is inferred from
these unit/integration results. Local diagnostic logs are not required to reproduce
the maintained tests.

From the repository root, with the documented native toolchain and NASM available:

```sh
CMAKE_BUILD_PARALLEL_LEVEL=2 cargo test --manifest-path packages/asset-compiler-rust/Cargo.toml --locked --all-features --lib -j2 fbx_lights
CMAKE_BUILD_PARALLEL_LEVEL=2 cargo test --manifest-path packages/asset-compiler-rust/Cargo.toml --locked --all-features --lib -j2 vox
CMAKE_BUILD_PARALLEL_LEVEL=2 cargo test --manifest-path packages/asset-compiler-rust/Cargo.toml --locked --all-features --lib -j2 rhino
node --test packages/sdk-browser/src/world/core/modelLights.test.ts packages/sdk-browser/src/world/core/modelNodes.test.ts
```

## Final release measurements

All five fixtures compiled successfully with fresh application caches and then
reused the same product key on a warm invocation: 10/10 processes exited 0.
CLI SHA-256: `82ee39079e17a8cc7737a93cdfdd26c38050b5eb79227e9629e729c1d6ce2057`.
Each process uses one worker and a 64 MiB admission budget, with no simplification
or texture conversion. Runs follow the other format batch sequentially; filesystem
caches are not flushed. `wait4` supplies each child's peak RSS.

| Fixture | Placed triangles | Source / cooked materials | Cold wall | Warm wall | Cold / warm peak RSS |
|---|---:|---:|---:|---:|---:|
| rhino-meshes | 2 | 2 / 2 | 9.17 ms | 8.68 ms | 20,176 / 18,472 KiB |
| rhino-instances | 2 | 1 / 1 | 14.77 ms | 6.35 ms | 22,556 / 18,824 KiB |
| vox | 60 | 2 / 2 | 28.12 ms | 6.34 ms | 22,980 / 14,380 KiB |
| fbx-lights | 1 | 0 / 1 | 9.11 ms | 4.85 ms | 16,444 / 13,904 KiB |
| gltf-material-variants | 1 | 3 / 3 | 6.46 ms | 4.69 ms | 16,192 / 13,808 KiB |

Rhino instances retain one shared source mesh and two placements. VOX retains one
20-triangle source mesh with three placements, two authored materials and the
hidden node record. The FBX fixture has no authored material: its one cooked
material is the normal default binding, not an added source identity. The glTF
variant fixture retains all three materials and both separately indexed `paint`
names. These tiny fixtures measure compile/cache overhead, not scene throughput.
Warm CLI phase metrics may describe the cached product; only the separately
observed wall time and child RSS measure that warm process.

[Raw commands, fixture/binary hashes, counts and measurements](source-formats-356-rhino-vox-fbx-timings.json)
record every invocation. The production implementation remained frozen for this batch.
