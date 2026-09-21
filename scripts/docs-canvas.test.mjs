import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { loadReactComponents } from './docs/render-react.mjs';
const { Canvas } = await loadReactComponents('docs/react/components/Canvas.tsx');
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
    new URL('../docs/react/gallery/RendererLesson.tsx', import.meta.url),
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

test('zoom buttons scale the offset from the controls target, the pivot the wheel uses', async () => {
  const { configureSceneCamera } = await import('../docs/js/engine-scene/cameraControls.js');
  // A mutating vector with the operations the helper uses, as Three's Vector3 behaves.
  const vector = (x, y, z) => ({
    x,
    y,
    z,
    clone() {
      return vector(this.x, this.y, this.z);
    },
    copy(v) {
      return Object.assign(this, { x: v.x, y: v.y, z: v.z });
    },
    sub(v) {
      return Object.assign(this, { x: this.x - v.x, y: this.y - v.y, z: this.z - v.z });
    },
    add(v) {
      return Object.assign(this, { x: this.x + v.x, y: this.y + v.y, z: this.z + v.z });
    },
    length() {
      return Math.hypot(this.x, this.y, this.z);
    },
    setLength(l) {
      const k = l / this.length();
      return Object.assign(this, { x: this.x * k, y: this.y * k, z: this.z * k });
    },
  });
  const controls = {
    target: vector(0, 3, 0),
    object: { position: vector(0, 3, 10) },
    minDistance: 1,
    maxDistance: 25,
    update() {},
  };
  const explorer = { center: vector(0, 0, 0), resetHome() {} };
  const camera = configureSceneCamera(explorer, controls);
  const offset = () => controls.object.position.clone().sub(controls.target);
  camera.zoomIn();
  assert.deepEqual([offset().x, offset().y, offset().z], [0, 0, 8]);
  camera.zoomOut();
  camera.zoomOut();
  camera.zoomOut();
  assert.equal(offset().length(), 15.625);
  for (let i = 0; i < 8; i++) camera.zoomOut();
  assert.equal(offset().length(), controls.maxDistance);
});

test('RendererViewport offers every shared diagnostic mode with the scene copy of each locale', async () => {
  const { RendererViewport } = await loadReactComponents('docs/react/gallery/RendererViewport.tsx');
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
