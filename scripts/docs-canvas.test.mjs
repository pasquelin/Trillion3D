import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { loadReactComponents } from './docs/render-react.mjs';
const { Canvas } = await loadReactComponents('docs/react/components/Canvas.jsx');

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

test('a canvas renders an overlay element and places it inside the canvas frame', () => {
  const html = renderToStaticMarkup(
    createElement(Canvas, {
      label: 'Scene',
      overlay: createElement('div', { className: 'canvas-modes' }, 'Diagnostic'),
    }),
  );
  assert.match(html, /<div class="engine-canvas-frame/);
  assert.match(html, /<div class="canvas-modes">Diagnostic<\/div>/);
});

test('configureSceneCamera enables wheel zoom on controls within distance limits', async () => {
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
    object: {
      position: {
        distanceTo() {
          return 10;
        },
        clone() {
          return {
            sub() {
              return this;
            },
            length() {
              return 10;
            },
            setLength() {},
          };
        },
        copy() {
          return { add() {} };
        },
      },
    },
    enableZoom: false,
    minDistance: 0,
    maxDistance: 0,
    update() {},
  };
  const camera = configureSceneCamera(explorer, controls);
  camera.reset();
  assert.equal(homeReset, true);
  assert.equal(controls.enableZoom, true);
  assert.equal(controls.minDistance, 1.5);
  assert.equal(controls.maxDistance, 25);
});

test('RendererViewport renders the diagnostic mode select with all active modes in French and English', async () => {
  const { RendererViewport, DIAGNOSTIC_MODES } = await loadReactComponents(
    'docs/react/gallery/RendererViewport.jsx',
  );
  assert.equal(DIAGNOSTIC_MODES.length, 7);
  assert.deepEqual(
    DIAGNOSTIC_MODES.map((m) => m.id),
    ['beauty', 'wireframe', 'clusters', 'pages', 'lod', 'screen-error', 'visibility'],
  );

  const htmlEn = renderToStaticMarkup(
    createElement(RendererViewport, {
      lesson: { id: 'test-lesson' },
      state: {},
      locale: 'en',
      label: 'Viewport',
    }),
  );
  assert.match(htmlEn, /data-renderer-diagnostic/);
  assert.match(htmlEn, /aria-label="Render mode"/);
  assert.match(htmlEn, /<option value="wireframe">Triangles<\/option>/);
  assert.match(htmlEn, /<option value="clusters">Clusters<\/option>/);

  const htmlFr = renderToStaticMarkup(
    createElement(RendererViewport, {
      lesson: { id: 'test-lesson' },
      state: {},
      locale: 'fr',
      label: 'Viewport',
    }),
  );
  assert.match(htmlFr, /aria-label="Mode de rendu"/);
  assert.match(htmlFr, /<option value="wireframe">Triangles<\/option>/);
  assert.match(htmlFr, /<option value="clusters">Groupes<\/option>/);
  assert.match(htmlFr, /<option value="lod">Niveau de détail<\/option>/);
});
