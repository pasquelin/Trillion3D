import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CLUSTER_STATS_HOLD,
  clusterStatsRows,
  mapClusterCounts,
  showsClusterStats,
} from './clusterStats.ts'

test('the sections: all, 1 or a list holding clusters show the table; none, basic or other sections do not', () => {
  for (const on of ['all', '1', 'ALL', 'basic,Clusters', ' clusters '])
    assert.equal(showsClusterStats(on), true, on)
  for (const off of ['', '0', 'basic', 'pages,cache'])
    assert.equal(showsClusterStats(off), false, off)
})

test('a map’s clusters are its hardware and software raster’s, summed', () => {
  const words = new Uint32Array([9, 9, 1, 2, 0, 0, 5, 7])
  assert.deepEqual(mapClusterCounts(words, 3), [3, 0, 12])
})

test('a map is listed while it draws and for the hold after its last cluster, then leaves', () => {
  const timers = new Map<number, number>()
  const name = (id: number) => `light${id}`
  assert.equal(clusterStatsRows([4, 0], name, timers).length, 2)
  assert.match(clusterStatsRows([4, 0], name, timers)[1]!, /^ {5}0 \| .*light0 \| {10}4$/)
  let rows = 0
  for (let frame = 0; frame <= CLUSTER_STATS_HOLD + 1; frame++)
    rows = clusterStatsRows([0, 0], name, timers).length
  assert.equal(rows, 1, 'only the header is left')
  assert.equal(timers.size, 0)
})
