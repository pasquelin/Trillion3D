// #486, over budget: a cut larger than the page pool is a steady state under the one cut rule —
// the pages past the budget are drawn by their nearest resident ancestor and never arrive. The
// image must still settle and hold once the pages the pool accepted are resident; before, the
// budget flag and the pending count of the refused pages kept a still camera redrawing forever.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import { createCutPending } from '../cut/pending.ts';
import { admitGpuCut } from '../pages/render/gpuCutAdmission.ts';
import { scene } from '../residency/sets.fixture.ts';
import { holdWebgpuFrame, keepWebgpuFrame, unsettledMask, unsettledReasons } from './hold.ts';
import { settledRt } from './hold.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** The residency path of one GPU-cut image, in the engine's order: publication, admission, budget. */
function overBudgetEngine(slots: number) {
  const world = scene();
  const cutPending = createCutPending(world.packed, world.delta, world.sets.accepts);
  const rt = settledRt();
  Object.assign(rt, { setup: { slots } });
  Object.assign(rt.services, { residencySets: world.sets, cutPending });
  Object.assign(rt.run, { gpuSelection: { peek: () => ({ uniforms: { pixelError: 1 } }) } });
  const cut = world.packed.map((_, id) => id);
  const image = () => {
    world.delta.apply(cut);
    world.sets.applyCut(world.delta);
    cutPending.apply();
    admitGpuCut(rt);
    // Room beyond the pinned cover, as `queueCutResidency` passes it.
    world.sets.applyBudget(slots - 2);
  };
  /** The host serves every page the pool accepted, and nothing else. */
  const serveAccepted = () =>
    world.packed.forEach((rec, id) => {
      if (!world.sets.accepts(rec)) return;
      (rec as PageRec & { array: unknown }).array = new Float32Array(1);
      cutPending.touch(id);
    });
  return { world, rt, cutPending, image, serveAccepted };
}

test('a cut larger than the page pool settles and holds on a still camera', () => {
  const { world, rt, cutPending, image, serveAccepted } = overBudgetEngine(4);
  image();
  assert.equal(rt.run.coverageBudgetLimited, true, 'the cut asks for more pages than the pool');
  const refused = world.packed.filter((rec) => !world.sets.accepts(rec));
  assert.ok(refused.length > 0, 'some pages of the cut are past the budget');
  assert.ok(cutPending.count > 0, 'the accepted pages are awaited');
  assert.ok(
    cutPending.records.every((rec) => world.sets.accepts(rec)),
    'the host is asked only for the accepted pages',
  );

  serveAccepted();
  // Still camera: the same cut, image after image. The refused pages never get their bytes.
  for (let i = 0; i < 3; i++) image();
  assert.ok(
    refused.every((rec) => !(rec as { array?: unknown }).array),
    'the refused pages never arrive',
  );
  assert.equal(cutPending.count, 0, 'nothing the pool accepted is still awaited');
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), [], 'over budget is a steady state');

  for (let i = 0; i < 2; i++) {
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  assert.equal(holdWebgpuFrame(rt, fakeDevice().device), true, 'the still image is held');
});
