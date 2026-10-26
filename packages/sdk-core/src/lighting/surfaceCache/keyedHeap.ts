import { createHeap } from '../../../../math/src/sequence/heap.ts'

/** What the heap holds of an id: its key, and its place in the heap. */
interface Entry {
  key: number
  readonly id: number
  at: number
}

/**
 * A MIN-HEAP OF IDS BY A KEY, the smallest key on top, an id taken out or given another key wherever
 * it stands: the pages the surface cache evicts by the frame they were last used at, the pages it
 * captures again by the frame they were last captured at, the pages it was asked to capture again
 * by the frame of the request. It is the one heap (`../../../../math/src/sequence/heap.ts`) with the
 * ids it orders told their place.
 */
export function createKeyedHeap() {
  const entries = new Map<number, Entry>()
  const heap = createHeap<Entry>(
    (a, b) => a.key < b.key,
    (entry, at) => {
      entry.at = at
    },
  )

  /** Gives the held `id` another key. */
  function update(key: number, id: number) {
    const entry = entries.get(id)
    if (!entry) return
    entry.key = key
    heap.settle(entry.at)
  }

  /** Lets `id` go, if it is held. */
  function remove(id: number) {
    const entry = entries.get(id)
    if (!entry) return
    heap.take(entry.at)
    entries.delete(id)
  }

  return {
    /** The ids held. */
    get size() {
      return entries.size
    },
    has: (id: number) => entries.has(id),
    /** The key of `id`, which must be held. */
    keyOf: (id: number) => entries.get(id)!.key,
    /** The id with the smallest key, which must exist. */
    top: () => heap.items[0].id,
    /** Holds `id` under `key`; an id held already takes the key. */
    add(key: number, id: number) {
      if (entries.has(id)) return update(key, id)
      const entry: Entry = { key, id, at: -1 }
      entries.set(id, entry)
      heap.push(entry)
    },
    update,
    remove,
    /** Lets the id with the smallest key go, which must exist. */
    pop: () => remove(heap.items[0].id),
    /** Lets every id go. */
    clear() {
      entries.clear()
      heap.clear()
    },
  }
}

/** A heap of ids by a key. */
export type KeyedHeap = ReturnType<typeof createKeyedHeap>
