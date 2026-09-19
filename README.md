<div align="center">

# Web Geometry

### Virtualized geometry for the web — a native Rust compiler, a WebGPU/WebGL2 runtime in TypeScript, and a bench that proves every number.

[![Rust](https://img.shields.io/badge/Rust-native%20compiler-2b2d30?logo=rust&logoColor=dea584)](packages/asset-compiler-rust)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-2b2d30?logo=typescript&logoColor=3178c6)](packages/sdk-core)
[![WebGPU](https://img.shields.io/badge/WebGPU-page%20raster%20%2B%20compute-2b2d30?logo=webgpu&logoColor=6fa8dc)](#what-it-does)
[![WebGL2](https://img.shields.io/badge/WebGL2-fallback-2b2d30?logo=webgl&logoColor=e06666)](#what-it-does)
[![Three.js 0.174](https://img.shields.io/badge/Three.js-0.174-2b2d30?logo=three.js&logoColor=ffffff)](packages/sdk-browser)
[![Node 22](https://img.shields.io/badge/Node-%E2%89%A522.18-2b2d30?logo=node.js&logoColor=6da95f)](#quick-start)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-2b2d30?logo=pnpm&logoColor=f69220)](#quick-start)
[![Quality](https://github.com/pasquelin/WebGeometry/actions/workflows/quality.yml/badge.svg)](https://github.com/pasquelin/WebGeometry/actions/workflows/quality.yml)
[![Tests](https://img.shields.io/badge/tests-node%20%2B%20cargo%20%2B%20GPU%20proofs-2b2d30?logo=checkmarx&logoColor=6da95f)](#quality-bar)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-2b2d30)](#licence)

**[Live report ↗](https://pasquelin.github.io/WebGeometry/)** · **[Why](#why-web-geometry)** · **[Quick start](#quick-start)** · **[Compiler](docs/COMPILER.md)** · **[SDK](docs/SDK.md)** · **[Architecture](packages/README.md)** · **[Bench](scripts/mesure/README.md)** · **[The reference in numbers](docs/REFERENCE_UE5.md)** · **[Roadmap](#roadmap)**

</div>

---

## Why Web Geometry

The best desktop engines changed what a scene can hold: geometry is streamed by clusters, one cut
through a DAG per frame, drawn through a visibility buffer, resolved by temporal antialiasing, held
under a fixed memory budget. None of that exists for the browser. **Web Geometry builds it for the
web's constraints** — no hardware ray tracing, bounded and unreadable GPU memory, one browser frame —
from the published literature only, and measures itself against the numbers those engines publish.
The geometry is the foundation; the lighting is what it is for.

Parity means four things, and none of them is a pixel count:

|                              |                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| **Fixed budgets**            | memory in bytes and frame time in milliseconds are set, not discovered on the machine |
| **Residency by the frame**   | what stays on the GPU is what the frame actually read, pages and texture tiles alike  |
| **Compression at cook time** | the compiler pays once; the runtime decodes pages, it never recomputes them           |
| **No work in a still scene** | a fixed camera redraws zero pages — measured, not assumed                             |

## What it does

| Area                   | Implemented scope                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Native compiler**    | glTF, GLB, FBX and OBJ import (no external tool); verified source hashes; a cluster DAG that reaches a single root — clusters grouped, simplified and welded level by level, each carrying its screen error; a flat culling hierarchy; streaming bundles; a bounded worker pool; DAG warnings reported to the CLI and to the engine |
| **Cache**              | SHA-addressed page, geometry-page and bundle objects; every persisted entry validated before reuse; `formatVersion` separate from `compilerVersion`, unknown formats rejected                                                                                                                                                       |
| **WebGPU page raster** | GPU frustum + `lodScore` cut in compute, conservative backface cones, two-phase Hi-Z occlusion, visibility-buffer encode through at most six non-indexed `drawIndirect` commands, deferred material shading, temporal antialiasing                                                                                                  |
| **Textures**           | virtual texturing: a bounded tile pool, per-tile feedback read back by rank, residency driven by what the frame sampled                                                                                                                                                                                                             |
| **Lighting**           | Cook-Torrance GGX with a hemispherical ambient term; sun through cascaded shadow maps under a 1 ms budget; per-tile light rejection — the stochastic and screen-space stages are the roadmap                                                                                                                                        |
| **Memory**             | fixed reservoirs for pages and tiles like the reference, adjustable in session without losing residency; no image cap; a `cpu-timing` diagnostic and per-step CPU profile                                                                                                                                                           |
| **Fallbacks**          | the CPU cut stays the A/A oracle and the silent fallback; WebGL2 exact-cluster and reference backends when no WebGPU device is present                                                                                                                                                                                              |
| **Jobs**               | immutable progress snapshots, subscriptions, bounded cancellation, explicit failure semantics                                                                                                                                                                                                                                       |

## Quick start

Requirements: **Node.js 22.18 or newer**, **pnpm**, and a Rust toolchain with Cargo on your path.

```sh
pnpm install
pnpm run build           # TypeScript → dist/ (ESM + declarations)
pnpm run build:native    # → packages/asset-compiler-rust/target/release/web-geometry-compiler
pnpm test                # unit and integration tests (node --test)
pnpm run test:native     # cargo test
```

The package is private and consumed locally; it is not published to npm. Scene assets are supplied
by the host and are not part of this repository.

## Native compiler

All preparation happens in one executable, `web-geometry-compiler`. It reads the source, writes
the cache to disk and talks to its host through three streams only: JSON events on stderr, a small
pointer on stdout, cancel requests on stdin.

```sh
packages/asset-compiler-rust/target/release/web-geometry-compiler scenes/city/city.obj cache/city full 150000 8 8192 /assets/city/ qem-endpoints
packages/asset-compiler-rust/target/release/web-geometry-compiler --jobs jobs.json   # many models, bounded workers, one process
```

`@web-geometry/sdk/node` (`prepare`, `prepareMany`) is a thin relay over it; any other host
(Electron, a CI script, another language) can drive it the same way. Full reference:
[docs/COMPILER.md](docs/COMPILER.md).

## Public SDK

| Entry point                                     | Purpose                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `@web-geometry/sdk` or `@web-geometry/sdk/core` | Versioned contracts, jobs, progress, cancellation, diagnostics and safety policy      |
| `@web-geometry/sdk/node`                        | Native compiler process adapter and compilation jobs                                  |
| `@web-geometry/sdk/browser`                     | Explorer lifecycle, rendering backends, camera paths, WebGPU page cache and tile pool |

Applications own their canvas, animation loop, resource URLs and controller disposal. Node hosts
own source/cache directories and process configuration. React and Electron integrations use these
boundaries without bringing a framework into the core. Consumers use public exports, never internal
source paths. See the [SDK guide](docs/SDK.md) and the [architecture notes](packages/README.md).

## Architecture

```text
Host-owned source assets
          │
          ▼
Node adapter → Native Rust compiler
                      │
                      ▼
          Versioned manifest + cached pages
                      │
                      ▼
              Browser adapter (WebGPU page raster · WebGL2 fallbacks)
                      │
                      ▼
             Host-owned canvas

Core: contracts · jobs · cancellation · diagnostics · safety policy
```

| Directory                                                      | Responsibility                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`packages/asset-compiler-rust`](packages/asset-compiler-rust) | Preparation library and native CLI                               |
| [`packages/page-codec`](packages/page-codec)                   | Reference geometry-page encoder used to test the browser decoder |
| [`packages/sdk-core`](packages/sdk-core)                       | Platform-independent TypeScript contracts and policies           |
| [`packages/sdk-node`](packages/sdk-node)                       | Native process and filesystem integration                        |
| [`packages/sdk-browser`](packages/sdk-browser)                 | Browser rendering and GPU resource adapters                      |
| [`scripts/mesure`](scripts/mesure)                             | The bench: one harness, campaigns and the HTML report            |
| [`test`](test)                                                 | Public package integration tests and GPU proofs                  |

## Measuring

Nothing is optimised before it is measured, and no claim outlives its measurement.

```sh
node scripts/mesure/banc.mjs --moteur webgpu --avant <git-ref|dist> --apres <git-ref|dist> \
     --vues generale,sol,rue --images 60 --pixelError 0,1
node scripts/mesure/campagne.mjs        # the whole campaign
node scripts/mesure/rapportGlobal.mjs   # one HTML report
```

- One harness for every lot: Playwright drives the machine's Chrome, nothing else is needed on
  disk beyond `.mesure/assets/`.
- **Before/after in one run**, same poses, same lights, same caches, same server — and the engine
  facing two witnesses: bare Three.js and Three.js with a three-level `THREE.LOD` (the classic method).
- Identical input, camera, quality, machine and resource budget; DPR, error threshold, resolution
  and commit recorded; CPU and GPU times never added; unmeasured values are `null`, never estimates.
- Per-pass GPU durations say _where_, never _how much_: on tile-based GPUs passes overlap, so a
  difference is read on the frame envelope only.
- `0 px`, `tri = selected` and A/A noise are the default proof for geometry and lighting.

See [scripts/mesure/README.md](scripts/mesure/README.md) and [docs/TESTS.md](docs/TESTS.md).

## Quality bar

| Gate                        | What it enforces                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm run check:changed`    | format, lint, line limit, duplicates and the unit tests reached by imports from the changed files                                                                                                |
| `pnpm run check:lines`      | **200 physical lines per source file**, JS/TS/Rust, no legacy exception                                                                                                                          |
| `pnpm run check:duplicates` | no repeated block ≥ 12 lines and ≥ 100 tokens across JS/TS/Rust                                                                                                                                  |
| `pnpm run check:structure`  | core/adapter boundaries; `sdk-core` type-checks without DOM                                                                                                                                      |
| `pnpm run validate`         | everything above plus Clippy, unused code/files/dependencies, TS and native builds, declarations, links, and all JS/TS/Rust tests — the CI gate ([`quality.yml`](.github/workflows/quality.yml)) |
| `pnpm run test:gpu`         | browser proofs on a real GPU                                                                                                                                                                     |

The engine stays generic: no scene names, no hardcoded lights or cameras, no object-type special
cases. Not one line of any other engine's code, shaders or assets enters this
repository; everything is reimplemented from papers, talks, documentation and observed behaviour.

## Documentation

| Document                                                              | Role                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Native compiler](docs/COMPILER.md)                                   | Arguments, events, pointer, batch mode, cancellation, FBX/OBJ import, error codes                             |
| [Cache format](docs/FORMAT.md)                                        | Pointer, `clusters.json` and its binary annex, cluster DAG, culling hierarchy, streaming bundles, SHA objects |
| [SDK guide](docs/SDK.md)                                              | Lifecycle, compatibility and fallback contracts                                                               |
| [Architecture](packages/README.md)                                    | Package contracts and remaining work                                                                          |
| [Product principles](docs/architecture/PRODUCT_PRINCIPLES.md)         | Portable core, capabilities, source ownership, fallback                                                       |
| [Web / Electron / Node integration](docs/architecture/INTEGRATION.md) | Who owns the canvas, the loop, the preparation and the fallback                                               |
| [Tests and benches](docs/TESTS.md)                                    | Unit tests, GPU correctness probes, performance benches                                                       |
| [The reference in numbers](docs/REFERENCE_UE5.md)                     | The reference's published constants, bytes per triangle and profile, against ours                             |
| [Engine target](docs/SPEC_ENGINE_WITHOUT_THREE.md)                    | Editor, final cook, exit from Three.js, requirements, exit criteria, lighting strategy                        |

The documentation, the code, its identifiers and this page are in English.

## Roadmap

The geometry, the temporal antialiasing and the memory budgets are the foundation. What they are
for is **real-time dynamic global illumination, reflections and shadows** — reached by
stages, each measured before the next ([spec §8](docs/SPEC_ENGINE_WITHOUT_THREE.md)):

| Stage | Content                                                                             | State                                                      |
| ----- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| L0    | Direct lighting and sun costed on the bench                                         | done — the sun costs its shadow sampling, not its cascades |
| L1    | Screen traces: reflections and short bounce from the rendered HDR, depth and normal | next                                                       |
| L2    | Stochastic direct lighting denoised by TAA: dozens of lights at the price of one    | planned                                                    |
| L3    | Virtual shadow pages from the hardware raster, only the pages seen, cached          | planned                                                    |
| L4    | Cooked global distance field traversed in compute, reading a surface cache          | planned                                                    |
| L5    | World radiance probes in cascades                                                   | planned                                                    |
| L6    | Reflections through the distance field reading the cache                            | planned                                                    |

Open tasks are tracked as [GitHub issues](https://github.com/pasquelin/WebGeometry/issues); an issue is closed once it is done.

## Current limits

- Not yet a general-purpose engine: the importer reads a versioned source manifest and the
  source it names; non-triangle primitives and non-standard glTF extensions are unsupported.
- Delivered simplification and page compression are those documented in
  [docs/FORMAT.md](docs/FORMAT.md); the compiler's RAM option is an admission estimate, not an
  enforced peak-memory limit.
- Specular environment-map IBL, full device-loss recovery and cross-API fallback are not
  implemented; a missing visbuffer format falls back to the untextured page raster with Hi-Z off.
- No N-API/WASM bindings, published packages, signed native distributions or cross-platform
  performance CI yet.

## Licence

Web Geometry is published under the [PolyForm Noncommercial License 1.0.0](LICENSE): free for
noncommercial use, study, research and personal projects. **Commercial use requires a separate
licence** from the copyright holder — open an issue or contact the author.

Copyright © 2026 Alban Pasquelin.
