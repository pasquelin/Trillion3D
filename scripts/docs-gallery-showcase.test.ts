import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';
import type { Gallery as GalleryComponent } from '../site/app/gallery/Gallery.tsx';
import type { GalleryShowcase as GalleryShowcaseComponent } from '../site/app/gallery/GalleryShowcase.tsx';
import type { Locale } from '../site/content/locale.ts';

const { Gallery } = (await loadReactComponents('site/app/gallery/Gallery.tsx')) as {
  Gallery: typeof GalleryComponent;
};
const { GalleryShowcase } = (await loadReactComponents('site/app/gallery/GalleryShowcase.tsx')) as {
  GalleryShowcase: typeof GalleryShowcaseComponent;
};
const render = (component: ComponentType<{ locale: Locale }>, locale: Locale) =>
  renderToStaticMarkup(createElement(component, { locale }));

test('showcase leads with a large observatory and exposes both live pilots', () => {
  const html = render(GalleryShowcase, 'en');
  assert.match(html, /data-gallery-showcase/);
  assert.match(html, /aspect-video max-h-\[32rem\] w-full object-cover/);
  assert.match(html, /assets\/gallery\/renderer\/runtime-pixel-error\.png/);
  assert.match(html, /assets\/gallery\/renderer\/shadow-casting-switch\.png/);
  assert.match(html, /#\/en\/lessons\/runtime-pixel-error/);
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
  assert.match(html, /Rechercher 58 leçons/);
});
