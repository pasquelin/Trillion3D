// A readback costs the row demand its lists' marks, never the catalogue: each list — drawn, asked,
// asked ahead — reaches it as a difference of plain ids (`listDifference.ts`), and no page record is
// read, nor any catalogue made over the packed instances, at 10³ as at 10⁵ of them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeAlone } from './rowCache.fixture.ts'
import { createRowDemand } from './rowDemand.ts'
import { createRowUse } from './rowUse.ts'
import type { PageRec } from '../../page/selection/types.ts'

/** `count` packed instances whose records and catalogue are counted: a record read through
 *  `recordOf` or by its rank, a catalogue made over them (which asks whether they resolve their
 *  own ranks). */
function countedPages(count: number) {
  const counts = { records: 0, catalogues: 0 }
  const rec = {} as PageRec
  const pages = new Proxy(
    { length: count, recordOf: () => (counts.records++, rec) },
    {
      has: (target, key) => (key === 'recordOf' && counts.catalogues++, key in target),
      get: (target, key) => {
        if (typeof key === 'string' && /^\d+$/.test(key)) counts.records++
        return target[key as keyof typeof target]
      },
    },
  )
  return { pages, counts }
}

/** A generated sequence of readbacks over `count` instances: a window of drawn, asked and ahead
 *  ids that slides by a tenth of itself each readback. */
function readbacks(count: number, frames: number) {
  const width = Math.min(count >> 2, 4096),
    step = Math.floor(width / 10)
  return Array.from({ length: frames }, (_, f) => {
    const from = (f * step) % (count - width + 1)
    const ids = (n: number, at: number) => Array.from({ length: n }, (_, i) => (at + i) % count)
    return {
      drawablePageIds: ids(width, from),
      pageIds: ids(width >> 1, from + step),
      aheadPageIds: ids(width >> 2, from + 2 * step),
    }
  })
}

test('a readback reads no page record and makes no catalogue, at 10³ and 10⁵ instances', () => {
  for (const count of [1e3, 1e5]) {
    const { pages, counts } = countedPages(count)
    const table = {
      rowOfPage: new Int32Array(count).fill(-1),
      residentFlags: new Uint32Array(count),
    }
    const demand = createRowDemand(table, createRowUse(count), () => true, pages, closeAlone)
    let wanted = 0
    for (const cut of readbacks(count, 24)) {
      demand.follow(cut)
      wanted += Number(demand.wanted(cut.pageIds[0]))
    }
    assert.equal(wanted, 24, `${count}: every readback's first request wanted`)
    assert.deepEqual(counts, { records: 0, catalogues: 0 }, `${count} instances`)
  }
})
