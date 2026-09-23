# Learning portal maintenance

The learning portal is a React application whose sources live under `site/`, one TypeScript folder
organised by role, and whose published tree is built into `dist/site/`, which git ignores. It uses
hash routes so the same files work on GitHub Pages and with the local documentation server.
`site/app/main.tsx` is the composition root; route components own their interactive effects and
dispose them before the next route. `docs/` holds the repository documentation only.

## Source layout

- `site/app/` owns the portal, in three layers and nothing outside them:
  - **primitives**, `ui/`: each DaisyUI component wrapped once — `Button` (and `LinkButton`,
    `Actions`), `Card`, `Badge`, `Alert`, `Modal`, `Fab`, `Tabs`, `Table`, `Input` (fields and
    `SearchInput`), `CodeBlock`, `RenderFrame`, `Grid`, `List`, `Split`, `Text`, `Toast`, `Icon`,
    and the richer pieces built on them (charts, stats, the code editor, the lesson controls).
    `CodeBlock.tsx` owns one inner scrolling region for all numbered lines and copies the original
    source string; `highlighter.ts` wraps Highlight.js with the TypeScript grammar;
  - **layouts**, `layout/`: `Shell.tsx` (the header, one sidebar per area, the page, the site
    search), and the two page templates — `DocPage.tsx` (eyebrow, title, lead, actions, body and
    an optional aside) for every page that is read, `DemoPage.tsx` for every page that is played;
  - **pages**, composed only from layouts and primitives: no class of their own, no inline style,
    no DOM written by hand. A page that needs something new adds a primitive.

  `App.tsx` reads the route (`hooks/useRoute.ts`), localizes the entries and hands both to the
  shell through `layout/PortalContext.ts`; the theme, the drawer and the search shortcut are the
  hooks `useTheme`, `useDrawer` and `useSearchShortcut`. Strings come from `t()`, imported where
  they are used. `portal/routes.ts` is the only place that translates URLs into page kinds: every
  link carries the locale as `#/en/...` or `#/fr/...`; the areas are Learn, Examples, API
  reference and Measurements (the lessons live under Learn), and a hash without a locale opens the
  home page. `portal/data.ts` gathers the content entries, `portal/searchIndex.ts` builds what the
  site search reads — every guide, API entry, ready example and lesson in the current language —
  and `layout/SearchModal.tsx` shows it (the header button, `/` or ⌘K; arrows and Enter).
  `Entry.tsx` renders API entries, `ApiDemo.tsx` the pure demo models, `engine-scene/` the real
  WebGPU preview behind a ref effect; `code/` runs an edited lesson snippet off the UI thread.

- `site/content/` owns the copy: `entries/*.ts` are the English API and guide entries (keep
  identifiers, signatures, module paths and executable examples in these source entries),
  `model.ts` declares the entry shape and the sections, `i18n/` contains French overlays and
  interface strings (`localizeEntries()` applies an overlay by entry id while preserving technical
  fields; missing fields and unsupported locales fall back to English through `t()`),
  `catalog.ts` is the lesson catalogue with its bilingual copy, `gallery-roadmap.json` the list of
  examples (see below), `locale.ts` the two languages.
- `site/lessons/` owns what drives the engine: the playground scenarios, evaluation, canvas
  drawings and 3D geometry (`scenarios.ts`, `evaluate*.ts`, `draw*.ts`, `sceneGeometry*.ts`),
  `webgpuRenderer.ts` which mounts the shared, disposable 3D illustrations (geometry is derived
  from evaluated SDK results, 2D diagrams remain complementary), the renderer, lighting, camera
  and occlusion lessons with their runtimes, `offline/` for the compiled offline examples, and
  `engine-scene/` for the WebGPU scene lifecycle, camera controls, diagnostic modes and pure
  bilingual copy. Each catalogue item declares the API functions it demonstrates;
  `apiScenario()` connects an API page to its related lesson. The lesson runtimes
  import the browser SDK by its source entry, `packages/sdk-browser/src/index.ts`, so the type checker
  sees the engine's own types; the build keeps that import external and resolves it to the
  `runtime/engine.js` bundle beside `portal.js`.
- `site/examples/` owns the examples: one standalone HTML file per example, `<id>.html`, which
  imports the built engine as `../runtime/engine.js`, loads a compiled scene from `../assets/` and
  runs as-is from the built site — or copied into a user's project, paths adjusted. The list is
  `site/content/gallery-roadmap.json`: the themes, then one entry per example with `id`, a
  bilingual `title`, its `theme` and its `file`, empty until the example exists. The Examples area
  shows the ready ones only (an entry with a `file`): its sidebar lists them theme by theme with
  their thumbnail and a filter box, its landing page is one card per example with its settled
  render (`site/assets/examples/thumbnails/<id>.png`, captured by
  `scripts/docs-examples-thumbnails.ts`). One example is the file on `DemoPage`: the iframe fills
  the content area under a one-line banner, and one DaisyUI floating action button carries Code (a
  modal with the source in the code editor: Run loads the edited source as the iframe's `srcdoc`
  with a `<base href>` at the file's address, so `../runtime/engine.js` and `../assets/` resolve;
  Reset returns to the file; Copy), Share (copies the page link), Controls, Fullscreen and Restart.
  The compiled scenes live under `site/assets/examples/`, each `<scene>/source` beside its
  `cache`, built by `scripts/docs-examples-assets.ts` with this checkout's native compiler; the
  models that some scenes import, and their licences, are listed in
  `site/assets/examples/CREDITS.md`.

  **The page ↔ example contract.** The page posts one message to the example's window, and only
  one: `{ type: 'wg:controls', visible: boolean }`, to show or hide the example's controls panel —
  when the reader presses Controls, and again after every load of the iframe with the current
  state. An example that has a panel listens for it; one without ignores it. Nothing else goes
  through `postMessage`: Restart remounts the iframe on the file (or on the edited source after a
  Run), and Run remounts it on the edited source.

- `site/demos/` contains the pure per-entry demonstration models; `kit.ts` declares their controls
  and result views, `registry.ts` maps entry ids to demos, and `engine.ts` is the one list of what
  the demos import from the engine — bundled as `js/engine.js`, the module the code editor's
  snippets import, so every demo and every edited snippet executes the engine itself.
- `site/reports/` owns the report contract (`contract.ts`), metric semantics, comparison
  eligibility and bilingual labels, beside the measurement records it reads (`index.json`, one
  folder per campaign).
- `site/styles/` holds `tailwind.css` and `portal.css`, which keeps only the design tokens and the
  primitives' own rules; `site/assets/`, `site/data/` and `site/index.html` are served as they are.

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

`build:docs` runs `scripts/docs-build.ts`, which writes the whole published tree into
`dist/site/`: it compiles `site/styles/tailwind.css` with Tailwind and DaisyUI into `css/site.css`
after scanning the handwritten HTML and TypeScript for class names, bundles the browser SDK and its
workers into `runtime/`, the demo maths into `js/engine.js` and the React portal into
`runtime/portal.js` with the areas `App.tsx` imports on demand — the examples, the lessons
gallery, the lessons and their code editor, the reports — as `runtime/portal-<hash>.js` chunks
beside it, then copies the statics (pages, examples, assets, data, reports) — files only when
missing or older. Nothing under `site/` is a build product and nothing built is committed: the
docs server, the browser proofs and the Pages workflow (`.github/workflows/pages.yml`, on every
push to `main`) build the same tree from the same function, `buildSite()` in
`scripts/docs/site.ts`.

`docs:serve` runs `scripts/docs-serve.ts`: it builds, then serves only `dist/site/` on
`http://127.0.0.1:4177`. This matches the published paths and adds no development framework or
fallback route.

### Build products: never committed, built by Pages

`dist/site/` is ignored by git and tracked on no branch: every consumer builds it on demand
(`docs:serve` and the browser proofs under `scripts/` and `tests/browser/renders/` build the whole tree; the
unit tests import the sources directly, the demos through `site/demos/engine.ts`, so no runner
builds anything), and `check:docs-bundles` in `validate` (`node scripts/docs-build.ts --untracked`)
fails when git tracks any file of it. The repository's Pages source is "GitHub Actions":
`.github/workflows/pages.yml` runs on every push to `main`, installs the dependencies, runs
`build:docs` and deploys `dist/site/` as the Pages artifact. A release (`develop` → `main`)
therefore publishes the site built from the merged sources, without committing it.

The runtime bundle is self-contained: every dependency is bundled at build time from the installed
packages; none stays external or is loaded from a CDN.

## Adding an example

1. Write `site/examples/<id>.html`: one file, a `<canvas id="view">`, no import map, and a module
   script that imports `createWorld` and the families it needs (`object`, `geometry`, `material`,
   `light`, …) from `../runtime/engine.js`. Keep it as short as the feature allows, and make it
   something to play with. `controls` from `../runtime/kit.js` (sources in `site/examples/kit/`,
   bundled beside the engine) draws a panel in the corner of the render:
   `controls({ light: [0, 10, 3], colour: '#88aaff', spin: true, view: ['a', 'b'], reset: () => {} },
   onChange)` gives sliders (`[min, max, value, step?]`), colour pickers, toggles, choices and
   buttons, returns the live values and calls `onChange(values, key)` once at start and after every
   change. Name each control so that its label says what to try; there is no caption over the
   render. The page hosting the example hides or shows the panel by posting
   `{ type: 'wg:controls', visible }` to its frame.
2. A scene of primitives is built in code, with `geometry.*`, directly in the example's HTML. A
   scene built around an imported model is added to `scripts/docs/examples/models.ts`, credited in
   `site/assets/examples/CREDITS.md`, then run `pnpm build:native` and
   `node scripts/docs-examples-assets.ts <scene>`.
3. Add its entry to `site/content/gallery-roadmap.json`, `file` set to `examples/<id>.html`, in
   learning order within its theme, or turn its "in progress" entry into it: an entry with no
   `file` carries `status` (`buildable`, or `needs-engine` with the engine feature it waits for in
   `missing`, in both languages). Then capture its thumbnail:
   `node scripts/docs-examples-thumbnails.ts <id>`. The capture hides the kit's panels and the
   credit line and waits for the example's most telling moment, the seconds it declares in
   `<meta name="thumbnail" content="3">` (1.5 when it declares none).
4. Run `node --test scripts/docs-examples.test.ts`, then the browser proofs
   `node --test scripts/docs-examples.browser.ts` and `node --test scripts/docs-shell.browser.ts`.

## Adding a lesson

1. Add its id, bilingual title and description, category and demonstrated function ids to
   `site/content/catalog.ts`.
2. Under `site/lessons/`, add controls and presets to `scenarios.ts`, evaluation to
   `evaluate.ts`, 3D geometry to `sceneGeometry.ts`, 2D explanation to `draw.ts` and its displayed
   source to `code.ts`. Split detail modules when a maintained file approaches 200 lines.
3. Add every visible sentence to both languages in the relevant catalogue, guidance or control-label
   module; keep API names and code unchanged.
4. Run `node --test scripts/docs-gallery.test.ts`. Confirm that the API pages for the declared
   functions link to the new lesson and that changing language preserves the example route.

## Adding or translating documentation

Add the English entry to the relevant `site/content/entries/*.ts` array with a stable id. Add a
French overlay with the same id to the matching file under `site/content/i18n/`. Translate the title only when
it is editorial; function, type and constant names remain exact. Translate descriptions, argument
descriptions and guide HTML, while signatures, exports, module paths and code examples remain the
source contract. Add new navigation or component text to both locale tables of
`site/content/i18n/strings.ts`, read by `t()`; the i18n test refuses a key missing from one.

Run `node --test scripts/docs-i18n.test.ts tests/integration/documentation-portal.test.ts` after
content changes. The localization test requires parity across all entries and verifies that the
French overlays do not alter technical fields.

## Original scene and asset provenance

`site/assets/kinetic-garden/` is an original procedural teaching scene. Its source is generated by
`scripts/docs/garden-source.ts` under the repository license; it contains no third-party models,
textures, shaders or sample code. Provenance and limitations live beside it in
`site/assets/kinetic-garden/README.md`. The scene is compact and demonstrates the public browser
SDK; it is not a performance or large-residency benchmark.

Regenerate it with:

```sh
pnpm build:native
pnpm docs:scene
```

`docs:scene` runs `scripts/docs-scene.ts`, regenerates the deterministic glTF source, then invokes
this checkout's native compiler to write the published cache. `WG_COMPILER` may select a compatible
compiler binary. Never replace source assets with compiler outputs or import assets from a
neighbouring project. Review the generated manifest provenance and run
`node --test scripts/docs-scene.test.ts` before publishing a regenerated cache.

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
the repository measurement harness described in `bench/runner/README.md`, identical input, camera,
quality and resource budgets, plus resolution, DPR, commit, display cap and run-to-run spread.
A bench witness is never imported by a portal example or demo: it is
named only through the measurement entry point (`packages/sdk-browser/src/measurement/measurement.ts`) the bench
and the report pipeline use.

API pages may show a related concept beside their original snippet. The panel labels this
relationship explicitly and links to the interactive example with its own inputs and matching code.
This is not a claim that every API function has a direct visual execution witness. Keep direct
function mappings in the catalogue limited to functions actually called by the evaluator.

## Benchmark reports

The Measurements route (`#/en/reports` or `#/fr/reports`) reads versioned campaign data from
`site/reports/`. Shared React components own its presentation; the modules of `site/reports/` own
the contract, metric semantics, comparison eligibility and bilingual labels. See the
[report pipeline](../bench/runner/README.md#published-reports) for export and staging. The page is
a `DocPage`, its sidebar the parts of the campaign. Campaign data is independent of the site build.
