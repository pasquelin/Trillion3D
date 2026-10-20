/** `count` rings of `capacity` recent values each, read in no order (`values`) or oldest first.
 *  Typed arrays made once: nothing allocated a push. */
export function createRings(count: number, capacity: number) {
  const data = new Float64Array(count * capacity),
    cursor = new Uint32Array(count),
    filled = new Uint32Array(count)
  return {
    push(ring: number, value: number) {
      data[ring * capacity + cursor[ring]] = value
      cursor[ring] = (cursor[ring] + 1) % capacity
      if (filled[ring] < capacity) filled[ring]++
    },
    /** The values ring `ring` holds, in no order. */
    values: (ring: number) => data.subarray(ring * capacity, ring * capacity + filled[ring]),
    /** The values ring `ring` holds, oldest first. */
    ordered(ring: number) {
      const count = filled[ring],
        ordered = new Array<number>(count)
      const first = count === capacity ? cursor[ring] : 0
      for (let i = 0; i < count; i++) ordered[i] = data[ring * capacity + ((first + i) % capacity)]
      return ordered
    },
    clear() {
      cursor.fill(0)
      filled.fill(0)
    },
  }
}
