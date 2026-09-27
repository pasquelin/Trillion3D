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
  let change: ((values: { lampWidth: number; moveSubject: boolean }) => void) | undefined,
    frame: ((event: { delta: number }) => void) | undefined,
    invalidations = 0;
  const world = {
    scene,
    camera: { position: { set() {} }, lookAt() {} },
    controls: { target: { set() {} }, maxPolarAngle: 0 },
    onFrame: (hook: (event: { delta: number }) => void) => (frame = hook),
    invalidate: () => void invalidations++,
  };
  await runExampleModule(html, {
    engine: { createWorld: () => world, geometry, light, material, math, object },
    kit: {
      controls: (
        spec: { lampWidth: number[] },
        onChange: (values: { lampWidth: number; moveSubject: boolean }) => void,
      ) => {
        const values = { lampWidth: spec.lampWidth[2], moveSubject: true };
        change = (next) => {
          Object.assign(values, next);
          onChange(values);
        };
        onChange(values);
        return values;
      },
    },
  });
  const lamp = scene.children.find(
    (child): child is Light => child instanceof Light && child.kind === 'point',
  );
  const subject = scene.children.find((child) => child.children.length === 3);
  const width = 0.8;
  assert.equal(lamp?.radius, width / 2);
  change?.({ lampWidth: 2.4, moveSubject: true });
  assert.equal(lamp?.radius, 1.2);
  frame?.({ delta: 0.05 });
  assert.notEqual(subject?.position.x, 0);

  change?.({ lampWidth: 2.4, moveSubject: false });
  const stoppedAt = subject?.position.x,
    stoppedInvalidations = invalidations;
  frame?.({ delta: 0.05 });
  assert.equal(subject?.position.x, stoppedAt);
  assert.equal(invalidations, stoppedInvalidations);
});
