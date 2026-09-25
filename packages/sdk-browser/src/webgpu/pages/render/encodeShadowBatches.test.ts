// A frame at rest draws every shadow page it marks (#489), a moving one what its budget holds
// (#525): the plan's list is cut into the batches the per-batch buffers hold, each after the last,
// and a batch that cannot be encoded leaves its pages and the rest pending for the next frame —
// never counted as drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHADOW_PAGES } from '../../../gpu/shadow/atlas.ts';
import { MAX_SHADOW_BATCHES } from '../../../gpu/shadow/batchBudget.ts';
import {
  SUN,
  VIEW,
  nudged,
  planFrame,
  report,
  sunGrid,
} from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { createWebgpuLightState } from '../state/lights.ts';
import { encodeShadowBatches, forEachShadowBatch } from './encodeShadowBatches.ts';
import { writeShadowPages, writeShadowRecords } from '../../shadow/pages.ts';
import { SHADOW_CULL_FLOATS } from '../../../../../sdk-core/src/index.ts';
import { MAX_SHADOW_REGIONS } from '../../../gpu/shadow/recordPack.ts';
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** A frame on the CPU cut whose plan lists the floor pages of `suns` new suns, the camera at rest —
 *  the view of the frame before — unless `moving`. */
function frame(suns: number, moving = false) {
  const lights = createWebgpuLightState(32);
  for (let k = 0; k < suns; k++)
    lights.store.add({ ...SUN, id: `sun${k}`, direction: [k / 10, -1, 0] });
  if (!moving) planFrame(lights.plan, lights.store, 0);
  const pages = planFrame(lights.plan, lights.store, 1);
  const rt = { lights, run: { gpuFrameActive: false, frame: 1 }, vis: {} };
  return { rt: rt as unknown as WebgpuPagesRuntime, lights, pages };
}

test('the pages a frame marks are cut into batches the buffers hold, every one visited', () => {
  const { rt, lights, pages } = frame(16);
  assert.ok(pages > 2 * MAX_SHADOW_PAGES, `${pages} pages, more than two batches`);
  const batches: number[][] = [];
  const drawn = forEachShadowBatch(rt, (from, to, runBase) => {
    batches.push([from, to, runBase]);
    lights.runs.reset();
    return true;
  });
  assert.equal(drawn, pages);
  assert.deepEqual(batches[0].slice(0, 2), [0, MAX_SHADOW_PAGES]);
  for (let k = 1; k < batches.length; k++) assert.equal(batches[k][0], batches[k - 1][1]);
  assert.ok(batches.every(([from, to]) => to - from <= MAX_SHADOW_PAGES));
  assert.equal(batches.at(-1)![1], pages);
});

test('a batch that cannot be encoded leaves its pages and the rest pending, none drawn', () => {
  const { rt, lights, pages } = frame(3);
  const { device } = fakeDevice();
  assert.equal(
    encodeShadowBatches(rt, device, device.createCommandEncoder(), VIEW.position),
    false,
  );
  assert.equal(lights.shadowPages, 0);
  assert.equal(lights.plan.counts.pendingPages, pages);
  assert.equal(lights.plan.admission.count, 0, 'the list is closed');
});

// #525: the shadow raster's fixed budget. While the camera moves a frame draws its lights' floors
// and one batch's pages — the coarsest first (`admit.ts`, `end`) — and leaves the rest
// pending; the first frame it rests draws every page left, so the still image is the one every
// page drawn gives.
test('a moving camera draws the floors and one batch a frame, the whole list once it rests', () => {
  const { rt, lights } = frame(1, true);
  const { plan, store } = lights;
  report(plan, store, 1, sunGrid(plan, store.sliceOf(0), [2, 3]));
  // A step far under a page: the view moved, no clipmap extent did.
  const moved = nudged(1);
  const listed = planFrame(plan, store, 2, moved),
    { list } = plan.admission;
  assert.equal(plan.resting, false);
  let floors = 0;
  for (let i = 0; i < listed; i++) if (plan.records.isFloor(list[i])) floors++;
  assert.ok(floors > 0 && listed > floors + MAX_SHADOW_PAGES, `${listed} pages, ${floors} floors`);
  const visit = (from: number, to: number) => {
    plan.commit(undefined, from, to);
    lights.runs.reset();
    return true;
  };
  const drawn = forEachShadowBatch(rt, visit);
  assert.equal(drawn, floors + MAX_SHADOW_PAGES, 'the floors and one batch while the camera moves');
  plan.reissue(drawn);
  assert.equal(plan.counts.pendingPages, listed - drawn, 'the rest pending');
  const left = planFrame(plan, store, 3, moved);
  assert.equal(plan.resting, true, 'the same view again: the camera rests');
  assert.equal(left, listed - drawn);
  assert.equal(forEachShadowBatch(rt, visit), left, 'every page left, in the frame');
});

// The batches' memory holds the largest pool in full batches (`batchBudget.ts`). Batches cut short —
// a view limit bisected after a light cut dropped work — can need more: the frame draws
// `MAX_SHADOW_BATCHES` of them, and the pages past the last are pending, drawn the next frame.
test('a frame draws at most the batches its memory holds, the rest pending', () => {
  const { rt, lights, pages } = frame(64);
  assert.ok(pages > MAX_SHADOW_BATCHES, `${pages} pages, more than the batches`);
  lights.plan.admission.batchEnd = (from) => from + 1;
  let batches = 0;
  const drawn = forEachShadowBatch(rt, () => {
    batches++;
    lights.runs.reset();
    return true;
  });
  assert.equal(batches, MAX_SHADOW_BATCHES);
  assert.equal(drawn, MAX_SHADOW_BATCHES, 'where it stopped: the rest wait');
});

// Under the CPU cut, the selection composes every batch to select its casters, then the depth pass
// composes them again to draw: the batch composed last is not composed again in the same image, so
// a frame of one batch — all a frame drew before #489 — composes its pages once, as it did.
test('the batch composed last is not composed again in its image, any other is', () => {
  const { lights, pages } = frame(8);
  assert.ok(pages > MAX_SHADOW_PAGES, `${pages} pages, two batches`);
  let written = 0;
  const volumes = new Float32Array(MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS);
  const noop = () => {};
  Object.assign(lights, {
    shadows: { writePage: () => written++, writeSun: noop, writeLamp: noop, clearRecord: noop },
    cull: { volumes, volumeWords: new Uint32Array(volumes.buffer) },
    plannedFrame: 1,
  });
  lights.shadowSlots = writeShadowRecords(lights);
  const first = writeShadowPages(lights, VIEW.position, 0, MAX_SHADOW_PAGES);
  assert.ok(first > 0 && written === first, 'one page matrix per region');
  assert.equal(writeShadowPages(lights, VIEW.position, 0, MAX_SHADOW_PAGES), first);
  assert.equal(written, first, 'the same batch of the same image is kept');
  const second = writeShadowPages(lights, VIEW.position, MAX_SHADOW_PAGES, pages);
  assert.equal(writeShadowPages(lights, VIEW.position, 0, MAX_SHADOW_PAGES), first);
  const again = written;
  assert.equal(again, 2 * first + second, 'another batch, then the first again, are composed');
  lights.plannedFrame = 2;
  writeShadowPages(lights, VIEW.position, 0, MAX_SHADOW_PAGES);
  assert.equal(written, again + first, 'the next image composes it anew');
});

// At the cap, the pages past the last batch are pending, and drawn within the bound of `admit.ts`:
// a view late in the list is not beaten every frame by the views ahead of it re-marked meanwhile.
// 64 suns turning every frame re-mark every floor page every frame; batches of one page (the
// smallest a bisected view limit leaves) hold fewer pages than the frame marks.
test('at the cap, every sun turning every frame is drawn within the bound, none starved', () => {
  const { rt, lights, pages } = frame(64);
  const { plan, store } = lights;
  assert.ok(pages > MAX_SHADOW_BATCHES, `${pages} pages, more than the batches`);
  const batchEnd = plan.admission.batchEnd;
  plan.admission.batchEnd = (from) => batchEnd(from, 1, 1);
  const bound = Math.ceil(plan.pool.pages / MAX_SHADOW_BATCHES) + 1;
  const lastDrawn = new Int32Array(store.count).fill(1);
  for (let f = 2; f < 2 + 3 * bound; f++) {
    for (let k = 0; k < store.count; k++)
      store.set(`sun${k}`, { direction: [k / 10 + f / 1000, -1, 0] });
    planFrame(plan, store, f);
    const drawn = forEachShadowBatch(rt, (from, to) => {
      for (let i = from; i < to; i++) {
        const slice = plan.pool.slice[plan.admission.list[i]];
        for (let slot = 0; slot < store.count; slot++)
          if (store.sliceOf(slot) === slice) lastDrawn[slot] = f;
      }
      plan.commit(undefined, from, to);
      lights.runs.reset();
      return true;
    });
    if (drawn < plan.admission.count) plan.reissue(drawn);
    for (let slot = 0; slot < store.count; slot++)
      assert.ok(f - lastDrawn[slot] <= bound, `sun ${slot} undrawn since frame ${lastDrawn[slot]}`);
  }
});
