import { casterFeedBytes } from './casterFeed.ts'
import { shadowRootBytes } from './rootWords.ts'

/** GPU bytes the casters' shadow data takes at `roots` placements and `cap` candidates — the
 *  placements' words and what the diff remembers of them, the casters' list and decoded clusters —,
 *  as their buffers are sized: what the first frame a light casts makes, and what the shadows
 *  reserve for it before (`vsmReserveBytes`). */
export const shadowRowBytes = (roots: number, cap: number) =>
  shadowRootBytes(roots) + casterFeedBytes(cap)
