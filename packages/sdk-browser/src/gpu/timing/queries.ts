import { PART_ALIGN } from './encoder.ts'
import { VSM_TIMED_PASSES } from './vsmPasses.ts'

/** Encoders an image is timed over. */
export const PARTS = 4
/** Passes of an image outside the virtual shadow maps, every encoder together. */
const IMAGE_PASSES = 256
/**
 * Passes an image times at most: its own, and the virtual shadow maps' (`./vsmPasses.ts`) — the
 * frame is timed whole, its shadow milliseconds among them.
 * The timestamps take as many query sets as they need, one resolve buffer and a readback per image
 * in flight (`READBACKS`, `encoder.ts`).
 */
export const TIMED_PASSES = IMAGE_PASSES + VSM_TIMED_PASSES
/** Aligned runs of timestamps an image takes before its padding runs out: each part's first, and
 *  one each time a part's passes resume after another part's (`encoder.ts`), once a part. */
const RUNS = 2 * PARTS
/** Timestamps: a pair per pass, and each run's start aligned for its resolve. */
export const QUERY_COUNT = 2 * TIMED_PASSES + RUNS * PART_ALIGN
