import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { coarseQuadScene } from '../backend/coarseQuads.fixture.ts'
import { backendOf, camera, disposeQuadRun } from '../backend/testScenes.fixture.ts'
import { settledImage } from '../backend/settledImage.fixture.ts'

// `geometryAllocationBytes` counts the page slots AND the vertex buffers held beside them —
// the float geometry of what no page covers, a one-vertex placeholder at least. The budget pays the
// streaming slots alone, the root cover's held beside them: what the pool holds past the root cover
// never passes the declared budget, whatever its value — a multiple of the slot, one byte off it,
// or a budget halved —, and the vertex buffers lie outside it, the same bytes at every budget.

/** The coarse quad over three 24-byte slots, one root, its leaves streamed on demand. */
function budgetedQuad(geometryPoolBytes: number) {
  const fixture = coarseQuadScene(),
    { device } = fakeDevice(BACKEND)
  const backend = backendOf({
    maxResidentPages: undefined,
    ...fixture,
    gpuDevice: device,
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
    retainedRanks: () => backend.retainedRanks(),
  })
  return backend.metrics().residentPages ?? 0
}

/** What an image holds in the pool past the root cover's `cover` bytes is under the budget, the
 *  `vertex` bytes of the vertex buffers lie beside the pool; a budget under a streaming slot, the
 *  `slot` bytes, holds that cover alone, by name. */
function assertBounded(budget: number, slot: number, cover: number, vertex: number) {
  return (metrics: {
    geometryAllocationBytes?: number | null
    geometryPoolAllocatedBytes?: number | null
    geometryPoolClamp?: unknown
  }) => {
    const pool = metrics.geometryPoolAllocatedBytes!
    assert.ok(pool - cover <= budget, `${pool} in the pool, ${cover} of cover, ${budget} budget`)
    assert.equal(metrics.geometryAllocationBytes! - pool, vertex, 'the vertex buffers lie beside')
    if (budget < slot) assert.deepEqual([pool, metrics.geometryPoolClamp], [cover, 'root-cover'])
  }
}

test('the geometry held never passes the declared pool, at prepare and mid-session, at any budget', async () => {
  installGpuGlobals()
  // The floor: what a one-byte budget holds — the root cover, beside no streaming slot, and the
  // vertex buffers beside the pool.
  const probe = budgetedQuad(1)
  await probe.backend.prepare()
  probe.backend.render(camera())
  const { geometryAllocationBytes, geometryPoolAllocatedBytes, geometryPoolSlots } =
    probe.backend.metrics()
  disposeQuadRun(probe.backend, probe.fixture)
  const cover = geometryPoolAllocatedBytes!,
    slot = cover / geometryPoolSlots!,
    vertex = geometryAllocationBytes! - cover
  assert.ok(vertex > 0, 'vertex buffers are held beside the root slot')
  // One byte, a value under the slot and one byte past it, off every 4-byte alignment, each slot
  // boundary and one byte under it, and the two budgets of the whole scene.
  const budgets = [1, slot - 1, slot, slot + 1, slot + 37, 393_024, 393_048]
  for (const slots of [1, 2, 3]) budgets.push(slots * slot - 1, slots * slot)
  let streamed = 0
  for (const budget of budgets) {
    const { fixture, backend } = budgetedQuad(budget)
    try {
      await backend.prepare()
      const bounded = assertBounded(budget, slot, cover, vertex)
      streamed = Math.max(streamed, await stream(backend, bounded))
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
      await stream(backend, assertBounded(budget, slot, cover, vertex))
    }
  } finally {
    disposeQuadRun(backend, fixture)
  }
})
