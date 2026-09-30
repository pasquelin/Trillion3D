# #522 floating crates: implementation audit and remaining current defect

Base: `9a74443d2d`, worktree `522-floating-crates-review`.

Already delivered before this work:

- `4ebf2f7190` unparked floating-crates after #573: dynamic sea geometry, ready roadmap entry, no waiting marker, all fifteen missing-gallery notices removed, and the page runtime test rewritten to assert no recut or session reopen.
- `af9627486a` supplied the gallery thumbnail (73,058 bytes).
- `docs/SDK.md:489` links the example; its Physics section links `docs/PHYSICS.md`, which also links the example at line 43 beside the water API.
- The page contains crates, barrels, other densities, and a three-part compound raft. Its sea is an ordinary dynamic mesh driven by the engine's `waterSurface.point/normal`, not a duplicated wave model. The four settings feed the public water setter; current is `[value, 0, value * 0.3]`, phases are retained when settings change.
- All fifteen locale JSON pairs have the gallery title and complete floating-crates banner/controls; no stale missing-gallery key remains. `check:i18n` passes.
- The pre-existing targeted water/fluids/compound/page tests passed (18 tests, no skip), and the gallery suite passed (5 tests, no skip). These are existing achievements, not newly implemented features.

Remaining defect reproduced here:

A density-600 cube initially at its equilibrium draft in calm water does not receive lateral acceleration on its first step despite a nonzero current. With current `[1,0,.3]`, it moves only 0.00898 m in x before sleeping. The native binding calls Jolt's `Body::ApplyBuoyancyImpulse`, whose drag cap uses the body's absolute speed; at zero speed it caps the current's impulse to zero. Small motion also falls below the sleep threshold, after which the active-body query excludes it.

The fix calculates buoyancy in the water's velocity frame using unclamped MotionProperties step operations, then restores world velocity. An immersed body with nonzero density, positive drag and a nonzero current resets its sleep timer only while its centre of buoyancy has nonzero velocity relative to the water. No page wake loop, changes to upstream Jolt, or permanent sleep-disable flag were introduced. The existing public water setter already wakes dynamic bodies when settings change; its test now explicitly includes a current change.

`waterCurrent.test.ts` first failed against the original committed module at the first-step acceleration assertion. All four new regressions pass against the rebuilt single-thread module: acceleration and sustained drift, calm -> current -> calm, current without drag allowing sleep, and zero-density water exerting no force.

Diagnostic native cross-check: the modified binding linked with the repository's existing official Jolt native library. At current .4, x advanced from .120 m at 2 s to 1.633 m at 10 s; without current x stayed zero and the body slept. This is a numerical diagnostic, not a rendering or timing proof. Harness/commands are retained in `.worktrees/logs/522-native/`.

Toolchain: Debian-signed emscripten `3.1.69+dfsg-3`, LLVM `19.1.7`, Ninja `1.13.2`, Node `24.19.0`. Packages were authenticated through apt and extracted locally; system files were not modified. Cloud activation: `. /workspace/.tools/emscripten-debian/activate.sh`; on another checkout install those tool versions and put Emscripten, CMake and Ninja on PATH. Official build: `node scripts/build-physics-wasm.ts`, two workers. Both modules built, and the build's SIMD/no-relaxed-SIMD checks passed.

The older toolchain adds one standard WASI import, `fd_write`, to the threaded module. The private loader now supplies a real stdout/stderr diagnostic writer: complete iovec/pointer validation before output, BADF/FAULT/OVERFLOW errno results, UTF-8 decoding across vector boundaries, and an exact byte count. Two tests cover shared memory, stdout/stderr, split Unicode, empty vectors, invalid descriptors and pointers, unchanged output count on error, and memory growth. This resolved the initial eight threaded-load failures; no successful stub was used.

Broad suite before the final zero-density sleep guard: **257 passed, 0 failed, 0 skipped**, 38.4 seconds:

```sh
node --test --test-concurrency=2 packages/sdk-browser/src/physics/*.test.ts packages/sdk-core/src/fluids/*.test.ts scripts/docs-examples-water.test.ts scripts/docs-examples.test.ts
```

This includes the existing bit-identical one-thread/eight-thread trajectories and worker startup tests. After extending the WASI test to explicitly use shared memory, its two tests passed again. Full tools typecheck, targeted ESLint and i18n validation passed. `TRILLION3D_BASE_REF=9a74443d2d pnpm run check:changed` completed with exit 0: 250 tests passed, no failures or skips (8 source/test/binary changes / 62 related test files). The subsequently added report was formatted separately. The final density-zero guard then reproduced a failing sleep assertion before its change; both WASM modules were rebuilt again, and all ten water/current tests passed, including one-thread/eight-thread trajectories. Full multi-group `validate` is not claimed here.

Committed-module SHA-256 after the official rebuild:

- single-thread (1,622,118 bytes): `58f115ee6a632c54534c8be716d04c6e2256600e81718065c5eab19f0350fb9d`;
- threaded (1,635,677 bytes): `9701ac68f4f7d83c61209dc16cc0b3d2205ed03b59ff3fb042cf8ac3e883e8d9`.

These are newly compiled binaries, not claimed byte-identical to the previous toolchain's binaries. Original-source and rebuilt numerical behavior are tested independently.

Chrome image/performance validation remains the recette workflow per AGENTS.md rule 2; this audit makes no blank-frame, pixel-identity, screenshot, FPS or GPU timing claim. The historical #573 recipe's unresolved image items are not represented as completed by these Node tests.
