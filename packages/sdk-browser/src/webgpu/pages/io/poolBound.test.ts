import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts'
import { webgpuPagesEngine } from '../pages.ts'
import { coarseQuadScene } from '../testOccluder.fixture.ts'
import { camera, disposeQuadRun } from '../testScenes.fixture.ts'
import { settledImage } from '../settledImage.fixture.ts'

// `geometryAllocationBytes` counts the page slots AND the vertex buffers held beside them —
// the float geometry of what no page covers, a one-vertex placeholder at least. The pool is drawn
// from what the budget leaves those buffers, so the two never sum past the declared pool, whatever
// its value: a multiple of the slot, one byte off it, or a budget halved.

/** The coarse quad over three 24-byte slots, one root, its leaves streamed on demand. */
function budgetedQuad(geometryPoolBytes: number) {
  const fixture = coarseQuadScene(),
    { device } = mockGpu()
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    viewport: [32, 32],
    geometryPoolBytes,
  })
  return { fixture, backend }
}

type Backend = ReturnType<typeof budgetedQuad>['backend']

/** Draws and drains the pose until it settles (`settledImage`): the GPU cut's requests come with
 *  the readback the drain adopts, their loads land in the drain of the image after it, and the
 *  pages enter the residency at the image after that. `each` reads every image's metrics. Returns
 *  the pages resident at the end. */
async function stream(backend: Backend, each: (metrics: ReturnType<Backend['metrics']>) => void) {
  await settledImage({
    render: (cam) => {
      backend.render(cam)
      each(backend.metrics())
    },
    flush: (options) => backend.flush(options),
    metrics: () => backend.metrics(),
    pendingUrls: () => backend.pendingUrls(),
    pageUrls: () => backend.pageUrls(),
  })
  return backend.metrics().residentPages ?? 0
}

/** What an image holds is under the budget, or the budget is under the root cover and the pool
 *  holds that cover alone, by name. */
function assertBounded(budget: number, floor: number) {
  return (metrics: { geometryAllocationBytes?: number | null; geometryPoolClamp?: unknown }) => {
    const held = metrics.geometryAllocationBytes!
    if (budget >= floor) assert.ok(held <= budget, `${held} bytes held under a ${budget} budget`)
    else assert.deepEqual([held, metrics.geometryPoolClamp], [floor, 'root-cover'])
  }
}

test('the geometry held never passes the declared pool, at prepare and mid-session, at any budget', async () => {
  installGpuGlobals()
  // The floor: what a one-byte budget is raised to — the root cover and the vertex buffers.
  const probe = budgetedQuad(1)
  await probe.backend.prepare()
  probe.backend.render(camera())
  const { geometryAllocationBytes, geometryPoolAllocatedBytes, geometryPoolSlots } =
    probe.backend.metrics()
  disposeQuadRun(probe.backend, probe.fixture)
  const floor = geometryAllocationBytes!,
    slot = geometryPoolAllocatedBytes! / geometryPoolSlots!
  assert.ok(floor > slot, 'vertex buffers are held beside the root slot')
  // The floor and one byte under it, one byte past it, a value off every 4-byte alignment, each
  // slot boundary and one byte under it, and the two budgets of the whole scene.
  const budgets = [floor - 1, floor, floor + 1, floor + 37, 393_024, 393_048]
  for (const slots of [1, 2]) budgets.push(floor + slots * slot - 1, floor + slots * slot)
  let streamed = 0
  for (const budget of budgets) {
    const { fixture, backend } = budgetedQuad(budget)
    try {
      await backend.prepare()
      streamed = Math.max(streamed, await stream(backend, assertBounded(budget, floor)))
    } finally {
      disposeQuadRun(backend, fixture)
    }
  }
  assert.ok(streamed > 1, 'pages streamed in beside the root cover')
  // The same sweep on one session, as a memory slider sets it.
  const { fixture, backend } = budgetedQuad(1 << 20)
  try {
    await backend.prepare()
    for (const budget of budgets) {
      const report = await backend.setMemoryBudgets!({ geometryPoolBytes: budget })
      assert.equal(report.geometryPool.budgetBytes, budget, 'the budget read back is the declared')
      await stream(backend, assertBounded(budget, floor))
    }
  } finally {
    disposeQuadRun(backend, fixture)
  }
})
