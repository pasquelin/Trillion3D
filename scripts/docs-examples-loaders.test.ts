import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';

type Values = { visible: boolean };

test('the folder example loads the merged cache and its controls drive the whole model', async () => {
  const html = await readFile(
    new URL('../site/examples/a-folder-merged-into-one-scene.html', import.meta.url),
    'utf8',
  );
  const loaded: string[] = [],
    eye: number[][] = [],
    aimed: number[][] = [],
    target: number[][] = [];
  const model = { visible: true };
  let values: Values = { visible: true },
    changed = (_values: Values) => {},
    home = () => {},
    invalidations = 0,
    updates = 0;
  const orbit: Record<string, unknown> & { target: { set: (...at: number[]) => number } } = {
    target: { set: (...at: number[]) => target.push(at) },
    update: () => updates++,
  };
  await runExampleModule(html, {
    engine: {
      createWorld: () => ({
        scene: {
          background: null,
          add() {},
          load: async (url: string) => {
            loaded.push(url);
            return model;
          },
        },
        camera: {
          position: { set: (...at: number[]) => eye.push(at) },
          lookAt: (...at: number[]) => aimed.push(at),
        },
        controls: orbit,
        invalidate: () => invalidations++,
      }),
      light: { directional: () => ({}), hemisphere: () => ({}) },
      math: { color: (value: string) => value },
    },
    kit: {
      controls: (specs: Values & { home: () => void }, onChange: (next: Values) => void) => {
        values = { visible: specs.visible };
        home = specs.home;
        changed = onChange;
        changed(values);
      },
    },
  });

  assert.deepEqual(loaded, ['../assets/examples/street-corner/cache/native/full/manifest.json']);
  assert.deepEqual(eye, [[2.15, 2.5, 4.1]]);
  assert.deepEqual(target, [[0.75, 1.6, 1]]);
  assert.deepEqual(aimed, [[0.75, 1.6, 1]]);
  assert.equal(orbit.maxDistance, 3.6);
  assert.equal(orbit.minPolarAngle, 0.5);
  assert.equal(orbit.maxPolarAngle, Math.PI / 2 - 0.05);
  assert.equal(orbit.enablePan, false);
  assert.equal(updates, 1);
  values.visible = false;
  changed(values);
  assert.equal(model.visible, false, 'visibility hides the whole merged model');
  eye.length = target.length = aimed.length = 0;
  home();
  assert.deepEqual(
    { eye, target, aimed },
    {
      eye: [[2.15, 2.5, 4.1]],
      target: [[0.75, 1.6, 1]],
      aimed: [[0.75, 1.6, 1]],
    },
  );
  assert.equal(updates, 2, 'Home settles the orbit controller on the restored target');
  assert.equal(invalidations, 4, 'initial view, controls, visibility and Home each redraw');
});
