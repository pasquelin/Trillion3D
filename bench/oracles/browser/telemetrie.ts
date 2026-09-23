// Pure A14 oracles, no side effects: the telemetry bench measures them; unit tests import
// them as reference.

/** `telemetry.ts:24-33` before batch A: `push` then `shift` of the whole array. */
export function referenceIntervals(max: number, valeurs: number[]) {
  const intervals: number[] = [];
  for (const dt of valeurs)
    if (dt > 0 && dt < 1000) {
      intervals.push(dt);
      if (intervals.length > max) intervals.shift();
    }
  return intervals;
}

/** `clusterPages.ts:12-15` and `streamingFetch.ts:4-7` before batch A: one `toString` per byte. */
export const referenceHex = (digested: Uint8Array) =>
  Array.from(digested, (b: number) => b.toString(16).padStart(2, '0')).join('');
