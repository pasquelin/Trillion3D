// A readback costs the row demand its request lists' marks, never the catalogue: each — asked,
// asked ahead — reaches it as a difference of plain ids (`../cut/delta.ts`), and no page record is
// read, nor any catalogue made over the packed instances, at 10³ as at 10⁵ of them. The drawn list
// costs it nothing: which rows are in use, the GPU says.
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeAlone } from './rowCache.fixture.ts'
import { createRowDemand } from './rowDemand.ts'
import type { PageRec } from '../../page/selection/types.ts'
import { pageStateOf } from './pageState.fixture.ts'

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

/** A generated sequence of readbacks over `count` instances: a window of asked and ahead ids that
 *  slides by a tenth of itself each readback. */
function readbacks(count: number, frames: number) {
  const width = Math.min(count >> 2, 4096),
    step = Math.floor(width / 10)
  return Array.from({ length: frames }, (_, f) => {
    const from = (f * step) % (count - width + 1)
    const ids = (n: number, at: number) => Array.from({ length: n }, (_, i) => (at + i) % count)
    return {
      pageIds: ids(width >> 1, from + step),
      aheadPageIds: ids(width >> 2, from + 2 * step),
    }
  })
}

test('a readback reads no page record and makes no catalogue, at 10³ and 10⁵ instances', () => {
  for (const count of [1e3, 1e5]) {
    const { counts } = countedPages(count)
    const table = pageStateOf(count)
    const demand = createRowDemand(table, () => true, closeAlone)
    let wanted = 0
    for (const cut of readbacks(count, 24)) {
      demand.follow(cut)
      wanted += Number(demand.wanted(cut.pageIds[0]))
    }
    assert.equal(wanted, 24, `${count}: every readback's first request wanted`)
    assert.deepEqual(counts, { records: 0, catalogues: 0 }, `${count} instances`)
  }
})

test('per readback, the row table is read per change, never per id named', () => {
  const count = 1e5,
    table = pageStateOf(count)
  // An instance in eight holds a row, resident.
  for (let page = 0; page < count; page += 8) {
    table.setRowOf(page, page >> 3)
    table.setResidentFlag(page, 1)
  }
  let rowReads = 0
  const counted = { ...table, rowOf: (page: number) => (rowReads++, table.rowOf(page)) }
  const demand = createRowDemand(counted, () => true, closeAlone)
  let named = 0
  for (const cut of readbacks(count, 24)) {
    demand.follow(cut)
    named += cut.pageIds.length + cut.aheadPageIds.length
  }
  // The row table is read for what entered or left the requests' closure alone, never per id named.
  assert.ok(rowReads < named / 4, `${rowReads} row reads for ${named} ids named`)
})

test('the demand holds bytes by the pages it holds, never by the largest: one asked at 10⁹', () => {
  const far = 1e9,
    demand = createRowDemand(pageStateOf(far + 1), () => true, closeAlone)
  demand.follow({ pageIds: [far], aheadPageIds: [far - 1] })
  assert.ok(demand.wanted(far), 'the far page is asked for')
  demand.follow({ pageIds: [far - 2], aheadPageIds: [] })
  assert.ok(demand.wanted(far - 2) && !demand.wanted(far))
  // A mark per id up to the largest named — the lists' or the demand's flags — would weigh a
  // gigabyte each.
  assert.ok(demand.bytes < 1 << 16, `${demand.bytes} bytes for four pages held`)
})

test('a drawn list that moves costs the demand no closure step: the GPU says which rows are in use', () => {
  const count = 1e4,
    table = pageStateOf(count)
  let steps = 0
  const counted = () => {
    const closure = closeAlone(),
      apply = closure.apply.bind(closure)
    closure.apply = (cut) => ((steps += cut.enteredCount + cut.exitedCount), apply(cut))
    return closure
  }
  const demand = createRowDemand(table, () => true, counted)
  demand.follow({ pageIds: [1, 2] })
  steps = 0
  // Readbacks whose drawn lists slide by a hundred ids each, their requests standing.
  for (let f = 0; f < 12; f++) {
    const drawn = Array.from({ length: 1000 }, (_, i) => (f * 100 + i) % count)
    const cut = { pageIds: [1, 2], drawablePageIds: drawn }
    demand.follow(cut)
  }
  assert.equal(steps, 0, `${steps} closure steps for the drawn lists`)
})
