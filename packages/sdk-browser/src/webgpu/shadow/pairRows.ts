import { KEPT_ROW_BYTES as ROW_BYTES } from '../../gpu/shadow/keptList.ts';
import { storageBufferCap } from '../../residency/pools.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_GPU_PAGES_PER_FRAME } from '../../gpu/shadow/batchBudget.ts';

/** Bytes of a kept pair: its region, its row. */
const PAIR_BYTES = 8;
/** Rows asked at once: a need growing pair by pair asks the device rarely. */
const ROW_STEP = 64;

/** Pairs the kept list holds per page of the pool, sized once with it and never grown (#831), as
 *  the reference engine's culling buffers are fixed (`a reference setting`): a page's texels over the
 *  32 a kept cluster covers at least. A page past them waits, whole, for the host. */
const PAIRS_PER_PAGE = (SHADOW_PAGE * SHADOW_PAGE) / 32;

/** The pairs the GPU draws at most a frame, for a pool of `pages` pages: its pair list's fixed
 *  size. A frame maps at most `SHADOW_GPU_PAGES_PER_FRAME` pages: a list of the whole pool's pairs
 *  (1.3 million, 10.6 MB at 2 601 pages) held what no frame draws (#831). */
export const poolPairs = (pages: number) =>
  Math.min(pages, SHADOW_GPU_PAGES_PER_FRAME) * PAIRS_PER_PAGE;

/** Pairs a kept list of `rows` rows a region holds. */
export const keptPairs = (rows: number) => Math.floor((rows * ROW_BYTES) / PAIR_BYTES);

/** The rows a region of the kept list holds: the table's `casterSlots`, or more for the GPU pages'
 *  `need` pairs — by `ROW_STEP` —, never past what one storage binding holds. */
export function keptRows(casterSlots: number, need: number, limits?: GPUSupportedLimits) {
  const asked = ROW_STEP * Math.ceil((need * PAIR_BYTES) / (ROW_BYTES * ROW_STEP));
  return Math.max(casterSlots, Math.min(asked, Math.floor(storageBufferCap(limits) / ROW_BYTES)));
}
