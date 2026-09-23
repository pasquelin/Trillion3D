import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';
import { modelScenes } from './docs/examples/models.ts';
import type { Example as ExampleComponent } from '../site/app/examples/Example.tsx';
import type { ExampleList as ExampleListComponent } from '../site/app/layout/ExampleList.tsx';
import { examplesMenu } from '../site/app/layout/menus.ts';
import type { Examples as ExamplesComponent } from '../site/app/examples/Examples.tsx';
import type { PortalRoute } from '../site/app/portal/routes.ts';
import roadmap from '../site/content/gallery-roadmap.json' with { type: 'json' };

const site = new URL('../site/', import.meta.url);
const ready = roadmap.entries.filter(({ file }) => file);

test('every example is one standalone HTML file that imports the built engine', async () => {
  assert.equal(new Set(roadmap.entries.map(({ id }) => id)).size, roadmap.entries.length);
  const themes = new Set(roadmap.themes.map(({ id }) => id));
  for (const entry of roadmap.entries) {
    assert.ok(themes.has(entry.theme), entry.id);
    assert.ok(entry.title.en && entry.title.fr, entry.id);
    assert.doesNotMatch(`${entry.id} ${entry.title.en} ${entry.title.fr}`, /three|unreal|babylon/i);
  }
  assert.ok(ready.length >= 10);
  for (const entry of ready) {
    assert.equal(entry.file, `examples/${entry.id}.html`);
    const html = await readFile(new URL(entry.file, site), 'utf8');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<canvas id="view"><\/canvas>/);
    assert.match(html, /import \{ createWorld[^}]*\} from '\.\.\/runtime\/engine\.js'/);
    assert.doesNotMatch(html, /setDiagnostic|localhost|127\.0\.0\.1/);
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

test('an example is its file, live, on the demo page; the area lists the ready examples only', async () => {
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
  assert.match(page, new RegExp(`<div class="render-frame[^"]*"><iframe src="${entry.file}"`));
  assert.match(page, /role="status"[^>]*>.*Preparing the scene/s);
  // One floating button carries the actions; the source waits behind Code, in its modal.
  assert.equal((page.match(/class="fab"/g) ?? []).length, 1);
  for (const action of ['Code', 'Share', 'Controls', 'Fullscreen', 'Restart'])
    assert.match(page, new RegExp(`aria-label="${action}"`), action);
  assert.doesNotMatch(page, /data-code-block/);
  const route: PortalRoute = { locale: 'en', area: 'examples', id: entry.id };
  const sidebar = renderToStaticMarkup(createElement(ExampleList, { groups: examplesMenu(route) }));
  for (const { id, file } of roadmap.entries) {
    assert.equal(sidebar.includes(`href="#/en/examples/${id}"`), Boolean(file), id);
    assert.equal(sidebar.includes(`thumbnails/${id}.png`), Boolean(file), id);
  }
  assert.match(
    sidebar,
    new RegExp(`href="#/en/examples/${entry.id}" title="[^"]*" aria-current="page"`),
  );
  const filtered = examplesMenu(route, entry.title.en).flatMap(({ items }) => items);
  assert.equal(filtered[0].key, entry.id);
  assert.deepEqual(examplesMenu(route, 'no example is called this'), []);
  const index = renderToStaticMarkup(createElement(Examples, { locale: 'en' }));
  for (const { id, file, title } of roadmap.entries) {
    assert.equal(index.includes(`>${title.en}</h2>`), Boolean(file), id);
    assert.equal(index.includes(`assets/examples/thumbnails/${id}.png`), Boolean(file), id);
  }
});
