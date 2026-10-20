// The transparent compaction ranks its entries by the engine's one workgroup scan (`laneScan`): a
// group is a workgroup, a lane an entry. Its count and its scatter take the scan's total and the
// lane's rank — never a serial count, nor a rescan of the group up to each entry, O(group²) a group.
import test from 'node:test'
import assert from 'node:assert/strict'
import { TRANSPARENT_COMPACT_SHADER } from './shader.ts'
import { TRANSPARENT_GROUP } from './table.ts'
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'

const kernel = (name: string) =>
  TRANSPARENT_COMPACT_SHADER.slice(TRANSPARENT_COMPACT_SHADER.indexOf(`fn ${name}(`)).split(
    '\n}',
  )[0]

test('the count and the scatter rank a group of entries by the lane scan, a lane an entry', () => {
  assert.equal(TRANSPARENT_GROUP, WORKGROUP_THREADS, 'a group is one workgroup')
  const count = kernel('countTransparentGroups'),
    scatter = kernel('scatterTransparentGroups')
  for (const text of [count, scatter]) {
    assert.match(text, /let group=flatIndex\(wg,n,1u\);\n if\(group>=uni\.groupCount\)\{return;\}/)
    assert.match(text, /laneScan\(lane,select\(0u,1u,/)
    assert.doesNotMatch(text, /for\(/, 'no serial walk of the group')
  }
  assert.match(count, /if\(lane==WORKGROUP_THREADS-1u\)\{groupCounts\[group\]=kept;\}/)
  assert.match(
    scatter,
    /instances\[groupOffsets\[group\]\+rank-1u\]=group\*WORKGROUP_THREADS\+lane;/,
  )
})
