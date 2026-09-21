import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { loadReactComponents } from './docs/render-react.mjs';
const { Canvas } = await loadReactComponents('docs/react/components/Canvas.tsx');

test('a pending canvas stays mounted behind one loading state and disables its actions', () => {
  const html = renderToStaticMarkup(
    createElement(Canvas, {
      label: 'Scene',
      pending: true,
      loadingLabel: 'Preparing the scene…',
      actions: [{ label: 'Zoom in', symbol: '+' }],
    }),
  );
  assert.match(html, /<canvas/);
  assert.match(html, /role="status"/);
  assert.match(html, /Preparing the scene/);
  assert.match(html, /aria-label="Zoom in"[^>]*disabled/);
});

test('switching renderer lessons remounts the pending viewport', async () => {
  const source = await readFile(
    new URL('../docs/react/gallery/RendererLesson.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /<RendererViewport\s+key=\{lesson\.id\}/);
});
