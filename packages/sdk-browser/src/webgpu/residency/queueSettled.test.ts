// A still view walks no queue (#1483): once a pass left nothing to do — every wanted page resident,
// every lower tier page held —, the queue runs none again until what a pass reads moves: the
// queue, the pool, a page's bytes, a lower tier's report (`queue.ts`, `residentEnsurer.ts`). It
// still touches the lower tiers' pages as a pass would, so the pool evicts in the same order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createWebgpuResidencyQueue } from './queue.ts'

test('a pass that left nothing to do runs again only once what it reads moved', async () => {
  let passes = 0,
    settled = true,
    revision = 0,
    touches = 0
  const ensureResident = Object.assign(async () => (passes++, settled), {
    revision: () => revision,
    touchLower: () => void touches++,
  })
  const sets = { desiredCount: 0, acceptedRevision: 0, followDesired() {} }
  const cache = {}
  const queue = createWebgpuResidencyQueue({
    tracking: createWebgpuPageTracking([]),
    sets: sets as never,
    closure: {} as never,
    recordOf: () => undefined,
    room: () => 0,
    getCache: () => cache as never,
    getFrame: () => 0,
    updatePins() {},
    ensureResident,
    markLost() {},
    traceEnabled: false,
    traceDiagnostic() {},
    diagnosticFailure() {},
  })
  const image = async () => {
    queue.queueCuts({ cuts: [], first: null })
    await queue.pending
  }
  await image()
  await image()
  await image()
  assert.deepEqual([passes, touches], [1, 2], 'one pass; the images after it touch the tiers')
  assert.equal(queue.busy, false)
  revision++
  await image()
  assert.equal(passes, 2, 'a page landed, the pool or a tier moved: a pass')
  sets.acceptedRevision++
  await image()
  assert.equal(passes, 3, 'the queue moved: a pass')
  settled = false
  revision++
  await image()
  await image()
  assert.equal(passes, 5, 'a pass that left work runs at every image')
})
