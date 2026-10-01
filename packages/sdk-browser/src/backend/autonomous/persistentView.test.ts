import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebglFrameGate } from '../../webgl/core/frameGate.ts';
import { createWebglViews } from './views.ts';
import { webglViewApi } from './persistentView.ts';
import type { HostCamera } from '../../camera/world.ts';

test('persistent GL composition owns its camera cut until composition ends, including failures', async () => {
  let invalidations = 0;
  const views = createWebglViews([800, 600], createWebglFrameGate(), () => invalidations++);
  const camera = {} as HostCamera;
  const api = webglViewApi(views, (given) => {
    assert.equal(given, camera);
    assert.notEqual(views.active, views.main);
    views.live.shownPacked.push(42);
  });
  const side = await api.addView({ x: 400, y: 0, width: 400, height: 300 });
  side.render(camera, () => {
    assert.deepEqual(views.live.shownPacked, [42]);
    assert.deepEqual(views.live.viewport, [400, 300]);
  });
  assert.equal(views.active, views.main);
  assert.deepEqual(views.live.shownPacked, []);
  assert.throws(
    () =>
      side.render(camera, () => {
        throw new Error('compose failed');
      }),
    /compose failed/,
  );
  assert.equal(views.active, views.main);
  side.resize({ x: 400, y: 0, width: 200, height: 100 });
  assert.deepEqual(views.all[1].viewport, [200, 100]);
  assert.throws(() => side.resize({ x: 0, y: 0, width: NaN, height: 100 }), /VIEW_RECT/);
  assert.deepEqual(views.all[1].viewport, [200, 100]);
  const before = invalidations;
  side.release();
  assert.equal(
    invalidations,
    before + 1,
    'retained pins are invalidated even when main is selected',
  );
  side.release();
  assert.deepEqual(views.all, [views.main]);
  assert.throws(() => side.render(camera), /VIEW_RELEASED/);
  assert.throws(() => side.resize({ x: 0, y: 0, width: 1, height: 1 }), /VIEW_RELEASED/);
});
