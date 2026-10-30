import { SURFACE_CLOSURE_OFFSET_BITS } from './surfaceOutputs.ts'
import { MAX_CLOSURES } from '../../../../sdk-core/src/world/material/graph/closures.ts'

/**
 * The closure offsets word of a pixel whose `count` closures are stored one slice after the other, as the reference packs it:
 * the first closure's slice in the low four bits (slice 0), then for each
 * closure after it the step from the previous closure's slice, four bits each, eight closures in thirty-two bits (a ninth is not packed).
 * A reader finds the slice of closure `i` by summing the first `i + 1` entries (`UnpackClosureOffsetAtIndex`), and counts a pixel's closures
 * by the entries that are not zero (`closureTilesWgsl.ts`).
 */
export function closureOffsetsOf(count: number) {
  let word = 0
  for (let i = 1; i < Math.min(count, MAX_CLOSURES); i++)
    word |= 1 << (SURFACE_CLOSURE_OFFSET_BITS * i)
  return word >>> 0
}
