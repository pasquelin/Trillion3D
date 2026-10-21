import assert from 'node:assert/strict'
import type { PageRec } from '../selection/types.ts'
import { createCutDelta, type CutDelta } from '../cut/adoption/delta.ts'
import { createGroupClosure } from '../cut/groupClosure.ts'
import { createWebgpuPageTracking, type WebgpuPageTracking } from '../rows/page/pageTracking.ts'
import { createWebgpuResidencySets } from './sets.ts'

export const rec = (url: string, level: number) => ({ url, level }) as unknown as PageRec

/** The residency sets over `packed`, the cover's holders in `bootstrapKey`, its addresses apart. */
export const setsOver = (
  tracking: WebgpuPageTracking,
  bootstrapKey: Uint8Array,
  packed: readonly PageRec[],
) =>
  createWebgpuResidencySets({
    ...{ tracking, bootstrapKey },
    packedPages: packed,
  })

/** The residency sets over `packed`, the catalogue in cut order, with `cover` pinned. `cut` applies
 *  a difference through the group closure, as the publication does; `stream` is the streaming's
 *  part of an image over a pool of `slots` streaming slots (`./queue.ts`): it starts each desired
 *  page it does not hold yet, in catalogue order, while it holds fewer than `slots`. It takes no
 *  victim: the pages it holds are the ones the tests' views keep asking for, which no update lets
 *  go. */
export function world(packed: PageRec[], cover: readonly PageRec[] = []) {
  const tracking = createWebgpuPageTracking([...packed, ...cover])
  const bootstrapKey = new Uint8Array(tracking.keyCount)
  for (const page of cover) bootstrapKey[tracking.keyOf(page)] = 1
  const sets = setsOver(tracking, bootstrapKey, packed)
  const pages: PageRec[] = []
  const delta = createCutDelta(packed, pages)
  const closure = createGroupClosure([], { baseOfRoot: new Int32Array(0), packedCount: 0 }, packed)
  const cut = (difference: CutDelta = delta) => {
    closure.apply(difference)
    sets.applyCut(closure.delta)
  }
  const stream = (slots = Infinity) => {
    for (const page of packed) {
      const key = tracking.keyOf(page)
      if (!sets.requests(key) || sets.covers(key) || sets.streamed.has(key)) continue
      if (sets.streamed.size >= slots) return
      sets.streamed.start(key, page)
      sets.take(key, page)
    }
  }
  return { packed, tracking, bootstrapKey, sets, pages, delta, closure, cut, stream }
}

type World = ReturnType<typeof world>

/** Sixteen opaque placements over eight pages — two placements share a page — then four
 *  transparent clusters of the same cut, and a two-page pinned cover. One catalogue, one cut. */
export function scene() {
  const opaque = Array.from({ length: 16 }, (_, id) => rec(`o${id >> 1}`, id >> 1))
  const transparent = Array.from({ length: 4 }, (_, id) => rec(`t${id}`, id))
  return { ...world([...opaque, ...transparent], [rec('o0', 0), rec('t0', 0)]), transparent }
}

/** What the whole-set version computed every image, written out in full, the pool holding every
 *  page: the cut is deduplicated before it is cut, and the pool takes on each of its pages. */
function reference(world: World, cutIds: readonly number[]) {
  const { tracking, bootstrapKey, packed } = world,
    key = tracking.keyOf
  const cover: number[] = []
  for (let k = 0; k < tracking.keyCount; k++) if (bootstrapKey[k]) cover.push(k)
  const desired = cutIds.map((id) => key(packed[id]))
  const requested = new Set([...cover, ...desired])
  const wanted = new Set(desired.filter((k) => !bootstrapKey[k]))
  const keep = new Set([...cover, ...wanted])
  return { requested: requested.size, wanted, keep }
}

/** One image, in the order the engine runs it: the difference, then the streaming over a pool of
 *  `slots` streaming slots, every page by default. */
export function frame(world: World, cutIds: readonly number[], slots = Infinity) {
  const { delta, sets } = world
  delta.apply(cutIds)
  world.cut()
  const requested = sets.requestedCount
  world.stream(slots)
  return { requested, keep: sets.keepCount }
}

/** A residency list, in its order. */
export const queueOf = (set: { list: Int32Array; count: number }) => [
  ...set.list.subarray(0, set.count),
]

export const keysOf = (set: { list: Int32Array; count: number }) => new Set(queueOf(set))

export function check(world: World, cutIds: readonly number[], label: string) {
  const got = frame(world, cutIds)
  const want = reference(world, cutIds)
  assert.equal(got.requested, want.requested, `${label}: requested pages`)
  assert.deepEqual(keysOf(world.tracking.wanted), want.wanted, `${label}: residency queue`)
  assert.deepEqual(keysOf(world.tracking.keep), want.keep, `${label}: kept set`)
  assert.equal(got.keep, want.keep.size, `${label}: kept size`)
}
