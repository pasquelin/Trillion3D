import type { HostRetentionDelta } from './types.ts'
import { eachRankUrl } from './streamingPins.ts'
import { createCutDelta } from '../cut/adoption/delta.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'

/** What the delta reads from a record: its request rank, and the records of the bundles it is
 *  installed after (`PageRec.dependencies`). */
export type Ranked = { requestIndex?: number; dependencies?: readonly Ranked[] }

/** What the delta keeps: the ranks of the pass being marked, and the pass each was last marked in. */
interface RankPass {
  /** Ranks past the table name no address: they are never marked. */
  capacity: number
  difference: ReturnType<typeof createCutDelta>
  /** The ranks of the pass being marked, each once, in marking order; the pass each rank was last
   *  marked in — the placements of a page share its rank, so the lists name it once a placement. */
  marked: number[]
  passes: Uint32Array
  closed: Uint32Array
  pass: number
}

/** The published delta over `difference`. */
const retentionDelta = (difference: RankPass['difference'], urls: readonly string[]) =>
  ({
    urls,
    get entered() {
      return difference.entered
    },
    get exited() {
      return difference.exited
    },
    get enteredCount() {
      return difference.enteredCount
    },
    get exitedCount() {
      return difference.exitedCount
    },
    get held() {
      return difference.ids as Int32Array
    },
    get heldCount() {
      return difference.count
    },
  }) satisfies HostRetentionDelta

const markRank = (r: RankPass, rank: number) => {
  if (rank < 0 || rank >= r.capacity || r.passes[rank] === r.pass) return
  r.passes[rank] = r.pass
  r.marked.push(rank)
}

const markList = (r: RankPass, list: readonly Ranked[]) => {
  for (let i = 0; i < list.length; i++) {
    const rank = list[i].requestIndex
    if (rank !== undefined) markRank(r, rank)
  }
}

/**
 * Marks a cut, then the bundles each record is installed after (`PageRec.dependencies`): what
 * the host keeps retained with the cut, so a parent fetched for a cut page is not evicted
 * before that page can follow it. A rank whose bundles the pass marked already — another
 * placement of its page — marks none again: the walk costs the cut's records, its bundles once.
 */
const markClosed = (r: RankPass, cut: readonly Ranked[]) => {
  markList(r, cut)
  for (let i = 0; i < cut.length; i++) {
    const rec = cut[i],
      rank = rec.requestIndex,
      dependencies = rec.dependencies
    if (!dependencies?.length) continue
    if (rank !== undefined && rank >= 0 && rank < r.capacity) {
      if (r.closed[rank] === r.pass) continue
      r.closed[rank] = r.pass
    }
    markList(r, dependencies)
  }
}

/**
 * The set of request ranks an image keeps, held from one image to the next and published as a delta.
 *
 * The ranks a pass marks are gathered as integers, and the one difference of the engine
 * (`../cut/adoption/delta.ts`) names what entered and what left: a rank marked twice in a pass is
 * held once, and no string is touched. An image that keeps exactly the same ranks publishes an
 * empty delta, which the cache recognises without walking anything.
 */
export function createHostRankDelta(requestCount: number, urls: readonly string[]) {
  const r: RankPass = {
    capacity: requestCount,
    difference: createCutDelta(),
    marked: [],
    passes: new Uint32Array(requestCount),
    closed: new Uint32Array(requestCount),
    pass: 1,
  }
  const delta = retentionDelta(r.difference, urls)
  return {
    /** Extends a mounted catalogue without changing ranks or the address table's identity. */
    grow(count: number) {
      if (count <= r.capacity) return
      r.capacity = count
      r.passes = resized(r.passes, count)
      r.closed = resized(r.closed, count)
    },
    /** Opens a pass: what is not re-marked before `finish()` will leave the set. */
    begin() {
      r.marked.length = 0
      // A pass names each rank once; wrapped, every rank is unmarked again.
      if (++r.pass > 0xfffffffe) {
        r.passes.fill(0)
        r.closed.fill(0)
        r.pass = 1
      }
    },
    /** Marks the ranks of a list, each once a pass (`markRank`): the placements of one primitive
     *  share its rank. */
    mark: (list: readonly Ranked[]) => markList(r, list),
    markClosed: (cut: readonly Ranked[]) => markClosed(r, cut),
    markRank: (rank: number) => markRank(r, rank),
    /** Closes the pass and returns the delta: what entered, what left. */
    finish(): HostRetentionDelta {
      r.difference.apply(r.marked, r.marked.length)
      return delta
    },
    /** The already-published set, without walking anything: the image keeps what it kept. */
    hold(): HostRetentionDelta {
      r.difference.hold()
      return delta
    },
  }
}

/** Hands `streamer` the ranks an engine retains — the delta applied before another read of the
 *  engine can turn it into an empty one —, then `visit` each address they hold. */
export function retainHeldUrls(
  streamer: { retainRanks(ranks: HostRetentionDelta): void },
  ranks: HostRetentionDelta,
  visit: (url: string) => void,
) {
  streamer.retainRanks(ranks)
  eachRankUrl(ranks.urls, ranks.held, ranks.heldCount, visit)
}
