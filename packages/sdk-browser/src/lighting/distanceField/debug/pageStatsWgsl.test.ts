import assert from 'node:assert/strict'
import test from 'node:test'
import { pageStatsLines } from './pageStats.ts'
import { PAGE_STATS_ENTRIES, PAGE_STATS_WGSL } from './pageStatsWgsl.ts'

test('the statistics program has both entries and no backtick', () => {
  for (const entry of Object.values(PAGE_STATS_ENTRIES))
    assert.ok(PAGE_STATS_WGSL.includes(`fn ${entry}(`))
  assert.ok(!PAGE_STATS_WGSL.includes('`'))
})

test('the table gives the allocated pages as the maximum less the free ones, none known without a maximum', () => {
  const text = (max: number) => pageStatsLines({ words: [5, 2, 3, 10], max }).map(([line]) => line)
  assert.deepEqual(text(100), [
    'GDF Pages',
    ' Max   100',
    ' Alloc 90',
    ' Free  10',
    ' Combi 5',
    ' Empty 2',
    ' Updated  3',
  ])
  assert.equal(text(0)[2], ' Alloc -1')
})
