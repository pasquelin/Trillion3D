import { resized } from './resized.ts'

/**
 * Indices listed each once in the order they came, a byte marking each up to the largest listed:
 * the changed list (`../../../sdk-browser/src/geometry/residency/ranges.ts`), the row claims
 * (`../../../sdk-browser/src/geometry/rows/claims.ts`).
 */
export function createMarkedList() {
  let marks = new Uint8Array(0),
    list = new Int32Array(8),
    count = 0
  return {
    get list() {
      return list
    },
    get count() {
      return count
    },
    get byteLength() {
      return marks.byteLength + list.byteLength
    },
    /** Lists `index` unless it is listed already; true when it was not. */
    add(index: number) {
      if (index >= marks.length) marks = resized(marks, index + 1)
      if (marks[index]) return false
      marks[index] = 1
      if (count === list.length) list = resized(list, count + 1)
      list[count++] = index
      return true
    },
    /** Drops the first `served` indices and keeps the rest in their order. */
    consume(served: number) {
      for (let i = 0; i < served; i++) marks[list[i]] = 0
      if (served < count) list.copyWithin(0, served, count)
      count -= served
    },
    /** Nothing is listed. */
    clear() {
      for (let i = 0; i < count; i++) marks[list[i]] = 0
      count = 0
    },
  }
}
