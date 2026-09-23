import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadReactComponents } from './docs/render-react.ts';

const { Canvas } = (await loadReactComponents('site/app/ui/Canvas.tsx')) as {
  Canvas: ComponentType<{
    label?: string;
    pending?: boolean;
    loadingLabel?: string;
    actions?: { label: string; symbol: ReactNode }[];
    overlay?: ReactNode;
  }>;
};
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

test('a canvas frames its overlay in the hover-revealed chrome next to the actions', () => {
  const html = renderToStaticMarkup(
    createElement(Canvas, {
      label: 'Scene',
      overlay: createElement('span', null, 'Diagnostic'),
      actions: [{ label: 'Reset', symbol: '↺' }],
    }),
  );
  assert.match(html, /<div class="render-frame/);
  assert.match(html, /<div class="canvas-overlay[^"]*"><span>Diagnostic<\/span><\/div>/);
  assert.equal(html.match(/class="canvas-overlay/g)?.length, 2);
});
