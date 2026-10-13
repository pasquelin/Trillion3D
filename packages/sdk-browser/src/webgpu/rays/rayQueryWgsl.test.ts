// The ray query's shipped WGSL run as JavaScript (`shaderRun`): a ray's filter admits the placements
// its sorted list names, or every other one, as its include bit asks; the row index answers each
// page of the table with its row, and none for a page no row draws.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { rayQueryWgsl } from './rayQueryWgsl.ts'
import { FILTER_INCLUDE } from './rayRecord.ts'

const WHOLE = { per: Infinity, parts: 1 }
const params = { filterWord: 10, hashWord: 32, hashMask: 15 }
const query = new Array<number>(64).fill(0)
const run = shaderRun<{
  rqAdmits(w: number, first: number, word: number): boolean
  rowOfPage(page: number): number
}>(
  rayQueryWgsl({ nodes: WHOLE, cold: WHOLE, ranges: [{ first: 0, count: 8 }] }),
  ['rqAdmits', 'rowOfPage'],
  { params, query },
)

test('a filter admits its listed placements, or all others, as its include bit asks', () => {
  const listed = [2, 5, 9, 11]
  query.splice(params.filterWord + 3, listed.length, ...listed)
  for (let w = 0; w < 14; w++) {
    const named = listed.includes(w)
    assert.equal(run.rqAdmits(w, 3, (listed.length | FILTER_INCLUDE) >>> 0), named, `${w} met`)
    assert.equal(run.rqAdmits(w, 3, listed.length), !named, `${w} passed by`)
  }
  assert.equal(run.rqAdmits(4, 3, 0), true, 'an empty list passes nothing by')
  assert.equal(run.rqAdmits(4, 3, FILTER_INCLUDE), false, 'and meets nothing when it includes')
})

test('the row index answers each page its row, and none for a page no row draws', () => {
  // The index as the insertion kernel leaves it: from the page's slot on, the first free slot.
  const slots = params.hashMask + 1,
    rows = new Map([
      [7, 0],
      [23, 1],
      [39, 2],
      [1, 3],
    ])
  query.fill(0, params.hashWord, params.hashWord + 2 * slots)
  for (const [page, row] of rows) {
    let slot = ((page * 2654435761) % 2 ** 32) & params.hashMask
    while (query[params.hashWord + 2 * slot]) slot = (slot + 1) & params.hashMask
    query[params.hashWord + 2 * slot] = page + 1
    query[params.hashWord + 2 * slot + 1] = row
  }
  for (const [page, row] of rows) assert.equal(run.rowOfPage(page), row, `page ${page}`)
  assert.equal(run.rowOfPage(8), 0xffffffff, 'a page without a row')
})
