import type { PageRec } from '../../page/selection/selection.ts'
import { FLAG_MASK, ROW_WORDS } from '../../visibility/types.ts'
import { VIS_TRIANGLE_BITS } from '../../visibility/visWords.ts'
import { NO_HIZ_SLOT } from './noHizSlot.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'

/** Stamps rank `row` as the Hi-Z slot of the row at `base`, unless the row has none. */
export function restampHizSlot(ints: Uint32Array, base: number, row: number) {
  if (ints[base + PAGE_INFO.at.hizSlot] !== NO_HIZ_SLOT) ints[base + PAGE_INFO.at.hizSlot] = row
}
/** True when row `row` of the table `ints` is a cutout (`FLAG_MASK`): the bit `maskKeep` tests. */
export const rowCutout = (ints: Uint32Array, row: number) =>
  (ints[row * ROW_WORDS + PAGE_INFO.at.flags] & FLAG_MASK) !== 0
/**
 * Identifier base of a page-table row: its rank shifted by the triangle bits, leaving zero free for
 * the background. The first write of a row and the compact that moves it both rest on it; two writes
 * of the same value, one formula.
 */
export const packedRowBase = (row: number) => ((row + 1) << VIS_TRIANGLE_BITS) >>> 0
/** A cluster holds the geometry a row draws: its own quantized page, or its primitive's positions,
 *  which the float vertex pool holds (`../core/geometryPool.ts`). Without either, it takes no row. */
export const rowHasGeometry = (rec: PageRec) => !!rec.geometryPage || !!rec.attributes.position
/** Corners the row draws: the count the cluster's own geometry page declares, or the length of the
 *  index page for a cluster that still draws from one. A paged cluster never holds an index page —
 *  nothing fetches it — and this is the only number the row ever wanted from it. */
export const rowIndexCount = (rec: PageRec) =>
  rec.geometryPage?.indexCount ?? rec.array?.length ?? 0
