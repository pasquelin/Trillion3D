/**
 * THE STAGE PROFILE'S TABLES (`profiler.ts`): rings of recent values, read by quantiles, and the
 * slowest images of a window, each kept whole. Typed arrays made once: nothing allocated an image.
 */

/** `count` rings of `capacity` recent values each. Order does not matter: only quantiles are read. */
export function createRings(count: number, capacity: number) {
  const data = new Float64Array(count * capacity),
    cursor = new Uint32Array(count),
    filled = new Uint32Array(count)
  return {
    push(ring: number, value: number) {
      data[ring * capacity + (cursor[ring] % capacity)] = value
      cursor[ring]++
      if (filled[ring] < capacity) filled[ring]++
    },
    /** The values ring `ring` holds, in no order. */
    values: (ring: number) => data.subarray(ring * capacity, ring * capacity + filled[ring]),
    clear() {
      cursor.fill(0)
      filled.fill(0)
    },
  }
}

/** The slowest images of a window by total, sorted descending, each with its whole row. A sorted
 *  insertion rather than a heap: a few slots (ten by default) shift in place and read in order. */
export function createWorst(width: number, count: number) {
  const rows = new Float64Array(count * width),
    total = new Float64Array(count),
    frame = new Float64Array(count)
  let filled = 0
  return {
    file(row: Float64Array, at: number, ms: number) {
      if (filled === count && ms <= total[filled - 1]) return
      let slot = Math.min(filled, count - 1)
      while (slot > 0 && total[slot - 1] < ms) {
        total[slot] = total[slot - 1]
        frame[slot] = frame[slot - 1]
        rows.copyWithin(slot * width, (slot - 1) * width, slot * width)
        slot--
      }
      total[slot] = ms
      frame[slot] = at
      rows.set(row, slot * width)
      if (filled < count) filled++
    },
    read(names: readonly string[]) {
      const worst: Array<Record<string, number>> = []
      for (let w = 0; w < filled; w++) {
        const entry: Record<string, number> = { frame: frame[w] }
        for (let c = 0; c < width; c++) entry[names[c]] = rows[w * width + c]
        worst.push(entry)
      }
      return worst
    },
    clear() {
      filled = 0
    },
  }
}
