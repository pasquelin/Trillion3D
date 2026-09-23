# Web Geometry Documentation

[Contributing](../CONTRIBUTING.md): engineering practices, validation and review.

[Create a world](SDK.md#create-a-world): `createWorld(canvasOrId)` owns the scene, the camera, the renderer and the loop; every family a page writes with is listed in [SDK.md#families](SDK.md#families).

This folder is the repository documentation only. The learning portal lives under `site/`, one TypeScript folder organised by role, and is published from the tree `pnpm build:docs` writes into `dist/site/` (see [LEARNING_PORTAL.md](LEARNING_PORTAL.md)): `index.html` is the portal (guides, constants and enums, every public function, the live WebGPU demo, the measurement reports staged by `node bench/runner/publierRapport.ts`); the demos run the engine's own kernels, bundled into `js/engine.js` at build time.

The delivered SDK is described by the [SDK guide](SDK.md), [package architecture](../packages/README.md), [native compiler](COMPILER.md), and [cache format](FORMAT.md). Anything not listed here is not part of the release.

| Document                                            | Role                                                                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [SDK guide — families](SDK.md#families)             | Every family `createWorld` hands a page — `geometry`, `material`, `light`, `camera`, `object`, `page`, `budget`, `metric`, `diagnostic`, `capability`, `capture`, `pose`, `batch`, … — one example each |
| [Native compiler](COMPILER.md)                      | `web-geometry-compiler`: CLI arguments, events, pointer, batch mode, cancellation, FBX/OBJ import, error codes                     |
| [Cache format](FORMAT.md)                           | Pointer, `clusters.json` and its binary sidecar `clusters.bin`, cluster DAG, culling hierarchy, streaming bundles, SHA objects     |
| [Product principles](PRODUCT_PRINCIPLES.md)         | Behavioral requirements: portable core, capabilities, source ownership, fallback                                                   |
| [Web / Electron / Node integration](INTEGRATION.md) | Canvas ownership, render loop, preparation, and fallback                                                                           |
| [Engine API, batch by batch](API.md)                | Functions each merged batch delivers: signature, what it computes, the host-library call replaced, the proof                       |
| [Tests and performance benchmarks](TESTS.md)        | Unit tests organization, GPU correctness probes, and 39 performance benchmarks                                                     |
| [Reference UE5 in numbers](REFERENCE_UE5.md)        | Published constants, bytes per triangle, and performance profile of the reference versus our engine; valid comparisons and caveats |

The end goal the engine is built for — dynamic global illumination, reflections and shadows — and the stages it is reached by are maintained in [`docs/LIGHTING_STRATEGY.md`](LIGHTING_STRATEGY.md). The backlog of open tasks is kept in the [GitHub issues](https://github.com/pasquelin/WebGeometry/issues); a finished task is closed.
