import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { webgpuPagesBackend } from '../pages.ts';
import { coarseQuadScene } from '../testOccluder.fixture.ts';
import { camera, disposeQuadRun } from '../testScenes.fixture.ts';

// #487: `geometryAllocationBytes` counts the page slots AND the vertex buffers held beside them —
// the float geometry of what no page covers, a one-vertex placeholder at least. The pool is drawn
// from what the budget leaves those buffers, so the two never sum past the declared pool, whatever
// its value: a multiple of the slot, one byte off it, or the budget a measurer halves.

/** The coarse quad over three 24-byte slots, one root, its leaves streamed on demand. */
function budgetedQuad(geometryPoolBytes: number) {
  const fixture = coarseQuadScene(),
    { device } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    viewport: [32, 32],
    geometryPoolBytes,
    geometryPoolCeilingBytes: 1 << 20,
  });
  return { fixture, backend };
}

/** Renders and waits for the loads it asked, until the resident set stops moving; `each` reads
 *  every image's metrics. Returns the pages resident at the end. */
async function stream(
  backend: ReturnType<typeof budgetedQuad>['backend'],
  each: (metrics: ReturnType<typeof backend.metrics>) => void,
) {
  let before = -1,
    resident = backend.metrics().residentPages;
  for (let round = 0; round < 8 && resident !== before; round++) {
    before = resident;
    backend.render(camera());
    const metrics = backend.metrics();
    each(metrics);
    resident = metrics.residentPages;
    await backend.flush();
  }
  return resident;
}

/** What an image holds is under the budget, or the budget is under the root cover and the pool
 *  holds that cover alone, by name. */
function assertBounded(budget: number, floor: number) {
  return (metrics: { geometryAllocationBytes: number | null; geometryPoolClamp: unknown }) => {
    const held = metrics.geometryAllocationBytes!;
    if (budget >= floor) assert.ok(held <= budget, `${held} bytes held under a ${budget} budget`);
    else assert.deepEqual([held, metrics.geometryPoolClamp], [floor, 'root-cover']);
  };
}

test('the geometry held never passes the declared pool, at prepare and mid-session, at any budget', async () => {
  installGpuGlobals();
  // The floor: what a one-byte budget is raised to — the root cover and the vertex buffers.
  const probe = budgetedQuad(1);
  await probe.backend.prepare();
  probe.backend.render(camera());
  const { geometryAllocationBytes, geometryPoolAllocatedBytes, geometryPoolSlots } =
    probe.backend.metrics();
  probe.backend.dispose();
  const floor = geometryAllocationBytes!,
    slot = geometryPoolAllocatedBytes! / geometryPoolSlots!;
  assert.ok(floor > slot, 'vertex buffers are held beside the root slot');
  // The floor and one byte under it, every value one byte off a slot boundary, one off every
  // alignment, the whole scene, and the two budgets #487 measured.
  const budgets = [floor - 1, floor, floor + 1, floor + 37, 393_024, 393_048];
  for (const slots of [1, 2]) budgets.push(floor + slots * slot - 1, floor + slots * slot);
  let streamed = 0;
  for (const budget of budgets) {
    const { fixture, backend } = budgetedQuad(budget);
    try {
      await backend.prepare();
      streamed = Math.max(streamed, await stream(backend, assertBounded(budget, floor)));
    } finally {
      disposeQuadRun(backend, fixture);
    }
  }
  assert.ok(streamed > 1, 'pages streamed in beside the root cover');
  // The same sweep on one session, as a memory slider sets it.
  const { fixture, backend } = budgetedQuad(1 << 20);
  try {
    await backend.prepare();
    for (const budget of budgets) {
      const report = await backend.setMemoryBudgets!({ geometryPoolBytes: budget });
      assert.equal(report.geometryPool.budgetBytes, budget, 'the budget read back is the declared');
      await stream(backend, assertBounded(budget, floor));
    }
  } finally {
    disposeQuadRun(backend, fixture);
  }
});
