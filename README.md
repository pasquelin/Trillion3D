<div align="center">

# Trillion3D

### Virtualized geometry for the web — a native Rust compiler, a WebGPU/WebGL2 runtime in TypeScript, and a bench that proves every number.

[![Rust](https://img.shields.io/badge/Rust-native%20compiler-2b2d30?logo=rust&logoColor=dea584)](packages/asset-compiler-rust)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-2b2d30?logo=typescript&logoColor=3178c6)](packages/sdk-core)
[![WebGPU](https://img.shields.io/badge/WebGPU-page%20raster%20%2B%20compute-2b2d30?logo=webgpu&logoColor=6fa8dc)](#what-it-does)
[![WebGL2](https://img.shields.io/badge/WebGL2-fallback-2b2d30?logo=webgl&logoColor=e06666)](#what-it-does)
[![Node 22](https://img.shields.io/badge/Node-%E2%89%A522.18-2b2d30?logo=node.js&logoColor=6da95f)](#quick-start)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-2b2d30?logo=pnpm&logoColor=f69220)](#quick-start)
[![Quality](https://github.com/pasquelin/Trillion3D/actions/workflows/quality.yml/badge.svg)](https://github.com/pasquelin/Trillion3D/actions/workflows/quality.yml)
[![Tests](https://img.shields.io/badge/tests-node%20%2B%20cargo%20%2B%20GPU%20proofs-2b2d30?logo=checkmarx&logoColor=6da95f)](#quality-bar)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-2b2d30)](#licence)

**[Documentation ↗](https://www.trillion3d.com/)** · **[Live report ↗](https://www.trillion3d.com/#/en/reports)** · **[Why](#why-trillion3d)** · **[Quick start](#quick-start)** · **[Compiler](docs/COMPILER.md)** · **[SDK](docs/SDK.md)** · **[Architecture](packages/README.md)** · **[Bench](bench/runner/README.md)** · **[The reference in numbers](docs/REFERENCE.md)** · **[Roadmap](#roadmap)**

</div>

[Create a world](docs/SDK.md#create-a-world): `createWorld(canvasOrId)`, add objects or `scene.load` a compiled model, `onFrame` for per-frame work. It owns the scene, the camera, the renderer and the loop, and pauses once the image is stable.

---

## Why Trillion3D

The best desktop engines changed what a scene can hold: geometry is streamed by clusters, one cut
through a DAG per frame, drawn through a visibility buffer, resolved by temporal antialiasing, held
under a fixed memory budget. None of that exists for the browser. **Trillion3D builds it for the
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

| Area                   | Implemented scope                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Native compiler**    | glTF/GLB, FBX, OBJ, USD/USDZ, Alembic, `.blend`, Maya ASCII and Unity scenes and packages, with a dozen image formats, read by its own drivers (no external tool); verified source hashes; a cluster DAG that reaches a single root — clusters grouped, simplified and welded level by level, each carrying its screen error; a flat culling hierarchy; streaming bundles; a bounded worker pool; DAG warnings reported to the CLI and to the engine |
| **Cache**              | SHA-addressed page, geometry-page and bundle objects; every persisted entry validated before reuse; `formatVersion` separate from `compilerVersion`, unknown formats rejected                                                                                                                                                                                                                                                                        |
| **WebGPU page raster** | GPU frustum + `lodScore` cut in compute, conservative backface cones, two-phase Hi-Z occlusion, visibility-buffer encode through at most six non-indexed `drawIndirect` commands, deferred material shading, temporal antialiasing                                                                                                                                                                                                                   |
| **Textures**           | virtual texturing: a bounded tile pool, per-tile feedback read back by rank, residency driven by what the frame sampled                                                                                                                                                                                                                                                                                                                              |
| **Lighting**           | Cook-Torrance GGX, no fixed ambient term — ambient only comes from a declared `light.ambient`/`light.hemisphere`, and a surface no light reaches stays black; sun and lamps through virtual shadow maps — a page table over a fixed pool, the level chosen per pixel, only the pages the image reads drawn — under a 1 ms budget; per-tile light rejection — the stochastic and screen-space stages are the roadmap                                  |
| **Memory**             | fixed reservoirs for pages and tiles like the reference, adjustable in session without losing residency; no image cap; a `cpu-timing` diagnostic and per-step CPU profile                                                                                                                                                                                                                                                                            |
| **Fallbacks**          | a world takes WebGPU pages by default when the machine grants a device, WebGL2 pages otherwise; the CPU cut stays the A/A oracle; a forced renderer the machine lacks is refused by name, never swapped                                                                                                                                                                                                                                              |
| **Jobs**               | immutable progress snapshots, subscriptions, bounded cancellation, explicit failure semantics                                                                                                                                                                                                                                                                                                                                                        |

## Quick start

Requirements: **Node.js 22.18 or newer**, **pnpm**, and a Rust toolchain with Cargo on your path.

```sh
pnpm install
pnpm run build           # TypeScript → dist/ (ESM + declarations)
pnpm run build:native    # → packages/asset-compiler-rust/target/release/trillion3d-compiler
pnpm test                # unit and integration tests (node --test)
pnpm run test:native     # cargo test
```

The package is private and consumed locally; it is not published to npm. Scene assets are supplied
by the host and are not part of this repository.

```js
import { createWorld, object, geometry, material, light } from 'trillion3d';

const world = createWorld('viewer'); // a canvas element, or its id

const ball = object.mesh(geometry.sphere(1), material.meshStandard({ color: 0x8899aa }));
world.scene.add(ball);
world.scene.add(light.directional({ intensity: 3, position: [5, 10, 2] }));

await world.scene.load('assets/city/manifest.json'); // a compiled model, added like anything else

world.onFrame(({ delta }) => {
  ball.rotation.y += delta;
  world.invalidate();
});
```

## Native compiler

All preparation happens in one executable, `trillion3d-compiler`. It reads the source, writes
the cache to disk and talks to its host through three streams only: JSON events on stderr, a small
pointer on stdout, cancel requests on stdin.

```sh
packages/asset-compiler-rust/target/release/trillion3d-compiler scenes/city/city.obj cache/city full 150000 8 8192 /assets/city/ qem-endpoints
packages/asset-compiler-rust/target/release/trillion3d-compiler --jobs jobs.json   # many models, bounded workers, one process
```

`trillion3d` (`prepare`, `prepareMany` in Node) is a thin relay over it; any other host
(Electron, a CI script, another language) can drive it the same way. Full reference:
[docs/COMPILER.md](docs/COMPILER.md).

## Public SDK

Every consumer imports `trillion3d`. Conditional exports provide common maths and contracts in
all environments, rendering APIs to browser bundlers, and native preparation APIs to Node.

| Environment       | Available API                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common and worker | Versioned contracts, maths, jobs, diagnostics and safety policy                                                                                                                             |
| Node              | Common API plus native compiler process adapter and compilation jobs                                                                                                                        |
| Browser bundler   | Common API plus `createWorld` and its families (`geometry`, `material`, `light`, `camera`, `object`, `page`, `budget`, `metric`, `diagnostic`, `capability`, `capture`, `pose`, `batch`, …) |

An application owns the canvas, its resource URLs and controller disposal; the world owns its own
loop by default (`interactive: false` + `world.render()` for a host-led loop instead). Node hosts
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
| [`bench/runner`](bench/runner)                                 | The bench: one harness, campaigns and the HTML report            |
| [`tests`](tests)                                               | Public package integration tests and GPU proofs                  |

## Measuring

Nothing is optimised before it is measured, and no claim outlives its measurement.

```sh
node bench/runner/bench.ts --moteur webgpu --avant <git-ref|dist> --apres <git-ref|dist> \
     --vues generale,sol,rue --images 60 --pixelError 0,1
node bench/runner/campaign.ts        # the whole campaign
node bench/runner/summaryGlobal.ts   # one HTML report
```

- One harness, Playwright driving the machine's Chrome, nothing on disk beyond `.mesure/assets/`.
- **Before/after in one run**, same poses, lights, caches and server — and the engine facing two
  witnesses: bare Three.js and Three.js with a three-level `THREE.LOD` (the classic method).
- The measurement rules — identical budgets, `null` for the unmeasured, CPU and GPU never added,
  differences read on the frame envelope — are in [CONTRIBUTING.md](CONTRIBUTING.md#measure-before-optimising).

See [bench/runner/README.md](bench/runner/README.md) and [docs/TESTS.md](docs/TESTS.md).

## Quality bar

Every source file fits 200 lines, no block is duplicated, core packages never see the DOM, and
`pnpm run validate` — format, lint, Clippy, unused code, builds, declarations, links, every JS/TS/Rust
test — gates each pull request in CI ([`quality.yml`](.github/workflows/quality.yml)); `pnpm run
test:gpu` adds the proofs on a real GPU. The gates, one by one: [docs/TESTS.md](docs/TESTS.md#4-quality-gates).
The rules a contribution follows: [CONTRIBUTING.md](CONTRIBUTING.md).

## How the project is run

Trillion3D is built by a small company of AI sessions — a CTO, leads per domain, measurement,
acceptance, an architect and an analyst — run by one maintainer. [docs/COMPANY.md](docs/COMPANY.md)
explains every role and how to run it from any clone; the contribution workflow never requires it.

## Documentation

Every document, and what it is for, is listed once in [docs/README.md](docs/README.md). The
documentation, the code, its identifiers and this page are in English.

## Roadmap

The geometry, the temporal antialiasing and the memory budgets are the foundation. What they are
for is **real-time dynamic global illumination, reflections and shadows** — reached by
stages, each measured before the next ([lighting strategy](docs/ENGINE.md#lighting-the-target-and-the-stages)):

| Stage | Content                                                                             | State                                                      |
| ----- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| L0    | Direct lighting and sun costed on the bench                                         | done — the sun costs its shadow sampling, not its cascades |
| L1    | Screen traces: reflections and short bounce from the rendered HDR, depth and normal | next                                                       |
| L2    | Stochastic direct lighting denoised by TAA: dozens of lights at the price of one    | planned                                                    |
| L3    | Virtual shadow pages from the hardware raster, only the pages seen, cached          | planned                                                    |
| L4    | Cooked global distance field traversed in compute, reading a surface cache          | planned                                                    |
| L5    | World radiance probes in cascades                                                   | planned                                                    |
| L6    | Reflections through the distance field reading the cache                            | planned                                                    |

Open tasks are tracked as [GitHub issues](https://github.com/pasquelin/Trillion3D/issues); an issue is closed once it is done.

## Current limits

- Not yet a general-purpose engine: `scene.load` reads a versioned source manifest and the source
  it names; non-triangle primitives and non-standard glTF extensions are unsupported. A world built
  in code — `geometry`/`material`/`object`/`light` — does not go through the compiler at all.
- Delivered simplification and page compression are those documented in
  [docs/FORMAT.md](docs/FORMAT.md); the compiler's RAM option is an admission estimate, not an
  enforced peak-memory limit.
- Specular environment-map IBL, full device-loss recovery and cross-API fallback are not
  implemented; a missing visbuffer format falls back to the untextured page raster with Hi-Z off.
- No N-API binding of the compiler, published packages, signed native distributions or
  cross-platform performance CI yet; WebAssembly serves the page decoder, three math kernels and
  the physics.
- Physics ([docs/SDK.md](docs/SDK.md#physics)) steps Jolt on its thread pool when the page is
  cross-origin isolated, on one worker elsewhere; what 10,000 boxes landing at once cost is
  measured there.

## Licence

Trillion3D is published under the [PolyForm Noncommercial License 1.0.0](LICENSE): free for
noncommercial use, study, research and personal projects. **Commercial use requires a separate
licence** from the copyright holder — open an issue or contact the author.

Copyright © 2026 Alban Pasquelin.

The physics is [Jolt Physics](https://github.com/jrouwe/JoltPhysics) (MIT), built from its
official sources: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
