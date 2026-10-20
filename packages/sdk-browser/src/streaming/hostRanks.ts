import type { HostRetentionDelta } from './types.ts'
import { createCutDelta } from '../webgpu/cut/delta.ts'
import { resized } from '../../../math/src/sequence/resized.ts'

/** What the delta reads from a record: its request rank, and the records of the bundles it is
 *  installed after (`PageRec.dependencies`). */
export type Ranked = { requestIndex?: number; dependencies?: readonly Ranked[] }

/**
 * The set of request ranks an image keeps, held from one image to the next and published as a delta.
 *
 * The ranks a pass marks are gathered as integers, and the one difference of the engine
 * (`../webgpu/cut/delta.ts`) names what entered and what left: a rank marked twice in a pass is
 * held once, and no string is touched. An image that keeps exactly the same ranks publishes an
 * empty delta, which the cache recognises without walking anything.
 */
export function createHostRankDelta(requestCount: number, urls: readonly string[]) {
  /** Ranks past the table name no address: they are never marked. */
  let capacity = requestCount
  const difference = createCutDelta()
  /** The ranks of the pass being marked, each once, in marking order; the pass each rank was last
   *  marked in — the placements of a page share its rank, so the lists name it once a placement. */
  const marked: number[] = []
  let passes = new Uint32Array(capacity),
    closed = new Uint32Array(capacity),
    pass = 1
  const delta = {
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
  } satisfies HostRetentionDelta
  const markRank = (rank: number) => {
    if (rank < 0 || rank >= capacity || passes[rank] === pass) return
    passes[rank] = pass
    marked.push(rank)
  }
  const markList = (list: readonly Ranked[]) => {
    for (let i = 0; i < list.length; i++) {
      const rank = list[i].requestIndex
      if (rank !== undefined) markRank(rank)
    }
  }
  return {
    /** Extends a mounted catalogue without changing ranks or the address table's identity. */
    grow(count: number) {
      if (count <= capacity) return
      capacity = count
      passes = resized(passes, capacity)
      closed = resized(closed, capacity)
    },
    /** Opens a pass: what is not re-marked before `finish()` will leave the set. */
    begin() {
      marked.length = 0
      // A pass names each rank once; wrapped, every rank is unmarked again.
      if (++pass > 0xfffffffe) {
        passes.fill(0)
        closed.fill(0)
        pass = 1
      }
    },
    /** Marks the ranks of a list, each once a pass (`markRank`): the placements of one primitive
     *  share its rank. */
    mark: markList,
    /**
     * Marks a cut, then the bundles each record is installed after (`PageRec.dependencies`): what
     * the host keeps retained with the cut, so a parent fetched for a cut page is not evicted
     * before that page can follow it. A rank whose bundles the pass marked already — another
     * placement of its page — marks none again: the walk costs the cut's records, its bundles once.
     */
    markClosed(cut: readonly Ranked[]) {
      markList(cut)
      for (let i = 0; i < cut.length; i++) {
        const rec = cut[i],
          rank = rec.requestIndex,
          dependencies = rec.dependencies
        if (!dependencies?.length) continue
        if (rank !== undefined && rank >= 0 && rank < capacity) {
          if (closed[rank] === pass) continue
          closed[rank] = pass
        }
        markList(dependencies)
      }
    },
    markRank,
    /** Closes the pass and returns the delta: what entered, what left. */
    finish(): HostRetentionDelta {
      difference.apply(marked, marked.length)
      return delta
    },
    /** The already-published set, without walking anything: the image keeps what it kept. */
    hold(): HostRetentionDelta {
      difference.hold()
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
  for (let i = 0; i < ranks.heldCount; i++) {
    const url = ranks.urls[ranks.held[i]]
    if (url !== undefined) visit(url)
  }
}
