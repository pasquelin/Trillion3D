import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  Camera,
  geometry,
  light,
  material,
  math,
  object,
  Scene,
  Vector3,
} from '../packages/sdk-browser/src/index.ts';
import type { ControlSpec } from '../site/examples/kit/controls.ts';
import { tour } from '../site/examples/kit/tour.ts';
import { runExampleModule } from './docs/examples/capture.ts';

test('recorded fly-through replays, stops, yields to the viewer and disposes', async (t) => {
  const html = await readFile(
    new URL('../site/examples/a-recorded-fly-through.html', import.meta.url),
    'utf8',
  );
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  const hooks = new Set<(frame: { delta: number }) => void>();
  const listeners = new Map<string, Set<() => void>>();
  const canvas = {
    addEventListener: (type: string, listener: () => void) => {
      const group = listeners.get(type) ?? new Set();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener: (type: string, listener: () => void) =>
      listeners.get(type)?.delete(listener),
  };
  let disposed = false;
  let pagehide = () => {};
  let shown = '';
  let buttons: Record<string, () => void> = {};
  const world = {
    scene,
    canvas,
    camera: new Camera('perspective'),
    controls: {
      target: new Vector3(),
      update() {},
      minDistance: 0,
      maxDistance: 0,
      maxPolarAngle: 0,
    },
    onFrame: (hook: (frame: { delta: number }) => void) => (
      hooks.add(hook),
      () => hooks.delete(hook)
    ),
    invalidate() {},
    dispose: () => (hooks.clear(), void (disposed = true)),
  };
  const frame = (count = 1) => {
    for (let at = 0; at < count; at++) for (const hook of [...hooks]) hook({ delta: 0.05 });
  };
  const previousListener = globalThis.addEventListener;
  globalThis.addEventListener = ((type: string, listener: () => void) => {
    if (type === 'pagehide') pagehide = listener;
  }) as typeof addEventListener;
  t.after(() => void (globalThis.addEventListener = previousListener));

  await runExampleModule(html, {
    engine: { createWorld: () => world, geometry, light, material, math, object },
    kit: {
      controls: (specs: Record<string, ControlSpec>) => {
        buttons = specs as Record<string, () => void>;
        return {};
      },
      readout: () => (value: string) => void (shown = value),
      tour,
      words: () => (word: string) => word,
    },
  });

  assert.equal(shown, 'entrance');
  frame(70);
  assert.equal(shown, 'pond');
  const stoppedAt = world.camera.position.clone();
  buttons.stop();
  frame(20);
  assert.ok(world.camera.position.equals(stoppedAt));
  assert.equal(shown, 'complete');

  buttons.replay();
  assert.equal(shown, 'complete');
  frame();
  assert.equal(shown, 'entrance');
  const interruptedAt = world.camera.position.clone();
  for (const listener of listeners.get('pointerdown') ?? []) listener();
  frame(20);
  assert.ok(world.camera.position.equals(interruptedAt));
  assert.equal(shown, 'complete');

  pagehide();
  assert.ok(disposed);
  assert.equal(hooks.size, 0);
  assert.equal(listeners.get('pointerdown')?.size, 0);
  assert.equal(listeners.get('wheel')?.size, 0);
});
