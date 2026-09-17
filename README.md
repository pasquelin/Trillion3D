<div align="center">

# Web Geometry

### Reusable geometry preparation and rendering for the web — a native Rust compiler, a TypeScript SDK, and explicit performance evidence.

[![Rust](https://img.shields.io/badge/Rust-native%20compiler-000000?logo=rust&logoColor=white)](packages/asset-compiler-rust)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](packages/sdk-core)
[![Three.js 0.174](https://img.shields.io/badge/Three.js-0.174-000000?logo=three.js&logoColor=white)](packages/sdk-browser)
[![WebGL2](https://img.shields.io/badge/WebGL2-scene%20renderer-990000?logo=webgl&logoColor=white)](#current-capabilities)
[![WebGPU](https://img.shields.io/badge/WebGPU-page%20cache-005A9C?logo=webgpu&logoColor=white)](#current-capabilities)
[![Status](https://img.shields.io/badge/status-in%20development-d29922)](#current-limits)

**[Product principles](docs/architecture/PRINCIPES_DU_PRODUIT.md)** · **[Quick start](#quick-start)** · **[SDK](docs/SDK.md)** · **[Compiler](docs/COMPILER.md)** · **[Architecture](packages/README.md)** · **[Current limits](#current-limits)**

</div>

Documentation : [spécifications de Web Geometry](docs/README.md) · [format de cache](docs/FORMAT.md).

---

## Overview

Web Geometry brings geometry preparation, versioned runtime contracts and browser adapters into one reusable SDK. Applications consume the public SDK entry points.

The native compiler prepares a cluster DAG — small clusters of triangles, grouped and simplified level by level, each carrying the screen error that lets a runtime pick one cut through the graph — plus a culling hierarchy, streaming bundles and reusable SHA-addressed cache pages. The browser adapter currently renders the prepared scene through Three.js and WebGL2, with a reference backend and an exact-cluster backend. When a WebGPU device is available, an optional page raster consumes the bounded WebGPU page cache and runs frustum + `lodScore` in compute; the CPU cut stays the A/A oracle and the silent fallback.

**The project is under active development.** The importer reads a versioned source manifest and the glTF it names. This is not yet a general-purpose virtualized geometry engine or an integrated WebGPU scene renderer.

## Quick start

Requirements: **Node.js 22.18 or newer**, npm, and a Rust toolchain with Cargo available on your path.

From the repository root:

```sh
pnpm install
pnpm run build
pnpm run build:native
pnpm test
pnpm run test:native
```

During development, `pnpm run check:changed` checks the line limit, formatting, lint and duplicated blocks in modified files, then runs unit tests connected to them by imports. `pnpm run test:changed` runs just those tests, and `pnpm run test:watch` watches unit tests while editing. Every maintained source file has a strict 200-line maximum; `pnpm run check:lines` checks the whole repository with no legacy exceptions. `pnpm run check:duplicates` detects repeated JS, TS and Rust blocks of at least 12 lines and 100 tokens. Before integration, run `pnpm run validate` once for the complete line-limit, duplication, format, lint, unused-code, build and test gates. Browser rendering still needs the visual proof described below.

The TypeScript build emits ESM JavaScript and declarations into `dist/`. The native build produces `packages/asset-compiler-rust/target/release/web-geometry-compiler` (`.exe` on Windows).

The package is currently private and consumed locally; it has not been published to npm. Build it before importing it from a host project. Scene assets are supplied by the host and are not included in this repository.

## Native compiler

All preparation work happens in one executable, `web-geometry-compiler`, built by `pnpm run build:native`. It reads glTF, GLB, **FBX and OBJ** (the reader is compiled in; no Blender or other tool is needed), writes the cache to disk and talks to its host through three streams only: JSON events on stderr, a small pointer on stdout, cancel requests on stdin.

```sh
packages/asset-compiler-rust/target/release/web-geometry-compiler scenes/city/city.obj cache/city full 150000 8 8192 /assets/city/ qem-endpoints
packages/asset-compiler-rust/target/release/web-geometry-compiler --jobs jobs.json   # many models, bounded workers, one process
```

`@web-geometry/sdk/node` (`prepare`, `prepareMany`) is a thin relay over it; any other host (Electron, a CI script, another language) can drive it the same way. Full reference: [docs/COMPILER.md](docs/COMPILER.md).

## Public SDK

| Entry point | Purpose |
|---|---|
| `@web-geometry/sdk` or `@web-geometry/sdk/core` | Versioned contracts, jobs, progress, cancellation, diagnostics and safety policy |
| `@web-geometry/sdk/node` | Native compiler process adapter and compilation jobs |
| `@web-geometry/sdk/browser` | Explorer lifecycle, rendering backends, camera paths and WebGPU page cache |

Applications own their canvas, animation loop, resource URLs and controller disposal. Node hosts own source/cache directories and process configuration. React and Electron integrations can use these boundaries without introducing framework dependencies into the core.

See the [SDK guide](docs/SDK.md) and [architecture notes](packages/README.md) for lifecycle, compatibility and fallback contracts. Consumers should use public exports rather than internal source paths.

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
              Browser adapter
                      │
                      ▼
             Host-owned canvas

Core: contracts · jobs · cancellation · diagnostics · safety policy
```

| Directory | Responsibility |
|---|---|
| [`packages/asset-compiler-rust`](packages/asset-compiler-rust) | Production preparation library and native CLI |
| [`packages/page-codec`](packages/page-codec) | Reference geometry-page encoder used to test the browser decoder |
| [`packages/sdk-core`](packages/sdk-core) | Platform-independent TypeScript contracts and policies |
| [`packages/sdk-node`](packages/sdk-node) | Native process and filesystem integration |
| [`packages/sdk-browser`](packages/sdk-browser) | Browser rendering and GPU resource adapters |
| [`test`](test) | Public package integration tests |

## Current capabilities

| Area | Implemented scope |
|---|---|
| Native preparation | Verified source hashes, read-only binary mapping, a cluster DAG with per-cluster screen errors, a flat culling hierarchy, streaming bundles and a bounded worker pool |
| Cache | SHA-addressed shared page, geometry-page and bundle objects, validation before reuse and manifest publication after preparation |
| Browser rendering | Reference and exact-cluster WebGL2 backends, CPU culling over the flat cluster hierarchy, source material preservation, optional WebGPU page raster with visbuffer, glTF 2.0 Cook-Torrance GGX PBR specular with hemispherical diffuse ambient (no environment map), and 2-phase Hi-Z |
| Diagnostics | Beauty, wireframe and cluster views where supported by the selected backend |
| WebGPU resources | Page-cache API with uploads, pins, bounded slots and eviction; optional page raster (`webgpu-page-raster`) with GPU frustum + `lodScore` selection plus conservative backface cones, 2-phase Hi-Z occlusion culling, visbuffer encode of at most six non-indexed `drawIndirect` commands, and a CPU cut fallback |
| Jobs | Immutable progress snapshots, subscriptions and cancellation |
| Compatibility | Separate SDK and asset-format versions; explicit rejection of unsupported formats |
| Recovery | Prepared reference fallback for backend errors while the WebGL context remains usable |

## Evidence and validation

Correctness comes before performance. Compare reference and candidate images under identical scene, camera and rendering conditions before recording a performance verdict. Diagnostic overlays stay outside measured beauty passes. Unknown or uninstrumented metrics remain `null`.

The test suites cover compiler behavior and public SDK contracts. A passing build or unit test does not establish a rendering speedup. Physical scene campaigns and their raw measurements must record the input, revision, machine, cache state and timing boundary alongside each result.

## Current limits

- The importer supports multiple buffers, sparse accessors (`accessor.sparse`), and routes skinned meshes, morph targets and animations to the `shared-blend` reference pass without pipeline failure. Non-triangle primitives and non-standard extensions remain unsupported.
- Compression and independently replaceable native pipeline stages remain future work. The compiler emits one hierarchy, the cluster DAG; the pair-tree hierarchy it used to emit is gone, and the browser adapter still reads caches that carry one.
- GPU frustum + `lodScore` selection plus conservative backface cones (prepare-time page cones, `coneRejects` with perspective spread). Visbuffer encode instances resident pages from the page table and issues at most six non-indexed `drawIndirect` commands (cull mode × Hi-Z pass). `selectVisiblePages` and `applyTemporalHiz` remain the A/A oracles and the silent fallbacks. Compaction is a stable exclusive scan; overflow or a missing compact pipeline restores the per-page `draw()` loop and keeps `'indirect draw'` in `unsupported`. The visibility buffer pass evaluates Cook-Torrance GGX specular with a hemispherical diffuse ambient term; specular environment-map IBL is not implemented. 2-phase Hi-Z tests occluders in Pass 1, builds the current frame depth pyramid, and disoccludes revealed geometry in Pass 2; previous-frame depth is reused only while the view is unchanged and is never reprojected. The WebGPU page raster falls back to WebGL2 if the device is missing or lost; a missing visbuffer format falls back to the untextured page raster and leaves Hi-Z off.
- The compiler RAM option is an admission estimate, not an enforced peak-memory limit.
- Full graphics-device/context-loss recovery and cross-API fallback remain unimplemented.
- N-API/WASM bindings, published packages, signed native distributions and cross-platform performance CI remain pending.

See [architecture and implementation limits](packages/README.md) for the detailed contracts and remaining work.
