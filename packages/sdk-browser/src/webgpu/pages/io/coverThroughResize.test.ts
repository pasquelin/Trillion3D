// #1483: a pool resized under a view whose rows are full copies the root cover elsewhere; its rows
// follow the copy at once, so the cover never leaves residency and no image goes empty while the
// cut asks for, and the table grows to, the finer clusters.
import test from 'node:test'
import assert from 'node:assert/strict'
import { setWebgpuMemoryBudgets } from './memory.ts'
import { coarseSession } from './memoryGrowth.fixture.ts'
import { createPageCatalogue } from '../prepare/catalogue.ts'

test('the root cover draws through a pool resize and the row growth that follows', async () => {
  const { rt, draw, drawn, dispose } = await coarseSession()
  try {
    const { layout } = rt
    const { recordOf } = createPageCatalogue(layout.packedPages)
    const rankOf = (url: string) => {
      for (let page = 0; page < layout.packedPages.length; page++)
        if (recordOf(page)?.url === url) return page
      return -1
    }
    const cover = ['2', '3'].map(rankOf)
    assert.ok(
      cover.every((page) => page >= 0),
      'the cover is in the catalogue',
    )
    assert.deepEqual(drawn(), ['2'])
    layout.viewRows = 2
    await setWebgpuMemoryBudgets(rt, { geometryPoolBytes: 1 << 20 })
    await draw(1)
    const flags = () => cover.map((page) => layout.rows.residentFlags[page])
    assert.deepEqual(flags(), [1, 1], 'the cover stays resident, its rows at its new place')
    assert.ok(drawn().length > 0, 'the first image after the resize draws')
    for (let image = 1; image < 4; image++) {
      await draw(1)
      assert.ok(drawn().length > 0, `image ${image} draws`)
    }
    await layout.growing
    await draw(2)
    assert.deepEqual(drawn().sort(), ['0', '1'], 'the finer clusters, each on its row')
  } finally {
    dispose()
  }
})
