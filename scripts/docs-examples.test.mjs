import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.mjs';
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
    assert.match(html, /import \{ createExplorer \} from '\.\.\/runtime\/engine\.js'/);
    assert.doesNotMatch(html, /setDiagnostic|localhost|127\.0\.0\.1/);
    const manifest = html.match(/manifestUrl: '\.\.\/(assets\/[^']+)'/)?.[1];
    assert.ok(manifest, entry.id);
    await access(new URL(manifest, site));
    if (/models\/|CC BY/.test(html)) assert.match(html, /<p>.*CC BY 3\.0.*CREDITS\.md<\/p>/);
  }
});

test('the example page shows the file as source on the left and runs it on the right', async () => {
  const { Example } = await loadReactComponents('site/app/examples/Example.tsx');
  const { Examples } = await loadReactComponents('site/app/examples/Examples.tsx');
  const [entry] = ready;
  const page = renderToStaticMarkup(createElement(Example, { id: entry.id, locale: 'fr' }));
  assert.match(page, new RegExp(`<h1[^>]*>${entry.title.fr}</h1>`));
  assert.match(page, new RegExp(`<iframe class="example-frame" src="${entry.file}"`));
  assert.match(page, new RegExp(`<span class="text-sm font-semibold">${entry.file}</span>`));
  assert.ok(page.indexOf('data-code-block') < page.indexOf('<iframe'));
  const list = renderToStaticMarkup(createElement(Examples, { locale: 'en' }));
  for (const { id, file } of roadmap.entries)
    assert.equal(list.includes(`href="#/en/examples/${id}"`), Boolean(file), id);
});
