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

**[Documentation ↗](https://www.trillion3d.com/)** · **[Live report ↗](https://www.trillion3d.com/#/en/reports)** · **[Why](#why-trillion3d)** · **[Quick start](#quick-start)** · **[Compiler](docs/COMPILER.md)** · **[SDK](docs/SDK.md)** · **[Architecture](packages/README.md)** · **[Bench](bench/runner/README.md)**

</div>

---

## Why Trillion3D

The best desktop engines changed what a scene can hold: geometry is streamed by clusters, one cut
through a DAG per frame, drawn through a visibility buffer, resolved by temporal antialiasing, held
under a fixed memory budget. **Trillion3D builds that for the web's constraints** — no hardware ray
tracing, bounded and unreadable GPU memory, one browser frame — from its own derivations, and
measures itself against the numbers those engines publish. The geometry is the foundation; the
lighting is what it is for.

|   |   |
|---|---|
| **Fixed budgets** | memory in bytes and frame time in milliseconds are set, not discovered on the machine |
| **Residency by the frame** | what stays on the GPU is what the frame actually read, pages and texture tiles alike |
| **Compression at cook time** | the compiler pays once; the runtime decodes pages, it never recomputes them |
| **No work in a still scene** | a fixed camera redraws zero pages — measured, not assumed |

## What it does

| Area | Scope |
|---|---|
| **Native compiler** | glTF/GLB, FBX, OBJ, USD/USDZ, Alembic, `.blend`, Maya ASCII and Unity scenes, a dozen image formats, read by its own drivers; a cluster DAG down to one root, each cluster carrying its screen error; streaming bundles; a bounded worker pool ([docs/COMPILER.md](docs/COMPILER.md)) |
| **Cache** | SHA-addressed objects, validated before reuse; `formatVersion` separate from the compiler version ([docs/FORMAT.md](docs/FORMAT.md)) |
| **WebGPU page raster** | the cut in compute, two-phase Hi-Z occlusion, a visibility buffer, deferred material shading, temporal antialiasing ([docs/ENGINE.md](docs/ENGINE.md)) |
| **Textures** | virtual texturing: a bounded tile pool, residency driven by what the frame sampled |
| **Lighting** | metallic-roughness microfacet shading, no fixed ambient term; sun and lamps through virtual shadow maps ([docs/SHADOWS.md](docs/SHADOWS.md)); per-tile light rejection |
| **Memory** | fixed reservoirs for pages and tiles, adjustable in session without losing residency ([docs/RESIDENCY.md](docs/RESIDENCY.md)) |
| **Fallbacks** | WebGPU pages when the machine grants a device, WebGL2 pages otherwise; a forced renderer the machine lacks is refused by name, never swapped |
| **Physics** | Jolt in a worker, every body an ordinary mesh ([docs/PHYSICS.md](docs/PHYSICS.md)) |

## Quick start

Requirements: **Node.js 22.18 or newer**, **pnpm**, and a Rust toolchain with Cargo on your path.

```sh
pnpm install
pnpm run build           # TypeScript → dist/ (ESM + declarations)
pnpm run build:native    # → packages/asset-compiler-rust/target/release/trillion3d-compiler
pnpm test                # unit and integration tests
pnpm run test:native     # cargo test
```

This builds the repository. The package is not on npm yet; from its first release, an application
installs it instead — `npm install trillion3d`, then `npx trillion3d-compile` for its models — as
the portal's [Install page](https://www.trillion3d.com/#/en/learn/install) shows, with the
supported platforms and the server headers.

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

The world owns the scene, the camera, the renderer and the loop, and pauses once the image is
stable: [Create a world](docs/SDK.md#create-a-world). A model is compiled once by the native
compiler, `trillion3d-compiler`, which a host drives through three streams (JSON events on stderr,
a pointer on stdout, cancel requests on stdin) or through `prepare` in Node:
[docs/COMPILER.md](docs/COMPILER.md).

## Public SDK

Every consumer imports `trillion3d`; conditional exports give a worker or any environment the
contracts, maths, jobs and diagnostics, Node the compiler process adapter, and a browser bundler
`createWorld` and its families ([Entry points](docs/SDK.md#entry-points)).

Without a bundler, a page imports the browser entry built as one module, `trillion3d/module`
(`dist/trillion3d.module.js`), with its workers, WebAssembly modules and source map beside it. A
CDN serving the package's files (jsDelivr, unpkg) needs one `importmap` line; the workers start
across origins. Each optional family — physics, particles, WebGPU transmission and deformation, the
effect chain, guides, diagnostic views — is a chunk of its own, fetched with the scene that uses it
before any frame is drawn; a plain scene fetches none.

```html
<script type="importmap">
  {
    "imports": { "trillion3d": "https://cdn.jsdelivr.net/npm/trillion3d/dist/trillion3d.module.js" }
  }
</script>
<script type="module">
  import { createWorld } from 'trillion3d';
</script>
```

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

What each package owns: [packages/README.md](packages/README.md).

## Measuring

Frame time is measured on the GPU bench, which draws a site page in Node on the machine's GPU
through Dawn; a Chrome harness serves the WebGL2 proofs and pits the engine against two witnesses,
bare Three.js and Three.js with a three-level `THREE.LOD`. Both, and the published reports:
[bench/runner/README.md](bench/runner/README.md); the measurement rules:
[CONTRIBUTING.md](CONTRIBUTING.md#measure-before-optimising).

## Quality bar

`pnpm run validate` — format, lint, Clippy, unused code, builds, declarations, links, every
JS/TS/Rust test — gates each pull request in CI ([`quality.yml`](.github/workflows/quality.yml));
`pnpm run test:gpu` adds the proofs on a real GPU. The gates:
[docs/TESTS.md](docs/TESTS.md#4-quality-gates); the rules a contribution follows:
[CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

Every document, and what it is for, is listed once in [docs/README.md](docs/README.md). The
documentation, the code and its identifiers are in English.

## Current limits

- Not yet a general-purpose engine: `scene.load` reads a versioned source manifest and the source
  it names; non-triangle primitives and non-standard glTF extensions are unsupported. A world built
  in code (`geometry`, `material`, `object`, `light`) does not go through the compiler.
- Specular environment-map IBL is not implemented; a lost device is recovered without reloading the
  page (`gpu-device-recovered`); a missing visibility-buffer format falls back to the untextured
  page raster with Hi-Z off.
- Physics threads need a cross-origin isolated page (COOP/COEP); without it the physics runs on one
  worker, silently.
- No N-API binding of the compiler, published package or signed native distribution yet; only
  macOS arm64 is built and run here
  ([release work](packages/README.md#release-work-still-required)).

## Licence

Trillion3D is published under the [PolyForm Noncommercial License 1.0.0](LICENSE): free for
noncommercial use, study, research and personal projects. **Commercial use requires a separate
licence** from the copyright holder — open an issue or contact the author.

Copyright © 2026 Alban Pasquelin.

The physics is [Jolt Physics](https://github.com/jrouwe/JoltPhysics) (MIT), built from its
official sources: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
