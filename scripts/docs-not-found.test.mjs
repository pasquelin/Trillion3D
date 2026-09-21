import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.mjs';

const { NotFound } = await loadReactComponents('docs/react/portal/NotFound.tsx');

test('missing pages retain localized recovery links and an accessible 3D illustration', () => {
  for (const locale of ['en', 'fr']) {
    const html = renderToStaticMarkup(createElement(NotFound, { locale }));
    assert.match(html, /<h1[^>]*>/);
    assert.ok(html.includes(`href="#/${locale}/learn/home"`));
    assert.ok(html.includes(`href="#/${locale}/examples"`));
    assert.match(html, /<canvas[^>]*aria-label=/);
    assert.match(html, /data-geometry-fps/);
    assert.match(html, /aria-pressed="false"/);
  }
});
