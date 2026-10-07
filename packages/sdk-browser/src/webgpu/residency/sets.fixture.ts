import assert from 'node:assert/strict'
import type { PageRec } from '../../page/selection/selection.ts'
import { createCutDelta, type CutDelta } from '../cut/delta.ts'
import { createGroupClosure } from '../../page/cut/groupClosure.ts'
import { createRequestAdmission } from './requestAdmission.ts'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createWebgpuResidencySets } from './sets.ts'
import { admissionLevel } from '../../residency/minimumCapacity.ts'
import { ADMISSION_BUCKETS, ADMISSION_LEVEL_MAX } from '../../gpu/dag/request.ts'

export const rec = (url: string, level: number) => ({ url, level }) as unknown as PageRec

/** `ids` in the order the GPU ranks a short pool's requests (`../../gpu/dag/request.ts`,
 *  `admitByLevel`): the minimum capacity's pages, then the coarser level first, each level in the
 *  order the ids came in — one of the orders the kernel's threads give. */
export const admissionOrder = (ids: ArrayLike<number>, packed: readonly PageRec[], top: number) =>
  Array.from(ids, (id, at) => ({ id, at, level: admissionLevel(packed[id], top) }))
    .sort((a, b) => b.level - a.level || a.at - b.at)
    .map(({ id }) => id)

/** The readback of a cut asking for `ids`, ranked by the GPU for a short pool. */
export const readbackOf = (ids: ArrayLike<number>, packed: readonly PageRec[], top: number) => ({
  uniforms: { admitByLevel: true },
  result: { pageIds: admissionOrder(ids, packed, top), levelCounts: bucketCounts(ids, packed) },
})

/** The admission counts the GPU writes beside such a list (`levelCountsWord`): each bucket's
 *  requests, a bucket the page's level, the minimum capacity's bit above. */
function bucketCounts(ids: ArrayLike<number>, packed: readonly PageRec[]) {
  const counts = new Uint32Array(ADMISSION_BUCKETS)
  for (const id of Array.from(ids)) {
    const page = packed[id]
    const level = Math.min(page.level ?? 0, ADMISSION_LEVEL_MAX)
    counts[level + (page.rootChild ? ADMISSION_LEVEL_MAX + 1 : 0)]++
  }
  return counts
}

/** The residency sets over `packed`, the catalogue in cut order, with `cover` pinned. `cut` applies
 *  a difference through the group closure, as the publication does; `budget` is the admission at
 *  `room` of the cut's readback, ranked by the GPU, true past it. */
export function world(packed: PageRec[], cover: readonly PageRec[] = []) {
  const tracking = createWebgpuPageTracking([...packed, ...cover])
  const bootstrapKey = new Uint8Array(tracking.keyCount)
  for (const page of cover) bootstrapKey[tracking.keyOf(page)] = 1
  const sets = createWebgpuResidencySets({ tracking, bootstrapKey, packedPages: packed })
  const pages: PageRec[] = []
  const delta = createCutDelta(packed, pages)
  const closure = createGroupClosure(
      [],
      { baseOfRoot: new Int32Array(0), rootOfPacked: new Int32Array(0) },
      packed,
    ),
    admission = createRequestAdmission(sets, tracking, closure, (id) => packed[id])
  const cut = (difference: CutDelta = delta) => {
    closure.apply(difference)
    sets.applyCut(closure.delta)
  }
  const budget = (room: number) => {
    const short = admission.short(room)
    const asked = Array.from(delta.ids).slice(0, delta.count)
    admission(room, { cuts: [readbackOf(asked, packed, tracking.topLevel)], first: null })
    return short
  }
  return { packed, tracking, bootstrapKey, sets, pages, delta, closure, admission, cut, budget }
}

type World = ReturnType<typeof world>

/** Sixteen opaque placements over eight pages — two placements share a page — then four
 *  transparent clusters of the same cut, and a two-page pinned cover. One catalogue, one cut. */
export function scene() {
  const opaque = Array.from({ length: 16 }, (_, id) => rec(`o${id >> 1}`, id >> 1))
  const transparent = Array.from({ length: 4 }, (_, id) => rec(`t${id}`, id))
  return { ...world([...opaque, ...transparent], [rec('o0', 0), rec('t0', 0)]), transparent }
}

/** What the whole-set version computed every image, written out in full. The budget counts slots,
 *  and one page is one slot: the cut is deduplicated before it is cut. */
function reference(world: World, cutIds: readonly number[], room: number) {
  const { tracking, bootstrapKey, packed } = world,
    key = tracking.keyOf
  const cover: number[] = []
  for (let k = 0; k < tracking.keyCount; k++) if (bootstrapKey[k]) cover.push(k)
  const seen = new Set<number>()
  const desired = cutIds.filter((id) => !seen.has(id) && seen.add(id)).map((id) => packed[id])
  const requested = new Set([...cover, ...desired.map(key)])
  const pages: PageRec[] = [],
    kept = new Set<number>()
  for (const page of desired) {
    if (bootstrapKey[key(page)] || kept.has(key(page))) continue
    kept.add(key(page))
    pages.push(page)
  }
  let records = pages
  if (records.length > room)
    records = [...records].sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).slice(0, room)
  const wanted = new Set(records.map(key))
  const keep = new Set([...cover, ...wanted])
  return { requested: requested.size, wanted, keep }
}

/** One image, in the order the engine runs it: the difference, then the admission at `room`. */
export function frame(world: World, cutIds: readonly number[], room: number) {
  const { delta, sets } = world
  delta.apply(cutIds)
  world.cut()
  const requested = sets.requestedCount
  world.budget(room)
  return { requested, keep: sets.keepCount }
}

/** A residency list, in its order. */
export const queueOf = (set: { list: Int32Array; count: number }) => [
  ...set.list.subarray(0, set.count),
]

export const keysOf = (set: { list: Int32Array; count: number }) => new Set(queueOf(set))

export function check(world: World, cutIds: readonly number[], room: number, label: string) {
  const got = frame(world, cutIds, room)
  const want = reference(world, cutIds, room)
  assert.equal(got.requested, want.requested, `${label}: requested pages`)
  assert.deepEqual(keysOf(world.tracking.wanted), want.wanted, `${label}: residency queue`)
  assert.deepEqual(keysOf(world.tracking.keep), want.keep, `${label}: kept set`)
  assert.equal(got.keep, want.keep.size, `${label}: kept size`)
}
