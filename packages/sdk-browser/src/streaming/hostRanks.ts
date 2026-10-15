import type { HostRetentionDelta } from './types.ts'
import { createCutDelta } from '../webgpu/cut/delta.ts'

/** What the delta reads from a record: its request rank, and nothing else. */
type Ranked = { requestIndex?: number }
/** No record of any list: the one a list's first record is compared with. */
const UNMARKED: Ranked = {}

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
  /** The ranks of the pass being marked, in marking order. */
  const marked: number[] = []
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
    if (rank >= 0 && rank < capacity) marked.push(rank)
  }
  return {
    /** Extends a mounted catalogue without changing ranks or the address table's identity. */
    grow(count: number) {
      capacity = Math.max(capacity, count)
    },
    /** Opens a pass: what is not re-marked before `finish()` will leave the set. */
    begin() {
      marked.length = 0
    },
    /** Marks the ranks of a list. A record repeated next to itself — the placements of one
     *  primitive, rank after rank — is marked once: marking its rank again would change nothing. */
    mark(list: readonly Ranked[]) {
      let last: Ranked = UNMARKED
      for (let i = 0; i < list.length; i++) {
        const rec = list[i]
        if (rec === last) continue
        last = rec
        const rank = rec.requestIndex
        if (rank !== undefined) markRank(rank)
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
