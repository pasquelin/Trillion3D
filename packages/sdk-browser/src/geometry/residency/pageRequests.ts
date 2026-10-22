import type { PageRec } from '../selection/types.ts'
import type { GpuCut } from '../../gpu/core/selection.ts'
import type { GroupClosure } from '../cut/groupClosure.ts'
import { createSparseInts } from '../cut/sparseInts.ts'
import { createPageCatalogue, type PageList } from '../selection/catalogue.ts'
import { hasPage } from '../rows/page/pageSlots.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { REQUEST_PRIORITY_MAX } from '../dag/request/request.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { PageUnits } from './pageUnits.ts'

/** The highest priority a lift hands: a u32's. */
const PRIORITY_MAX = 0xffffffff

/** The updates a prefetch asks its pages for at most, whatever its asker names: a wrong count
 *  never keeps one for good. */
const PREFETCH_UPDATES_MAX = 30

/** A priority an asker names, kept as it is up to the highest the GPU's own requests take; 0 is
 *  no request — and so is any value under one, or none. */
const requestPriority = (priority: number) => {
  const whole = Math.trunc(priority)
  return whole > 0 ? Math.min(whole, REQUEST_PRIORITY_MAX) : 0
}

/** A prefetch: packed pages, the updates it still asks them for, the priority its asker fixed, if
 *  it did, and their priority this update beside each, for the walk of what they depend on. */
type Prefetch = {
  pages: readonly number[]
  left: number
  fixed: number | undefined
  ranks: Uint32Array
}

/** What a request table reads of the catalogue's streaming pages. */
type Streaming = {
  keyOf: (rec: PageRec) => number
  /** The streaming pages of the catalogue: the one of a key, the keys and the records of one
   *  (`./pageUnits.ts`). */
  units: Pick<PageUnits, 'of' | 'keys' | 'records'>
  /** The streaming pages a streaming page depends on (`./queueHold.ts`, `createUnitParents`). */
  parents: (unit: number) => readonly number[]
  /** True for a key of the root cover. */
  covers: (key: number) => boolean
}

/** The streaming pages requested in one update: each once, in the order first requested
 *  (`keys`, the first `count`), and beside each the record it was first requested by. */
type RequestTable = {
  /** Each requested streaming page's priority, a u32 held in an int's bits. */
  priority: ReturnType<typeof createSparseInts>
  /** The streaming pages a lift is in, so a hop back onto one ends it. */
  lifting: ReturnType<typeof createSparseInts>
  keys: Int32Array
  count: number
  records: PageRec[]
}

/** Streaming page `unit`, first requested by `rec`, joins the table. */
function addUnit(t: RequestTable, unit: number, rec: PageRec) {
  t.keys = resized(t.keys, t.count + 1)
  t.records[t.count] = rec
  t.keys[t.count++] = unit
}

/** `rec` requested at `asked`: its streaming page joins the table and is raised to `asked`. */
function noteRecord(t: RequestTable, s: Streaming, rec: PageRec, asked: number) {
  // A record without a page — a world cluster no surface wears — is no streaming page: it has
  // no bytes to wait for, and one started would hold every install behind it.
  if (!hasPage(rec)) return
  const key = s.keyOf(rec)
  if (s.covers(key)) return
  const unit = s.units.of(key),
    held = t.priority.get(unit) >>> 0
  if (held === 0) addUnit(t, unit, rec)
  if (asked > held) t.priority.set(unit, asked | 0)
}

/** The streaming pages `unit`, requested at `asked`, depends on, each raised to one above it, and
 *  theirs in turn, while a priority rises. The root cover is no request, and a hop back onto a
 *  streaming page the lift is in leaves it be. */
function liftUnit(t: RequestTable, s: Streaming, unit: number, asked: number) {
  const above = asked + 1
  if (above > PRIORITY_MAX) return
  t.lifting.set(unit, 1)
  for (const parent of s.parents(unit)) {
    const held = t.priority.get(parent) >>> 0
    if (above <= held || t.lifting.has(parent) || s.covers(s.units.keys(parent)[0])) continue
    if (held === 0) {
      const rec = s.units.records(parent).find(hasPage)
      if (!rec) continue
      addUnit(t, parent, rec)
    }
    t.priority.set(parent, above | 0)
    liftUnit(t, s, parent, above)
  }
  t.lifting.set(unit, 0)
}

/** The table of one update's requests: `note` raises a page to the priority asked, `liftRequested`
 *  raises what every page asked depends on, a hop a streaming page. */
function createRequestTable(s: Streaming) {
  const t: RequestTable = {
    priority: createSparseInts(),
    lifting: createSparseInts(),
    keys: new Int32Array(64),
    count: 0,
    records: [],
  }
  const note = (rec: PageRec, asked: number) => noteRecord(t, s, rec, asked)
  return {
    /** A new update: nothing requested. */
    clear() {
      t.priority.clear()
      t.count = t.records.length = 0
    },
    note,
    /** `note` as the group closure visits a record (`closeOver`). */
    visit: (_id: number, rec: PageRec, asked: number) => note(rec, asked),
    /** What every page asked depends on, a hop a streaming page: each requested one, as it
     *  stands. Those a lift adds are lifted by it, in turn: only the ones asked so far are walked. */
    liftRequested() {
      const requested = t.count
      for (let at = 0; at < requested; at++)
        liftUnit(t, s, t.keys[at], t.priority.get(t.keys[at]) >>> 0)
    },
    get keys() {
      return t.keys
    },
    recordAt: (at: number) => t.records[at],
    get count() {
      return t.count
    },
    requested: (unit: number) => t.priority.get(unit) !== 0,
    priorityOf: (unit: number) => t.priority.get(unit) >>> 0,
    get byteLength() {
      return t.priority.byteLength + t.keys.byteLength + t.records.length * 8
    },
  }
}

/**
 * THE REQUESTS OF ONE UPDATE, by STREAMING PAGE — the unit the residency streams
 * (`./pageUnits.ts`) —: the streaming pages of the leaves the views' readbacks ask for — a request
 * names a leaf's first page and how many pages it takes from there, every one asked, whichever
 * streaming page it lies in —, each at the highest priority a request of one of its pages takes — the GPU's, the larger the more
 * urgent (`../../gpu/core/selection.ts`, `SelectionResult.requests`) —; then the prefetches
 * (`prefetch`), each page at the highest priority a request takes less the updates left before
 * its asker draws it — above every view's, the nearer the deadline the higher —; then what they
 * all depend on: each group a request's cut rule needs, up to the roots, at its request's priority
 * (`../cut/groupClosure.ts`, `closeOver`), and each streaming page a requested one depends on at
 * one above it — one per hop from streaming page to streaming page, however many groups a page
 * holds —, and theirs in turn, as long as a priority rises (`lift`). The root cover is no
 * request: it is held apart (`covers`).
 *
 * `keys` lists the streaming pages once each, the views' requests first, in their readbacks'
 * order, then the prefetches', then what they depend on, in the walks' order: the order the
 * streaming moves them to the end of its use order (`./streamedPages.ts`). Their count is the
 * update's unique requests, what the pool's pressure reads (`./poolPressure.ts`). The tables follow
 * the requests, never the catalogue.
 */
export function createPageRequests(options: {
  packedPages: PageList
  keyOf: (rec: PageRec) => number
  /** The streaming pages of the catalogue: the one of a key, the keys and the records of one
   *  (`./pageUnits.ts`). */
  units: Pick<PageUnits, 'of' | 'keys' | 'records'>
  /** The streaming pages a streaming page depends on (`./queueHold.ts`, `createUnitParents`). */
  parents: (unit: number) => readonly number[]
  /** True for a key of the root cover. */
  covers: (key: number) => boolean
  closure: Pick<GroupClosure, 'closeOver'>
}) {
  const { closure } = options
  const { recordOf } = createPageCatalogue(options.packedPages)
  const table = createRequestTable(options)
  /** The prefetches still asking, in the order asked. */
  const prefetches: Prefetch[] = []
  return {
    /** The requests of `cuts`, the readbacks of the update, the drawn capture's first, then the
     *  prefetches' — each one update nearer its deadline, let go once there —, then what they
     *  depend on. */
    take(cuts: readonly GpuCut[]) {
      table.clear()
      for (const { result } of cuts) {
        const { pages, counts, priorities } = result.requests
        for (let i = 0; i < pages.length; i++) {
          const asked = Math.max(1, priorities[i] >>> 0),
            named = Math.max(1, counts[i] | 0)
          for (let k = 0; k < named; k++) {
            const rec = recordOf(pages[i] + k)
            if (rec) table.note(rec, asked)
          }
        }
      }
      for (const ask of prefetches) {
        const asked = ask.fixed ?? REQUEST_PRIORITY_MAX - ask.left
        ask.left--
        ask.ranks.fill(asked)
        for (const id of ask.pages) {
          const rec = recordOf(id)
          if (rec) table.note(rec, asked)
        }
      }
      for (const { result } of cuts) {
        const { pages, priorities } = result.requests
        closure.closeOver(pages, table.visit, priorities)
      }
      for (const ask of prefetches) closure.closeOver(ask.pages, table.visit, ask.ranks)
      table.liftRequested()
      // Those whose updates are spent let go, the others kept in their order, in place.
      let kept = 0
      for (const ask of prefetches) if (ask.left > 0) prefetches[kept++] = ask
      prefetches.length = kept
    },
    /** Asks packed pages `pages` for the next `updates` updates — at least one, at most
     *  `PREFETCH_UPDATES_MAX` —, the asker drawing them after. Each update the pages are asked at
     *  `priority` when the asker gives one — a whole number kept as it is up to
     *  `REQUEST_PRIORITY_MAX`, the highest of the GPU's own requests, a value past it brought back
     *  to it: a request of the asker's own rank beside the views' —, and a priority of 0 asks for
     *  nothing; else at `REQUEST_PRIORITY_MAX` less the updates left, ahead of the views'
     *  requests, the nearer the deadline the higher. */
    prefetch(pages: readonly number[], updates: number, priority?: number) {
      const left = clamp(updates, 1, PREFETCH_UPDATES_MAX),
        fixed = priority === undefined ? undefined : requestPriority(priority)
      if (fixed === 0) return
      prefetches.push({ pages, left, fixed, ranks: new Uint32Array(pages.length) })
    },
    /** The streaming pages requested, in the order above: read up to `count`. */
    get keys() {
      return table.keys
    },
    /** The record the streaming page at place `at` was first requested by. */
    recordAt: table.recordAt,
    /** Unique streaming pages requested, the root cover apart. */
    get count() {
      return table.count
    },
    /** Whether this update requests streaming page `unit`: one it uses, never a victim. */
    requested: table.requested,
    /** `unit`'s priority this update, 0 for one it does not request. */
    priorityOf: table.priorityOf,
    /** Bytes of its tables, bounded by the requests and the prefetches asking. */
    get byteLength() {
      let asking = 0
      for (const ask of prefetches) asking += ask.pages.length * 8 + ask.ranks.byteLength
      return table.byteLength + asking
    },
  }
}
