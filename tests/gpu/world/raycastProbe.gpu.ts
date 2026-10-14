// #1527 diagnostic: what the ray query reads and does for the ray proof's still quad
// (`raycastProbePage.ts`), printed whole — the counters of each ray, the frame row, root node and
// world of each placement as the GPU read them, the host's records, the oracle's triangle and the
// record the hit should have read. It asserts only that the page ran: the reading is for a person.
import test from 'node:test'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts'

test('the ray query is audited on the ray proof scene', async () => {
  const result = await runPageProof(resolve(import.meta.dirname, 'raycastProbePage.ts'), 'probe')
  console.log(JSON.stringify(result, null, 1))
  assertSoundProof(result)
})
