import { PART_ALIGN } from './encoder.ts'
import { VSM_TIMED_PASSES } from './vsmPasses.ts'

/** Encoders an image is timed over. */
export const PARTS = 4
/** Passes of an image outside the virtual shadow maps, every encoder together. */
const IMAGE_PASSES = 256
/**
 * Passes an image times at most: its own, and the virtual shadow maps' (`./vsmPasses.ts`) — the
 * frame is timed whole, so its shadow milliseconds and their cull and raster split are published.
 * The timestamps take as many query sets as they need, one resolve buffer and a readback per image
 * in flight (`READBACKS`, `encoder.ts`).
 */
export const TIMED_PASSES = IMAGE_PASSES + VSM_TIMED_PASSES
/** Timestamps: a pair per pass, and each part's start aligned for its resolve. */
export const QUERY_COUNT = 2 * TIMED_PASSES + PARTS * PART_ALIGN
