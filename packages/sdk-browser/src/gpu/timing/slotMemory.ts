/**
 * The timestamp each slot held when the last image was read. A pass the driver skips (an empty
 * one) writes nothing, and its slots still hold what an earlier image's pass wrote there, or zero
 * where none did: a timestamp read again is not a time of this image. One timestamp is compared,
 * never the pair: a render pass begun at its vertex stage can leave its beginning behind while its
 * end is new, and that half is no pass's time either (`sample.ts`). Values are compared, not placed
 * on the device's timeline: a device that overlaps passes begins this image's before the last one's
 * end (`sample.ts`, `setOwnShares`), so a timestamp before that end can be a new one.
 */
export function createSlotMemory(size: number) {
  const held = new BigUint64Array(size)
  let latest = -Infinity
  return {
    /**
     * The reader of image `frame`'s timestamps: whether the one at a slot is the one it held, which
     * no pass of this image wrote; it then holds this image's. An image read after a later one
     * compares nothing — the slots hold the later image's timestamps, not those it could have
     * skipped.
     */
    read(frame: number) {
      const current = frame > latest
      if (current) latest = frame
      return (slot: number, value: bigint) => {
        if (!current) return false
        const unchanged = held[slot] === value
        held[slot] = value
        return unchanged
      }
    },
  }
}

/** Whether the timestamp at `slot` is the one it held, so no pass of this image wrote it
 *  (`createSlotMemory`). */
export type Stale = ReturnType<ReturnType<typeof createSlotMemory>['read']>
