import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';

type Values = { spin: boolean; visible: boolean };

test('the folder example loads the merged cache and its controls drive the whole model', async () => {
  const html = await readFile(
    new URL('../site/examples/a-folder-merged-into-one-scene.html', import.meta.url),
    'utf8',
  );
  const loaded: string[] = [],
    frames: ((frame: { delta: number }) => void)[] = [];
  const model = { visible: true, rotation: { y: 0 } };
  let values: Values = { spin: true, visible: true },
    changed = (_values: Values) => {};
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
        camera: { position: { set() {} }, lookAt() {} },
        controls: { target: { set() {} } },
        onFrame: (frame: (value: { delta: number }) => void) => frames.push(frame),
        invalidate() {},
      }),
      light: { directional: () => ({}), hemisphere: () => ({}) },
      math: { color: (value: string) => value },
    },
    kit: {
      controls: (specs: Values, onChange: (next: Values) => void) => {
        values = { ...specs };
        changed = onChange;
        changed(values);
        return values;
      },
    },
  });

  assert.deepEqual(loaded, ['../assets/examples/street-corner/cache/native/full/manifest.json']);
  frames[0]({ delta: 2 });
  assert.equal(model.rotation.y, 0.3, 'spin turns the merged model');
  values.spin = false;
  frames[0]({ delta: 2 });
  assert.equal(model.rotation.y, 0.3, 'spin off leaves the model still');
  values.visible = false;
  changed(values);
  assert.equal(model.visible, false, 'visibility hides the whole merged model');
});
