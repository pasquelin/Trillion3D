# Trillion3D Documentation

The one index of the repository's documentation. The learning portal — guides, every public
function, live demos, examples and the measurement reports — is built from `site/` into
`dist/site/` and published on [www.trillion3d.com](https://www.trillion3d.com/); how it is
maintained is [LEARNING_PORTAL.md](LEARNING_PORTAL.md).

Start with [Create a world](SDK.md#create-a-world): `createWorld(canvasOrId)` owns the scene, the
camera, the renderer and the loop.

| Document | Role |
| --- | --- |
| [SDK guide](SDK.md) | The public API, each entry documented once: principles, entry points, a world, its families, the loop, lights, scene fog, budgets, integration, current limits |
| [Maths](MATHS.md) | Batch and unit maths for hosts: conventions, layouts, the batch functions and their witness ratios |
| [Physics](PHYSICS.md) | Jolt in the world: bodies, joints, vehicles, soft bodies, budgets, compiled colliders, exact raycast |
| [Engine internals](ENGINE.md) | The map of the engine: the session, the frame's stages and the files that own them, the rules across files |
| [Residency](RESIDENCY.md) | What stays in memory: the cut rule, the geometry pool, out-of-memory answers, coverage counters, virtual textures |
| [Shadows](SHADOWS.md) | Virtual shadow maps: the page pool, its memory, clipmaps, one frame's passes, the static slice, the transmission atlas, metrics |
| [Native compiler](COMPILER.md) | `trillion3d-compiler`: arguments, events, pointer, batch mode, cancellation, imports, input formats, adding a format |
| [Cache format](FORMAT.md) | Pointer, `clusters.json` and its pages, cluster DAG, pages, textures, prepared scene tables |
| [Package architecture](../packages/README.md) | What each package owns, the native library, release work still required |
| [Tests and benchmarks](TESTS.md) | Test layout, GPU proofs, performance benchmarks, quality gates |
| [Format fixtures](../tests/fixtures/formats/README.md) | The compiler's test inputs, one section per format: content, provenance, licence |
| [Measurement harness](../bench/runner/README.md) | The bench, its options, the witnesses, the published reports |
| [Contributing](../CONTRIBUTING.md) | Engineering rules, measurement rules, the contribution workflow |
| [Asset licence audit](ASSET_LICENSE_AUDIT.md) | `pnpm audit:assets`: the offline check of a corpus's licence manifest, and the licence table of every asset |

Anything not described here is not part of the release. Open tasks are the
[GitHub issues](https://github.com/pasquelin/Trillion3D/issues).
