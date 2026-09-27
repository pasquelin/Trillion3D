import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';
import { geometry, light, material, math, object } from '../packages/sdk-browser/src/index.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { Scene } from '../packages/sdk-browser/src/world/core/scene.ts';
import { describe, type ControlSpec } from '../site/examples/kit/controls.ts';

test('outline-the-selection states the expected public pass and drives it from controls and picks', async () => {
  const html = await readFile(
    new URL('../site/examples/outline-the-selection.html', import.meta.url),
    'utf8',
  );
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  const listeners = new Map<string, (event: { offsetX: number; offsetY: number }) => void>();
  const canvas = {
    addEventListener: (name: string, listener: never) => listeners.set(name, listener),
  };
  let picked: object | null = null;
  const pass: { objects: object[]; color: string; thickness: number } = {
    objects: [],
    color: '',
    thickness: 0,
  };
  let change = (_values: Record<string, number | string>) => {};
  let values: Record<string, number | string> = {};
  await runExampleModule(html, {
    engine: {
      createWorld: () => ({
        scene,
        canvas,
        camera: new Camera('perspective'),
        controls: { target: { set() {} } },
        effects: { add: (value: typeof pass) => value },
        raycast: () => (picked ? { object: picked } : null),
        invalidate() {},
      }),
      effect: {
        outline: (options: typeof pass) => Object.assign(pass, options),
      },
      geometry,
      light,
      material,
      math,
      object,
    },
    kit: {
      controls: (specs: Record<string, ControlSpec>, callback: typeof change) => {
        values = describe(specs).values as typeof values;
        change = callback;
        callback(values);
        return values;
      },
    },
  });
  assert.equal(pass.objects.length, 1);
  Object.assign(values, { color: '#44ccff', thickness: 5.5 });
  change(values);
  assert.deepEqual([pass.color, pass.thickness], ['#44ccff', 5.5]);
  picked = scene.children[2];
  listeners.get('pointerdown')!({ offsetX: 10, offsetY: 12 });
  listeners.get('pointerup')!({ offsetX: 10, offsetY: 12 });
  assert.deepEqual(pass.objects, [picked]);
  picked = null;
  listeners.get('pointerup')!({ offsetX: 10, offsetY: 12 });
  assert.deepEqual(pass.objects, []);
});
