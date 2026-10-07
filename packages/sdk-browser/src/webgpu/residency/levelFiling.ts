import type { PageRec } from '../../page/selection/selection.ts'
import { createSparseInts, grown } from '../../page/cut/sparseInts.ts'
import type { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { admissionLevel } from '../../residency/minimumCapacity.ts'
import type { createReadbackMerge } from './readbackMerge.ts'

type Tracking = ReturnType<typeof createWebgpuPageTracking>

/**
 * What an admission's walk files (`requestAdmission.ts`): each key it reached, at its admission
 * level, a capture's lifted, then ranked by level into the queue. `cursor` is the merged request
 * the walk is entering, `straddle` the level of the one the room ran out at (-1 not yet), `lift` a
 * capture's lift above every level of the union, `ranked` whether every list walked is ranked by
 * level.
 */
export type LevelFiling = ReturnType<typeof createLevelFiling>

export function createLevelFiling(
  keyOf: Tracking['keyOf'],
  covers: (key: number) => boolean,
  topLevel: number,
  merged: ReturnType<typeof createReadbackMerge>['merged'],
) {
  return {
    keyOf,
    covers,
    topLevel,
    merged,
    /** Per key the walk filed, one plus its filing rank. */
    filedBy: createSparseInts(),
    keys: new Int32Array(0),
    /** The admission level each key was filed at: its own, a capture's lifted. */
    filedLevel: new Int32Array(0),
    /** Keys filed per level, then where each level's slice of `order` ends. */
    perLevel: new Int32Array(8),
    /** The filed keys by level, coarsest first, in walk order within a level. */
    order: new Int32Array(0),
    queue: new Int32Array(0),
    pages: [] as PageRec[],
    queued: [] as PageRec[],
    visits: 0,
    cursor: -1,
    straddle: -1,
    lift: 0,
    room: 0,
    ranked: true,
  }
}

/** A new walk in `room`, every list ranked by level or not. */
export function openFiling(f: LevelFiling, room: number, ranked: boolean) {
  f.ranked = ranked
  f.room = room
  f.lift = 2 * f.topLevel + 2
  f.visits = 0
  f.straddle = f.cursor = -1
  f.filedBy.clear()
}

/** `rec`, reached by the walk, filed unless the sets cover it or it is filed already. */
export function filePage(f: LevelFiling, rec: PageRec) {
  const key = f.keyOf(rec)
  if (f.covers(key) || f.filedBy.get(key)) return
  const visits = f.visits
  if (visits === f.keys.length) {
    f.keys = grown(f.keys, visits + 1, visits)
    f.filedLevel = grown(f.filedLevel, visits + 1, visits)
  }
  f.keys[visits] = key
  f.filedLevel[visits] = admissionLevel(rec, f.topLevel) + (f.cursor < f.merged.first ? f.lift : 0)
  f.pages[visits] = rec
  f.visits = visits + 1
  f.filedBy.set(key, f.visits)
  if (f.visits === f.room && f.straddle < 0) f.straddle = f.merged.levels[f.cursor]
}

/** Called before each request is entered (`closeOver`): the walk stops at the first one finer
 *  than the level the room ran out at. */
export function filingFull(f: LevelFiling) {
  f.cursor++
  return f.ranked && f.straddle >= 0 && f.merged.levels[f.cursor] < f.straddle
}

/**
 * The coarsest levels whole, then the one that straddles the room, what the queue holds first:
 * the walk filed each page at its own level — a request brings coarser groups its cut rule needs
 * —, so the levels are counted over what it filed, bounded by the room and one level, never the
 * view's whole request list. Returns how many the queue takes.
 */
export function rankFiling(f: LevelFiling, wanted: Tracking['wanted']) {
  const { floor, taken, end } = countLevels(f)
  if (f.queue.length < end) f.queue = grown(f.queue, end)
  if (f.order.length < f.visits) f.order = grown(f.order, f.visits)
  const { filedLevel, perLevel, order, keys } = f
  for (let i = 0; i < f.visits; i++)
    if (filedLevel[i] >= floor) order[perLevel[filedLevel[i]]++] = i
  for (let at = 0; at < taken; at++) take(f, at, order[at])
  // The straddled level's queued pages keep the queue's own order, whatever the walk's.
  let at = taken
  for (let i = 0; i < wanted.count && at < end; i++) {
    const filed = f.filedBy.get(wanted.list[i])
    if (filed && filedLevel[filed - 1] === floor) take(f, at++, filed - 1)
  }
  for (let s = taken; s < perLevel[floor] && at < end; s++)
    if (!wanted.has(keys[order[s]])) take(f, at++, order[s])
  f.queued.length = end
  return end
}

/** The filed keys counted by level: the floor the room reaches, the keys of the levels above it,
 *  the queue's end; `perLevel` then holds where each level's slice of `order` starts. */
function countLevels(f: LevelFiling) {
  const { visits, filedLevel, room } = f
  let top = 0
  for (let i = 0; i < visits; i++) top = Math.max(top, filedLevel[i])
  if (f.perLevel.length <= top) f.perLevel = grown(f.perLevel, top + 1)
  const perLevel = f.perLevel
  perLevel.fill(0, 0, top + 1)
  for (let i = 0; i < visits; i++) perLevel[filedLevel[i]]++
  let floor = top,
    taken = 0
  while (floor > 0 && taken + perLevel[floor] < room) taken += perLevel[floor--]
  const end = Math.min(room, taken + perLevel[floor])
  // A counting sort: each level from `floor` up gets its slice of `order`.
  for (let level = top, start = 0; level >= floor; level--) {
    const count = perLevel[level]
    perLevel[level] = start
    start += count
  }
  return { floor, taken, end }
}

function take(f: LevelFiling, at: number, i: number) {
  f.queue[at] = f.keys[i]
  f.queued[at] = f.pages[i]
}

/** Bytes of the filing's tables. */
export const filingBytes = (f: LevelFiling) =>
  f.filedBy.byteLength +
  f.keys.byteLength +
  f.filedLevel.byteLength +
  f.perLevel.byteLength +
  f.order.byteLength +
  f.queue.byteLength
