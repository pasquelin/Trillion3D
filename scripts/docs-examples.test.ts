import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';
import { modelScenes } from './docs/examples/models.ts';
import { thumbnailDelay } from './docs/examples/capture.ts';
import type { Example as ExampleComponent } from '../site/app/examples/Example.tsx';
import type { ExampleList as ExampleListComponent } from '../site/app/layout/ExampleList.tsx';
import { examplesMenu } from '../site/app/layout/menus.ts';
import type { Examples as ExamplesComponent } from '../site/app/examples/Examples.tsx';
import type { PortalRoute } from '../site/app/portal/routes.ts';
import { isReady, readyEntries as ready, roadmapEntries } from '../site/app/examples/list.ts';
import roadmap from '../site/content/gallery-roadmap.json' with { type: 'json' };

const site = new URL('../site/', import.meta.url);
const written = roadmapEntries.filter(({ file }) => file);

test('every example is one standalone HTML file that imports the built engine', async () => {
  assert.equal(new Set(roadmapEntries.map(({ id }) => id)).size, roadmapEntries.length);
  const themes = new Set(roadmap.themes.map(({ id }) => id));
  for (const { id, title, theme, file, status, missing, issue } of roadmapEntries) {
    assert.ok(themes.has(theme), id);
    assert.ok(title.en && title.fr, id);
    assert.doesNotMatch(`${id} ${title.en} ${title.fr}`, /three|unreal|babylon/i);
    // An example still to write says whether it waits on the engine, and then on what; one
    // written and parked until the engine draws it also names the issue that delivers it.
    const waits = status === 'needs-engine' || status === 'waiting-engine';
    if (status === 'waiting-engine') assert.ok(file && Number.isInteger(issue), id);
    else if (file) assert.equal(status, undefined, id);
    else assert.ok(status === 'buildable' || status === 'needs-engine', id);
    assert.equal(Boolean(missing?.en && missing.fr), waits, id);
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
    await access(new URL(manifest, site));
    // A scene built around an imported model credits its author on the page.
    if (Object.keys(modelScenes).some((scene) => manifest.startsWith(`assets/examples/${scene}/`)))
      assert.match(html, /<p>[^<]*\b(CC0|CC BY 3\.0)\b[^<]*CREDITS\.md<\/p>/, entry.id);
  }
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
  assert.match(page, new RegExp(`<h1[^>]*>.*${entry.title.en}</h1>`));
  assert.match(page, new RegExp(`<div class="render-frame[^"]*"[^>]*><iframe src="${entry.file}"`));
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
  const filtered = examplesMenu(route, entry.title.en).flatMap(({ items }) => items);
  assert.equal(filtered[0].key, entry.id);
  assert.deepEqual(examplesMenu(route, 'no example is called this'), []);
  const index = renderToStaticMarkup(createElement(Examples, { locale: 'en' }));
  // The index shows every entry: a ready one as a card that opens it, one still to come as an
  // "in progress" card that opens nothing, with the engine feature it waits for; one written and
  // waiting for the engine opens nothing either, and links its issue.
  for (const entry of roadmapEntries) {
    assert.ok(index.includes(`>${entry.title.en}</h2>`), entry.id);
    assert.equal(index.includes(`href="#/en/examples/${entry.id}"`), isReady(entry), entry.id);
    assert.equal(index.includes(`thumbnails/${entry.id}.png`), isReady(entry), entry.id);
    if (entry.missing)
      assert.ok(index.includes(`Waits for the engine: ${entry.missing.en}`), entry.id);
    if (entry.issue)
      assert.ok(index.includes(`/issues/${entry.issue}">#${entry.issue}</a>`), entry.id);
  }
  const count = (pattern: RegExp) => (index.match(pattern) ?? []).length;
  assert.equal(count(/aria-disabled="true"/g), roadmapEntries.length - ready.length);
  assert.equal(count(/>In progress</g), roadmapEntries.length - written.length);
  assert.equal(count(/>Waiting for the engine</g), written.length - ready.length);
});
