# Learning portal maintenance

The learning portal is a React application served from `docs/`. It uses hash routes so the same
files work on GitHub Pages and with the local documentation server. `docs/react/main.tsx` is the
composition root; route components own their interactive effects and dispose them before the next
route.

## Source layout

- `docs/react/` owns the shell, pages and reusable presentation components. `Entry.tsx` renders API
  entries, `ApiDemo.tsx` renders the pure demo models, and `engine-scene/` hosts the real WebGPU
  preview while keeping its imperative renderer behind a ref effect.
- `docs/js/portal/` owns the route and content data used by the React application.
  `routes.js` is the only place that translates URLs into page kinds. All generated links include
  the locale as `#/en/...` or `#/fr/...`; old hashes are accepted using the current locale.
- `docs/js/docsContent*.js` contains the English API and guide entries. Keep identifiers,
  signatures, module paths and executable examples in these source entries.
- `docs/js/i18n/` contains French overlays and interface strings. `localizeEntries()` applies an
  overlay by entry id while preserving technical fields. Missing fields and unsupported locales
  fall back to English through `t()`.
- `docs/js/gallery/` owns the visual example catalogue, bilingual copy, evaluation and canvas
  drawings. `webgpuRenderer.js` mounts the shared, disposable 3D illustrations; geometry is
  derived from evaluated SDK results, and 2D diagrams remain complementary. Each catalogue item
  declares the API functions it demonstrates;
  `findExampleForFunction()` connects an API page to its relevant playground.
- `docs/js/engine-scene/` owns the WebGPU scene lifecycle and pure bilingual copy. React imports the
  generated browser SDK when the scene mounts, renders while controls settle, and disposes controls,
  observers and the explorer when the route changes.
- `docs/js/demo*.js` contains the pure per-entry demonstration models. `demoKit.js` defines their
  controls and result views; `docs/react/ApiDemo.tsx` localizes and presents them.
- `docs/react/components/` contains the shared DaisyUI primitives. `CodeBlock.tsx` owns one inner
  scrolling region for all numbered lines and copies the original source string. `Stats.tsx` owns
  metric presentation. `gallery/ExampleCard.tsx` composes the same `Card` primitive for both the home
  page and the gallery; the whole card is a link, with one shared preview shape and no nested button.
- `docs/js/components/highlightLines.js` uses Highlight.js with the TypeScript grammar (including
  JavaScript) through `highlighter.js`, a handwritten module bundled by `build:docs`. Multiline
  tokens remain balanced per numbered row without introducing a separate scroll area on each line.

## Build and local preview

Install the repository dependencies, then run:

```sh
pnpm build:docs
pnpm docs:serve
```

`build:docs` runs `scripts/docs-build.mjs`. It compiles `docs/styles/tailwind.css` with Tailwind
and DaisyUI into `docs/css/site.css`, scans the handwritten HTML, JavaScript and TypeScript for
class names, bundles the public maths the demos run into `docs/js/engine.js`, and bundles the React
portal, browser SDK and workers into `docs/runtime/`. `scripts/docs/bundles.mjs` names these
generated files: change their sources and rebuild instead of editing the outputs. The React
components and the content, gallery, localization and engine-scene modules under `docs/js/` are
handwritten.

`docs:serve` runs `scripts/docs-serve.mjs`: it builds the bundles, then serves only the `docs/`
tree on `http://127.0.0.1:4177`. This matches the published paths and adds no development framework
or fallback route.

### Generated bundles: never committed, built by Pages

The bundles are ignored by git and tracked on no branch: every consumer builds them on demand
(`docs:serve` and the browser proofs under `scripts/` and `test/browser/` build all of them; the
unit-test runners `scripts/test-unit.mjs` and `scripts/check-changed.mjs` build `js/engine.js`,
which the handwritten modules under `docs/js/` import, before any test loads; the portal build
resolves that import to its entry and needs no file), and `check:docs-bundles` in `validate`
(`node scripts/docs-build.mjs --untracked`) fails when git tracks any of them. The repository's Pages source is "GitHub Actions":
`.github/workflows/pages.yml` runs on every push to `main`, installs the dependencies, runs
`build:docs` and deploys the `docs/` tree as the Pages artifact. A release (`develop` → `main`)
therefore publishes the bundles built from the merged sources, without committing them.

The browser SDK keeps `three` and `three/*` external during the documentation build. The scene
loads the repository's current Three.js peer dependency from one pinned CDN URL at runtime. Do not
bundle, copy or vendor that dependency into `docs/runtime/`; update the pinned URL together with the
peer dependency and exercise the live scene after the change.

## Adding a visual example

1. Add its id, bilingual title and description, category and demonstrated function ids to
   `docs/js/gallery/catalog.js`.
2. Add controls and presets to `scenarios.js`, evaluation to `evaluate.js`, 3D geometry to `sceneGeometry.js`, 2D explanation to `draw.js`,
   and its displayed source to `code.js`. Split detail modules when a maintained file approaches
   200 lines.
3. Add every visible sentence to both languages in the relevant catalogue, guidance or control-label
   module; keep API names and code unchanged.
4. Run `node --test scripts/docs-gallery.test.mjs`. Confirm that the API pages for the declared
   functions link to the new playground and that changing language preserves the example route.

## Adding or translating documentation

Add the English entry to the relevant `docsContent*.js` array with a stable id. Add a French
overlay with the same id to the matching file under `docs/js/i18n/`. Translate the title only when
it is editorial; function, type and constant names remain exact. Translate descriptions, argument
descriptions and guide HTML, while signatures, exports, module paths and code examples remain the
source contract. Add new navigation or component text to both locale tables used by `t()`.

Run `node --test scripts/docs-i18n.test.mjs test/integration/portail-documentation.test.mjs` after
content changes. The localization test requires parity across all entries and verifies that the
French overlays do not alter technical fields.

## Original scene and asset provenance

`docs/assets/kinetic-garden/` is an original procedural teaching scene. Its source is generated by
`scripts/docs/garden-source.mjs` under the repository license; it contains no third-party models,
textures, shaders or sample code. Provenance and limitations live beside it in
`docs/assets/kinetic-garden/README.md`. The scene is compact and demonstrates the public browser
SDK; it is not a performance or large-residency benchmark.

Regenerate it with:

```sh
pnpm build:native
pnpm docs:scene
```

`docs:scene` runs `scripts/docs-scene.mjs`, regenerates the deterministic glTF source, then invokes
this checkout's native compiler to write the published cache. `WG_COMPILER` may select a compatible
compiler binary. Never replace source assets with compiler outputs or import assets from a
neighbouring project. Review the generated manifest provenance and run
`node --test scripts/docs-scene.test.mjs` before publishing a regenerated cache.

## Reading live performance counters

Live demo counters describe the current browser and scene; they are not comparative benchmarks.
Use DaisyUI `stats`, `stat`, `stat-title`, `stat-value` and `stat-desc` for their presentation.
FPS comes from consecutive animation-frame intervals during active rendering. A settled scene
reports an idle state instead of inventing a continuously measured frame rate. CPU submission time
is not GPU duration, and the two must never be added. Unknown measurements remain unavailable.

Memory figures must name their scope: owned visualization buffers, engine geometry pool, resident
pages or cache bytes. Configured budgets are limits, not measured memory consumption. WebGPU does
not expose total physical GPU memory consumption to this application.

The gallery's procedural 3D illustrations explain SDK calculations; the compiled garden executes
the streaming pipeline. Neither proves a speedup over another renderer. Comparative claims require
the repository measurement harness described in `scripts/mesure/README.md`, identical input, camera,
quality and resource budgets, plus resolution, DPR, commit, display cap and run-to-run spread.

API pages may show a related concept beside their original snippet. The panel labels this
relationship explicitly and links to the interactive example with its own inputs and matching code.
This is not a claim that every API function has a direct visual execution witness. Keep direct
function mappings in the catalogue limited to functions actually called by the evaluator.

## Benchmark reports

The Measurements route (`#/en/reports` or `#/fr/reports`) reads versioned campaign data from
`docs/reports/`. Shared React components own its presentation; `docs/js/reports/` owns metric
semantics, comparison eligibility and bilingual labels. See the
[report pipeline](../scripts/mesure/report/README.md) for export and staging. The legacy
`report.html` URL forwards to this route. Campaign data is independent of the site build.
