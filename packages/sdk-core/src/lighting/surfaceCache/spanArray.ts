import { createSpanAllocator } from '../../../../math/src/sequence/spanAllocator.ts'

/**
 * AN ARRAY WITH STABLE INDICES AND CONTIGUOUS RUNS: the home of the cards, the mesh cards and the
 * pages of the surface cache, whose indices the GPU's records name and whose runs — the cards of
 * one mesh, the pages of one mip — are told by their first index alone. The runs are the one span
 * allocator's (`math/src/sequence/spanAllocator.ts`).
 */

/** An array whose elements keep their index while others come and go, and are added and removed in
 *  runs. */
export interface SpanArray<T> {
  /** The range in use: one past the last index that may hold an element. */
  readonly length: number
  /** Adds a run of `count` elements, each made by `make` told its place in the run; the index of the
   *  first. */
  addSpan(count: number, make: (offset: number) => T): number
  /** Removes the run of `count` elements at `first`. */
  removeSpan(first: number, count: number): void
  /** The element at `index`, which must be allocated. */
  at(index: number): T
  /** Whether `index` holds an element. */
  has(index: number): boolean
  /** Joins the runs removed to the free ones, and gives back the room past the last element. */
  consolidate(): void
}

/** An empty `SpanArray`. */
export function createSpanArray<T>(): SpanArray<T> {
  const runs = createSpanAllocator()
  const items: (T | undefined)[] = []
  return {
    get length() {
      return runs.extent
    },
    addSpan(count, make) {
      const first = runs.allocate(count)
      for (let offset = 0; offset < count; offset++) items[first + offset] = make(offset)
      return first
    },
    removeSpan(first, count) {
      for (let at = first; at < first + count; at++) items[at] = undefined
      runs.release(first, count)
    },
    at: (index) => items[index] as T,
    has: (index) => items[index] !== undefined,
    consolidate() {
      runs.consolidate()
      // The storage is kept until the range is under half of it.
      if (items.length > runs.extent * 2) items.length = runs.extent
    },
  }
}
