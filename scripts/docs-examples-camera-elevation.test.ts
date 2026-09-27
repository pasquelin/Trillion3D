import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  camera,
  geometry,
  light,
  material,
  math,
  object,
} from '../packages/sdk-browser/src/index.ts';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { Scene } from '../packages/sdk-browser/src/world/core/scene.ts';
import { describe, type ControlSpec } from '../site/examples/kit/controls.ts';
import { runExampleModule } from './docs/examples/capture.ts';

type Values = { elevation: string; distance: number; zoom: number };

test('the house elevations use parallel rays and keep their scale across camera distance', async () => {
  const html = await readFile(
    new URL('../site/examples/an-elevation-of-the-house.html', import.meta.url),
    'utf8',
  );
  const scene = new Scene(() => Promise.reject(new Error('the page loads no model')));
  const canvas = { clientWidth: 1600, clientHeight: 900 };
  let active = new Camera('perspective');
  let values = {} as Values;
  let change = (_next: Values, _key?: keyof Values) => {};
  let watched: unknown;
  const world = {
    scene,
    canvas,
    get camera() {
      return active;
    },
    set camera(next: Camera) {
      active = next;
    },
    invalidate() {},
    onPageHide() {},
    dispose() {},
  };
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe() {
      this.callback([], this as never);
    }
    disconnect() {}
    unobserve() {}
  };
  try {
    await runExampleModule(html, {
      engine: { createWorld: () => world, camera, geometry, material, object, light, math },
      kit: {
        controls: (
          specs: Record<string, ControlSpec>,
          callback: typeof change,
          statsWorld: unknown,
        ) => {
          values = describe(specs).values as Values;
          change = callback;
          watched = statsWorld;
          callback(values);
          return values;
        },
      },
    });
  } finally {
    globalThis.ResizeObserver = previous;
  }

  assert.equal(active.projection, 'orthographic');
  assert.equal(watched, world);
  const span = () => {
    const left = active.rayThrough(-0.5, 0, 16 / 9);
    const right = active.rayThrough(0.5, 0, 16 / 9);
    assert.ok(left.direction.distanceTo(right.direction) < 1e-12, 'elevation rays stay parallel');
    return left.origin.distanceTo(right.origin);
  };
  const nearSpan = span();
  values.distance = 60;
  change(values, 'distance');
  assert.equal(span(), nearSpan, 'distance does not change the elevation scale');
  values.elevation = 'right';
  change(values, 'elevation');
  assert.deepEqual(active.position.toArray(), [60, 4.3, 0]);
  values.zoom = 1.5;
  change(values, 'zoom');
  assert.ok(span() < nearSpan, 'zoom changes the drawing scale deliberately');
});
