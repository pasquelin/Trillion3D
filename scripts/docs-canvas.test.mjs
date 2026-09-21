import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { loadReactComponents } from './docs/render-react.mjs';
const { Canvas } = await loadReactComponents('docs/react/components/Canvas.jsx');
const { DIAGNOSTIC_MODES } = await import('../docs/js/engine-scene/diagnosticModes.js');
const { sceneCopy } = await import('../docs/js/engine-scene/content.js');

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
    new URL('../docs/react/gallery/RendererLesson.jsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /<RendererViewport\s+key=\{lesson\.id\}/);
});

test('a canvas frames its overlay in the hover-revealed chrome next to the actions', () => {
  const html = renderToStaticMarkup(
    createElement(Canvas, {
      label: 'Scene',
      overlay: createElement('span', null, 'Diagnostic'),
      actions: [{ label: 'Reset', symbol: '↺' }],
    }),
  );
  assert.match(html, /<div class="engine-canvas-frame/);
  assert.match(html, /<div class="canvas-overlay[^"]*"><span>Diagnostic<\/span><\/div>/);
  assert.equal(html.match(/class="canvas-overlay/g).length, 2);
});

test('configureSceneCamera clamps the distance and leaves wheel zoom enabled', async () => {
  const { configureSceneCamera } = await import('../docs/js/engine-scene/cameraControls.js');
  let homeReset = false;
  const explorer = {
    center: { x: 0, y: 0, z: 0 },
    resetHome() {
      homeReset = true;
    },
  };
  const controls = {
    target: { copy() {} },
    object: { position: { distanceTo: () => 10 } },
    minDistance: 0,
    maxDistance: 0,
    update() {},
  };
  configureSceneCamera(explorer, controls).reset();
  assert.equal(homeReset, true);
  assert.equal(controls.enableZoom, undefined);
  assert.equal(controls.minDistance, 1.5);
  assert.equal(controls.maxDistance, 25);
});

test('RendererViewport offers every shared diagnostic mode with the scene copy of each locale', async () => {
  const { RendererViewport } = await loadReactComponents('docs/react/gallery/RendererViewport.jsx');
  for (const locale of ['en', 'fr']) {
    const copy = sceneCopy[locale];
    const html = renderToStaticMarkup(
      createElement(RendererViewport, {
        lesson: { id: 'test-lesson' },
        state: {},
        locale,
        label: 'Viewport',
      }),
    );
    assert.match(
      html,
      new RegExp(`<select[^>]*aria-label="${copy.mode}"[^>]*data-renderer-diagnostic`),
    );
    for (const mode of DIAGNOSTIC_MODES)
      assert.match(html, new RegExp(`<option value="${mode}"[^>]*>${copy[mode]}</option>`));
    assert.equal(html.match(/<option /g).length, DIAGNOSTIC_MODES.length);
  }
});
