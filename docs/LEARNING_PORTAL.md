# Learning portal maintenance

The learning portal is a React application whose TypeScript sources live under `site/`, organised by
role, built into `dist/site/` (ignored by git). Hash routes let the same files work on the public
site and the local documentation server. `site/app/main.tsx` is the composition root; route
components own their interactive effects and dispose them before the next route. `docs/` holds the
repository documentation only.

## Source layout

| Folder                                          | Owns                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/app/`                                     | the portal, in three layers (below)                                                                                                                                                                                                                                                                                                                                                                            |
| `site/i18n/<language>.json`                     | every word of the portal ([Languages](#languages))                                                                                                                                                                                                                                                                                                                                                             |
| `site/content/`                                 | what no language changes: `entries/*.ts` (guide entries and written notes completing a generated API entry, without words), `reference/` (the generated API reference and its translations, [below](#the-api-reference)), `model.ts` (entry shape, sections), `i18n/` (dictionary helpers; `localizeEntries()` gives an entry its words, keeping technical fields), `gallery-roadmap.json` (the examples list) |
| `site/examples/`                                | one standalone HTML file per example ([Examples](#examples))                                                                                                                                                                                                                                                                                                                                                   |
| `site/demos/`                                   | pure per-entry demo models: `kit.ts` declares controls and result views, `registry.ts` maps entry ids to demos, `engine.ts` is the one list of what demos import from the engine, so every demo runs the engine itself                                                                                                                                                                                         |
| `site/reports/`                                 | the report contract (`contract.ts`), metric semantics, comparison eligibility, bilingual labels, beside the records it reads (`index.json`, one folder per campaign)                                                                                                                                                                                                                                           |
| `site/styles/`                                  | `tailwind.css`, and `portal.css` with only the design tokens and the primitives' rules                                                                                                                                                                                                                                                                                                                         |
| `site/assets/`, `site/data/`, `site/index.html` | served as they are                                                                                                                                                                                                                                                                                                                                                                                             |

`site/app/` has three layers and nothing outside them:

- **primitives**, `ui/`: each DaisyUI component wrapped once — `Button` (and `LinkButton`,
  `Actions`), `Card`, `Badge`, `Alert`, `Modal`, `Fab`, `Tabs`, `Table`, `Input` (fields and
  `SearchInput`), `CodeBlock`, `RenderFrame`, `Grid`, `List`, `Split`, `Text`, `Toast`, `Icon`, and
  richer pieces built on them (charts, stats, code blocks). `CodeBlock.tsx` owns one inner scrolling
  region for all numbered lines and copies the original source string; `highlighter.ts` wraps
  Highlight.js with the TypeScript grammar.
- **layouts**, `layout/`: `Shell.tsx` (header, one sidebar per area, the page, site search) and two
  page templates — `DocPage.tsx` (eyebrow, title, lead, actions, body, optional aside) for every
  page that is read, `DemoPage.tsx` for every page that is played.
- **pages**, composed only from layouts and primitives: no class of their own, no inline style, no
  hand-written DOM. A page needing something new adds a primitive.

`App.tsx` reads the route (`site/app/hooks/useRoute.ts`), localizes the entries and hands both to the shell
through `site/app/layout/PortalContext.ts`; theme, drawer and search shortcut are the hooks `useTheme`,
`useDrawer`, `useSearchShortcut`. Strings come from `t()`, imported where used. `site/app/portal/routes.ts`
alone turns URLs into page kinds: every link carries the locale (`#/en/...`, `#/fr/...`); the areas
are Learn, Try it live (the sandbox, `#/<locale>/sandbox/<example>`: an example's source edited
beside its render, run in a `srcdoc` frame whose `<base>` is the example's file, kept in the
browser), Examples, API reference and Measurements; a hash without a locale opens the home page.
`site/app/portal/data.ts` gathers the content entries, `site/app/portal/searchIndex.ts` builds the site search's index
(every guide, API entry and ready example in the current language), `layout/SearchModal.tsx` shows
it (header button, `/` or ⌘K; arrows and Enter). `Entry.tsx` renders API entries, `ApiDemo.tsx` the
pure demo models.

Types are declared where the data is — entry shape in `site/content/model.ts`, demo model in
`site/demos/kit.ts`, report in `site/reports/contract.ts`; components declare their props inline.
`tsconfig.site.json` checks the folder with `strict` and `allowJs` off (`check:site-types`);
`check:no-js` refuses any JavaScript source under `site/`.

### Languages

`site/i18n/<language>.json`, one file per language, English the reference and fallback:

- a `meta` block — `lang`, `name`, `abbr`, `hreflang`, `rtl`, and `flag`, the ISO 3166 region whose
  SVG from the MIT `flag-icons` package the build copies to `flags/` for the selector;
- the interface namespaces, then the content: the course (`course`), the guides' and notes' text
  (`written`), the examples' titles, themes and awaited features (`gallery`), demo canvas labels.

The languages are the folder's files: `site/content/i18n/languages.inline.ts` reads each `meta`, and
the portal build runs that module and bundles its result (`scripts/docs/inline-modules.ts`), so a
language is added by its file (and its `api.<language>.json`). English is bundled with the portal;
every other dictionary and each `api.<language>.json` is its own chunk, read (`loadDictionary`,
`loadReferenceTranslation`) before a page first shows in that language. `site/app/i18n.ts` is the
one i18next instance: language from the route (`#/<language>/…`), then the reader's last choice
(`localStorage`), the browser, English; the header lists every language. `check:i18n` in `validate`
and `scripts/docs-i18n.test.ts` fail when a language's keys differ from English's, naming each
missing and extra key.

### Examples

Each `site/examples/<id>.html` imports the built engine as `../runtime/engine.js`, loads a compiled
scene from `../assets/`, and runs as-is from the built site — or copied into a project, paths
adjusted. The list is `site/content/gallery-roadmap.json`: theme ids, then one entry per example
(`id`, `theme`, `file`, empty until the example exists); their words are each dictionary's
`gallery`.

- **Examples area**: the sidebar lists ready entries (with a `file`) theme by theme, each a card
  with its thumbnail, under a filter box; the landing page shows every entry by theme — a ready one
  as a card with its settled render (`site/assets/examples/thumbnails/<id>.png`, captured by
  `scripts/docs-examples-thumbnails.ts`) that opens it, one to come as an "in progress" card that
  opens nothing and names the engine feature it waits for.
- **One example** is the file on `DemoPage`: the iframe fills the content area; one DaisyUI floating
  action button carries Code (the source, highlighted, in a modal, with Copy — read only; editing
  and running belong to the sandbox), Share (copies the link), Controls, Fullscreen and Restart.
- **Scenes** live under `site/assets/examples/`, each `<scene>/source` beside its `cache`, built by
  `scripts/docs-examples-assets.ts` with this checkout's native compiler. Git tracks no cache:
  `pnpm run compile:caches` (`scripts/site-caches.ts`) compiles each missing or stale one, as the
  site deploy, the unit test runners and `test:gpu` do first. Imported models and their licences are
  listed in `site/assets/examples/CREDITS.md`.

**The page ↔ example contract.** The page posts one message to the example's window, and only one:
`{ type: 'trillion3d:controls', visible: boolean }`, showing or hiding the example's controls panel
— when the reader presses Controls, and after every iframe load with the current state. The kit
listens from its import, before the example runs, so a panel built after an `await` still hears it;
an example without a panel ignores it. Nothing else goes through `postMessage`: Restart remounts the
iframe on the file.

## Build and local preview

```sh
pnpm build:docs
pnpm docs:serve
```

`build:docs` runs `scripts/docs-build.ts`, writing the published tree into `dist/site/`: it compiles
`site/styles/tailwind.css` with Tailwind and DaisyUI into `css/site.css` after scanning the
handwritten HTML and TypeScript for class names; bundles the browser SDK and its workers into
`runtime/`, the React portal into `runtime/portal.js`, and the areas `App.tsx` imports on demand
(the examples, the reports) as `runtime/portal-<hash>.js` chunks beside it; then copies the statics
(pages, examples, assets, data, reports), only files missing or older. The docs server, the browser
proofs and the site workflow (`.github/workflows/pages.yml`, [Deploy](#deploy)) build the same tree
from one function, `buildSite()` in `scripts/docs/site.ts`.

`docs:serve` (`scripts/docs-serve.ts`) builds, then serves only `dist/site/` on
`http://127.0.0.1:4177`: the published paths, no development framework or fallback route; it stays
the proofs' production-path server. `pnpm docs:dev` (`scripts/docs-dev.ts`) builds once, serves
`dist/site/` through the same server and headers, and follows `site/` and `packages/`: a change git
does not ignore reruns only the `buildSite()` steps that read it or an earlier step's output (the
list `SITE_STEPS` in `scripts/docs/site.ts`), then every open page reloads. The reload script is
added by that server, never written into `dist/site/`. A new language's
flag needs a restart: languages load once per process.

### Build products: never committed, built by CI

Nothing built is committed — the site, the API files, the scene caches. `dist/site/` is tracked on
no branch: `docs:serve` builds the whole tree; unit tests import the sources directly, the demos
through `site/demos/engine.ts`, so
no runner builds anything. `check:docs-bundles` in `validate`
(`node scripts/docs-build.ts --untracked`) fails when git tracks any file of it. A release
(`develop` → `main`) publishes the site built from the merged sources.

The site address is one constant, `SITE_URL` in `scripts/docs/site.ts`: the build writes the
portal's canonical link and a `robots.txt` allowing everything. Routing by hash, the root is the
only address to list, so no sitemap is written.

### Deploy

`.github/workflows/pages.yml` builds the site on every pull request touching it and publishes it to
https://www.trillion3d.com on every push to `main`; a manual run publishes only when asked, only
from `main`:

```sh
gh workflow run pages.yml -f deploy=true --ref main
```

1. Builds the native compiler, the scene caches (`pnpm run compile:caches`), and each cache object's
   brotli sibling (`scripts/compress-cache-objects.ts`, #921).
2. Refuses an output without `index.html` or `runtime/portal.js`, or with fewer files than the build
   copies; pre-compresses text files beside their originals.
3. Sends the tree over SSH with `rsync --delete-delay --delay-updates`, **excluding `openworld/`**,
   which the open world's own repository publishes and this deploy must never delete.
4. Checks that the site root and the portal bundle answer with
   `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`.
   These make the page cross-origin isolated, which the physics needs for its threads
   (`SharedArrayBuffer`); `credentialless` rather than `require-corp` lets the consent panel and its
   audience measurement load from their own origins. `scripts/docs-serve.ts` answers the same
   headers locally.

Secrets: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_TARGET`, `DEPLOY_SSH_PORT`. The maintainer
sets up the server side: web server, HTTPS, the bare domain's redirect to `www`, the isolation
headers, the pre-compressed siblings (`.gz`, and `.br` sent with `Content-Encoding: br` to a browser
accepting it), and the deploy key restricted to the web root. GitHub Pages is no longer deployed
(its last deployment is removed by turning Pages off in the repository settings), leaving
https://www.trillion3d.com the one public address.

The runtime bundle is self-contained: every dependency is bundled at build time from the installed
packages; none stays external or comes from a CDN.

## Adding an example

1. **Write `site/examples/<id>.html`**: one file, a `<canvas id="view">`, no import map, a module
   script importing `createWorld` and the families it needs (`object`, `geometry`, `material`,
   `light`, …) from `../runtime/engine.js`. As short as the feature allows, and something to play
   with. Every word the reader sees goes in the examples' dictionaries ([Example
   words](#example-words)), never in the page.
   1. **Panel**: `controls` from `../runtime/kit.js` (sources in `site/examples/kit/`, bundled
      beside the engine) draws a panel in the render's corner.
      `controls({ light: [0, 10, 3], colour: '#88aaff', spin: true, view: ['a', 'b'], reset: () => {} }, onChange)`
      gives sliders (`[min, max, value, step?]`), colour pickers (`'#rrggbb'`), help lines (any
      other text, such as keys to press), toggles, choices and buttons; it returns the live values
      and calls `onChange(values, key)` once at start and after every change. Name each control so
      its label says what to try; there is no caption over the render. The hosting page shows or
      hides it by posting `{ type: 'trillion3d:controls', visible }` ([contract](#examples)).
   2. **Stats**: given the world last (`controls({ … }, onChange, world)` or
      `controls({ … }, world)`) it also opens the stats corner, bottom left — frames drawn per
      second (`held` while the image stands still), the last frame's measured counters, and where
      the frame's time went: the CPU frame, its stages (cut and culling,
      page preparation, command encoding, physics step) and the costliest GPU
      passes, a line left out when the engine did not measure it; hidden, it reads no CPU time;
      `stats(world)` opens it alone.
   3. **Readouts**: `readout(key)`, declared after it, adds a live line and returns the function
      writing it (a counter read every frame); `physicsReadouts(world, ['bodies', 'awake', 'step'])`
      adds the physics' lines from `world.physics.stats` each frame (`page` adds the page's share of
      the frame).
2. **Scene**: primitives are built in code with `geometry.*` in the HTML. A scene around an imported
   model is added to `scripts/docs/examples/models.ts`, credited in
   `site/assets/examples/CREDITS.md`, then `pnpm build:native` and
   `node scripts/docs-examples-assets.ts <scene>`.
3. **Roadmap entry** in `site/content/gallery-roadmap.json`, `file` = `examples/<id>.html`, in
   learning order within its theme, or turn its "in progress" entry into it. An entry with no `file`
   carries `status` (`buildable`, or `needs-engine` with the awaited feature in
   `gallery.missing.<id>` of every dictionary) and its title under `gallery.titles.<id>`. A written
   example parked until the engine draws it keeps its `file` with `status` `waiting-engine` and the
   delivering `issue`: the kit's banner shows on its page only "Waiting for the engine (#n)"
   (`kit.banner.waiting`) linked to it, read from the roadmap at build time
   (`site/examples/kit/waiting.inline.ts`).
4. **Thumbnail**: declare the most telling moment in seconds, `<meta name="thumbnail" content="3">`
   (1.5 when none); the author captures nothing. The card shows the shared placeholder until the
   recette, after the merge, captures every example its batch added or changed with
   `node scripts/docs-examples-thumbnails.ts <id>` (kit panels and credit line hidden) and delivers
   them in one "Thumbnail only" pull request. A scene too heavy to cook here lives in its own
   repository, published beside the portal outside this gallery: the open world (#332),
   https://github.com/pasquelin/Trillion3D-openworld, served at `/openworld/` (#426).

## Example words

What an example shows in words — panel, readouts, banners, game menu, key sheet — reads in the
portal's language; the kit loads it before the example's script runs.

- **The language** is `?lang=<code>` on the example's address: `DemoPage` and the chapter's "Try it"
  frame add it to the frame's `src` (`exampleAddress` in `site/app/i18n.ts`), the sandbox to its
  `srcdoc`'s `<base>`. A page opened alone falls back on the browser's language, then English.
  Arabic pages turn right to left (`dir="rtl"`); the kit's panels, on logical sides, mirror with
  them.
- **The dictionaries** are `site/examples/i18n/<code>.json`, one per portal language, English the
  reference, copied with the examples by the build. `kit` holds the kit's words (panel, menu, key
  names, stats); each example has its part, named by file (`a-field-of-pebbles.html` →
  `a-field-of-pebbles`): `controls.<key>` a control's label (or a note's text),
  `choices.<key>.<value>` a choice's or game option's shown value, `readouts.<key>`, `game.title`,
  `game.goal`, `game.keys.<action>`, `game.options.<id>`, and `words.<key>` for everything else.
- **The code keeps identifiers.** Control keys, choice values and game actions stay the words the
  code tests; the kit shows their translation, or the key humanised when one is missing. Free text
  goes through `const say = words();` then `say('key', { n: 3 })` (`{n}` blanks), or
  `data-words="key"` on a page element, which the kit fills.
- **The checks.** `pnpm run check:i18n` refuses a language whose keys or `{blanks}` differ from
  English's.

## The API reference

Generated, never hand-written: `scripts/generate-api-reference.ts` reads the declarations of the
three public entries of `trillion3d` (`packages/sdk/index.ts`, `browser.ts`, `node.mts`) and writes
`site/content/reference/api.json` — one entry per export, per member of every family
(`geometry.box`, `material.meshStandard`, …) and per member of the world (`world.scene`,
`world.onFrame`, …). An entry carries its summary (the TSDoc's first sentence), parameters (an
options object field by field, with each field's `@defaultValue`), return, `@example`, members, and
the rest of the TSDoc as description; `EngineError` lists every code it is thrown with, from its
`@errorCode` lines. A member built from a list of keys has no declaration: its owner documents it
with `@property <name> - <text>`. The section follows the defining module
(`scripts/api-reference/sections.ts`): the world and its families, the constant families under
"Constants", the maths, the Node compiler, every other public type.

To document a symbol: write its TSDoc, run `node scripts/generate-api-reference.ts`, and add its
text in every other language to `site/content/reference/api.<language>.json` (keyed by entry id;
rows by name), which only translators write. Git tracks neither `api.json` nor
`site/data/api-inventory.json`: `pnpm install` writes both, and `pnpm run generate:api`, the site
build, the test runners and `validate` rewrite them when a source is newer.
`scripts/docs-api-reference.test.ts` fails on an export, family member or row without an entry or
summary, two entries sharing a summary, or a thrown error code left unexplained; `check:i18n` on a
translation missing a text or naming one English does not show. The written notes of
`site/content/entries/*.ts` (matrices, vectors, bounds…) only add a longer text, an example or a
proof to the generated entry of the same id.

## Adding or translating documentation

Add the entry to the relevant `site/content/entries/*.ts` array with a stable id, its words under
`written.<id>` in every `site/i18n/<language>.json`. Translate a title only when editorial;
function, type and constant names stay exact. Translate descriptions, argument descriptions and
guide HTML; signatures, exports, module paths and code examples stay the source contract. New
navigation or component text goes in every dictionary, read with `useWords(locale)`
(`site/app/i18n.ts`); keys are typed from the English file. After content changes run
`pnpm run check:i18n` and
`node --test scripts/docs-i18n.test.ts tests/integration/documentation-portal.test.ts`: key parity
across languages, and no translation altering technical fields.

## Original scene and asset provenance

`tests/fixtures/scenes/kinetic-garden/` is an original procedural scene the tests read; the site
serves neither it nor the mountain terrain beside it. `scripts/docs/garden-source.ts` generates its
source under the repository license, with no third-party models, textures, shaders or sample code;
provenance and limits are in its `README.md`. It is not a performance or large-residency benchmark.

```sh
pnpm build:native
pnpm docs:scene
```

`docs:scene` (`scripts/docs-scene.ts`) regenerates the deterministic glTF source, then runs this
checkout's native compiler for its cache; `docs:gallery` does the same for the scenes modelled in
code, the gallery's observatory and the mountain terrain. Every generator runs the compiler through
`scripts/native-compiler.ts`, following the SDK's rule: `TRILLION3D_COMPILER_BIN` may select a
compatible binary. Never replace source assets with compiler outputs or import assets from a
neighbouring project. Review the generated manifest provenance and run
`node --test scripts/docs-scene.test.ts` before publishing a regenerated cache.

## Reading live performance counters

Live demo counters describe the current browser and scene, not comparative benchmarks; they use
DaisyUI `stats`, `stat`, `stat-title`, `stat-value` and `stat-desc`.

- FPS comes from consecutive animation-frame intervals while rendering; a settled scene reports an
  idle state, never an invented continuous rate. CPU submission time is not GPU duration; never add
  them. Unknown measurements stay unavailable.
- Memory figures name their scope: owned visualization buffers, engine geometry pool, resident pages
  or cache bytes. Configured budgets are limits, not consumption. WebGPU does not expose total
  physical GPU memory use to this application.
- The examples run the streaming pipeline; they prove no speedup over another renderer. Comparative
  claims need the harness of `bench/runner/README.md` with identical input, camera, quality and
  resource budgets, plus resolution, DPR, commit, display cap and run-to-run spread. No portal
  example or demo imports a bench witness: it is named only through the witness entry point
  (`bench/witnesses/measurement.ts`) of the bench and the report pipeline, and never ships in the
  package.
- API pages may show a related concept beside their snippet: the panel labels the relationship and
  links to the interactive example with its own inputs and matching code — no claim that every API
  function has a direct visual witness. Direct function mappings in the catalogue stay limited to
  functions the evaluator actually calls.

## Benchmark reports

The Measurements route (`#/en/reports` or `#/fr/reports`) reads the one published campaign from
`site/reports/`, which `bench/runner/publishReport.ts` replaces. Shared React components own its
presentation; `site/reports/` modules own contract, metric semantics, comparison eligibility and
bilingual labels ([report pipeline](../bench/runner/README.md#published-reports) for export and
staging). The page is a `DocPage`, its sidebar the campaign's parts. Campaign data is independent of
the site build.
