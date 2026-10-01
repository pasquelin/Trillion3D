import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fakeWorld } from './docs/examples/world.ts';
import { runControlledExample } from './docs/examples/controlled.ts';
import { catchPagehide } from './docs/examples/capture.ts';

type Values = { elevation: string; distance: number; zoom: number };

test('the house elevations use parallel rays and keep their scale across camera distance', async (t) => {
  const html = await readFile(
    new URL('../site/examples/an-elevation-of-the-house.html', import.meta.url),
    'utf8',
  );
  const { world, state } = fakeWorld();
  const hide = catchPagehide(t);
  const { values, change } = await runControlledExample<Values>(html, world);

  const active = world.camera;
  assert.equal(active.projection, 'orthographic');
  assert.ok(active.fitAspect, 'the engine fits the box to the canvas');
  const aspect = 16 / 9;
  const span = () => {
    const left = active.rayThrough(-0.5, 0, aspect);
    const right = active.rayThrough(0.5, 0, aspect);
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
  hide();
  assert.equal(state.disposals, 1);
});
