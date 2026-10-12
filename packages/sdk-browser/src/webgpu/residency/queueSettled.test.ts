// A still view walks no queue (#1483): once a pass left nothing to do — every wanted page resident,
// every lower tier page held —, the queue runs none again until what a pass reads moves: the
// queue, the pool, a page's bytes, a lower tier's report (`queue.ts`, `residentEnsurer.ts`): the
// pool's order of eviction is the GPU's, and asks nothing of a still view.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createWebgpuResidencyQueue } from './queue.ts'

test('a pass that left nothing to do runs again only once what it reads moved', async () => {
  let passes = 0,
    settled = true,
    revision = 0
  const ensureResident = Object.assign(async () => (passes++, settled), {
    revision: () => revision,
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
  assert.equal(passes, 1, 'one pass; the images after it run none')
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
