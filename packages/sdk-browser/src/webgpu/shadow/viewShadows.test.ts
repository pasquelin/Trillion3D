import assert from 'node:assert/strict';
import test from 'node:test';
import { SUN, VIEW } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import {
  PAGE_VALID,
  PAGE_INDEX_MASK,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import { addWebgpuView, removeWebgpuView } from '../pages/state/persistentView.ts';
import { drawnQuad } from '../pages/drawnQuad.fixture.ts';
import { gpuFrames } from './gpuFrames.fixture.ts';
import { floorTiles, tileGrid } from './shadingReads.fixture.ts';

// Runs the shipped allocation and page composition WGSL through the existing mock-device runner.
test('alternating views retain both sun records and drawn pages in one GPU atlas', async () => {
  const run = gpuFrames(16, [SUN]),
    { plan, store } = run;
  const floor = floorTiles(tileGrid(-4, 4, -14, -10), 3),
    side = { ...VIEW, position: [30, 5, 0] } as typeof VIEW;
  const draw = async (key: unknown, frame: number, view: typeof VIEW) => {
    plan.useView(key);
    return run.frame(
      frame,
      view,
      floor.lits,
      (report) => plan.receiver()(report),
      [],
      plan.keptFrom(frame),
    );
  };
  const first = await draw(undefined, 0, VIEW),
    slice = store.sliceOf(0);
  const held = new Map(first.map((entry) => [entry, run.table[entry] & PAGE_INDEX_MASK]));
  const second = await draw('side', 1, side);
  assert.notEqual(store.sliceOf(0), slice);
  for (const [entry, page] of held) {
    assert.equal(run.owner[page], entry, 'inactive view still owns its GPU pages');
    assert.ok(run.table[entry] & PAGE_VALID, 'its shadow record remains readable');
    assert.equal(run.drawnFor[page], entry);
  }
  await draw(undefined, 2, VIEW);
  assert.equal(store.sliceOf(0), slice);
  for (const entry of [...first, ...second]) {
    assert.ok(run.table[entry] & PAGE_VALID);
    assert.equal(run.drawnFor[run.table[entry] & PAGE_INDEX_MASK], entry);
  }
});

test('persistent view admission refuses an insufficient shadow budget before allocating targets', async () => {
  const { rt, gpu } = await drawnQuad(false);
  rt.lights.store.add(SUN);
  rt.lights.plan = createShadowPlan(1);
  const textures = gpu.textures.length,
    views = rt.views.persistent.length;
  await assert.rejects(
    addWebgpuView(rt, { x: 0, y: 0, width: 16, height: 16 }),
    /SHADOW_VIEW_POOL_EXCEEDED/,
  );
  assert.equal(rt.views.persistent.length, views);
  assert.equal(gpu.textures.length, textures);
  assert.equal(rt.views.active, rt.views.main);
});

test('a view can be released after added lights exceed the shared budget', async () => {
  const { rt } = await drawnQuad(false);
  rt.lights.store.add(SUN);
  rt.lights.plan = createShadowPlan(2);
  const rect = { x: 0, y: 0, width: 16, height: 16 };
  const side = await addWebgpuView(rt, rect);
  rt.lights.store.add({ ...SUN, id: 'second' });
  rt.lights.store.add({ ...SUN, id: 'third' });
  await assert.rejects(addWebgpuView(rt, rect), /SHADOW_VIEW_POOL_EXCEEDED/);
  await assert.doesNotReject(removeWebgpuView(rt, side));
  assert.equal(rt.views.persistent.length, 0);
  assert.equal(rt.views.active, rt.views.main);
});
