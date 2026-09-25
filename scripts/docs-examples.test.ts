import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { markdownLinks } from './check-links.ts';
import { loadReactComponents } from './docs/render-react.ts';
import { modelScenes } from './docs/examples/models.ts';
import { observatoryMaterials } from './docs/observatory/scene.ts';
import { exampleModules, thumbnailDelay } from './docs/examples/capture.ts';
import exampleWords from '../site/examples/i18n/en.json' with { type: 'json' };
import type { Example as ExampleComponent } from '../site/app/examples/Example.tsx';
import type { ExampleList as ExampleListComponent } from '../site/app/layout/ExampleList.tsx';
import { examplesMenu } from '../site/app/layout/menus.ts';
import type { Examples as ExamplesComponent } from '../site/app/examples/Examples.tsx';
import type { PortalRoute } from '../site/app/portal/routes.ts';
import {
  exampleMissing,
  exampleTitle,
  isReady,
  readyEntries as ready,
  roadmapEntries,
} from '../site/app/examples/list.ts';
import { loadDictionary } from '../site/content/i18n/dictionary.ts';
import roadmap from '../site/content/gallery-roadmap.json' with { type: 'json' };

const site = new URL('../site/', import.meta.url);
const written = roadmapEntries.filter(({ file }) => file);
// #719: the sky a page loading the observatory adds, from the court's limestone in its source.
const [, court] =
  observatoryMaterials.find(([name]) => name === 'Warm limestone') ??
  assert.fail('the observatory names no Warm limestone');
const limestone = court.slice(0, 3);
const observatorySky = `light.hemisphere({ color: '#a6c6ff', groundColor: [${limestone.join(', ')}], intensity: sun.intensity / 5 })`;
await loadDictionary('fr');

test('no Markdown page links an example parked until the engine draws it', () => {
  const parked = new Set(
    written
      .filter(({ status }) => status === 'waiting-engine')
      .map(({ file }) => fileURLToPath(new URL(file, site))),
  );
  const links = markdownLinks().local.filter(({ dest }) => parked.has(dest));
  assert.deepEqual(
    links.map(({ file, target }) => `${file}: ${target}`),
    [],
  );
});

test('every example is one standalone HTML file that imports the built engine', async () => {
  assert.equal(new Set(roadmapEntries.map(({ id }) => id)).size, roadmapEntries.length);
  const themes = new Set(roadmap.themes);
  for (const { id, theme, file, status, issue } of roadmapEntries) {
    assert.ok(themes.has(theme), id);
    // Its words are each language's `gallery`: a title always, the feature it waits for if any.
    const [title, titleFr] = [exampleTitle(id, 'en'), exampleTitle(id, 'fr')];
    assert.ok(title !== id && titleFr !== id, id);
    assert.doesNotMatch(`${id} ${title} ${titleFr}`, /three|unreal|babylon/i);
    // An example still to write says whether it waits on the engine, and then on what; one
    // written and parked until the engine draws it also names the issue that delivers it.
    const waits = status === 'needs-engine' || status === 'waiting-engine';
    if (status === 'waiting-engine') assert.ok(file && Number.isInteger(issue), id);
    else if (file) assert.equal(status, undefined, id);
    else assert.ok(status === 'buildable' || status === 'needs-engine', id);
    assert.equal(Boolean(exampleMissing(id, 'en') && exampleMissing(id, 'fr')), waits, id);
    assert.equal(issue !== undefined, status === 'waiting-engine', id);
  }
  assert.ok(ready.length >= 10);
  // A written example follows the same rules whether the engine draws it yet or not.
  for (const entry of written) {
    assert.equal(entry.file, `examples/${entry.id}.html`);
    const html = await readFile(new URL(entry.file, site), 'utf8');
    if (entry.issue) assert.match(html, new RegExp(`// Waits for #${entry.issue}: `), entry.id);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<canvas id="view"><\/canvas>/);
    assert.match(html, /import \{ createWorld[^}]*\} from '\.\.\/runtime\/engine\.js'/);
    assert.doesNotMatch(html, /setDiagnostic|localhost|127\.0\.0\.1/);
    // The kit, when used, is the one served beside the engine, and the thumbnail moment is valid.
    if (/runtime\/kit\.js/.test(html))
      assert.match(html, /import \{[^}]*\} from '\.\.\/runtime\/kit\.js'/, entry.id);
    thumbnailDelay(html);
    // #276: an example lets the engine read the machine and choose its path, so it renders
    // wherever it is opened; one that pins a backend to show the setting says so on the page.
    if (/backends:/.test(html)) assert.match(html, /<p>[^<]*\bbackend\b[^<]*<\/p>/i, entry.id);
    else assert.doesNotMatch(html, /webgpuPagesBackend/, entry.id);
    // A scene built in code loads nothing; one that loads a compiled cache names a published one.
    const manifest = html.match(/scene\.load\('\.\.\/(assets\/[^']+)'\)/)?.[1];
    if (!manifest) continue;
    // #719: its scene file carries only a sun, so the page adds the sky.
    if (manifest.startsWith('assets/gallery/signature-architecture/'))
      assert.ok(html.includes(observatorySky), entry.id);
    await access(new URL(manifest, site));
    // A scene built around an imported model credits its author on the page, in its words.
    if (
      Object.keys(modelScenes).some((scene) => manifest.startsWith(`assets/examples/${scene}/`))
    ) {
      assert.match(html, /<p data-words="credit"><\/p>/, entry.id);
      const credit = (exampleWords as Record<string, { words?: { credit?: string } }>)[entry.id];
      assert.match(credit?.words?.credit ?? '', /\b(CC0|CC BY 3\.0)\b.*CREDITS\.md$/, entry.id);
    }
  }
});

test('every example page parses, so a slip that stops it before its first frame fails here', async () => {
  // #534: a name declared twice left the flight page blank, and no test read that part of it.
  const pages = (await readdir(new URL('examples/', site))).filter((file) =>
    file.endsWith('.html'),
  );
  assert.ok(pages.length >= written.length);
  for (const page of pages)
    await exampleModules(await readFile(new URL(`examples/${page}`, site), 'utf8')).catch(
      (error: Error) => assert.fail(`${page}: ${error.message}`),
    );
  await assert.rejects(exampleModules('<script type="module">const a = 1, a = 2;</script>'));
});

test('an example declares the moment its thumbnail is taken, or gets the settled default', () => {
  assert.equal(thumbnailDelay('<title>x</title>'), 1.5);
  assert.equal(thumbnailDelay('<meta name="thumbnail" content="4.5" />'), 4.5);
  assert.throws(() => thumbnailDelay('<meta name="thumbnail" content="soon" />'), /0 to 20 s/);
  assert.throws(() => thumbnailDelay('<meta name="thumbnail" content="60" />'), /0 to 20 s/);
});

test('an example is its file, live, on the demo page; the index shows what is ready and what is to come', async () => {
  const { Example } = (await loadReactComponents('site/app/examples/Example.tsx')) as {
    Example: typeof ExampleComponent;
  };
  const { ExampleList } = (await loadReactComponents('site/app/layout/ExampleList.tsx')) as {
    ExampleList: typeof ExampleListComponent;
  };
  const { Examples } = (await loadReactComponents('site/app/examples/Examples.tsx')) as {
    Examples: typeof ExamplesComponent;
  };
  const [entry] = ready;
  const page = renderToStaticMarkup(createElement(Example, { id: entry.id, locale: 'en' }));
  assert.match(page, new RegExp(`<h1[^>]*>.*${exampleTitle(entry.id, 'en')}</h1>`));
  assert.match(
    page,
    new RegExp(`<div class="render-frame[^"]*"[^>]*><iframe src="${entry.file}\\?lang=en"`),
  );
  assert.match(page, /role="status"[^>]*>.*Preparing the scene/s);
  // One floating button carries the actions; the source waits behind Code, in its modal.
  assert.equal((page.match(/class="fab"/g) ?? []).length, 1);
  for (const action of ['Code', 'Share', 'Controls', 'Fullscreen', 'Restart'])
    assert.match(page, new RegExp(`aria-label="${action}"`), action);
  assert.doesNotMatch(page, /data-code-block/);
  const route: PortalRoute = { locale: 'en', area: 'examples', id: entry.id };
  const sidebar = renderToStaticMarkup(createElement(ExampleList, { groups: examplesMenu(route) }));
  for (const entry of roadmapEntries) {
    assert.equal(sidebar.includes(`href="#/en/examples/${entry.id}"`), isReady(entry), entry.id);
    assert.equal(sidebar.includes(`thumbnails/${entry.id}.png`), isReady(entry), entry.id);
  }
  assert.match(
    sidebar,
    new RegExp(`href="#/en/examples/${entry.id}" title="[^"]*" aria-current="page"`),
  );
  const filtered = examplesMenu(route, exampleTitle(entry.id, 'en')).flatMap(({ items }) => items);
  assert.equal(filtered[0].key, entry.id);
  assert.deepEqual(examplesMenu(route, 'no example is called this'), []);
  const index = renderToStaticMarkup(createElement(Examples, { locale: 'en' }));
  // The index shows every entry: a ready one as a card that opens it, one still to come as an
  // "in progress" card that opens nothing, with the engine feature it waits for; one written and
  // waiting for the engine opens nothing either, and links its issue.
  for (const entry of roadmapEntries) {
    assert.ok(index.includes(`>${exampleTitle(entry.id, 'en')}</h2>`), entry.id);
    assert.equal(index.includes(`href="#/en/examples/${entry.id}"`), isReady(entry), entry.id);
    assert.equal(index.includes(`thumbnails/${entry.id}.png`), isReady(entry), entry.id);
    const missing = exampleMissing(entry.id, 'en');
    if (missing) assert.ok(index.includes(`Waits for the engine: ${missing}`), entry.id);
    if (entry.issue)
      assert.ok(index.includes(`/issues/${entry.issue}">#${entry.issue}</a>`), entry.id);
  }
  const count = (pattern: RegExp) => (index.match(pattern) ?? []).length;
  assert.equal(count(/aria-disabled="true"/g), roadmapEntries.length - ready.length);
  assert.equal(count(/>In progress</g), roadmapEntries.length - written.length);
  assert.equal(count(/>Waiting for the engine</g), written.length - ready.length);
});
