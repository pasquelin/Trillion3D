# Compilateur — native compiler/import handoff

Confirm title with `get_session("self")`; refresh `list_sessions` before messaging (IDs change). Follow `AGENTS.md`.

## Workflow

- Fable leads, neither codes nor reads code. One Opus 5, one batch at a time; isolated worktree, `compilateur/lot-<letter>-<subject>` from develop. Sonnet 5: docs/reviews/tests. Brief replies. Continue delivery → Validateur → next batch; go required only for plan changes/irreversible deletion.
- Reproduce in a test first; fix generically by property; correct goldens that encode wrong output; visual proof for rendering changes. Count unconverted features using named codes in `docs/COMPILER.md`. Driver output changes require `version()` bumps.
- Gates: `fmt --check`, `clippy -D warnings`, `cargo test --locked`, `check:lines`, `check:duplicates`, `check:changed`, prohibited-name scan. Temporarily link worktree `node_modules`, remove afterward. Run cargo directly with `DEVELOPER_DIR=/Library/Developer/CommandLineTools`. CC0 `test-assets/` is read-only. Never push, stash, run full validate or merge develop.
- Deliver head SHA, merge-base, named reproduction tests, gate results, added report codes, changed driver versions/goldens, remaining work. Validateur merges/simplifies/validates/pushes; then remove batch worktree/branch.
- Status: 11 scene + 12 image drivers merged (`packages/asset-compiler-rust/FORMATS.md`). Go required: GPU-preserved DDS/KTX2 blocks, Draco/meshopt input, Industrial Map on bench 15, FAB license.

## Driver audit — 2026-09-15, f6ac76f

58 findings. Read-only audit: 268 library + 4 CLI tests pass; 48 images decoded; **no browser proof**. Temporary reproductions: `/tmp/wg-plugin-audit`, `/tmp/wg-scenes-audit`, `/tmp/wg-plugin-usd-audit`, `/tmp/wg-plugin-unity-audit`; recreate as tests. P1: scene corruption, nondeterminism or process termination; P2: fidelity, robustness, resources, diagnostics. Passing tests/goldens may encode bugs.

User order: scene fidelity/OBJ cache, crashes, remaining families; one batch at a time. Paths below are audit locations, not freshly verified.

## Batches

- A OBJ cache/MTL: 1,2 + MTL audit; **merged 2df0b9f** (46d0d61), obj/fbx `-gltf-5`, 9 codes, OBJ golden. Remaining: `-o`/`-s` counted, `-clamp` lacks browser proof, `encode_relative` wired only in the ufbx import — `blend/images.rs:59-92`, `ma/texture.rs:60`, `usd/texture.rs:61`, `unity/textures.rs:54` still write the raw URI (batch H or J), simplify's `texture_ref` untested. Scope `import/{runner,textures,materials}.rs`, `src/uri.rs`.
- B concave n-gons: **merged** (31abb0d), shared `plugins/scene/ngon.rs` (ear clipping in the Newell plane) for ma/blend/alembic/usd, four `*-ngon-untriangulable` codes, driver versions `-gltf-2`, goldens changed by version string only. Remaining: no browser proof; faces with holes still `ma-face-hole-unsupported`.
- C USD fidelity: **merged** (5fb7a38), 35,36,37,38,40,41; `usd-openusd-0.7.0-gltf-3`, codes `usd-opacity-texture-unsupported`, `usd-texture-channel-unsupported`; goldens changed by version string only. Remaining for J: 39,42–46; `usd/texture.rs` still writes the raw URI.
- D' fixes on merged batches: **merged** (4c31066f). COMP-01 ngon closed-triangle test, COMP-02 external-import record keyed by resolving directory, COMP-03 only `outputs:a` carries opacity (else `usd-texture-channel-unsupported`); all three reproduced first. Versions ma/alembic/blend `-gltf-3`, usd `-gltf-4`; goldens by version string only. Remaining: old `imports-externes/<base>.json` records in an existing cache are orphaned, never read.
- D Unity fidelity: **merged** (69a79fa), 29,30,32,31; `unity-yaml-rust2-0.13-gltf-3`, codes `unity-model-hierarchy-invalid`, `unity-prefab-override-unplaced`; goldens: version string, four `-0.0` → `0.0`. Remaining: 33,34,47–52 (J); earlier `unity-*` codes undocumented; an override aimed at an object inside a model is counted, not applied.
- E Maya fidelity: **merged** (4b7e1c1), 10,11,12,13; `ma-mel-subset-1-gltf-4`, codes `ma-name-ambiguous`, `ma-face-material-missing`, `ma-shape-intermediate`, `ma-matrix-unsupported` (`ma-shear-unsupported` removed, shear composed); golden: version and `rule` prose only. Remaining: `joint` nodes not traversed (`jointOrient`, `segmentScaleCompensate` untouched); an ambiguous short name yields the first node written.
- F Blend fidelity: **merged** (3b755ba1), 14,15,16,17,18; `blend-…-gltf-4`, codes `blend-object-outside-scene`, `blend-surface-node-unsupported`, `blend-alpha-texture-unsupported`, `blend-texture-channel-unsupported`; golden regenerated: `Transparent` alpha 0.4 → 1.0 (image already carried the opacity, factor multiplied it twice). Remaining: no browser proof of the V flip (changes every texture imported from a `.blend`); MASK branch for files < 4.2 proven on a patched SDNA only.
- G crashes/bounds: **merged** (de5d47d5), 23,24,28,7,25,27; codes `unity-prefab-material-slot-invalid`, `image-too-large`; no driver reversioned, no golden touched (refusal boundaries only). Remaining: no end-to-end reproduction of the ma cancel-inside-a-mesh site (fix in place, shared helper proven on blend and alembic).
- H routing/archives: **merged** (5be10b35), 3,4,5,6,26 + escaped image URIs in blend/ma/usd/unity (batch A closed); codes `USDZ_ROOT_LAYER_MISSING`, `alembic-archive-unfrozen`, `alembic-version-unsupported`; versions blend/ma/usd `-gltf-5`, unity `-gltf-4`; goldens by version string, plus usdz fixture `deux-scenes.usdz` rewritten (root layer first). Ogawa version read big-endian (proven on the four `.abc` of the repo). Remaining: nested `.usdz` inside `.usdz` not handled; unitypackage inflates its stream twice.
- I image fidelity: **merged** (56f3e4bd), 8,53–58; contract `image-plugin-3` (`ImageDecoded { image, transfer, notes }`), codes `image-animation-first-frame`, `psd-alpha-channel-ignored`, `psd-layers-flattened`, `ktx2-orientation-unsupported`, `ktx2-swizzle-unsupported`, `image-icc-profile-ignored`; own EAC R11/RG11 decoder (`ktx2/eac.rs`: texture2ddecoder 0.1.2 truncated and shuffled texels). Goldens: exr (associated alpha now straight) and psd (4th plane no longer transparency) corrected; previews gain `notes`. Remaining: no ICC conversion; swizzle and other orientations counted only; sRGB profile recognised by name; no browser proof.
- J partial properties: **in progress** on `compilateur/lot-j-proprietes` (worktree `.claude/worktrees/lot-j-proprietes`), three passes. J1 ma/blend **merged** (9f39aff8): 19,20,21,22; shared `plugins/scene/normals.rs` (corner normals with hard edges), codes `ma-bump-height-unsupported`, `ma-bump-object-space-unsupported`, `ma-texture-transform-unsupported`, `ma-texture-mirror-unsupported`, `ma-normals-computed`; ma/blend `-gltf-6`; ma golden `wrapT` 33071 → 10497 (only `wrapU no` declared). Remaining: blend attribute layout only (4.4+); `KHR_texture_transform` never written. J2 unity **next**: 33,34,47–52. J3 usd: 39,42–46.

## Findings (ID, priority, defect, location, evidence)

1. P1 OBJ cache omits MTL — `import/runner.rs:25`, `import/scene.rs:44`; changed MTL returns unchanged cached output.
2. P2 OBJ/FBX emit raw paths, not URIs — `import/textures.rs:99`, `texture_preview/source.rs:55`; `color%red.png` → `image-uri-undecodable`.
3. P2 Router treats directory as file — `scene/route.rs:61`; `textures.fbx` directory → `SOURCE_FORMAT_AMBIGUOUS`.
4. P2 unitypackage accepts truncated gzip/bad CRC — `scene/unitypackage.rs:82`; exit 0 on 3 variants.
5. P2 Rejected ZIP leaves partial files, IO_ERROR instead of ARCHIVE_UNREADABLE — `archive/zip_reader.rs:61`, `container.rs:38`; cleanup issue only, nothing consumed.
6. P2 USDZ routed as generic ZIP, first layer ignored — `scene/usdz.rs:63`, `container.rs:68`; OBJ inside `.usdz` accepted; 2 layers ambiguous.
7. P2 RGBA expansion exceeds allocation limit — `image/crate_image.rs:18`; TGA 1×1, max_alloc=3 → 4 bytes.
8. P2 APNG silently flattened — `image/png.rs:61`; 2 frames → red frame only.
9. P1 Fan fills concave n-gons — `ma/mesh/part.rs:108`, `blend/build.rs:30`, `alembic/mesh/build.rs:36`, `usd/surface.rs:62`; U area 7 → 11.
10. P1 MA overwrites same-name nodes — `ma/document/edit.rs:16`, `ma/document.rs:120`; `|A|M` lost.
11. P1 MA drops unassigned faces with partial material binding — `ma/mesh/part.rs:79`; 2 triangles instead of 4.
12. P1 MA exports invisible/intermediate shapes — `ma/build.rs:153`, `ma/mesh.rs:33`; `.v no`, `.io yes` emitted.
13. P1 MA ignores component `.tx`/`.rx`/`.sx`, `rotateAxis`, `inheritsTransform`, `offsetParentMatrix` — `ma/xform.rs:29`; `.tx 10` → x=0.
14. P1 Blend imports every OB, including outside scene — `blend/convert.rs:38`, `blend/walker.rs:35`; code evidence.
15. P1 Blend keeps V uninverted/images unchanged — `blend/build.rs:71`, `blend/images.rs:48`; unlike ma/alembic.
16. P1 Blend selects first Principled even disconnected — `blend/material.rs:42`; code evidence.
17. P1 Blend loses separate alpha texture — `blend/material.rs:59`; code, no counter.
18. P2 Blend multiplies textured emission by replaced black value — `blend/shading.rs:45`; code.
19. P2 MA loses `.b`/`.e` weights when texture connected — `ma/material.rs:80`; factors [1,1,1].
20. P2 MA treats bump2d height as normal map — `ma/material.rs:167`; never reads `bumpInterp`.
21. P2 MA ignores wrapV/place2dTexture transforms — `ma/texture.rs:108`; code.
22. P2 Hard/smooth edges lost — `ma/mesh.rs:54`, `blend/mesh.rs:94`, `blend/normals.rs:22`; all flat (ma)/smooth (blend).
23. P2 MA debug panic on `i64::MIN` — `ma/mesh.rs:135`; exit 101, release unproven.
24. P2 Blend SDNA lacks checked_mul/count bounds; views file-bounded, not block-bounded — `blend/dna.rs:191,157,52`, `blend/view.rs:67`; debug exit 101.
25. P2 Uncompressed Blend bypasses limit — `blend/envelope.rs:40`, `blend/convert.rs:19`; code.
26. P2 Alembic accepts unknown version/unfrozen archive; reads version 256 instead of 1 — `alembic/ogawa.rs:69`, `alembic/archive.rs:74`; exit 0.
27. P2 Cancellation only between objects — `ma/convert.rs:15`, `blend/build.rs:30`, `alembic/walk.rs:49`; code.
28. P1 Unity panic on material index `2^64−1` — `unity/patch.rs:74`; debug exit 101.
29. P1 Unity loses imported-model transforms — `unity/merge.rs:174`, `unity/render.rs:129`; child lacks matrix.
30. P1 Unity mixes overrides of two objects, nondeterministic — `unity/patch.rs:114`, `unity/prefab.rs:61`; x=7,2,2,2,7 over 5 runs.
31. P2 Unity rounds 64-bit `.meta` fileID — `unity/meta.rs:100`; 2^53+1 → 2^53.
32. P1 Unity transparent + cutoff → MASK — `unity/materials.rs:117`; violates AGENTS.md.
33. P2 Unity opaque `_Mode=0` becomes BLEND from color alpha — `unity/materials.rs:127`.
34. P2 Unity ignores HDRP `_SurfaceType` — `unity/materials.rs:117`.
35. P1 USD 5/6 Euler orders assign angles to wrong axes — `usd/xform.rs:90`; rotateZYX(90,0,0) around Z.
36. P1 USD implicit unit 1 instead of 0.01 — `usd/layer.rs:12`.
37. P1 USD defaultPrim drops other roots — `usd/convert.rs:84`; 1 triangle instead of 2.
38. P1 USD ignores `visibility=invisible` — `usd/visit.rs:18`.
39. P2 USD loses material inheritance — `usd/subset.rs:74`; `materials: []`.
40. P1 USD loads then drops opacity texture — `usd/material.rs:81`; opaque instead of transparent.
41. P1 USD metal/roughness textures canceled by factors 0/0.5; channels ignored — `usd/material.rs:99`.
42. P2 Referenced USD layer textures resolved against root — `usd/read.rs:104`, `usd/texture.rs:25`; `usd-texture-missing`.
43. P2 USD ignores UsdUVTexture scale/bias/sourceColorSpace/wrapT — `usd/texture.rs:18`.
44. P2 USD absent diffuseColor = white instead of 0.18; specular/ior/clearcoat/occlusion uncounted — `usd/material.rs:38`.
45. P2 USD loses doubleSided without material binding — `usd/mesh.rs:27`.
46. P2 USD silently drops invalid faces, negative indices → 0 — `usd/surface.rs:67`, `usd/mesh.rs:59`, `usd/primvar.rs:72`.
47. P2 Unity loses outer overrides of nested prefab; never reads m_Removed*/m_Added* — `unity/build.rs:83`, `unity/prefab.rs:18`.
48. P2 Unity ignores null material override — `unity/render.rs:59`, `unity/patch.rs:74`.
49. P2 Unity rebinding mutates shared mesh, changes first instance — `unity/render.rs:146`.
50. P2 Unity drops LOD0 through renderer shared with lower LOD — `unity/build.rs:155`.
51. P2 Unity loses model-driver unsupported/notes report — `unity/models.rs:69`.
52. P2 Unity samplers ignore `.meta` wrap/filter — `unity/textures.rs:9`.
53. P2 EXR premultiplied alpha emitted as straight — `image/exr.rs:160`, contract `image.rs:50`; `demi.exr`.
54. P2 PSD selection alpha treated as transparency; layer count unread — `psd/pixels.rs:90,28`, `psd.rs:160`; goldens encode assumption.
55. P2 EAC R11/RG11 truncated to 8-bit by `texture2ddecoder` (`val >> 3`) — `ktx2/format.rs:74`.
56. P2 DDS/KTX2 linear and sRGB conflated — `dds/codec.rs:105`, `ktx2/format.rs:46`, consumer `texture_preview.rs:15`.
57. P2 KTX2 DFD/keys (premultiplied, swizzle, orientation) silently ignored — `ktx2/header.rs:76`, `ktx2/level.rs:29`.
58. P2 ICC profiles discarded before sRGB output — `image/crate_image.rs:21`, `psd/pixels.rs:28`; `into_rgba8` assumes sRGB.

Uncertain, excluded from count: RGBE reconstruction (lower bound/center), glTF sparse/morph indices in `unity/merge.rs`, USD holeIndices.
