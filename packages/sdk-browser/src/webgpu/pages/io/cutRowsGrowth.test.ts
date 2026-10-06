// The rows a view holds bound the table, and the CPU cut grows them by what it selects. A
// larger pool alone grows the table no further than the view's rows; the cut that then selects
// past four fifths of them raises them, and the table grows in place to hold what it drew.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setWebgpuMemoryBudgets } from './memory.ts'
import { coarseSession } from './memoryGrowth.fixture.ts'
import { CUT_ROWS } from '../../row/tableRows.ts'

test('the table grows by the rows the cut selects, not by the pool', async () => {
  const { rt, draw, drawn, dispose } = await coarseSession()
  try {
    const { layout } = rt
    layout.viewRows = 2
    const report = await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 })
    assert.equal(report.tables, null, 'the pool asks no row past the view')
    assert.deepEqual([rt.setup.cap, layout.drawSlots], [4, 2])
    await draw(4)
    await layout.growing
    assert.equal(layout.viewRows, CUT_ROWS, 'the cut selected past four fifths of the rows')
    assert.equal(layout.drawSlots, 4, 'grown to what the pool and the cut can draw')
    await draw(2)
    assert.deepEqual(drawn().sort(), ['0', '1'], 'the finer clusters, each on its row')
  } finally {
    dispose()
  }
})
