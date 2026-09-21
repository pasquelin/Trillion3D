import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.mjs';
import { modelScenes } from './docs/examples/models.mjs';
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
    assert.match(html, /import \{ createExplorer[^}]*\} from '\.\.\/runtime\/engine\.js'/);
    assert.doesNotMatch(html, /setDiagnostic|localhost|127\.0\.0\.1/);
    const manifest = html.match(/manifestUrl: '\.\.\/(assets\/[^']+)'/)?.[1];
    assert.ok(manifest, entry.id);
    await access(new URL(manifest, site));
    // A scene built around an imported model credits its author on the page.
    if (Object.keys(modelScenes).some((scene) => manifest.startsWith(`assets/examples/${scene}/`)))
      assert.match(html, /<p>[^<]*\b(CC0|CC BY 3\.0)\b[^<]*CREDITS\.md<\/p>/, entry.id);
  }
});

test('the example page shows the file as source on the left and runs it on the right', async () => {
  const { Example } = await loadReactComponents('site/app/examples/Example.tsx');
  const { SidebarMenu } = await loadReactComponents('site/app/portal/SidebarMenu.tsx');
  const { examplesMenu } = await loadReactComponents('site/app/examples/examplesMenu.ts');
  const [entry] = ready;
  const page = renderToStaticMarkup(createElement(Example, { id: entry.id, locale: 'fr' }));
  assert.match(page, new RegExp(`<h1[^>]*>${entry.title.fr}</h1>`));
  // The example runs in the very frame a lesson's canvas wears, loading state included.
  assert.match(
    page,
    new RegExp(`<div class="render-frame relative min-w-0"><iframe src="${entry.file}"`),
  );
  assert.match(page, /role="status"[^>]*>.*Préparation de la scène/s);
  assert.match(page, new RegExp(`<span class="text-sm font-semibold">${entry.file}</span>`));
  assert.ok(page.indexOf('data-code-block') < page.indexOf('<iframe'));
  const route = { locale: 'en', area: 'examples', id: entry.id };
  const sidebar = renderToStaticMarkup(
    createElement(SidebarMenu, { groups: examplesMenu(route), open: true }),
  );
  for (const { id, file } of roadmap.entries)
    assert.equal(sidebar.includes(`href="#/en/examples/${id}"`), Boolean(file), id);
  assert.match(
    sidebar,
    new RegExp(`class="menu-active" href="#/en/examples/${entry.id}" aria-current="page"`),
  );
  const { Examples } = await loadReactComponents('site/app/examples/Examples.tsx');
  const index = renderToStaticMarkup(createElement(Examples, { locale: 'en' }));
  for (const theme of roadmap.themes) {
    const entries = roadmap.entries.filter((entry) => entry.theme === theme.id),
      done = entries.filter((entry) => entry.file).length;
    assert.ok(
      sidebar.includes(
        `<span class="sidebar-section-title">${theme.title.en}</span><span class="sidebar-count">${done}/${entries.length}</span>`,
      ),
      theme.id,
    );
  }
  // The grid is the lessons' progressive list: its first batch of 24 cards is what the server
  // renders, theme by theme; the rest mounts on scroll.
  const shown = roadmap.themes
    .flatMap((theme) => roadmap.entries.filter((entry) => entry.theme === theme.id))
    .slice(0, 24);
  for (const { id, file, title } of shown) {
    assert.ok(index.includes(`>${title.en}</h2>`), id);
    assert.equal(index.includes(`assets/examples/thumbnails/${id}.png`), Boolean(file), id);
  }
  assert.equal(
    (index.match(/aria-disabled="true"/g) ?? []).length,
    shown.filter(({ file }) => !file).length,
  );
});
