// The page table's addressing and entries, as the page access layout sets
// them out: 128 pages a side at mip 0, the coarser mips packed
// in the 64 rows under it, single-page maps in the first 128×128 block, full maps a 128×192 table
// each; an entry holds its physical page in 10+10 bits and its flags in bits 30-31.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VSM_LEVEL0_PAGES,
  VSM_MIPS,
  VSM_SINGLE_PAGE_MAP_SLOTS,
  VSM_PAGE_TEXELS,
  VSM_PAGE_TABLE_BLOCK_HEIGHT,
  VSM_LEVEL0_TEXELS,
} from './constants.ts'

test('the page and table sizes, and where single-page maps end', () => {
  assert.equal(VSM_PAGE_TEXELS, 128)
  assert.equal(VSM_LEVEL0_PAGES, 128)
  assert.equal(VSM_MIPS, 8)
  assert.equal(VSM_LEVEL0_TEXELS, 16384)
  assert.equal(VSM_SINGLE_PAGE_MAP_SLOTS, 8192)
  assert.equal(VSM_PAGE_TABLE_BLOCK_HEIGHT, 192)
})
