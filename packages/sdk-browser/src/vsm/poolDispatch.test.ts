// The pool-wide passes — the page management's (`run`) and the transmission's clear — dispatch
// a group per run of pool pages in one row, never in rows: their bound under one dimension's
// groups comes from the largest pool a page table entry can address, read from the packing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { DEFAULT_GROUP_WIDTH } from '../gpu/dispatch/grid.ts'
import { VSM_GROUP_WIDTH, VSM_PAGE_TEXELS, VSM_TABLE_ROW_WIDTH } from './constants.ts'
import { VSM_PAGE_ADDRESS_WGSL } from './pageTableWgsl.ts'
import { VSM_TRANSMISSION_PAGE_GROUP } from './transmissionWgsl.ts'
import { vsmLayout } from './layout.ts'

test('the largest pool an entry addresses fits one row of every pool-wide dispatch', () => {
  // An entry holds a page's column in the low bits, its row from `rowShift` up to the fallback's
  // levels (`vsmPackTableEntry`, `vsmPackFallbackEntry`).
  const rowShift = Number(/physicalAddress\.y<<(\d+)u/.exec(VSM_PAGE_ADDRESS_WGSL)![1])
  const levelShift = Number(/coarserLevels<<(\d+)u/.exec(VSM_PAGE_ADDRESS_WGSL)![1])
  const rows = 2 ** (levelShift - rowShift),
    perRow = VSM_TABLE_ROW_WIDTH / VSM_PAGE_TEXELS
  assert.ok(perRow <= 2 ** rowShift, 'a row of pages within its column bits')
  const { poolPages } = vsmLayout({ fullMapCapacity: 63, poolPages: rows * perRow }, 2 ** 31)
  assert.equal(poolPages, 2 ** 17)
  for (const group of [VSM_GROUP_WIDTH, VSM_TRANSMISSION_PAGE_GROUP])
    assert.ok(ceilDiv(poolPages, group) <= DEFAULT_GROUP_WIDTH, `${group} pages a group`)
})
