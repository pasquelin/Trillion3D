// The starts of the streaming (`queue.ts`), by STREAMING PAGE (`pageUnits.ts`): the pages that left
// the pool followed, the victims of an update, the root cover's missing pages, and the new
// streaming pages of highest priority, each a free slot or a victim's.
import type { PageRec } from '../selection/types.ts'
import type { GpuPageCache } from '../pages/pool/pages.ts'
import { pageAddress } from '../rows/page/pageSlots.ts'
import { createHeap } from '../../../../math/src/sequence/heap.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { QueueState, Started, Victim } from './queueState.ts'
import { dependOn, letGo, residentAddress, takeDesired, unloadStranded } from './queueHold.ts'
import { install } from './queueInstalls.ts'

/** The pages that left the pool since the last update, a victim's or a resize's: the streaming
 *  lets go each streaming page of theirs it held resident, whatever of it the pool still holds
 *  given back with it. */
export function followDepartures(s: QueueState, cache: GpuPageCache) {
  const { tracking, sets } = s.o
  cache.takeDepartures((address) => {
    const key = tracking.pageCatalogIds.get(address)
    if (key === undefined) return
    const unit = tracking.units.of(key)
    if (!sets.streamed.has(unit) || sets.streamed.pending(unit)) return
    letGo(s, unit)
    unloadStranded(s, cache, unit)
  })
}

/** Whether a page of `unit` is the root cover's. */
const covered = (s: QueueState, unit: number) => s.o.tracking.units.keys(unit).some(s.o.sets.covers)

/**
 * The victims of one update, from the head of the use order, each named once: the next streaming
 * page this update does not request, that has landed, holds no page of the root cover and that no
 * started or resident streaming page depends on, let go; none when none is left. One the walk
 * finds gone from the pool is let go on the way. The walk goes on from where the last one stopped.
 */
export function victims(s: QueueState, cache: GpuPageCache) {
  const { streamed } = s.o.sets
  let at = streamed.first
  return (): Victim | undefined => {
    while (at >= 0) {
      const unit = at
      at = streamed.next(unit)
      if (s.requests.requested(unit) || streamed.pending(unit) || covered(s, unit)) continue
      // A root page holds a root grain, which no arrival of a streaming slot takes.
      if (streamed.dependentsOf(unit) > 0 || rootGrained(s, cache, unit)) continue
      const address = residentAddress(s, cache, unit),
        page = letGo(s, unit)
      if (address !== undefined && page) return { unit, address, page }
    }
    return undefined
  }
}

/** `unit` started on `cache`, its slot `victim`'s, the one its pages hold already (`holds`), a
 *  free root grain (`grain`), or a free slot. */
function started(
  s: QueueState,
  cache: GpuPageCache,
  unit: number,
  victim: Victim | undefined,
  grain: boolean,
  cover: boolean,
): Started {
  const { units, pageCatalog } = s.o.tracking
  const held = units.keys(unit).some((key) => cache.holds(pageCatalog[key]))
  const onGrain = grain && !held,
    onFree = !victim && !grain && !held
  if (onFree) s.onFree++
  if (onGrain) s.onGrain++
  return {
    unit,
    pages: units.records(unit),
    victim,
    onFree,
    onGrain,
    cover,
    root: grain,
    cache,
    read: undefined,
    ready: false,
    failed: false,
    error: undefined,
  }
}

/** Whether `unit` lands in a root grain of the pool, never a streaming slot nor a victim's: a
 *  root page, the pool having a root region (`../pages/pool/placement.ts`). */
const rootGrained = (s: QueueState, cache: GpuPageCache, unit: number) => {
  const { units, pageCatalog } = s.o.tracking
  return units.keys(unit).some((key) => cache.rooted(pageCatalog[key]))
}

/** The streaming pages a later holder brought into the root cover that the pool lacks a page of,
 *  in the order of their lowest-ranked missing page, loaded at once, pinned on arrival: each takes
 *  the slot its pages hold; a root page a free root grain, or none left, waits for the region to
 *  grow (`rootsShort`); another a free slot, else a victim's; none, and the rest waits for a later
 *  update. */
export function loadCover(s: QueueState, cache: GpuPageCache, victim: () => Victim | undefined) {
  const { sets, tracking, coverRank } = s.o
  const missing = sets.coverMissing((page) => !!cache.get(pageAddress(page)), coverRank)
  let free = cache.room() - s.onFree,
    grains = cache.rootRoom() - s.onGrain
  s.rootsShort = 0
  for (const page of missing) {
    const unit = tracking.units.of(tracking.keyOf(page))
    if (s.covering.has(unit) || s.refused.has(unit)) continue
    let given: Victim | undefined
    const absent = residentAddress(s, cache, unit) === undefined,
      grain = absent && rootGrained(s, cache, unit)
    if (grain && grains <= 0) {
      s.rootsShort++
      continue
    }
    if (grain) grains--
    else if (absent) {
      if (free > 0) free--
      else if (!(given = victim())) return
    }
    s.covering.add(unit)
    install(s, cache, started(s, cache, unit, given, grain, true))
  }
}

/** `entry`'s pages read from now on: its install waits for them, the pool's loads joining the
 *  reads (`QueueOptions.read`) — a streaming page's pages one read of it
 *  (`../streaming/pageStreamer.ts`) —; pages served from memory wait for their bytes instead
 *  (`hasBytes`). */
function readOf(s: QueueState, entry: Started) {
  const reads = entry.pages.flatMap((page) => s.o.read(page, s.o.signal) ?? [])
  if (reads.length)
    entry.read = Promise.all(reads).then(
      () => void (entry.ready = true),
      (error: unknown) => {
        entry.failed = true
        entry.error = error
      },
    )
}

/** The new streaming pages of this update, highest priority first, each a free slot or a
 *  victim's, at most as many as may still be pending. */
export function start(s: QueueState, cache: GpuPageCache, victim: () => Victim | undefined) {
  const { o, requests } = s,
    { streamed } = o.sets
  const chosen = highest(s, s.limits.maxPendingPages - s.pending.length)
  let free = cache.room() - s.onFree,
    grains = cache.rootRoom() - s.onGrain
  for (const at of chosen) {
    const unit = requests.keys[at],
      page: PageRec = requests.recordAt(at)
    let given: Victim | undefined
    // A streaming page the pool holds a page of already — a victim let go before its taker came —
    // takes the slot it has: no free slot, no victim. A root page — an HLOD cell's, not yet held —
    // takes a free root grain, never a streaming slot nor a victim's: none left, it waits for the
    // root region to grow (`rootsShort`).
    const absent = residentAddress(s, cache, unit) === undefined,
      grain = absent && rootGrained(s, cache, unit)
    if (grain && grains <= 0) {
      s.rootsShort++
      continue
    }
    if (grain) grains--
    else if (absent) {
      if (free > 0) free--
      else if (!(given = victim())) return void (s.more = false)
    }
    const entry = started(s, cache, unit, given, grain, false)
    // Started: at the use order's end, holding what it depends on, its desired pages taken on by
    // the pool.
    streamed.start(unit, page)
    dependOn(s, unit, 1)
    takeDesired(s, unit, o.tracking.keyOf(page))
    readOf(s, entry)
    s.pending.push(entry)
    s.started++
  }
}

/**
 * The places, in the requests, of the `room` new streaming pages of highest priority — neither
 * started nor resident, nor refused —, the highest first, ties in the requests' order: a heap of
 * `room` over them, never a sort of all. Notes whether the bound left one out (`more`).
 */
function highest(s: QueueState, room: number) {
  const { requests } = s,
    { streamed } = s.o.sets,
    ranks = (s.ranks = resized(s.ranks, requests.count))
  for (let at = 0; at < requests.count; at++) ranks[at] = requests.priorityOf(requests.keys[at])
  // The lowest first: the one a fuller heap lets go.
  const heap = createHeap<number>((a, b) => ranks[a] < ranks[b] || (ranks[a] === ranks[b] && a > b))
  let candidates = 0
  for (let at = 0; at < requests.count; at++) {
    const unit = requests.keys[at]
    if (streamed.has(unit) || s.refused.has(unit)) continue
    candidates++
    if (room <= 0) continue
    heap.push(at)
    if (heap.size > room) heap.take()
  }
  s.more = candidates > heap.size
  const chosen: number[] = []
  while (heap.size) chosen.push(heap.take()!)
  return chosen.reverse()
}
