import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as engine from '../packages/sdk/browser.ts';
import {
  labelCanvas,
  glyphPixels,
  labelTexture,
} from '../packages/sdk-browser/src/world/label/canvas.fixture.ts';
import { describe, type ControlSpec } from '../site/examples/kit/controls.ts';
import { catchPagehide, runExampleModule } from './docs/examples/capture.ts';

test('planet labels use real scene glyphs, follow their parents and respond to the example controls', async (t) => {
  labelCanvas(t);
  const html = await readFile(
    new URL('../site/examples/labels-that-follow.html', import.meta.url),
    'utf8',
  );
  const scene = new engine.Scene();
  let frame = (_info: { delta: number }) => {},
    disposed = 0;
  const world = {
    scene,
    camera: new engine.Camera('perspective'),
    controls: { target: engine.math.vector3(), minDistance: 0, maxDistance: 100, update() {} },
    invalidate() {},
    dispose() {
      disposed++;
    },
    onFrame(hook: typeof frame) {
      frame = hook;
    },
  };
  type Values = { show: string; speed: number };
  let values!: Values, change!: (value: Values) => void, specs!: Record<string, ControlSpec>;
  const labels: engine.LabelHandle[] = [];
  const pending: Promise<void>[] = [];
  const pagehide = catchPagehide(t);
  await runExampleModule(html, {
    engine: {
      ...engine,
      createWorld: () => world,
      async addLabel(...args: Parameters<typeof engine.addLabel>) {
        const label = await engine.addLabel(...args);
        labels.push(label);
        return {
          ...label,
          setText(text: string) {
            const task = label.setText(text);
            pending.push(task);
            return task;
          },
        };
      },
    },
    kit: {
      words: () => (key: string, values?: object) =>
        values ? `${key} ${Object.values(values).join(' ')}` : key,
      language: () => 'en',
      opening: () => ({ gliding: false }),
      ease: { inOut: (t: number) => t },
      controls(next: Record<string, ControlSpec>, callback: typeof change) {
        specs = next;
        values = describe(next).values as Values;
        change = callback;
        callback(values);
        return values;
      },
    },
  });
  await Promise.all(pending.splice(0));
  assert.equal(labels.length, 10);
  const first = labels[0];
  assert.ok(first.object.parent?.parent === scene);
  const image = () => glyphPixels(labelTexture(first).image);
  const described = image();
  values.show = 'names only';
  change(values);
  await Promise.all(pending.splice(0));
  assert.ok(image().height < described.height, 'the control removes the second text line');
  frame({ delta: 0.05 });
  const planet = labels[1].object;
  const before = planet.getWorldPosition();
  frame({ delta: 0.05 });
  assert.ok(planet.getWorldPosition().distanceTo(before) > 0, 'a parent move carries its label');
  values.speed = 0;
  change(values);
  const stopped = planet.getWorldPosition();
  frame({ delta: 0.05 });
  assert.deepEqual(planet.getWorldPosition().toArray(), stopped.toArray());
  const align = specs.lineThemUp;
  assert.ok(typeof align === 'function');
  align();
  frame({ delta: 0.05 });
  assert.ok(planet.getWorldPosition().distanceTo(stopped) > 0);
  pagehide();
  assert.ok(labels.every(({ object }) => object.parent === null));
  assert.equal(disposed, 1);
  await Promise.all(pending);
});
