// Lot H2: the real entry point of the page worker, run by a real `worker_threads` thread
// (the bridge of `../../../../../bench/oracles/browser/pageWorkNodeWorker.ts`), without touching the file itself.
// Hostile inputs: a message of another contract version, a source too short to read.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PAGE_TASK_PROTOCOL,
  type PageTaskAnswer,
} from '../../../../sdk-core/src/page/taskContracts.ts'
import { NodeDomWorker } from '../../../../../bench/oracles/browser/pageWorkNodeWorker.ts'

const SOURCE = new URL('./pageWorker.ts', import.meta.url)

/** The next message received from the worker, or a timeout elapsed with nothing received. The timeout is wide: on a loaded machine, worker startup exceeds a second, and assertions rest on the identifier received, never on time. */
function next(worker: NodeDomWorker, timeoutMs = 10_000): Promise<PageTaskAnswer | null> {
  return new Promise((resolve) => {
    const minuteur = setTimeout(() => resolve(null), timeoutMs)
    worker.onmessage = (event: { data: unknown }) => {
      clearTimeout(minuteur)
      resolve(event.data as PageTaskAnswer)
    }
  })
}

test('a message of another protocol is ignored, the next valid request answers alone', async () => {
  const worker = new NodeDomWorker(SOURCE)
  try {
    // Two bytes hold no cell file: the valid request answers a refusal, under its own id.
    const request = { op: 'cells', source: new ArrayBuffer(2), name: 'short.cells' }
    worker.postMessage({ protocol: 999, id: 1, ...request }, [])
    worker.postMessage({ protocol: PAGE_TASK_PROTOCOL, id: 2, ...request }, [])
    const reponse = await next(worker)
    assert.ok(reponse, 'no answer received')
    assert.equal(reponse!.id, 2, 'the off-protocol message answered wrongly')
    assert.equal(reponse!.ok, false)
    assert.equal((reponse as { code: string }).code, 'PAGE_TASK_FAILED')
  } finally {
    await worker.terminate()
  }
})
