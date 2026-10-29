/**
 * WHICH PIXEL THE DEBUG PIXEL'S READING IS OF (`debugPixel.ts`): the reading comes back some images late, so the table it feeds must not be drawn from one of another pixel (the cursor
 * moved) or from one the kernel has not repeated (the pass drew at half resolution, where the kernel does not run). The kernel leaves the pixel it read in the first two floats of what it
 * found; a reading is fresh when those are the pixel last asked.
 */
export function trackPixelReading() {
  let x = -1
  let y = -1
  let asking = false
  let fresh = false
  return {
    /** Notes the pixel asked this image; whether it is not the one asked before, a reading of it to be taken at once. */
    ask(px: number, py: number) {
      const moved = !asking || px !== x || py !== y
      if (moved) fresh = false
      x = px
      y = py
      asking = true
      return moved
    },
    /** A reading of `found` (its first two floats the pixel the kernel read) has come back. */
    landed(found: ArrayLike<number>) {
      fresh = asking && found[0] === x && found[1] === y
    },
    /** The kernel does not run just now: no reading held says what the pixel is. */
    forget() {
      fresh = false
      asking = false
    },
    /** Whether the reading held is of the pixel asked last. */
    get fresh() {
      return fresh
    },
  }
}
