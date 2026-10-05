// The slots against the runs (#831, GPU wave 1): the draws laid out ahead of the GPU's order
// (`runs.ts`) paint the very instances, in the very order, with the very pipeline and buffers the
// runs the CPU sliced from the whole paint order used to paint — the same image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { orderBlendPasses, refreshEyeKeys } from './order.ts';
import { expandBlendPlan, orderBlendPlanCpu } from './expandCpu.ts';
import { planItem, planPipeline } from './plan.ts';
import { PLAN_SHARED_BIT } from './planEntry.ts';
import { RUN_WORDS } from './planLayout.ts';
import type { createWebgpuBlendState } from './state.ts';
import { transparentScene } from './orderKernel.fixture.ts';
import { referenceOrder } from './plan.fixture.ts';

type BlendState = ReturnType<typeof createWebgpuBlendState>;
const planShared = (entry: number) => (entry & PLAN_SHARED_BIT) !== 0;

/** Runs as the CPU sliced them before the GPU ordered the plan: a stretch of shared entries of one
 *  pipeline is one draw, any other entry a draw of its own. */
function slicedRuns(order: number[]) {
  const runs: number[] = [];
  for (let first = 0; first < order.length;) {
    let end = first + 1;
    if (planShared(order[first]))
      while (
        end < order.length &&
        planShared(order[end]) &&
        planPipeline(order[end]) === planPipeline(order[first])
      )
        end++;
    runs.push(first, end - first);
    first = end;
  }
  return runs;
}

/** Every instance the draws paint, in paint order, with the pipeline, the buffers and the vertex
 *  count of the draw that paints it: two lists equal here paint the same image. */
function painted(blendState: BlendState, order: number[], runs: number[]) {
  const expanded = new Uint32Array(blendState.instanceCapacity * 2),
    args = new Uint32Array(runs.length * 2 + 4);
  const counts = new Uint32Array(blendState.table!.length).map((_, k) => 1 + (k % 3));
  expandBlendPlan({
    order: Uint32Array.from(order),
    runs: Uint32Array.from(runs),
    runCount: runs.length / RUN_WORDS,
    draws: blendState.drawsPacked,
    keep: blendState.keepPacked,
    itemCounts: counts,
    instances: Uint32Array.from({ length: 4 * blendState.table!.length }, (_, k) => 1000 + k),
    maxVertexWords: blendState.maxVertexWords,
    vertexShift: blendState.vertexShift,
    instanceBase: 0,
    argsBase: 0,
    expanded,
    args,
  });
  const out: string[] = [];
  for (let run = 0; run < runs.length / RUN_WORDS; run++) {
    const [first, entries] = [runs[run * 2], runs[run * 2 + 1]];
    const [vertices, instances, start] = [args[run * 4], args[run * 4 + 1], args[run * 4 + 2]];
    if (!entries) continue;
    const entry = order[first],
      item = blendState.blendGpu[planItem(entry)];
    const buffers = item.paged ? 'paged' : `own ${planItem(entry)}`;
    for (let k = 0; k < instances; k++) {
      const at = (start >> blendState.vertexShift) + k;
      out.push(
        `${planPipeline(entry)} ${buffers} ${vertices} ${expanded[at * 2]} ${expanded[at * 2 + 1]}`,
      );
    }
  }
  return out;
}

test('the slots paint the instances the runs painted, in their order, with their pipeline', () => {
  for (const [count, seed] of [
    [5, 21],
    [40, 22],
    [200, 23],
  ]) {
    const { blendState, next } = transparentScene(count, seed);
    for (let frame = 0; frame < 4; frame++) {
      const eye = [0, 1, 2].map(() => Math.round((next() - 0.5) * 16) / 2);
      // Some items out of view: their instances vanish from both lists.
      for (let w = 0; w < blendState.keepPacked.length; w++)
        blendState.keepPacked[w] = Math.floor(next() * 2 ** 32);
      orderBlendPasses(blendState, eye, () => 0);
      refreshEyeKeys(blendState, eye);
      for (let pass = 0; pass < 2; pass++) {
        const seeds = blendState.seeds[pass];
        if (!seeds.length) continue;
        // Before: the whole pass ranked by `precedes`, then sliced.
        const before = referenceOrder(seeds, blendState.blendGpu);
        const after = Array.from(orderBlendPlanCpu(blendState, pass));
        assert.deepEqual(after, before, `${count} items, frame ${frame}, pass ${pass}: order`);
        const slots = Array.from(
          blendState.runs[pass].subarray(0, blendState.slotCounts[pass] * 2),
        );
        const instances = painted(blendState, before, slicedRuns(before));
        assert.ok(instances.length > seeds.length / 4, 'most entries paint');
        assert.deepEqual(
          painted(blendState, after, slots),
          instances,
          `${count} items, frame ${frame}, pass ${pass}: painted`,
        );
      }
    }
  }
});
