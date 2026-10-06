# Trillion3D Documentation

The one index of the repository's documentation. The learning portal — guides, every public
function, live demos, examples and the measurement reports — is built from `site/` into
`dist/site/` and published on [www.trillion3d.com](https://www.trillion3d.com/); how it is
maintained is [LEARNING_PORTAL.md](LEARNING_PORTAL.md).

Start with [Create a world](SDK.md#create-a-world): `createWorld(canvasOrId)` owns the scene, the
camera, the renderer and the loop.

| Document | Role |
| --- | --- |
| [SDK guide](SDK.md) | The public API: principles, entry points, a world, its families, the loop, the renderer option, lights, scene fog, budgets, integration, current limits |
| [API reference](API.md) | Index of the public API: each entry and the section that documents it |
| [Maths](MATHS.md) | Batch and unit maths for hosts: conventions, layouts, the batch functions and their witness ratios |
| [Physics](PHYSICS.md) | Jolt in the world: bodies, joints, vehicles, soft bodies, budgets, compiled colliders, exact raycast |
| [Engine internals](ENGINE.md) | How a world draws: backend choice, page raster, surfaces, TAA, lighting, bounce, memory, diagnostics, and the lighting target and its stages |
| [Residency](RESIDENCY.md) | What stays in memory: the cut rule, the geometry pool, out-of-memory answers, coverage counters, virtual textures |
| [Shadows](SHADOWS.md) | Virtual shadow maps: the page pool, its memory, clipmaps, one frame's passes, the static slice, the transmission atlas, metrics |
| [Native compiler](COMPILER.md) | `trillion3d-compiler`: arguments, events, pointer, batch mode, cancellation, imports, input formats, adding a format |
| [Compiler message codes](COMPILER_ERRORS.md) | Every message of the compiler and its Node adapter: public code, sentence, cause, action, one page per code |
| [Cache format](FORMAT.md) | Pointer, `clusters.json` and its pages, cluster DAG, pages, textures, prepared scene tables |
| [Package architecture](../packages/README.md) | What each package owns, the native library, release work still required |
| [Tests and benchmarks](TESTS.md) | Test layout, GPU proofs, performance benchmarks, quality gates |
| [Format fixtures](../tests/fixtures/formats/README.md) | The compiler's test inputs, one section per format: content, provenance, licence |
| [Measurement harness](../bench/runner/README.md) | The bench, its options, the witnesses, the published reports |
| [Contributing](../CONTRIBUTING.md) | Engineering rules, measurement rules, the contribution workflow |
| [Asset licence audit](ASSET_LICENSE_AUDIT.md) | `pnpm audit:assets`: the offline check of a corpus's licence manifest, and the licence table of every asset |
| [The company](COMPANY.md) | The AI roles that develop the repository, and how to run them from any clone |

Anything not described here is not part of the release. Open tasks are the
[GitHub issues](https://github.com/pasquelin/Trillion3D/issues).
