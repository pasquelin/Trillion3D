import { KEPT_ROW_BYTES as ROW_BYTES } from '../../gpu/shadow/keptList.ts';
import { storageBufferCap } from '../../residency/pools.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowPagesPerFrame } from '../../gpu/shadow/batchBudget.ts';

/** Bytes of a kept pair: its region, its row. */
const PAIR_BYTES = 8;
/** Rows asked at once: a need growing pair by pair asks the device rarely. */
const ROW_STEP = 64;

/** Pairs the kept list holds per page of the pool, sized once with it and never grown (#831), as
 *  the reference engine's culling buffers are fixed (`a reference setting`): a page's texels over the
 *  32 a kept cluster covers at least. A page past them waits, whole, for the host. */
const PAIRS_PER_PAGE = (SHADOW_PAGE * SHADOW_PAGE) / 32;

/** The pairs the GPU draws at most a frame, for a pool of `pages` pages: its pair list's fixed
 *  size, the pages a frame maps at most (`shadowPagesPerFrame`) — the grant's, never a scene's
 *  (#831). */
export const poolPairs = (pages: number) => shadowPagesPerFrame(pages) * PAIRS_PER_PAGE;

/** Pairs a kept list of `rows` rows a region holds. */
export const keptPairs = (rows: number) => Math.floor((rows * ROW_BYTES) / PAIR_BYTES);

/** The rows `need` pairs take in a region of the kept list, by `ROW_STEP`. */
const rowsFor = (need: number) =>
  ROW_STEP * Math.ceil((need * PAIR_BYTES) / (ROW_BYTES * ROW_STEP));

/** The rows a region of the kept list gives the pairs of a pool of `pages` pages (`poolPairs`):
 *  their share of the shadows' bytes, whether grown for them or shared with the table's caster
 *  rows (`followPairBytes`). */
export const pairRows = (pages: number) => rowsFor(poolPairs(pages));

/** Bytes of `rows` rows of the kept lists the pairs are held in: the cull's, the occlusion test's
 *  (`occlusion`, made with the static layer), and the raster bins' — `binStride` words a row, a row
 *  and, stored, its matrix (`../../gpu/shadow/bins.ts`). One formula for the setting
 *  (`poolSetting.ts`) and the bytes held (`followPairBytes`). */
export const keptListBytes = (rows: number, binStride: number, occlusion = true) =>
  rows * ROW_BYTES * (1 + (occlusion ? 1 : 0) + binStride);

/** The rows a region of the kept list holds: the table's `casterSlots`, or more for the GPU pages'
 *  `need` pairs — by `ROW_STEP` —, never past what one storage binding holds. */
export function keptRows(casterSlots: number, need: number, limits?: GPUSupportedLimits) {
  const cap = Math.floor(storageBufferCap(limits) / ROW_BYTES);
  return Math.max(casterSlots, Math.min(rowsFor(need), cap));
}
