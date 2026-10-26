import { VSM_MAX_VIEW_PASSES } from '../../lighting/shadows/vsm/render/renderViewPasses.ts'

/**
 * The passes the virtual shadow maps encode in a frame: the invalidation and the rows' changes'
 * (`../../lighting/shadows/vsm/invalidation/castInvalidation.ts`), the page addresses, the marking
 * (`lighting/shadows/vsm/markingPass.ts`: the clears of the request flags, the receiver masks, the page table and the
 * page flags, then the rects, the coarse pages and the pixels), the page allocations, the
 * occlusion pyramid's last build (`lighting/shadows/vsm/occlusion/occlusionPass.ts`), the
 * post-render and the projection (`lighting/shadows/vsm/frame/vsmEncode.ts`).
 */
const VSM_FIXED_PASSES = 2 + 1 + 7 + 1 + 1 + 1 + 1
/** Passes of one view pass of the raster: its cull and its raster
 *  (`lighting/shadows/vsm/render/renderPass.ts`), the candidates in the first cull's, and with the
 *  occlusion culling the pyramid's build, the second cull and the second raster. */
const VSM_VIEW_PASS_PASSES = 5
/** Passes the virtual shadow maps time at most in a frame: those of each of the most view passes a
 *  frame takes (`lighting/shadows/vsm/render/renderViewPasses.ts`). */
export const VSM_TIMED_PASSES = VSM_FIXED_PASSES + VSM_VIEW_PASS_PASSES * VSM_MAX_VIEW_PASSES
