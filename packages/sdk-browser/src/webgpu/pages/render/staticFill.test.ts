// #831: a residency change over the whole view — the terrain streaming in finer, the boss's spike of
// 478 static pages drawn in one frame — stales every cached page at once. The frame fills its
// static fill (`shadowPagesPerFrame`) and no more; every other page keeps its former depth, read as
// it was, never a hole nor a coarser page, and is filled the next frames, all within the frames
// the budget spreads them over: no page is drawn twice for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowPagesPerFrame } from '../../../gpu/shadow/batchBudget.ts';
import { SUN, VIEW } from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { STALE_BY } from '../../../../../sdk-core/src/scene/light-shadow/counts.ts';
import { createWebgpuLightState } from '../state/lights.ts';
import { forEachShadowBatch } from './encodeShadowBatches.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

const MIN = [-50, 0, -50],
  MAX = [50, 10, 50];

test('a residency change over the view is filled at the static fill a frame, read meanwhile', () => {
  const lights = createWebgpuLightState(16),
    { plan, store } = lights;
  for (let k = 0; k < 30; k++) store.add({ ...SUN, id: `sun${k}`, direction: [k / 40, -1, 0] });
  const rt = { lights, run: { frame: 1 }, vis: {}, gpu: {} } as unknown as WebgpuPagesRuntime;
  const drawn = new Map<number, number>();
  const frame = (at: number) => {
    plan.plan(store, VIEW, MIN, MAX, at, at * 16);
    const done = forEachShadowBatch(rt, (from, to) => {
      for (const page of plan.admission.list.subarray(from, to))
        drawn.set(page, (drawn.get(page) ?? 0) + 1);
      plan.commit(undefined, from, to);
      lights.runs.reset();
      return true;
    });
    if (done < plan.admission.count) plan.reissue(done);
    return done;
  };
  // Every page mapped and drawn once, over as many frames as the fill takes.
  for (let at = 1; at < 40 && (at === 1 || plan.counts.pendingPages); at++) frame(at);
  const cached = [...drawn.keys()],
    budget = shadowPagesPerFrame(plan.pool.pages);
  assert.ok(cached.length > 4 * budget, `${cached.length} cached pages, four fills and more`);
  assert.equal(plan.counts.pendingPages, 0, 'all drawn');
  drawn.clear();
  plan.residencyChanged(MIN, MAX);
  let at = 40;
  const first = frame(at);
  assert.equal(plan.counts.staledBy[STALE_BY.detail], cached.length, 'every cached page staled');
  assert.ok(first < budget + 24, `${first} pages filled in the frame, the fill ${budget}`);
  for (const page of cached) assert.equal(plan.pool.valid[page], 1, `page ${page} still read`);
  const bound = at + Math.ceil(cached.length / budget) + 1;
  while (plan.counts.pendingPages && at < bound) frame(++at);
  assert.equal(plan.counts.pendingPages, 0, `all filled again by frame ${at}`);
  assert.ok([...drawn.values()].every((n) => n === 1), 'each page drawn once');
});
