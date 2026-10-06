// The CPU cut's rows: its own pages, in its order; a page that awaits its bytes, or a blended one,
// takes no row.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mount, PAGES } from './commit.fixture.ts'

test('the CPU cut writes its own rows, in its order', () => {
  const { rows, sync, pages, coupe, coupePacked } = mount()
  for (let page = 0; page < PAGES; page++) {
    rows.residentOffsetWords[page] = page * 16
    rows.touchPage(page)
  }
  for (const page of [0, 1, 3, 2, 4, 5]) {
    coupe.push(pages[page])
    coupePacked.push(page)
  }
  // Page 2 awaits its bytes and page 4 is blended: neither takes a row.
  assert.equal(sync.syncRowsFromCut(), 4, 'the camera draws four rows')
  assert.equal(rows.packedCount, 4)
  assert.deepEqual(Array.from(rows.packedPageIndex.slice(0, 4)), [0, 1, 3, 5])
})
