/** A heap's items, its order, and how an item is put at a place, told its place. */
type Heap<T> = { items: T[]; before: (a: T, b: T) => boolean; put: (item: T, at: number) => void }

/** The item at `at` of `heap` climbs while it leaves before its parent. */
function up<T>({ items, before, put }: Heap<T>, at: number) {
  const item = items[at]
  for (let parent = (at - 1) >> 1; at > 0 && before(item, items[parent]); parent = (at - 1) >> 1) {
    put(items[parent], at)
    at = parent
  }
  put(item, at)
}

/** The item at `at` of `heap` sinks while a child leaves before it. */
function down<T>({ items, before, put }: Heap<T>, at: number) {
  const item = items[at],
    n = items.length
  for (let child = 2 * at + 1; child < n; child = 2 * at + 1) {
    if (child + 1 < n && before(items[child + 1], items[child])) child++
    if (!before(items[child], item)) break
    put(items[child], at)
    at = child
  }
  put(item, at)
}

/**
 * THE ONE HEAP: a binary min-heap of `T` in the order `before` gives, each item's place told to
 * `placed` as it moves, so an item that keeps its place is taken out, or settles again once its key
 * changed, in O(log n) wherever it stands. The streamer's jobs (`sdk-browser/src/streaming/
 * queueOrder.ts`), the cache's eviction order (`cacheEvictionOrder.ts`), the failed reads' waits
 * (`failures.ts`), the places a search of the queue visits, a tile pool's victims
 * (`webgpu/tile/victimHeap.ts`) and the impostor roots waiting on the view (`sdk-core/src/impostor/
 * watch.ts`) are all this heap.
 */
export function createHeap<T>(
  before: (a: T, b: T) => boolean,
  placed: (item: T, at: number) => void = () => {},
) {
  const items: T[] = []
  const heap: Heap<T> = {
    items,
    before,
    put(item, at) {
      items[at] = item
      placed(item, at)
    },
  }
  /** The item at `at` changed its key, or took another's place: it climbs or sinks to its own. */
  const settle = (at: number) => {
    if (at > 0 && before(items[at], items[(at - 1) >> 1])) up(heap, at)
    else down(heap, at)
  }
  return {
    /** The items in heap order: the first at 0, each parent before its children. */
    items: items as readonly T[],
    get size() {
      return items.length
    },
    push(item: T) {
      items.push(item)
      up(heap, items.length - 1)
    },
    /** Adds `item` unordered: `order` then makes the heap of every item added, in O(n). */
    add(item: T) {
      items.push(item)
    },
    /** The items added since the last order, made a heap at once. */
    order() {
      for (let at = (items.length >> 1) - 1; at >= 0; at--) down(heap, at)
    },
    /** Takes out the item at `at`, the first by default: it, or `undefined` past the heap. */
    take(at = 0) {
      if (at >= items.length) return undefined
      const item = items[at],
        last = items.pop()!
      if (at < items.length) {
        heap.put(last, at)
        settle(at)
      }
      return item
    },
    settle,
    clear() {
      items.length = 0
    },
  }
}
