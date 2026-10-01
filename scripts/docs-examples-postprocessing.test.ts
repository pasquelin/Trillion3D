import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Color } from '../packages/sdk/browser.ts';
import { fakeWorld } from './docs/examples/world.ts';
import { runControlledExample } from './docs/examples/controlled.ts';

test('outline-the-selection states the expected public pass and drives it from controls and picks', async () => {
  const html = await readFile(
    new URL('../site/examples/outline-the-selection.html', import.meta.url),
    'utf8',
  );
  const { world: baseWorld } = fakeWorld();
  const { scene } = baseWorld;
  const listeners = new Map<string, (event: { offsetX: number; offsetY: number }) => void>();
  const canvas = {
    addEventListener: (name: string, listener: never) => listeners.set(name, listener),
  };
  let picked: object | null = null;
  let filtered: object[] = [];
  const pass: { objects: object[]; color: Color; thickness: number } = {
    objects: [],
    color: new Color(),
    thickness: 0,
  };
  const world = {
    ...baseWorld,
    canvas,
    effects: { add: (value: typeof pass) => value },
    raycast: (_point: object, options: { objects: object[] }) => {
      filtered = options.objects;
      return picked ? { object: picked } : null;
    },
  };
  const { values, change } = await runControlledExample<Record<string, number | string>>(
    html,
    world,
    {
      engine: {
        effect: {
          outline: (options: { objects: object[]; color: string; thickness: number }) => {
            pass.objects = options.objects;
            pass.color.set(options.color);
            pass.thickness = options.thickness;
            return pass;
          },
        },
      },
    },
  );

  const click = () => {
    listeners.get('pointerdown')!({ offsetX: 10, offsetY: 12 });
    listeners.get('pointerup')!({ offsetX: 10, offsetY: 12 });
  };
  assert.deepEqual(pass.objects, [scene.children[0]]);
  listeners.get('pointerup')!({ offsetX: 10, offsetY: 12 });
  assert.deepEqual(pass.objects, [scene.children[0]]);
  Object.assign(values, { color: '#44ccff', thickness: 5.5 });
  change(values);
  assert.deepEqual([pass.color.getHexString(), pass.thickness], ['44ccff', 5.5]);
  picked = scene.children[2];
  click();
  assert.deepEqual(pass.objects, [picked]);
  assert.deepEqual(filtered, scene.children.slice(0, 5));
  listeners.get('pointerup')!({ offsetX: 10, offsetY: 12 });
  assert.deepEqual(pass.objects, [picked]);
  picked = null;
  click();
  assert.deepEqual(pass.objects, []);
});
