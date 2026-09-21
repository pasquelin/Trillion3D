# Learning portal maintenance

The learning portal is a React application whose sources live under `site/`, one TypeScript folder
organised by role, and whose published tree is built into `dist/site/`, which git ignores. It uses
hash routes so the same files work on GitHub Pages and with the local documentation server.
`site/app/main.tsx` is the composition root; route components own their interactive effects and
dispose them before the next route. `docs/` holds the repository documentation only.

## Source layout

- `site/app/` owns the shell, pages, reusable presentation components and routing.
  `portal/routes.ts` is the only place that translates URLs into page kinds; all generated links
  include the locale as `#/en/...` or `#/fr/...`, and old hashes are accepted using the current
  locale. `portal/data.ts` gathers the content entries. `Entry.tsx` renders API entries,
  `ApiDemo.tsx` renders the pure demo models, `engine-scene/` hosts the real WebGPU preview while
  keeping its imperative renderer behind a ref effect. `components/` contains the shared DaisyUI
  primitives: `CodeBlock.tsx` owns one inner scrolling region for all numbered lines and copies the
  original source string; `Stats.tsx` owns metric presentation; `gallery/ExampleCard.tsx` composes
  the same `Card` primitive for both the home page and the gallery. `components/highlighter.ts`
  wraps Highlight.js with the TypeScript grammar (including JavaScript); `code/` runs an edited
  snippet off the UI thread.
- `site/content/` owns the copy: `entries/*.ts` are the English API and guide entries (keep
  identifiers, signatures, module paths and executable examples in these source entries),
  `model.ts` declares the entry shape and the sections, `i18n/` contains French overlays and
  interface strings (`localizeEntries()` applies an overlay by entry id while preserving technical
  fields; missing fields and unsupported locales fall back to English through `t()`),
  `catalog.ts` is the visual example catalogue with its bilingual copy, `gallery-roadmap.json` the
  planned examples, `locale.ts` the two languages.
- `site/lessons/` owns what drives the engine: the playground scenarios, evaluation, canvas
  drawings and 3D geometry (`scenarios.ts`, `evaluate*.ts`, `draw*.ts`, `sceneGeometry*.ts`),
  `webgpuRenderer.ts` which mounts the shared, disposable 3D illustrations (geometry is derived
  from evaluated SDK results, 2D diagrams remain complementary), the renderer, lighting, camera
  and occlusion lessons with their runtimes, `offline/` for the compiled offline examples, and
  `engine-scene/` for the WebGPU scene lifecycle, camera controls, diagnostic modes and pure
  bilingual copy. Each catalogue item declares the API functions it demonstrates;
  `findExampleForFunction()` connects an API page to its relevant playground. The lesson runtimes
  import the browser SDK by its source entry, `packages/sdk-browser/index.ts`, so the type checker
  sees the engine's own types; the build keeps that import external and resolves it to the
  `runtime/engine.js` bundle beside `portal.js`.
- `site/demos/` contains the pure per-entry demonstration models; `kit.ts` declares their controls
  and result views, `registry.ts` maps entry ids to demos, and `engine.ts` is the one list of what
  the demos import from the engine — bundled as `js/engine.js`, the module the code editor's
  snippets import, so every demo and every edited snippet executes the engine itself.
- `site/reports/` owns the report contract (`contract.ts`), metric semantics, comparison
  eligibility and bilingual labels, beside the measurement records it reads (`index.json`, one
  folder per campaign).
- `site/styles/`, `site/assets/`, `site/data/`, `site/index.html` and `site/report.html` are served
  as they are.

Types are declared where the data is: the entry shape in `content/model.ts`, the catalogue item in
`content/catalog.ts`, the scenarios and lessons in `lessons/`, the demo model in `demos/kit.ts`,
the report in `reports/contract.ts`; components import them and declare their own props inline.
`tsconfig.site.json` checks the whole folder with `strict` and `allowJs` off (`check:site-types`),
and `check:no-js` refuses any JavaScript source under `site/`.

## Build and local preview

Install the repository dependencies, then run:

```sh
pnpm build:docs
pnpm docs:serve
```

`build:docs` runs `scripts/docs-build.mjs`, which writes the whole published tree into
`dist/site/`: it compiles `site/styles/tailwind.css` with Tailwind and DaisyUI into `css/site.css`
after scanning the handwritten HTML and TypeScript for class names, bundles the browser SDK and its
workers into `runtime/`, the demo maths into `js/engine.js` and the React portal into
`runtime/portal.js` with the areas `App.tsx` imports on demand — the gallery and its roadmap, the
playground and its code editor, the reports — as `runtime/portal-<hash>.js` chunks beside it,
then copies the statics (pages, assets, data, reports) — files only when missing or older. Nothing under `site/` is a build product and nothing built is committed: the
docs server, the browser proofs and the Pages workflow (`.github/workflows/pages.yml`, on every
push to `main`) build the same tree from the same function, `buildSite()` in
`scripts/docs/site.mjs`.

`docs:serve` runs `scripts/docs-serve.mjs`: it builds, then serves only `dist/site/` on
`http://127.0.0.1:4177`. This matches the published paths and adds no development framework or
fallback route.

### Build products: never committed, built by Pages

`dist/site/` is ignored by git and tracked on no branch: every consumer builds it on demand
(`docs:serve` and the browser proofs under `scripts/` and `test/browser/` build the whole tree; the
unit tests import the sources directly, the demos through `site/demos/engine.ts`, so no runner
builds anything), and `check:docs-bundles` in `validate` (`node scripts/docs-build.mjs --untracked`)
fails when git tracks any file of it. The repository's Pages source is "GitHub Actions":
`.github/workflows/pages.yml` runs on every push to `main`, installs the dependencies, runs
`build:docs` and deploys `dist/site/` as the Pages artifact. A release (`develop` → `main`)
therefore publishes the site built from the merged sources, without committing it.

The browser SDK keeps `three` and `three/*` external during the site build. The scene loads the
repository's current Three.js peer dependency from one pinned CDN URL at runtime. Do not bundle,
copy or vendor that dependency into the built tree; update the pinned URL together with the peer
dependency and exercise the live scene after the change.

## Adding a visual example

1. Add its id, bilingual title and description, category and demonstrated function ids to
   `site/content/catalog.ts`.
2. Under `site/lessons/`, add controls and presets to `scenarios.ts`, evaluation to
   `evaluate.ts`, 3D geometry to `sceneGeometry.ts`, 2D explanation to `draw.ts` and its displayed
   source to `code.ts`. Split detail modules when a maintained file approaches 200 lines.
3. Add every visible sentence to both languages in the relevant catalogue, guidance or control-label
   module; keep API names and code unchanged.
4. Run `node --test scripts/docs-gallery.test.mjs`. Confirm that the API pages for the declared
   functions link to the new playground and that changing language preserves the example route.

## Adding or translating documentation

Add the English entry to the relevant `site/content/entries/*.ts` array with a stable id. Add a
French overlay with the same id to the matching file under `site/content/i18n/`. Translate the title only when
it is editorial; function, type and constant names remain exact. Translate descriptions, argument
descriptions and guide HTML, while signatures, exports, module paths and code examples remain the
source contract. Add new navigation or component text to both locale tables used by `t()`.

Run `node --test scripts/docs-i18n.test.mjs test/integration/portail-documentation.test.mjs` after
content changes. The localization test requires parity across all entries and verifies that the
French overlays do not alter technical fields.

## Original scene and asset provenance

`site/assets/kinetic-garden/` is an original procedural teaching scene. Its source is generated by
`scripts/docs/garden-source.mjs` under the repository license; it contains no third-party models,
textures, shaders or sample code. Provenance and limitations live beside it in
`site/assets/kinetic-garden/README.md`. The scene is compact and demonstrates the public browser
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
`site/reports/`. Shared React components own its presentation; the modules of `site/reports/` own
the contract, metric semantics, comparison eligibility and bilingual labels. See the
[report pipeline](../scripts/mesure/report/README.md) for export and staging. The legacy
`report.html` URL forwards to this route. Campaign data is independent of the site build.
