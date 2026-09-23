import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';
import type { Locale } from '../site/content/locale.ts';

const { NotFound } = (await loadReactComponents('site/app/portal/NotFound.tsx')) as {
  NotFound: ComponentType<{ locale: Locale }>;
};

test('missing pages keep localized recovery links and mount no canvas', () => {
  for (const locale of ['en', 'fr'] as const) {
    const html = renderToStaticMarkup(createElement(NotFound, { locale }));
    assert.match(html, /<h1[^>]*>/);
    assert.ok(html.includes(`href="#/${locale}/learn/home"`));
    assert.ok(html.includes(`href="#/${locale}/examples"`));
    assert.doesNotMatch(html, /<canvas/);
  }
});
