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
import { runExampleModule } from './docs/examples/capture.ts';

type Values = { running: boolean; speed: number; direction: string };

test('carousel animates eight phased horses and its controls pause and reverse the ride', async (t) => {
  const html = await readFile(new URL('../site/examples/a-carousel.html', import.meta.url), 'utf8');
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  let disposed = false,
    pagehide = () => {};
  const world = {
    scene,
    camera: new Camera('perspective'),
    controls: { target: { set() {} }, minDistance: 0, maxDistance: 0, maxPolarAngle: 0 },
    invalidate() {},
    dispose: () => void (disposed = true),
  };
  const previousListener = globalThis.addEventListener;
  globalThis.addEventListener = ((type: string, listener: () => void) => {
    if (type === 'pagehide') pagehide = listener;
  }) as typeof addEventListener;
  t.after(() => void (globalThis.addEventListener = previousListener));
  let change: (values: Values) => void = () => {};
  let values = {} as Values;
  await runExampleModule(html, {
    engine: {
      advanceMixers,
      animation,
      createWorld: () => world,
      geometry,
      light,
      material,
      math,
      object,
    },
    kit: {
      announceWhatToDo() {},
      controls: (specs: Record<string, ControlSpec>, callback: (next: Values) => void) => {
        values = describe(specs).values as Values;
        change = callback;
        callback(values);
        return values;
      },
    },
  });

  const carousel = scene.getObjectByName('carousel');
  assert.ok(carousel);
  const horses = Array.from({ length: 8 }, (_, index) => carousel.getObjectByName(`horse${index}`));
  assert.ok(
    horses.every((horse) => horse && horse.parent === carousel && horse.children.length === 11),
  );

  advanceMixers(scene, 0);
  const starts = horses.map((horse) => horse?.position.y);
  const low = [...starts] as number[],
    high = [...starts] as number[];
  for (let step = 0; step < 20; step++) {
    advanceMixers(scene, 0.5);
    horses.forEach((horse, index) => {
      low[index] = Math.min(low[index]!, horse!.position.y);
      high[index] = Math.max(high[index]!, horse!.position.y);
    });
  }
  horses.forEach((horse, index) => {
    const drift = Math.abs(horse!.position.y - starts[index]!);
    assert.ok(drift < 1e-6, `${horse!.name} cycle drift ${drift}`);
    assert.ok(high[index]! - low[index]! > 0.5, `${horse!.name} moves visibly`);
  });
  assert.ok(Math.abs(carousel.rotation.y) < 1e-6);
  const startTurn = carousel.rotation.y;
  advanceMixers(scene, 0.5);
  assert.ok(carousel.rotation.y > startTurn);

  values.running = false;
  change(values);
  const paused = [carousel.rotation.y, ...horses.map((horse) => horse?.position.y)];
  advanceMixers(scene, 0.5);
  assert.deepEqual([carousel.rotation.y, ...horses.map((horse) => horse?.position.y)], paused);

  values.speed = 1.6;
  values.direction = 'counterclockwise';
  change(values);
  advanceMixers(scene, 0.5);
  assert.equal(carousel.rotation.y, paused[0]);
  values.running = true;
  change(values);
  advanceMixers(scene, 0.25);
  assert.ok(carousel.rotation.y < paused[0]!);

  values.running = false;
  change(values);
  pagehide();
  assert.ok(disposed);
});
