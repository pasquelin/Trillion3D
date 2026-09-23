# Learning portal maintenance

The learning portal is a React application whose sources live under `site/`, one TypeScript folder
organised by role, and whose published tree is built into `dist/site/`, which git ignores. It uses
hash routes so the same files work on the public site and with the local documentation server.
`site/app/main.tsx` is the composition root; route components own their interactive effects and
dispose them before the next route. `docs/` holds the repository documentation only.

## Source layout

- `site/app/` owns the portal, in three layers and nothing outside them:
  - **primitives**, `ui/`: each DaisyUI component wrapped once — `Button` (and `LinkButton`,
    `Actions`), `Card`, `Badge`, `Alert`, `Modal`, `Fab`, `Tabs`, `Table`, `Input` (fields and
    `SearchInput`), `CodeBlock`, `RenderFrame`, `Grid`, `List`, `Split`, `Text`, `Toast`, `Icon`,
    and the richer pieces built on them (charts, stats, code blocks).
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
  link carries the locale as `#/en/...` or `#/fr/...`; the areas are Learn, Try it live (the
  sandbox, `#/<locale>/sandbox/<example>`: an example's source edited beside its render, run in a
  `srcdoc` frame whose `<base>` is the example's file, kept in the browser), Examples, API
  reference and Measurements, and a hash without a locale opens the home page. `portal/data.ts` gathers the content entries, `portal/searchIndex.ts` builds what the
  site search reads — every guide, API entry and ready example in the current language —
  and `layout/SearchModal.tsx` shows it (the header button, `/` or ⌘K; arrows and Enter).
  `Entry.tsx` renders API entries, `ApiDemo.tsx` the pure demo models.

- `site/i18n/<language>.json` holds every word of the portal, one file per language, English the
  reference and the fallback: a `meta` block (`lang`, `name`, `abbr`, `hreflang`, `rtl`, and `flag`, the ISO 3166 region
  whose SVG of the MIT `flag-icons` package the build copies to `flags/` for the language selector), the
  interface namespaces, then the content — the course (`course`), the written text of the guides
  and notes (`written`), the examples' titles, themes and awaited features (`gallery`) and the
  demo canvas labels. The languages are the files of the folder: `site/content/i18n/languages.inline.ts`
  reads each one's `meta`, and the portal build runs that module and bundles its result
  (`scripts/docs/inline-modules.ts`), so adding a language is adding its file (and its
  `api.<language>.json`, below). English is bundled with the portal; every other dictionary, and
  each `api.<language>.json`, is a chunk of its own, read (`loadDictionary`,
  `loadReferenceTranslation`) before a page first shows in that language. `site/app/i18n.ts` is
  the one i18next instance: the language comes from the route (`#/<language>/…`), then the
  reader's last choice (`localStorage`), then the browser, then English; the header lists every
  language. `check:i18n` in `validate`, and `scripts/docs-i18n.test.ts`, fail when a language's keys
  differ from English's, naming each missing and extra key.
- `site/content/` owns what no language changes: `entries/*.ts` are the guide entries and the
  written notes that complete a generated API entry, without their words; `reference/` the
  generated API reference and its translations (see "The API reference" below), `model.ts` the
  entry shape and the sections, `i18n/` the dictionary helpers (`localizeEntries()` gives an entry
  its words, keeping its technical fields), `gallery-roadmap.json` the list of examples (see
  below).
- `site/examples/` owns the examples: one standalone HTML file per example, `<id>.html`, which
  imports the built engine as `../runtime/engine.js`, loads a compiled scene from `../assets/` and
  runs as-is from the built site — or copied into a user's project, paths adjusted. The list is
  `site/content/gallery-roadmap.json`: the theme ids, then one entry per example with `id`, its
  `theme` and its `file`, empty until the example exists; their words are each dictionary's
  `gallery`. The Examples area's
  sidebar lists the ready ones (an entry with a `file`) theme by theme, each a card with its
  thumbnail, under a filter box; its landing page shows every entry theme by theme — a ready one
  as a card with its settled render (`site/assets/examples/thumbnails/<id>.png`, captured by
  `scripts/docs-examples-thumbnails.ts`) that opens it, one still to come as an "in progress"
  card that opens nothing and names the engine feature it waits for. One example is the file on
  `DemoPage`: the iframe fills the content area, and one DaisyUI floating action button carries
  Code (the file's source, highlighted, in a modal, with Copy — reading only; editing and running
  code belongs to the sandbox), Share (copies the page link), Controls, Fullscreen and Restart.
  The compiled scenes live under `site/assets/examples/`, each `<scene>/source` beside its
  `cache`, built by `scripts/docs-examples-assets.ts` with this checkout's native compiler; the
  models that some scenes import, and their licences, are listed in
  `site/assets/examples/CREDITS.md`.

  **The page ↔ example contract.** The page posts one message to the example's window, and only
  one: `{ type: 'trillion3d:controls', visible: boolean }`, to show or hide the example's controls panel —
  when the reader presses Controls, and again after every load of the iframe with the current
  state. The kit listens from its import, before the example runs, so an example that builds its
  panel after an `await` still hears it; an example without a panel ignores it. Nothing else goes
  through `postMessage`: Restart remounts the iframe on the file.

- `site/demos/` contains the pure per-entry demonstration models; `kit.ts` declares their controls
  and result views, `registry.ts` maps entry ids to demos, and `engine.ts` is the one list of what
  the demos import from the engine, so every demo executes the engine itself.
- `site/reports/` owns the report contract (`contract.ts`), metric semantics, comparison
  eligibility and bilingual labels, beside the measurement records it reads (`index.json`, one
  folder per campaign).
- `site/styles/` holds `tailwind.css` and `portal.css`, which keeps only the design tokens and the
  primitives' own rules; `site/assets/`, `site/data/` and `site/index.html` are served as they are.

Types are declared where the data is: the entry shape in `content/model.ts`, the demo model in
`demos/kit.ts`,
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
workers into `runtime/` and the React portal into `runtime/portal.js` with the areas `App.tsx`
imports on demand — the examples, the reports — as `runtime/portal-<hash>.js` chunks
beside it, then copies the statics (pages, examples, assets, data, reports) — files only when
missing or older. Nothing under `site/` is a build product and nothing built is committed: the
docs server, the browser proofs and the site workflow (`.github/workflows/pages.yml`, see
[Deploy](#deploy)) build the same tree from the same function, `buildSite()` in
`scripts/docs/site.ts`.

`docs:serve` runs `scripts/docs-serve.ts`: it builds, then serves only `dist/site/` on
`http://127.0.0.1:4177`. This matches the published paths and adds no development framework or
fallback route.

### Build products: never committed, built by CI

`dist/site/` is ignored by git and tracked on no branch: every consumer builds it on demand
(`docs:serve` and the browser proofs under `scripts/` and `tests/browser/renders/` build the whole tree; the
unit tests import the sources directly, the demos through `site/demos/engine.ts`, so no runner
builds anything), and `check:docs-bundles` in `validate` (`node scripts/docs-build.ts --untracked`)
fails when git tracks any file of it. A release (`develop` → `main`) therefore publishes the site
built from the merged sources, without committing it.

The site address is one constant, `SITE_URL` in `scripts/docs/site.ts`: the build writes the
portal's canonical link and a `robots.txt` that allows everything from it. The portal routes by
hash, so its root is the only address to list and no sitemap is written.

### Deploy

`.github/workflows/pages.yml` builds the site on every pull request that touches it, and
publishes it to https://www.trillion3d.com on every push to `main`. A manual run publishes only
when asked, and only from `main`:

```sh
gh workflow run pages.yml -f deploy=true --ref main
```

The deploy job refuses an output without `index.html` or `runtime/portal.js`, or with fewer files
than the build copies, pre-compresses the text files beside their originals, sends the tree over
SSH with `rsync --delete-delay --delay-updates`, then checks that the site root and the portal
bundle answer. It reads four repository secrets: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`,
`DEPLOY_TARGET` and `DEPLOY_SSH_PORT`. The server side — web server, HTTPS, the redirect of the
bare domain to `www`, and the deploy key restricted to the web root — is set up by the maintainer.
GitHub Pages is no longer deployed: its last deployment is removed by turning Pages off in the
repository settings, which leaves https://www.trillion3d.com the one public address.

The runtime bundle is self-contained: every dependency is bundled at build time from the installed
packages; none stays external or is loaded from a CDN.

## Adding an example

1. Write `site/examples/<id>.html`: one file, a `<canvas id="view">`, no import map, and a module
   script that imports `createWorld` and the families it needs (`object`, `geometry`, `material`,
   `light`, …) from `../runtime/engine.js`. Keep it as short as the feature allows, and make it
   something to play with. `controls` from `../runtime/kit.js` (sources in `site/examples/kit/`,
   bundled beside the engine) draws a panel in the corner of the render:
   `controls({ light: [0, 10, 3], colour: '#88aaff', spin: true, view: ['a', 'b'], reset: () => {} },
onChange)` gives sliders (`[min, max, value, step?]`), colour pickers (`'#rrggbb'`), lines of
   help (any other text, such as the keys to press), toggles, choices and buttons, returns the live values and calls `onChange(values, key)` once at start and after every
   change. Given the world as its last argument (`controls({ … }, onChange, world)`, or
   `controls({ … }, world)`), it also opens the stats corner, bottom left: frames drawn per second
   (marked `held` while the image stands still) and the last frame's measured counters, a line
   left out when the engine did not measure it; `stats(world)` opens it alone. `readout(key)`, declared after it, adds a live line to that panel and returns the
   function that writes it (a counter read every frame). Name each control so that its label says
   what to try; there is no caption over the
   render. The page hosting the example hides or shows the panel by posting
   `{ type: 'trillion3d:controls', visible }` to its frame. Every word the reader sees goes in the
   examples' dictionaries (see "Example words" below), never in the page.
2. A scene of primitives is built in code, with `geometry.*`, directly in the example's HTML. A
   scene built around an imported model is added to `scripts/docs/examples/models.ts`, credited in
   `site/assets/examples/CREDITS.md`, then run `pnpm build:native` and
   `node scripts/docs-examples-assets.ts <scene>`.
3. Add its entry to `site/content/gallery-roadmap.json`, `file` set to `examples/<id>.html`, in
   learning order within its theme, or turn its "in progress" entry into it: an entry with no
   `file` carries `status` (`buildable`, or `needs-engine` with the engine feature it waits for in
   `gallery.missing.<id>` of every dictionary), and its title under `gallery.titles.<id>`. Then
   capture its thumbnail:
   `node scripts/docs-examples-thumbnails.ts <id>`. The capture hides the kit's panels and the
   credit line and waits for the example's most telling moment, the seconds it declares in
   `<meta name="thumbnail" content="3">` (1.5 when it declares none).
4. Run `node --test scripts/docs-examples.test.ts`, then the browser proofs
   `node --test scripts/docs-examples.browser.ts` and `node --test scripts/docs-shell.browser.ts`.

## Example words

What an example shows in words — its panel, readouts, banners, game menu and key sheet — reads
in the portal's language. The kit loads it before the example's script runs:

- **The language** is `?lang=<code>` on the example's address. `DemoPage` and the chapter's
  "Try it" frame add it to the frame's `src` (`exampleAddress` in `site/app/i18n.ts`); the
  sandbox adds it to the `<base>` of its `srcdoc`. A page opened on its own falls back on the
  browser's language, then English. Arabic pages turn right to left (`dir="rtl"`), and the kit's
  panels, which use logical sides, mirror with them.
- **The dictionaries** are `site/examples/i18n/<code>.json`, one per portal language, English
  the reference, copied with the examples by the build. `kit` holds the kit's own words (panel,
  menu, key names, stats); each example has its part, named by its file name
  (`a-field-of-pebbles.html` → `a-field-of-pebbles`): `controls.<key>` a control's label (or
  a note's text), `choices.<key>.<value>` a choice's or a game option's shown value,
  `readouts.<key>`, `game.title`, `game.goal`, `game.keys.<action>`, `game.options.<id>`, and
  `words.<key>` for everything else.
- **The code keeps identifiers.** Control keys, choice values and game actions stay the words the
  code tests; the kit shows their translation, or the key humanised when a word is missing.
  Free text goes through `const say = words();` then `say('key', { n: 3 })` (`{n}` blanks), or
  `data-words="key"` on an element of the page, which the kit fills.
- **The checks.** `pnpm run check:i18n` refuses a language whose keys or `{blanks}` differ from
  English's; `scripts/docs-examples-words.test.ts` refuses a written key an example uses that
  English lacks.

## The API reference

The reference is generated, never written by hand: `scripts/generate-api-reference.ts` reads the
TypeScript declarations of the three public entries of `trillion3d` (`packages/sdk/index.ts`,
`browser.ts`, `node.mts`) and writes `site/content/reference/api.json` — one entry per export, one
per member of every family (`geometry.box`, `material.meshStandard`, …) and one per member of the
world (`world.scene`, `world.onFrame`, …). Each entry carries its summary (the first sentence of
the TSDoc), its parameters (an options object field by field, with the `@defaultValue` of each
field), its return, its `@example`, its members and the rest of the TSDoc as its description;
`EngineError` lists every code it is thrown with, from its `@errorCode` lines. A member built from a
list of keys has no declaration of its own: its owner documents it with `@property <name> - <text>`.
The section follows the defining module (`scripts/api-reference/sections.ts`): the world and its
families first, the constant families under "Constants", then the maths, the Node compiler and
every other public type. To document a symbol, write its TSDoc in the source, run
`node scripts/generate-api-reference.ts`, and add its text in every other language to
`site/content/reference/api.<language>.json` (keyed by entry id; rows by name). `check:api-reference` in `validate` fails on a stale file, and
`scripts/docs-api-reference.test.ts` on an export, a family member or a row without an entry or a
summary, on two entries sharing a summary and on a thrown error code left unexplained; `check:i18n`
on a translation missing a text or naming one English does not show. The written notes of `site/content/entries/*.ts` (matrices, vectors, bounds…) only add a
longer text, an example or a proof to the generated entry of the same id.

## Adding or translating documentation

Add the entry to the relevant `site/content/entries/*.ts` array with a stable id, and its words
under `written.<id>` in every `site/i18n/<language>.json`. Translate the title only when it is
editorial; function, type and constant names remain exact. Translate descriptions, argument
descriptions and guide HTML, while signatures, exports, module paths and code examples remain the
source contract. Add new navigation or component text to every dictionary, and read it in a
component with `useWords(locale)` (`site/app/i18n.ts`); the keys are typed from the English file,
and `check:i18n` refuses a key missing from one language.

Run `pnpm run check:i18n` and `node --test scripts/docs-i18n.test.ts
tests/integration/documentation-portal.test.ts` after content changes: they require key parity
across the languages and verify that a translation does not alter technical fields.

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
this checkout's native compiler to write the published cache. `TRILLION3D_COMPILER` may select a compatible
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

The examples execute the streaming pipeline; they do not prove a speedup over another renderer. Comparative claims require
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
