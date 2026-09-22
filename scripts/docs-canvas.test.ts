import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { loadReactComponents } from './docs/render-react.ts';
import { configureSceneCamera } from '../site/lessons/engine-scene/cameraControls.ts';
import { pose } from '../packages/sdk-browser/world/pose/index.ts';
import { Camera } from '../packages/sdk-core/world/camera/camera.ts';
import { Vector3 } from '../packages/sdk-core/world/math/vector3.ts';
import { Box3 } from '../packages/sdk-core/world/math/box3.ts';
import type { World } from '../packages/sdk-browser/index.ts';

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

// The camera helper only reads `camera` and `controls.target`; a real `Camera` and a real
// `Vector3` stand in for the world, which otherwise needs a canvas.
const fakeWorld = (): World =>
  ({ camera: new Camera('perspective'), controls: { target: new Vector3() } }) as unknown as World;

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
  assert.match(html, /<div class="render-frame/);
  assert.match(html, /<div class="canvas-overlay[^"]*"><span>Diagnostic<\/span><\/div>/);
  assert.equal(html.match(/class="canvas-overlay/g)?.length, 2);
});

test('configureSceneCamera frames the bounds on reset and sets the controls target', () => {
  const world = fakeWorld();
  const bounds = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 3, 1));
  const framing = pose.fromBounds(bounds);
  configureSceneCamera(pose, world, bounds).reset();
  assert.deepEqual(world.camera.position.toArray(), framing.position);
  assert.deepEqual(world.controls.target.toArray(), framing.target);
});

test('zoom buttons scale the offset from the controls target, clamped to a home-relative range', () => {
  const world = fakeWorld();
  const bounds = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1));
  const camera = configureSceneCamera(pose, world, bounds);
  camera.reset();
  const offset = () => world.camera.position.clone().sub(world.controls.target);
  const home = offset().length();
  camera.zoomIn();
  assert.ok(offset().length() < home);
  for (let i = 0; i < 20; i++) camera.zoomOut();
  assert.equal(Number(offset().length().toFixed(6)), Number((home * 2.5).toFixed(6)));
  for (let i = 0; i < 20; i++) camera.zoomIn();
  assert.equal(Number(offset().length().toFixed(6)), Number((home * 0.15).toFixed(6)));
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
