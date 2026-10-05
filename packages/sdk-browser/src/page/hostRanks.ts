import type { HostRetentionDelta } from '../streaming/types.ts';

/** What the delta reads from a record: its request rank, and nothing else. */
type Ranked = { requestIndex?: number };
/** No record of any list: the one a list's first record is compared with. */
const UNMARKED: Ranked = {};

/**
 * The set of request ranks an image keeps, held from one image to the next and published as a delta.
 *
 * Nothing is allocated once the scene is known and no string is touched: membership is an epoch mark
 * read off a typed array, exits are read on the previous kept list, and two swapped buffers avoid any
 * reallocation. An image that keeps exactly the same ranks therefore publishes an empty delta, which
 * the cache recognises without walking anything.
 */
export function createHostRankDelta(requestCount: number, urls: readonly string[]) {
  let capacity = Math.max(1, requestCount);
  /** Epoch of the pass where the rank was last marked. */
  let markedAt = new Int32Array(capacity).fill(-1);
  /** Published membership: what the cache holds as pinned. */
  let published = new Uint8Array(capacity);
  let entered = new Int32Array(capacity),
    exited = new Int32Array(capacity);
  let held = new Int32Array(capacity),
    heldNext = new Int32Array(capacity);
  let epoch = 0,
    heldCount = 0,
    nextCount = 0,
    enteredCount = 0,
    exitedCount = 0;
  const delta = {
    urls,
    get entered() {
      return entered;
    },
    get exited() {
      return exited;
    },
    get enteredCount() {
      return enteredCount;
    },
    get exitedCount() {
      return exitedCount;
    },
    get held() {
      return held;
    },
    get heldCount() {
      return heldCount;
    },
  } satisfies HostRetentionDelta;
  const markRank = (rank: number) => {
    if (rank < 0 || rank >= capacity || markedAt[rank] === epoch) return;
    markedAt[rank] = epoch;
    heldNext[nextCount++] = rank;
    if (published[rank]) return;
    published[rank] = 1;
    entered[enteredCount++] = rank;
  };
  return {
    /** Extends a mounted catalogue without changing ranks or the address table's identity. */
    grow(count: number) {
      if (count <= capacity) return;
      const next = Math.max(count, capacity * 2);
      const marks = new Int32Array(next).fill(-1);
      marks.set(markedAt);
      markedAt = marks;
      const pins = new Uint8Array(next);
      pins.set(published);
      published = pins;
      const additions = new Int32Array(next),
        removals = new Int32Array(next),
        current = new Int32Array(next),
        upcoming = new Int32Array(next);
      additions.set(entered);
      removals.set(exited);
      current.set(held);
      upcoming.set(heldNext);
      entered = additions;
      exited = removals;
      held = current;
      heldNext = upcoming;
      capacity = next;
    },
    /** Opens a pass: what is not re-marked before `finish()` will leave the set. */
    begin() {
      epoch++;
      nextCount = 0;
      enteredCount = 0;
      exitedCount = 0;
    },
    /** Marks the ranks of a list. A rank already marked in this pass costs only a read, and a
     *  record repeated next to itself — the placements of one primitive, rank after rank — not
     *  even that: marking its rank again would change nothing. */
    mark(list: readonly Ranked[]) {
      let last: Ranked = UNMARKED;
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        if (rec === last) continue;
        last = rec;
        const rank = rec.requestIndex;
        if (rank !== undefined) markRank(rank);
      }
    },
    markRank,
    /** Closes the pass and returns the delta: what entered, what left. */
    finish(): HostRetentionDelta {
      for (let i = 0; i < heldCount; i++) {
        const rank = held[i];
        if (markedAt[rank] === epoch) continue;
        published[rank] = 0;
        exited[exitedCount++] = rank;
      }
      const swap = held;
      held = heldNext;
      heldNext = swap;
      heldCount = nextCount;
      return delta;
    },
    /** The already-published set, without walking anything: the image keeps what it kept. */
    hold(): HostRetentionDelta {
      enteredCount = 0;
      exitedCount = 0;
      return delta;
    },
  };
}
