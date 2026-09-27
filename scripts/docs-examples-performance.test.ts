import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';
import {
  geometry,
  light,
  material,
  math,
  Mesh,
  object,
} from '../packages/sdk-browser/src/index.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { Scene } from '../packages/sdk-browser/src/world/core/scene.ts';
import { describe, type ControlSpec } from '../site/examples/kit/controls.ts';

test('a-hundred-thousand-instances shares resources and changes only the requested visibility', async () => {
  const html = await readFile(
    new URL('../site/examples/a-hundred-thousand-instances.html', import.meta.url),
    'utf8',
  );
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  let change = (_values: Record<string, number | string>, _key?: string) => {};
  let values: Record<string, number | string> = {};
  const readouts = new Map<string, string>();
  const diagnostic = { mode: 'beauty' };
  await runExampleModule(html, {
    engine: {
      createWorld: () => ({
        scene,
        camera: new Camera('perspective'),
        controls: { target: { set() {} } },
        diagnostic,
        invalidate() {},
      }),
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
      language: () => 'en-US',
      readout: (name: string) => (value: string) => void readouts.set(name, value),
    },
  });
  const instances = [...scene.children[0].children];
  assert.equal(instances.length, 100000);
  assert.ok(instances.every((node) => node instanceof Mesh));
  assert.ok(instances.every((node) => node.geometry === instances[0].geometry));
  assert.ok(instances.every((node) => node.material === instances[0].material));
  assert.equal(readouts.get('objectsBuilt'), (100000).toLocaleString('en-US'));
  values.count = 42000;
  change(values, 'count');
  assert.equal(instances.filter(({ visible }) => visible).length, 42000);
  assert.equal(readouts.get('objectsShown'), (42000).toLocaleString('en-US'));
  values.view = 'clusters';
  change(values, 'view');
  assert.equal(instances.filter(({ visible }) => visible).length, 42000);
  assert.equal(diagnostic.mode, 'clusters');
});
