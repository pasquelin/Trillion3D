import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExampleModule } from './docs/examples/capture.ts';
import { geometry, light, material, math, object } from '../packages/sdk-browser/src/index.ts';
import { Light } from '../packages/sdk-core/src/world/light/light.ts';

test('the wide-lamp control changes the public emitter radius', async () => {
  const html = await readFile(
    new URL('../site/examples/soft-shadows-from-a-wide-lamp.html', import.meta.url),
    'utf8',
  );
  const scene = object.group();
  let change: ((values: { lampWidth: number; moveSubject: boolean }) => void) | undefined;
  const world = {
    scene,
    camera: { position: { set() {} }, lookAt() {} },
    controls: { target: { set() {} }, maxPolarAngle: 0 },
    onFrame() {},
    invalidate() {},
  };
  await runExampleModule(html, {
    engine: { createWorld: () => world, geometry, light, material, math, object },
    kit: {
      controls: (
        _spec: unknown,
        onChange: (values: { lampWidth: number; moveSubject: boolean }) => void,
      ) => {
        change = onChange;
        const values = { lampWidth: 0.8, moveSubject: true };
        onChange(values);
        return values;
      },
    },
  });
  const lamp = scene.children.find(
    (child): child is Light => child instanceof Light && child.kind === 'point',
  );
  assert.equal(lamp?.radius, 0.4);
  change?.({ lampWidth: 2.4, moveSubject: true });
  assert.equal(lamp?.radius, 1.2);
});
