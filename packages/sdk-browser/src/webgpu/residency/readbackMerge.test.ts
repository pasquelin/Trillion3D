// Lists ranked by admission come back with each admission bucket's count (`levelCountsWord`): the
// merge copies them level by level, a block a view, and reads no request's level — the same merge,
// rank for rank, as interleaving them by each head's level. A list in the cut's own order, or one
// whose counts do not name every request, is interleaved by level.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadbackMerge } from './readbackMerge.ts'
import { ADMISSION_BUCKETS, ADMISSION_LEVEL_MAX } from '../../gpu/dag/request.ts'

const TOP = 5
/** Request `id`'s admission bucket: its level, the minimum capacity's above (ids past 900). */
const bucketOf = (id: number) => (id >= 900 ? ADMISSION_LEVEL_MAX + 1 : 0) + (id % 7)
const bucketLevel = (bucket: number) =>
  (bucket & ADMISSION_LEVEL_MAX) + (bucket > ADMISSION_LEVEL_MAX ? TOP + 1 : 0)
const levelOf = (id: number) => bucketLevel(bucketOf(id))

/** A view's requests ranked by admission, the coarsest bucket first, and their counts. */
function ranked(ids: number[]) {
  const pageIds = ids.slice().sort((a, b) => bucketOf(b) - bucketOf(a))
  const levelCounts = new Uint32Array(ADMISSION_BUCKETS)
  for (const id of ids) levelCounts[bucketOf(id)]++
  return {
    uniforms: { admitByLevel: true },
    result: { pageIds, levelCounts } as { pageIds: number[]; levelCounts?: Uint32Array },
  }
}

type Merge = ReturnType<typeof createReadbackMerge>['merge']
const merged = (merge: Merge, ...args: Parameters<Merge>) => {
  const { ids, levels, count, first } = merge(...args)
  return { ids: [...ids.subarray(0, count)], levels: [...levels.subarray(0, count)], first }
}

test('lists merged by their counts are the lists interleaved by level, rank for rank', () => {
  const views = [
    ranked([1, 2, 3, 8, 9, 15, 901, 22]),
    ranked([4, 11, 18, 25, 903, 905]),
    ranked([6, 13, 20, 27, 34]),
  ]
  const capture = ranked([5, 12, 902])
  let reads = 0
  const counting = createReadbackMerge((id) => (reads++, levelOf(id)), bucketLevel)
  const byCounts = merged(counting.merge, { cuts: views, first: capture }, 100)
  assert.equal(reads, 0, 'no request level read')
  const strip = (cut: ReturnType<typeof ranked>) => ({
    ...cut,
    result: { pageIds: cut.result.pageIds },
  })
  const byLevel = merged(
    createReadbackMerge(levelOf, bucketLevel).merge,
    { cuts: views.map(strip), first: strip(capture) },
    100,
  )
  assert.deepEqual(byCounts, byLevel)
  assert.equal(byCounts.ids.length, 22)
  assert.deepEqual(byCounts.levels.slice(0, 3), [112, 105, 105], "the capture's lead, lifted")
})

test('counts that name fewer requests than the list holds are not believed', () => {
  const cut = ranked([1, 2, 3])
  cut.result.levelCounts![bucketOf(1)]--
  let reads = 0
  const { merge } = createReadbackMerge((id) => (reads++, levelOf(id)), bucketLevel)
  assert.equal(merged(merge, { cuts: [cut], first: null }, 0).ids.length, 3)
  assert.ok(reads > 0, 'interleaved by each level read')
})
