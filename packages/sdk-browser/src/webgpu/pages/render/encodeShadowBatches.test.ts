// A frame draws every shadow page it marks (#489): the plan's list is cut into the batches the
// per-batch buffers hold, each after the last, and a batch that cannot be encoded leaves its pages
// and the rest pending for the next frame — never counted as drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHADOW_PAGES } from '../../../gpu/shadow/atlas.ts';
import { SUN, VIEW } from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { createWebgpuLightState } from '../state/lights.ts';
import { encodeShadowBatches, forEachShadowBatch } from './encodeShadowBatches.ts';
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** A frame on the CPU cut whose plan lists the floor pages of `suns` new suns. */
function frame(suns: number) {
  const lights = createWebgpuLightState(32);
  for (let k = 0; k < suns; k++)
    lights.store.add({ ...SUN, id: `sun${k}`, direction: [k / 10, -1, 0] });
  const pages = lights.plan.plan(lights.store, VIEW, [-50, 0, -50], [50, 10, 50], 1, 0);
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
