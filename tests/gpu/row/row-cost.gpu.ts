// R3 (#1527, M-R1): what the rows' closure and their victim sort cost a cut, at 2¹⁸, 2²⁰ and 2²²
// live rows, on the machine's device (`rowCostPage.ts`): the same cut with and without the row
// pass, every frame cut again and copied back. Published for the recette, never asserted — a
// timing is the machine's —: past the budget, the closure's gate widens over frames (the design
// note's fallback). The main thread's row cache is the bench's to time, on the bench's scene.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

const SWEEP = { rows: [1 << 18, 1 << 20, 1 << 22], frames: 30, rounds: 5 }

test('the rows’ closure and sort cost, published by table size', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'rowCostPage.ts'),
    'rowCost',
  )) as typeof import('./rowCostPage.ts')
  const pageErrors: string[] = []
  const { adapter, errors, sizes } = await runOnDawn(page.measureRowCost, SWEEP, pageErrors)
  console.log(JSON.stringify({ adapter, sizes }, null, 2))
  assert.deepEqual([...errors, ...pageErrors], [])
  assert.ok(sizes.length > 0 && !('refused' in sizes[0]), 'the smallest table fits the device')
})
