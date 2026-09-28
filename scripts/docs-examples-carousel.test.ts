import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  advanceMixers,
  animation,
  Camera,
  geometry,
  light,
  material,
  math,
  object,
  Scene,
} from '../packages/sdk-browser/src/index.ts';
import { describe, type ControlSpec } from '../site/examples/kit/controls.ts';
import { catchPagehide, runExampleModule } from './docs/examples/capture.ts';

type Values = { running: boolean; speed: number; direction: string };

test('carousel animates eight phased horses and its controls pause and reverse the ride', async (t) => {
  const html = await readFile(new URL('../site/examples/a-carousel.html', import.meta.url), 'utf8');
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  let disposed = false;
  const world = {
    scene,
    camera: new Camera('perspective'),
    controls: { target: { set() {} }, minDistance: 0, maxDistance: 0, maxPolarAngle: 0 },
    invalidate() {},
    dispose: () => void (disposed = true),
  };
  const pagehide = catchPagehide(t);
  let change: (values: Values) => void = () => {};
  let values = {} as Values;
  await runExampleModule(html, {
    engine: {
      animation,
      createWorld: () => world,
      geometry,
      light,
      material,
      math,
      object,
    },
    kit: {
      controls: (specs: Record<string, ControlSpec>, callback: (next: Values) => void) => {
        values = describe(specs).values as Values;
        change = callback;
        callback(values);
      },
    },
  });

  const carousel = scene.getObjectByName('carousel');
  assert.ok(carousel);
  const horses = Array.from({ length: 8 }, (_, index) => {
    const horse = carousel.getObjectByName(`horse${index}`);
    assert.ok(horse && horse.parent === carousel && horse.children.length === 11);
    return horse;
  });
  const snapshot = () => [carousel.rotation.y, ...horses.map((horse) => horse.position.y)];

  advanceMixers(scene, 0);
  const starts = horses.map((horse) => horse.position.y);
  const low = [...starts],
    high = [...starts];
  for (let step = 0; step < 20; step++) {
    advanceMixers(scene, 0.5);
    horses.forEach((horse, index) => {
      low[index] = Math.min(low[index]!, horse.position.y);
      high[index] = Math.max(high[index]!, horse.position.y);
    });
  }
  horses.forEach((horse, index) => {
    const drift = Math.abs(horse.position.y - starts[index]!);
    assert.ok(drift < 1e-6, `${horse.name} cycle drift ${drift}`);
    assert.ok(high[index]! - low[index]! > 0.5, `${horse.name} moves visibly`);
  });
  assert.ok(Math.abs(carousel.rotation.y) < 1e-6);
  advanceMixers(scene, 0.5);
  assert.ok(carousel.rotation.y < 0, 'clockwise seen from above');

  const paused = snapshot();
  values.running = false;
  change(values);
  advanceMixers(scene, 0.5);
  assert.deepEqual(snapshot(), paused);

  values.speed = 1.6;
  values.direction = 'counterclockwise';
  change(values);
  advanceMixers(scene, 0.5);
  assert.equal(carousel.rotation.y, paused[0]);
  values.running = true;
  change(values);
  advanceMixers(scene, 0.25);
  assert.ok(carousel.rotation.y > paused[0]!, 'counterclockwise seen from above');

  values.running = false;
  change(values);
  pagehide();
  assert.ok(disposed);
});
