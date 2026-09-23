# Web Geometry Documentation

The one index of the repository's documentation. The learning portal — guides, every public
function, live demos, examples and the measurement reports — is built from `site/` into
`dist/site/` and published on [GitHub Pages](https://pasquelin.github.io/WebGeometry/); how it is
maintained is [LEARNING_PORTAL.md](LEARNING_PORTAL.md).

Start with [Create a world](SDK.md#create-a-world): `createWorld(canvasOrId)` owns the scene, the
camera, the renderer and the loop.

| Document                                                             | Role                                                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [SDK guide](SDK.md)                                                  | The public API: a world, its families, the loop, the renderer option, lights, budgets, current limits                                    |
| [Engine internals](ENGINE.md)                                        | How a world draws: backend choice, page raster, surfaces, TAA, lighting, bounce, memory, diagnostics                                     |
| [Engine maths API](API.md)                                           | The unit and batch maths functions, each with its proof and its measured ratio                                                           |
| [Native compiler](COMPILER.md)                                       | `web-geometry-compiler`: arguments, events, pointer, batch mode, cancellation, imports, error codes                                      |
| [Compiler input formats](../packages/asset-compiler-rust/FORMATS.md) | Which source formats are read, on what legal basis, and how a driver is added ([PLUGINS.md](../packages/asset-compiler-rust/PLUGINS.md)) |
| [Cache format](FORMAT.md)                                            | Pointer, `clusters.json` and `clusters.bin`, cluster DAG, pages, textures, prepared scene tables                                         |
| [SDK facade](SDK_FACADE.md)                                          | The one `web-geometry` specifier and its common, browser, Node and measurement branches                                                  |
| [Package architecture](../packages/README.md)                        | What each package owns, the native library, release work still required                                                                  |
| [Product principles](PRODUCT_PRINCIPLES.md)                          | Portable core, compiled preparation, capabilities, silent fallback                                                                       |
| [Web / Electron / Node integration](INTEGRATION.md)                  | Who owns the canvas, the loop, the preparation and the fallback                                                                          |
| [Tests and benchmarks](TESTS.md)                                     | Test layout, GPU proofs, performance benchmarks, quality gates                                                                           |
| [Measurement harness](../bench/runner/README.md)                     | The bench, its options, the witnesses, the report                                                                                        |
| [The reference in numbers](REFERENCE.md)                             | The reference's published constants, bytes per triangle and profile, against ours                                                        |
| [Lighting strategy](LIGHTING_STRATEGY.md)                            | The end goal — dynamic global illumination, reflections, shadows — and the stages it is reached by                                       |
| [Contributing](../CONTRIBUTING.md)                                   | Engineering rules, measurement rules, the contribution workflow                                                                          |

Anything not described here is not part of the release. Open tasks are the
[GitHub issues](https://github.com/pasquelin/WebGeometry/issues).
