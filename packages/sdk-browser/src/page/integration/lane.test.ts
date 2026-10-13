// The integration lane: the engine's worker host as a pool of one with no bound on what its worker
// holds, proved with a real `worker_threads` thread behind `NodeWorker`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageIntegrationLane } from './lane.ts'
import { NodeWorker } from '../../../../../bench/kit/worker.ts'
import {
  DeadNodeWorker,
  withNodeWorkerShim,
} from '../../../../../bench/oracles/browser/pageWorkNodeWorker.ts'

test('a lane whose worker starts answers its probe, then every request in send order', () =>
  withNodeWorkerShim(NodeWorker, async () => {
    const lane = createPageIntegrationLane()
    assert.equal(await lane.start(), true)
    const settled: string[] = []
    // Three requests posted at once, none waiting for the one before: each comes back to its own.
    const answers = await Promise.all(
      ['a', 'b', 'c'].map((url) =>
        lane.submit(url, 0, null).then((answer) => (settled.push(url), answer)),
      ),
    )
    assert.deepEqual(settled, ['a', 'b', 'c'])
    assert.deepEqual(
      answers.map((answer) => answer.id),
      [...answers.map((answer) => answer.id)].sort((x, y) => x - y),
    )
    lane.retire()
    assert.equal(lane.alive, false)
  }))

test('a lane whose worker dies at start says false and refuses what follows', () =>
  withNodeWorkerShim(DeadNodeWorker as unknown as typeof NodeWorker, async () => {
    const lane = createPageIntegrationLane()
    assert.equal(await lane.start(), false)
    assert.equal(lane.alive, false)
    const answer = await lane.submit('a', 0, null)
    assert.equal(answer.ok, false)
    assert.equal(!answer.ok && answer.code, 'PAGE_INTEGRATION_WORKER')
  }))
