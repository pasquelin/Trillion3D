import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  Camera,
  geometry,
  light,
  material,
  math,
  object,
  Scene,
  Vector3,
} from '../packages/sdk-browser/src/index.ts';
import type {
  GuideHandle,
  GuideLines,
  GuidePoints,
  World,
} from '../packages/sdk-browser/src/index.ts';
import { catchPagehide, runExampleModule } from './docs/examples/capture.ts';

test('distance picking keeps exact points, restarts, clears and disposes', async (t) => {
  const html = await readFile(
    new URL('../site/examples/measure-a-distance.html', import.meta.url),
    'utf8',
  );
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  const listeners = new Map<
    string,
    (event: { offsetX: number; offsetY: number; isPrimary: boolean }) => void
  >();
  const lineCalls: GuideLines[] = [],
    pointCalls: GuidePoints[] = [];
  let removed = 0,
    disposed = false;
  let buttons: Record<string, () => void> = {};
  const handle = (): GuideHandle => ({
    visible: true,
    setVisible() {
      return this;
    },
    setTransform() {
      return this;
    },
    remove: () => void removed++,
  });
  const record =
    <T extends GuideLines | GuidePoints>(calls: T[]) =>
    (spec: T) => (calls.push({ ...spec, positions: Array.from(spec.positions) }), handle());
  const guides = {
    lines: record(lineCalls),
    points: record(pointCalls),
  } satisfies Pick<World['guides'], 'lines' | 'points'>;
  const hits = new Map([
    [1, new Vector3(0, 0, 0)],
    [2, new Vector3(3, 4, 0)],
    [3, new Vector3(-1, 2, 2)],
  ]);
  const shown = new Map<string, string>();
  const world = {
    scene,
    guides,
    canvas: {
      addEventListener: (
        type: string,
        listener: (event: { offsetX: number; offsetY: number; isPrimary: boolean }) => void,
      ) => listeners.set(type, listener),
    },
    camera: new Camera('perspective'),
    controls: { target: new Vector3() },
    raycast: ({ x }: { x: number }) => {
      const point = hits.get(x);
      return point
        ? { point, object: scene, normal: new Vector3(0, 1, 0), distance: 1, face: 0 }
        : null;
    },
    dispose: () => void (disposed = true),
  } satisfies {
    [
      K in keyof Pick<
        World,
        'scene' | 'guides' | 'canvas' | 'camera' | 'controls' | 'raycast' | 'dispose'
      >
    ]: unknown;
  };
  const pagehide = catchPagehide(t);

  await runExampleModule(html, {
    engine: { createWorld: () => world, geometry, light, material, math, object },
    kit: {
      controls: (specs: Record<string, () => void>) => ((buttons = specs), {}),
      readout: (name: string) => (value: string) => void shown.set(name, value),
    },
  });
  const press = (type: string, offsetX: number, isPrimary = true) =>
    listeners.get(type)?.({ offsetX, offsetY: 0, isPrimary });
  const click = (x: number, dragged = 0) => {
    press('pointerdown', x);
    press('pointerup', x + dragged);
  };

  click(1);
  assert.deepEqual(pointCalls.at(-1), {
    positions: [0, 0, 0],
    color: '#ffd45c',
    size: 10,
  });
  assert.equal(shown.get('pointA'), '0.00, 0.00, 0.00');
  click(99);
  assert.equal(pointCalls.length, 1, 'a miss preserves the first point');
  click(2, 40);
  assert.equal(pointCalls.length, 1, 'releasing an orbit drag measures nothing');
  press('pointerdown', 50);
  press('pointerdown', 2, false);
  press('pointerup', 2, false);
  assert.equal(pointCalls.length, 1, 'a second finger of a pinch measures nothing');
  click(2);
  assert.deepEqual(lineCalls.at(-1), {
    positions: [0, 0, 0, 3, 4, 0],
    color: '#ffd45c',
    width: 3,
  });
  assert.deepEqual(pointCalls.at(-1), {
    positions: [0, 0, 0, 3, 4, 0],
    color: '#ffd45c',
    size: 10,
  });
  assert.equal(shown.get('distance'), '5.00 m');

  click(3);
  assert.deepEqual(
    pointCalls.at(-1)?.positions,
    [-1, 2, 2],
    'a third hit starts a new measurement',
  );
  assert.equal(shown.get('pointB'), '—');
  assert.equal(shown.get('distance'), '—');
  buttons.clear();
  assert.equal(shown.get('pointA'), '—');
  assert.ok(removed >= 3, 'replaced and cleared guide handles are removed');

  click(1);
  click(2);
  pagehide();
  assert.ok(disposed);
});
