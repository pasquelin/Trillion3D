import { grown } from './sparseInts.ts'

/**
 * Integer values keyed by packed ids, one word per id up to the largest seen — grown with the
 * catalogue, never hashed —: what the cut's per-page state is kept in where every frame reads it
 * id by id (`groupClosure.ts`, `../../webgpu/cut/delta.ts`). An absent id reads 0. A map emptied
 * every walk (`clearable`) holds a stamp beside each word: emptied by a new stamp, O(1), nothing
 * written per id. Bytes per catalogue id: 4, or 8 when clearable.
 *
 * The same contract as `createSparseInts` for the calls these readers make: `get`, `set` returning
 * the previous value, `add` returning the new one, `clear`.
 */
export function createDenseInts(clearable = false) {
  let values = new Int32Array(0),
    stamps = new Int32Array(0),
    stamp = 1
  const fit = (key: number) => {
    if (key < values.length) return
    values = grown(values, key + 1, values.length)
    if (clearable) stamps = grown(stamps, key + 1, stamps.length)
  }
  const map = {
    get(key: number) {
      if (!(key >= 0 && key < values.length)) return 0
      return !clearable || stamps[key] === stamp ? values[key] : 0
    },
    has: (key: number) => map.get(key) !== 0,
    /** Sets `key` to `value`; returns the previous value. */
    set(key: number, value: number) {
      const previous = map.get(key)
      if (key < 0) return previous
      fit(key)
      values[key] = value
      if (clearable) stamps[key] = stamp
      return previous
    },
    /** Adds `delta` to `key`'s value; returns the new value. */
    add(key: number, delta: number) {
      const next = map.get(key) + delta
      map.set(key, next)
      return next
    },
    /** Every value back to 0: a new stamp, or — a map never emptied per walk — every word. */
    clear() {
      if (!clearable) return void values.fill(0)
      if (++stamp < 0x7fffffff) return
      stamps.fill(0)
      stamp = 1
    },
    /** Bytes of the words: one per id, two when clearable. */
    get byteLength() {
      return values.byteLength + stamps.byteLength
    },
  }
  return map
}
