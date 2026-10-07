// Batch H2: the contract's shared task — the work run as-is by the worker and by the fallback
// on the main thread. Hostile input: a cell file too short to read.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PAGE_TASK_PROTOCOL,
  type PageTaskRequest,
} from '../../../../sdk-core/src/page/taskContracts.ts'
import { runPageTask } from './task.ts'

function requete(overrides: Partial<PageTaskRequest>): PageTaskRequest {
  return {
    protocol: PAGE_TASK_PROTOCOL,
    id: 1,
    op: 'cells',
    source: new ArrayBuffer(0),
    ...overrides,
  }
}

test('an arbitrary request identifier comes back unchanged in every form of answer', async () => {
  const cell = JSON.stringify({ version: 2, nodes: [] })
  const { answer: ok } = await runPageTask(
    requete({ op: 'cells', source: new TextEncoder().encode(cell).buffer, id: 777 }),
  )
  assert.equal(ok.ok, true, 'an empty cell file is read')
  assert.equal(ok.id, 777)
  const { answer: refusals } = await runPageTask(
    requete({ op: 'cells', source: new ArrayBuffer(2), id: 778, name: 'short.cells' }),
  )
  assert.equal(refusals.ok, false, 'two bytes hold no cell file')
  assert.equal(refusals.id, 778)
})
