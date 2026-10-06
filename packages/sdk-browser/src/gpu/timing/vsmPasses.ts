/**
 * The passes the virtual shadow maps encode in a frame, whatever the chunks: the invalidation, the
 * page addresses, the marking (`vsm/markingPass.ts`: the clears of the request flags, the receiver
 * masks, the page table and the page flags, then the rects, the coarse pages and the pixels), the
 * page allocations, the raster's candidates, the transmission's clear, bin (its candidates and
 * every chunk in one pass) and resolve, the post-render and the projection
 * (`webgpu/pages/render/vsm/vsmEncode.ts`).
 */
const VSM_FIXED_PASSES = 1 + 1 + 7 + 1 + 1 + 3 + 1 + 1
/** Passes of one chunk of rows: its cull and its raster, in the opaque draw (`vsm/renderPass.ts`);
 *  the transmission's chunks run inside its bin pass (`vsm/transmissionPass.ts`). */
const VSM_CHUNK_PASSES = 2
/**
 * Chunks a frame is timed whole over. A chunk is at most `VSM_RENDER_PAIR_CAPACITY / pages` rows
 * (`vsm/renderPass.ts`, `renderChunking`: 1 024 at the default 2 048 pages), so 256 chunks hold
 * 262 144 rows even where no bound shrinks them. The row table has no bound, so a frame past it is
 * not proven to fit: its image is flagged truncated (`encoder.ts`), never mistimed.
 */
const VSM_TIMED_CHUNKS = 256
/** Passes the virtual shadow maps time at most in a frame. */
export const VSM_TIMED_PASSES = VSM_FIXED_PASSES + VSM_CHUNK_PASSES * VSM_TIMED_CHUNKS
