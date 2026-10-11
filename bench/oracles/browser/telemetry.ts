// Pure A14 oracles, no side effects: the telemetry bench measures them; unit tests import
// them as reference.

/** `telemetry.ts:24-33`: `push` then `shift` of the whole array. */
export function referenceIntervals(max: number, valeurs: number[]) {
  const intervals: number[] = []
  for (const dt of valeurs)
    if (dt > 0 && dt < 1000) {
      intervals.push(dt)
      if (intervals.length > max) intervals.shift()
    }
  return intervals
}

/** The independent oracle of `hexOfBytes` and `sha256Hex` (`sha256Hex.test.ts`): one `toString` per byte, written apart on purpose. */
export const referenceHex = (digested: Uint8Array) =>
  Array.from(digested, (b: number) => b.toString(16).padStart(2, '0')).join('')
