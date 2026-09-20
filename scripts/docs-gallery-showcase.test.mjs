import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.mjs';

const { Gallery } = await loadReactComponents('docs/react/gallery/index.jsx');
const { GalleryShowcase } = await loadReactComponents('docs/react/gallery/GalleryShowcase.jsx');
const render = (component, locale) => renderToStaticMarkup(createElement(component, { locale }));

test('showcase leads with a large observatory and exposes both live pilots', () => {
  const html = render(GalleryShowcase, 'en');
  assert.match(html, /data-gallery-showcase/);
  assert.match(html, /aspect-video max-h-\[32rem\] w-full object-cover/);
  assert.match(html, /assets\/gallery\/renderer\/runtime-pixel-error\.png/);
  assert.match(html, /assets\/gallery\/renderer\/shadow-casting-switch\.png/);
  assert.match(html, /#\/en\/examples\/runtime-pixel-error/);
  assert.match(html, /Explore live LOD/);
  assert.equal((html.match(/role="listitem"/g) ?? []).length, 2);
});

test('showcase remains above the unchanged searchable catalogue', () => {
  const html = render(Gallery, 'fr'),
    showcase = html.indexOf('data-gallery-showcase'),
    catalogueTabs = html.indexOf('role="tablist"');
  assert.ok(showcase >= 0);
  assert.ok(catalogueTabs > showcase);
  assert.match(html, /91 352 triangles originaux/);
  assert.match(html, /Rechercher 663 sujets/);
});
