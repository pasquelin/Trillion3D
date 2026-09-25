import { PART_ALIGN } from './encoder.ts';
import { MAX_SHADOW_BATCHES } from '../shadow/batchBudget.ts';
import { DAG_MAX_VIEWS } from '../dag/shader/viewsWgsl.ts';

/** Encoders an image is timed over. */
export const PARTS = 4;
/** Passes of one shadow batch at most: its light cut's three, a region cull per face under the CPU
 *  cut, then the static layer, the page pyramids, the occlusion, the atlas and the transmittance. */
export const SHADOW_BATCH_PASSES = 3 + DAG_MAX_VIEWS + 5;
/** Passes of an image outside its shadow batches, every encoder together. */
const IMAGE_PASSES = 256;
/**
 * Passes an image times at most: its own, and those of the most shadow batches a frame draws
 * (`../shadow/batchBudget.ts`) — the frame that redraws the largest pool is timed whole, never
 * truncated, so its shadow milliseconds and their cull and raster split are published. The
 * timestamps take as many query sets as they need, one resolve and one readback buffer.
 */
export const TIMED_PASSES = IMAGE_PASSES + MAX_SHADOW_BATCHES * SHADOW_BATCH_PASSES;
/** Timestamps: a pair per pass, and each part's start aligned for its resolve. */
export const QUERY_COUNT = 2 * TIMED_PASSES + PARTS * PART_ALIGN;
