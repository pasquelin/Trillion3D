/**
 * A binary min-heap of root ranks keyed by the eye travel each may take before its verdict can
 * change (`watch.ts`). Each entry carries its rank's stamp when pushed: a rank read again since
 * holds a newer stamp, so its older entries are dropped as they surface, never searched for.
 */
export type SlackHeap = {
  readonly size: number
  /** The smallest key; `Infinity` when empty. */
  readonly min: number
  /** The rank and stamp the last `pop` took. */
  rank: number
  stamp: number
  push(key: number, rank: number, stamp: number): void
  /** Takes the smallest entry into `rank` and `stamp`. */
  pop(): void
  /** Each entry, its key lowered by `shift`, pushed into `into`; this heap emptied. */
  drainInto(into: SlackHeap, shift: number): void
  readonly bytes: number
}

export function createSlackHeap(): SlackHeap {
  let keys = new Float64Array(16),
    ranks = new Int32Array(16),
    stamps = new Uint32Array(16),
    size = 0
  const swap = (i: number, j: number) => {
    const key = keys[i],
      rank = ranks[i],
      stamp = stamps[i]
    keys[i] = keys[j]
    ranks[i] = ranks[j]
    stamps[i] = stamps[j]
    keys[j] = key
    ranks[j] = rank
    stamps[j] = stamp
  }
  const up = (at: number) => {
    while (at > 0) {
      const parent = (at - 1) >> 1
      if (keys[parent] <= keys[at]) return
      swap(at, parent)
      at = parent
    }
  }
  const down = (at: number) => {
    for (;;) {
      let child = 2 * at + 1
      if (child >= size) return
      if (child + 1 < size && keys[child + 1] < keys[child]) child++
      if (keys[child] >= keys[at]) return
      swap(at, child)
      at = child
    }
  }
  const heap: SlackHeap = {
    get size() {
      return size
    },
    get min() {
      return size ? keys[0] : Infinity
    },
    rank: -1,
    stamp: 0,
    push(key, rank, stamp) {
      if (size === keys.length) {
        const grow = <T extends Float64Array | Int32Array | Uint32Array>(from: T) => {
          const next = new (from.constructor as new (length: number) => T)(from.length * 2)
          next.set(from)
          return next
        }
        keys = grow(keys)
        ranks = grow(ranks)
        stamps = grow(stamps)
      }
      keys[size] = key
      ranks[size] = rank
      stamps[size] = stamp
      up(size++)
    },
    pop() {
      heap.rank = ranks[0]
      heap.stamp = stamps[0]
      swap(0, --size)
      down(0)
    },
    drainInto(into, shift) {
      for (let i = 0; i < size; i++) into.push(keys[i] - shift, ranks[i], stamps[i])
      size = 0
    },
    get bytes() {
      return keys.byteLength + ranks.byteLength + stamps.byteLength
    },
  }
  return heap
}
