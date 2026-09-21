import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { loadReactComponents } from './docs/render-react.ts';
import { configureSceneCamera } from '../site/lessons/engine-scene/cameraControls.ts';
import type { Explorer } from '../packages/sdk-browser/index.ts';

const { Canvas } = (await loadReactComponents('site/app/components/Canvas.tsx')) as {
  Canvas: ComponentType<{
    label?: string;
    pending?: boolean;
    loadingLabel?: string;
    actions?: { label: string; symbol: ReactNode }[];
    overlay?: ReactNode;
  }>;
};
const { DIAGNOSTIC_MODES } = await import('../site/lessons/engine-scene/diagnosticModes.ts');
const { sceneCopy } = await import('../site/lessons/engine-scene/content.ts');

// The camera helper only touches these fields of the engine's session and orbit controls; cast
// at this boundary rather than modelling the whole `Explorer`/orbit-controls surface.
type ControlsLike = Parameters<typeof configureSceneCamera>[1];

interface Vector3Like {
  x: number;
  y: number;
  z: number;
  clone(): Vector3Like;
  copy(v: Vector3Like): Vector3Like;
  sub(v: Vector3Like): Vector3Like;
  add(v: Vector3Like): Vector3Like;
  length(): number;
  setLength(l: number): Vector3Like;
}

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
    new URL('../site/app/gallery/RendererLesson.tsx', import.meta.url),
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
  assert.equal(html.match(/class="canvas-overlay/g)?.length, 2);
});

test('configureSceneCamera clamps the distance and leaves wheel zoom enabled', () => {
  let homeReset = false;
  const explorer = {
    center: { x: 0, y: 0, z: 0 },
    resetHome() {
      homeReset = true;
    },
  } as Explorer;
  const controls = {
    target: { copy() {} },
    object: { position: { distanceTo: () => 10 } },
    minDistance: 0,
    maxDistance: 0,
    update() {},
  } as ControlsLike;
  configureSceneCamera(explorer, controls).reset();
  assert.equal(homeReset, true);
  assert.equal((controls as { enableZoom?: boolean }).enableZoom, undefined);
  assert.equal(controls.minDistance, 1.5);
  assert.equal(controls.maxDistance, 25);
});

test('zoom buttons scale the offset from the controls target, the pivot the wheel uses', () => {
  // A mutating vector with the operations the helper uses, as Three's Vector3 behaves.
  const vector = (x: number, y: number, z: number): Vector3Like => ({
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
  } as ControlsLike;
  const explorer = { center: vector(0, 0, 0), resetHome() {} } as Explorer;
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
  const { RendererViewport } = (await loadReactComponents(
    'site/app/gallery/RendererViewport.tsx',
  )) as {
    RendererViewport: ComponentType<{
      lesson: { id: string };
      state: Record<string, number>;
      locale: 'en' | 'fr';
      label: string;
    }>;
  };
  for (const locale of ['en', 'fr'] as const) {
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
    assert.equal(html.match(/<option /g)?.length, DIAGNOSTIC_MODES.length);
  }
});
