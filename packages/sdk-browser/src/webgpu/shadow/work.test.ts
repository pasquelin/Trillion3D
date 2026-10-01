// #991: the frame metrics tell a page restored from the static layer — its moving casters alone
// rasterised — from a page whose static casters are rasterised again, the draw calls of each, the
// batches and layers a frame drew and why its pages turned stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { camera, disposeQuadRun } from '../pages/testScenes.fixture.ts';
import { castAt, floorCasterBackend } from './floorCaster.fixture.ts';

test('the shadow work metrics tell restored pages from rasterised ones, and say why', async () => {
  const { backend, lights, scene } = await floorCasterBackend(SUN);
  const view = camera();
  // The metrics of the frame `render` drew: `flush` may draw the pose again, a frame of its own.
  const frame = async (act?: () => void) => {
    act?.();
    backend.render(view);
    const drawn = backend.metrics();
    await backend.flush?.();
    await new Promise((settled) => setTimeout(settled, 0));
    return drawn;
  };
  const move = (x: number) => () => backend.setTransform!('caster', castAt(x));
  // The caster's first moves make the static layer.
  for (let step = 1; step <= 4; step++) await frame(move(step * 0.05));
  const moved = await frame(move(0.3));
  assert.ok(moved.shadowPagesRestored! > 0, 'pages restored from the static layer');
  assert.equal(moved.shadowPagesRasterized, 0, 'no static caster rasterised again');
  assert.equal(moved.shadowPagesRestored, moved.shadowPagesDrawn);
  assert.ok(moved.shadowRestoreCopies! >= moved.shadowPagesRestored!);
  assert.equal(moved.shadowStaticDrawCalls, 0);
  assert.ok(moved.shadowMovingDrawCalls! > 0);
  assert.ok(moved.shadowBatches! > 0 && moved.shadowLayersDrawn! > 0);
  assert.ok(moved.shadowPagesStaledBy!.moving > 0, 'staled by moving casters alone');
  assert.equal(moved.shadowPagesStaledBy!.light, 0);
  // The sun turns: every page's static casters are rasterised again.
  const turned = await frame(() =>
    lights.set(SUN.id, { direction: [Math.sin(0.1), -Math.cos(0.1), 0] }),
  );
  assert.ok(turned.shadowPagesRasterized! > 0 && turned.shadowStaticDrawCalls! > 0);
  assert.equal(
    turned.shadowPagesRestored! + turned.shadowPagesRasterized!,
    turned.shadowPagesDrawn,
  );
  assert.ok(turned.shadowPagesStaledBy!.light > 0, 'staled by the light');
  // At rest: nothing drawn, no batch run.
  await frame();
  const still = await frame();
  assert.equal(still.shadowBatches, 0);
  assert.equal(still.shadowPagesRestored! + still.shadowPagesRasterized!, 0);
  disposeQuadRun(backend, { geometry: scene.geoA, material: scene.front });
});
