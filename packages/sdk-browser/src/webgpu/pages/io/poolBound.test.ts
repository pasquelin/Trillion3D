import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { webgpuPagesBackend } from '../pages.ts';
import { coarseQuadScene } from '../testOccluder.fixture.ts';
import { camera } from '../testScenes.fixture.ts';

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
 *  every image's metrics. */
async function stream(
  backend: ReturnType<typeof budgetedQuad>['backend'],
  each: (metrics: ReturnType<typeof backend.metrics>) => void,
) {
  let resident = -1;
  for (let round = 0; round < 8 && backend.metrics().residentPages !== resident; round++) {
    resident = backend.metrics().residentPages;
    backend.render(camera());
    each(backend.metrics());
    await backend.flush();
  }
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
  const floor = probe.backend.metrics().geometryAllocationBytes!;
  probe.backend.dispose();
  const slot = 24;
  assert.ok(floor > slot, 'vertex buffers are held beside the root slot');
  const budgets = [
    floor - 1,
    floor,
    floor + 1,
    floor + slot - 1,
    floor + slot,
    floor + slot + 7,
    2 * slot,
    3 * slot,
    3 * slot + 1,
    floor + 2 * slot - 1,
    393_024,
    393_048,
  ];
  for (const budget of budgets) {
    const { fixture, backend } = budgetedQuad(budget);
    try {
      await backend.prepare();
      await stream(backend, assertBounded(budget, floor));
    } finally {
      backend.dispose();
      fixture.geometry.dispose();
      fixture.material.dispose();
    }
  }
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
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
