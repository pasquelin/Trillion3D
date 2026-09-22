# Web Geometry Documentation

[Contributing](../CONTRIBUTING.md): engineering practices, validation and review.

[Simple browser startup](SDK.md#simple-browser-startup): pass a canvas ID or element and opt into `interactive: true` for controls, CSS/DPR sizing and demand-driven rendering. Manual integration remains available.

This folder is the repository documentation only. The learning portal lives under `site/`, one TypeScript folder organised by role, and is published from the tree `pnpm build:docs` writes into `dist/site/` (see [LEARNING_PORTAL.md](LEARNING_PORTAL.md)): `index.html` is the portal (guides, constants and enums, every public function, the live WebGPU demo, the measurement reports staged by `node scripts/mesure/publierRapport.ts`); the demos run the engine's own kernels, bundled into `js/engine.js` at build time.

The delivered SDK is described by the [SDK guide](SDK.md), [package architecture](../packages/README.md), [native compiler](COMPILER.md), and [cache format](FORMAT.md). Anything not listed here is not part of the release.

| Document                                            | Role                                                                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [Native compiler](COMPILER.md)                      | `web-geometry-compiler`: CLI arguments, events, pointer, batch mode, cancellation, FBX/OBJ import, error codes                     |
| [Cache format](FORMAT.md)                           | Pointer, `clusters.json` and its binary sidecar `clusters.bin`, cluster DAG, culling hierarchy, streaming bundles, SHA objects     |
| [Product principles](PRODUCT_PRINCIPLES.md)         | Behavioral requirements: portable core, capabilities, source ownership, fallback                                                   |
| [Web / Electron / Node integration](INTEGRATION.md) | Canvas ownership, render loop, preparation, and fallback                                                                           |
| [Engine API, batch by batch](API.md)                | Functions each merged batch delivers: signature, what it computes, the host-library call replaced, the proof                       |
| [Tests and performance benchmarks](TESTS.md)        | Unit tests organization, GPU correctness probes, and 39 performance benchmarks                                                     |
| [Reference UE5 in numbers](REFERENCE_UE5.md)        | Published constants, bytes per triangle, and performance profile of the reference versus our engine; valid comparisons and caveats |

The end goal the engine is built for — dynamic global illumination, reflections and shadows — and the stages it is reached by are maintained in [`docs/LIGHTING_STRATEGY.md`](LIGHTING_STRATEGY.md). The backlog of open tasks is kept in the [GitHub issues](https://github.com/pasquelin/WebGeometry/issues); a finished task is closed.
