import { DAG_MAX_VIEWS } from '../dag/shader/viewsWgsl.ts';

/** Passes of one shadow batch at most: its light cut's three, a region cull per face under the CPU
 *  cut, then the static layer, the page pyramids, the occlusion, the atlas and the transmittance. */
export const SHADOW_BATCH_PASSES = 3 + DAG_MAX_VIEWS + 5;
