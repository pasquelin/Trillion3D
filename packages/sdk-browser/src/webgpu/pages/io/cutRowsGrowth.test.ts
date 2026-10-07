// #1232, #1483: the rows a view holds bound the table, and the GPU cut grows them by what it asks
// for. A larger pool alone grows the table no further than the view's rows; the cut whose requests
// the table cannot serve raises them, and the table grows in place to hold what it draws.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setWebgpuMemoryBudgets } from './memory.ts'
import { coarseSession } from './memoryGrowth.fixture.ts'
import { ROW_STEP } from '../../row/tableRows.ts'

test('the table grows by the rows the cut asks for, not by the pool', async () => {
  const { rt, draw, drawn, dispose } = await coarseSession()
  try {
    const { layout } = rt
    layout.viewRows = 2
    const report = await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 })
    assert.equal(report.tables, null, 'the pool asks no row past the view')
    assert.deepEqual([rt.setup.cap, layout.drawSlots], [4, 2])
    await draw(4)
    await layout.growing
    assert.equal(layout.viewRows, ROW_STEP, 'the cut asked past the rows the table holds')
    assert.equal(layout.drawSlots, 4, 'grown to what the pool and the cut can draw')
    await draw(2)
    assert.deepEqual(drawn().sort(), ['0', '1'], 'the finer clusters, each on its row')
  } finally {
    dispose()
  }
})
