# Compilateur — native compiler/import handoff

Confirm title with `get_session("self")`; refresh `list_sessions` before messaging (IDs change). Follow `AGENTS.md`.

## Workflow

- Fable leads, neither codes nor reads code. One Opus 5, one batch at a time; isolated worktree, `compilateur/lot-<letter>-<subject>` from develop (check the merge-base at launch). Sonnet 5: docs/reviews/tests. Brief replies. No go between batches; go only for a plan change, an irreversible deletion, or an optimisation.
- Every finding is reproduced in a failing test first; a finding that does not reproduce is refused with the reason. Fix generically by material/lamp/file property, never by object name or scene. Correct goldens that froze a wrong output and say what changes. Count unconverted features with named codes in `docs/COMPILER.md`. A driver whose output changes bumps its `version()`; a change of manifest shape or cache identity bumps `COMPILER_VERSION`.
- Gates from the worktree, cargo run directly with `DEVELOPER_DIR=/Library/Developer/CommandLineTools`: `fmt --check`, `clippy --all-targets -D warnings`, `cargo test --locked`, `check:lines`, `check:duplicates`, `check:changed`, sdk-node tests, `tsc --noEmit`, prohibited-name scan. Link the main checkout's `node_modules` for the gates, remove it after. Rebuild the native binary (`build:native`) before `check:changed` after a rebase, or the sdk-node V02 test fails on a stale binary. CC0 `test-assets/` is read-only. Never push, stash, run `validate` or merge from an agent.
- Delivery report: head SHA, merge-base, reproduction tests by name, gate results, codes added, versions bumped, goldens touched and why, leftovers. This session then merges `--no-ff` into develop locally, removes the batch worktree and branch, tells the Validateur (validate + push), and starts the next batch.
- Browser proof of a pixel change consumes compiled data only (UVs, previews via `decodeManifestBinary`, cache glTF), relative image URIs, `previews ≥ 1`, zero console error, a real pre-change binary built from the parent commit, and Blender (`/Applications/Blender.app/Contents/MacOS/Blender --background`) as reference for `.blend` scenes.

## State — 2026-09-16, origin/develop 18b27295 + local docs commits, compiler 0.6.0

- 11 scene + 12 image drivers (`packages/asset-compiler-rust/FORMATS.md`). Three audits and two verifications closed: 58 + 19 + 3 findings, batches A–J, D', K–P, all reproduced, fixed, validated and pushed. Details live in the commit messages (`git log --grep compilateur`); the audit files are the user's untracked `docs/AUDIT_*` and `docs/VERIFICATION_*`.
- Browser proof accepted (`.mesure/out/preuve-compilateur-2026-09-16-v2/`, untracked): Blender V flip (24/24 UVs v = 1 − v, Blender 5.2.1 render |ΔG| ≤ 2), PSD fourth plane (alpha 255, cube opaque vs holed), PNG gamma (preview 188 vs 128). EXR (`image-float-unsupported`, no float preview) and KTX2 EAC (no fixture) stay undemonstrable in the browser; their Rust tests hold.

## Known limits, not regressions (keep visible in contracts and reports)

- Maya: `joint` nodes not traversed (`jointOrient`, `segmentScaleCompensate`); an ambiguous short name yields the first node written; `place2dTexture` beyond repeat/offset/rotate/mirror uncounted; `KHR_texture_transform` never written.
- Blender: attribute mesh layout only (4.4+), older `MPoly`/`MEdge` flags and 3.x `auto_smooth` refused by `blend-mesh-layout-unsupported`; MASK branch for files < 4.2 proven on a patched SDNA only.
- Unity: `m_AddedComponents` counted not applied, `m_RemovedGameObjects` unread; an override aimed inside an imported model is counted; animation accessors of `source.gltf` keep unremapped ranks.
- USD: normal-map `scale` and alpha of `scale`/`bias` counted; nested `.usdz` in `.usdz` unhandled; a mesh whose faces are all holes ends `usd-mesh-invalid`.
- Images: no ICC conversion (counted); KTX2 swizzle and orientations other than `rd`/`ru` counted; sRGB profile recognised by name; a PSD with both transparency and selection planes refused.
- Cache and process: advisory OS lock (no guarantee on a network mount); old `imports-externes/<base>.json` records orphaned in pre-K caches; unitypackage inflates its stream twice; ma cancel-inside-a-mesh has no end-to-end test; RSS never measured, `cpuMs` stays `null`.

## Next, in order (each on go, one Opus at a time)

1. Q `emitterRadius` (asked by Lumière): no imported format fills `emitterRadius` in `lights.json` (`compiler_lights.rs`, `docs/SDK.md`), so the engine's emitter-sphere shadow exclusion (fix/emitter-sphere cf78bace) is unreachable from a real scene. Read the lamp's own radius where the format has one (USD `radius`, FBX, Blender `shadow_soft_size`; glTF KHR_lights_punctual has none), else derive it from the emissive body bound to the lamp's parent or sibling node, by material property. Bench: `fixtures/classes-materiaux/emetteur-sphere.gltf` on that branch.
2. Perf, identical output required (bit-for-bit bench, per-job `phaseElapsedMs`, A/A witness < 1 %): full-product reuse when every dependency hash and product exists (`compiler_build.rs::compile` rebuilds the DAG today); linear cut for convex n-gons (`ngon.rs::is_ear` is quadratic, 8 000 corners = 113 ms); shared-image decode cache in `texture_preview.rs`; single-pass unitypackage extraction keeping CRC, bounds, cancel and no partial publish; admission before import and cancel points inside long n-gon cuts and normal computation.
3. Older go-only items: GPU-preserved DDS/KTX2 blocks, Draco/meshopt input, Industrial Map on bench 15, FAB licence.
