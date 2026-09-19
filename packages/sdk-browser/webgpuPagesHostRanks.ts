import type { HostRetentionDelta } from './streamingTypes.ts';

/** What the delta reads from a record: its request rank, and nothing else. */
type Ranked = { requestIndex?: number };

/**
 * The set of request ranks an image keeps, held from one image to the next and published as a delta.
 *
 * Nothing is allocated once the scene is known and no string is touched: membership is an epoch mark
 * read off a typed array, exits are read on the previous kept list, and two swapped buffers avoid any
 * reallocation. An image that keeps exactly the same ranks therefore publishes an empty delta, which
 * the cache recognises without walking anything.
 */
export function createHostRankDelta(requestCount: number, urls: readonly string[]) {
  const capacity = Math.max(1, requestCount);
  /** Epoch of the pass where the rank was last marked. */
  const markedAt = new Int32Array(capacity).fill(-1);
  /** Published membership: what the cache holds as pinned. */
  const published = new Uint8Array(capacity);
  const entered = new Int32Array(capacity),
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
    entered,
    exited,
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
  return {
    /** Opens a pass: what is not re-marked before `finish()` will leave the set. */
    begin() {
      epoch++;
      nextCount = 0;
      enteredCount = 0;
      exitedCount = 0;
    },
    /** Marks the ranks of a list. A rank already marked in this pass costs only a read. */
    mark(list: readonly Ranked[]) {
      for (let i = 0; i < list.length; i++) {
        const rank = list[i].requestIndex;
        if (rank === undefined || rank < 0 || rank >= capacity) continue;
        if (markedAt[rank] === epoch) continue;
        markedAt[rank] = epoch;
        heldNext[nextCount++] = rank;
        if (published[rank]) continue;
        published[rank] = 1;
        entered[enteredCount++] = rank;
      }
    },
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
