/**
 * THE SLOTS WISHED AND NOT SHOWN, counted as they switch: the HLOD cells (`worldFollow.ts`) and the
 * cell files (`worldFiles.ts`). None left, everything within range shows its own content — what
 * the session's first image waits for (`../../../frame/loop/firstImage.ts`).
 */

/** The count over `slots` slots, none counted at first. */
export function createUnshown(slots: number) {
  const flags = new Uint8Array(slots)
  let count = 0
  return {
    /** Slot `at` wished and not shown (`short`), or not. */
    set(at: number, short: boolean) {
      const bit = short ? 1 : 0
      if (flags[at] === bit) return
      flags[at] = bit
      count += short ? 1 : -1
    },
    /** Whether no slot is wished and not shown. */
    get none() {
      return count === 0
    },
    /** Bytes of its host table. */
    get byteLength() {
      return flags.byteLength
    },
  }
}
