// The cut's groups follow the placements' records they bind (`recordsFollow.ts`): made again once a
// growth remakes the table for the proxy's copies, never while it stands.
import test from 'node:test'
import assert from 'node:assert/strict'
import { followRecords, recordsIdentity } from './recordsFollow.ts'
import type { DagResources } from './resources.ts'

test("the cut's groups are made again when the records they bind are, and only then", () => {
  let view = { name: 'records' },
    made = 0
  const frames = {
    get worlds() {
      return { view }
    },
    bindGroups: () => [{ first: 0, count: 1, bindGroup: { made: ++made } }],
    bindGroup: () => ({ rank: made }),
  }
  const resources = {
    frames,
    layout: {},
    group: {},
    ranks: [{}, {}],
    ranges: frames.bindGroups(),
    rankGroups: [],
    recordsBound: recordsIdentity(view as unknown as GPUTextureView),
  } as unknown as DagResources
  const ranges = resources.ranges
  followRecords(resources)
  assert.equal(resources.ranges, ranges, 'the records stand: nothing made')
  view = { name: 'grown' }
  followRecords(resources)
  assert.notEqual(resources.ranges, ranges, 'grown: every range made again')
  assert.equal(resources.rankGroups.length, 2, 'and each kept list')
  const again = resources.ranges
  followRecords(resources)
  assert.equal(resources.ranges, again)
})
