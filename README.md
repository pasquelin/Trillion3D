<div align="center">

# Web Geometry

### Reusable geometry preparation and rendering for the web — a native Rust compiler, a TypeScript SDK, and explicit performance evidence.

[![Rust](https://img.shields.io/badge/Rust-native%20compiler-000000?logo=rust&logoColor=white)](packages/asset-compiler-rust)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](packages/sdk-core)
[![Three.js 0.174](https://img.shields.io/badge/Three.js-0.174-000000?logo=three.js&logoColor=white)](packages/sdk-browser)
[![WebGL2](https://img.shields.io/badge/WebGL2-scene%20renderer-990000?logo=webgl&logoColor=white)](#current-capabilities)
[![WebGPU](https://img.shields.io/badge/WebGPU-page%20cache-005A9C?logo=webgpu&logoColor=white)](#current-capabilities)
[![Status](https://img.shields.io/badge/status-in%20development-d29922)](#current-limits)

**[Product principles](docs/architecture/PRINCIPES_DU_PRODUIT.md)** · **[Quick start](#quick-start)** · **[SDK](SDK.md)** · **[Architecture](packages/README.md)** · **[Current limits](#current-limits)**

</div>

Documentation : [spécifications de Web Geometry](docs/README.md) · [format 1](docs/FORMAT.md) · [exemple hôte](examples/minimal-webgl/README.md).

---

## Overview

Web Geometry brings geometry preparation, versioned runtime contracts and browser adapters into one reusable SDK. Applications consume the public SDK entry points.

The native compiler prepares exact geometry clusters, a spatial hierarchy and reusable cache pages. The browser adapter currently renders the prepared scene through Three.js and WebGL2, with a reference backend and an exact-cluster backend. When a WebGPU device is available, an optional page raster consumes the bounded WebGPU page cache and runs frustum + `lodScore` in compute; the CPU cut stays the A/A oracle and the silent fallback.

**The project is under active development.** The importer reads a versioned source manifest and the glTF it names. This is not yet a general-purpose virtualized geometry engine or an integrated WebGPU scene renderer.

## Quick start

Requirements: **Node.js 22.18 or newer**, npm, and a Rust toolchain with Cargo available on your path.

From the repository root:

```sh
npm install
npm run build
npm run build:native
npm test
npm run test:native
```

The TypeScript build emits ESM JavaScript and declarations into `dist/`. The native build produces `packages/asset-compiler-rust/target/release/web-geometry-compiler` (`.exe` on Windows; `rtl-asset-compiler` remains a compatibility alias).

The package is currently private and consumed locally; it has not been published to npm. Build it before importing it from a host project. Scene assets are supplied by the host and are not included in this repository.

## Public SDK

| Entry point | Purpose |
|---|---|
| `@web-geometry/sdk` or `@web-geometry/sdk/core` | Versioned contracts, jobs, progress, cancellation, diagnostics and safety policy |
| `@web-geometry/sdk/node` | Native compiler process adapter, filesystem access and compilation jobs |
| `@web-geometry/sdk/browser` | Explorer lifecycle, rendering backends, camera paths and WebGPU page cache |
| `@web-geometry/sdk/compiler-reference` | JavaScript reference compiler with injected source, cache and hashing |

Applications own their canvas, animation loop, resource URLs and controller disposal. Node hosts own source/cache directories and process configuration. React and Electron integrations can use these boundaries without introducing framework dependencies into the core.

See the [SDK guide](SDK.md) and [architecture notes](packages/README.md) for lifecycle, compatibility and fallback contracts. Consumers should use public exports rather than internal source paths.

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
| [`packages/asset-compiler-core`](packages/asset-compiler-core) | JavaScript reference implementation |
| [`packages/sdk-core`](packages/sdk-core) | Platform-independent TypeScript contracts and policies |
| [`packages/sdk-node`](packages/sdk-node) | Native process and filesystem integration |
| [`packages/sdk-browser`](packages/sdk-browser) | Browser rendering and GPU resource adapters |
| [`test`](test) | Public package integration tests |

## Current capabilities

| Area | Implemented scope |
|---|---|
| Native preparation | Verified source hashes, read-only binary mapping, exact index clusters, spatial hierarchy and bounded worker pool |
| Cache | SHA-addressed shared pages, validation before reuse and manifest publication after preparation |
| Browser rendering | Reference and exact-cluster WebGL2 backends, CPU hierarchy culling, source material preservation, optional WebGPU page raster with visbuffer + source-material second pass |
| Diagnostics | Beauty, wireframe and cluster views where supported by the selected backend |
| WebGPU resources | Page-cache API with uploads, pins, bounded slots and eviction; optional page raster (`webgpu-page-raster`) with GPU frustum + `lodScore` selection plus conservative backface cones, visbuffer encode of at most six non-indexed `drawIndirect` commands, and a CPU cut fallback |
| Jobs | Immutable progress snapshots, subscriptions and cancellation |
| Compatibility | Separate SDK and asset-format versions; explicit rejection of unsupported formats |
| Recovery | Prepared reference fallback for backend errors while the WebGL context remains usable |

## Evidence and validation

Correctness comes before performance. Compare reference and candidate images under identical scene, camera and rendering conditions before recording a performance verdict. Diagnostic overlays stay outside measured beauty passes. Unknown or uninstrumented metrics remain `null`.

The test suites cover compiler behavior and public SDK contracts. A passing build or unit test does not establish a rendering speedup. Physical scene campaigns and their raw measurements must record the input, revision, machine, cache state and timing boundary alongside each result.

## Current limits

- The importer reads `manifest.runtime.file` and the glTF buffer URI; it still rejects skins, sparse accessors, multiple buffers and non-triangle primitives. Arbitrary production glTF coverage is not complete.
- Compression, VGE1 and independently replaceable native pipeline stages remain future work. QEM endpoint collapse (`simplification: 'qem-endpoints'`) is available on the JavaScript reference compiler and the native compiler.
- GPU frustum + `lodScore` selection plus conservative backface cones (prepare-time page cones, `coneRejects` with perspective spread). Visbuffer encode instances resident pages from the page table and issues at most six non-indexed `drawIndirect` commands (cull mode × this-frame Hi-Z pass). `selectVisiblePages` remains the A/A oracle and the silent fallback. Compaction is a stable exclusive scan; overflow or a missing compact pipeline restores the per-page `draw()` loop and keeps `'indirect draw'` in `unsupported`. This is not `multiDrawIndexedIndirect`, not temporal Hi-Z, and not MeshStandardMaterial pixel-perfect. This-frame GPU Hi-Z (background 1, max reduction) is built from the vis occluder pass, then the rest is retested and drawn with `loadOp: 'load'`; remaining ⊆ the CPU cut, and a non-rejection is not an error. Node tests do not execute WGSL. CPU `applyHiz` is the fallback when compute Hi-Z is missing. Previous-frame depth as proof and cross-API device-loss recreation remain unimplemented. The WebGPU page raster falls back to the WebGL2 backends if the device is missing or lost; a missing visbuffer format falls back to the untextured page raster and leaves Hi-Z off.
- The compiler RAM option is an admission estimate, not an enforced peak-memory limit.
- Full graphics-device/context-loss recovery and cross-API fallback remain unimplemented.
- N-API/WASM bindings, published packages, signed native distributions and cross-platform performance CI remain pending.

See [architecture and implementation limits](packages/README.md) for the detailed contracts and remaining work.
