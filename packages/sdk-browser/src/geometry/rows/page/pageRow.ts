import type { PageRec } from '../../selection/types.ts'
import { FLAG_MASK, FLAG_VOXEL, ROW_WORDS } from '../../../visibility/types.ts'
import { VIS_TRIANGLE_BITS } from '../../../visibility/visWords.ts'
import { PAGE_INFO } from '../../../visibility/pageInfo.ts'
import { BIN_KIND, type BinKind } from '../../../visibility/draw/contract.ts'

/** The kind of row `row` of the table `ints` (`BIN_KIND`): voxel bricks (`FLAG_VOXEL`), whose boxes
 *  trace their voxels and write their depth (`vis_voxel_fs`); a cutout (`FLAG_MASK`), the bit
 *  `maskKeep` tests; or opaque. */
export function rowKind(ints: Uint32Array, row: number): BinKind {
  const flags = ints[row * ROW_WORDS + PAGE_INFO.at.flags]
  if (flags & FLAG_VOXEL) return BIN_KIND.VOXEL
  return flags & FLAG_MASK ? BIN_KIND.CUTOUT : BIN_KIND.OPAQUE
}
/**
 * Identifier base of a page-table row: its rank shifted by the triangle bits, leaving zero free for
 * the background. The first write of a row and the compact that moves it both rest on it; two writes
 * of the same value, one formula.
 */
export const packedRowBase = (row: number) => ((row + 1) << VIS_TRIANGLE_BITS) >>> 0
/** A cluster holds the geometry a row draws: its own quantized page, or its primitive's positions,
 *  which the float vertex pool holds (`../../pages/pool/geometryPool.ts`). Without either, it takes no row. */
export const rowHasGeometry = (rec: PageRec) => !!rec.geometryPage || !!rec.attributes.position
/** Corners the row draws: the count the cluster's own geometry page declares, or the length of the
 *  index page for a cluster that still draws from one. A paged cluster never holds an index page —
 *  nothing fetches it — and this is the only number the row ever wanted from it. */
export const rowIndexCount = (rec: PageRec) =>
  rec.geometryPage?.indexCount ?? rec.array?.length ?? 0
