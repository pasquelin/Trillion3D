import type { PageRec } from '../../page/selection/selection.ts'
import { FLAG_MASK, PAGE_INFO_STRIDE, VIS_TRIANGLE_BITS } from '../../visibility/buffer.ts'
import { NO_HIZ_SLOT } from './noHizSlot.ts'

/** Row word of the geometry's first vertex in the shared pools (`PageInfo.vertexBase`). */
export const ROW_VERTEX_BASE_WORD = 26,
  ROW_ID_BASE_WORD = 27,
  ROW_HIZ_SLOT_WORD = 31
/** Stamps rank `row` as the Hi-Z slot of the row at `base`, unless the row has none. */
export function restampHizSlot(ints: Uint32Array, base: number, row: number) {
  if (ints[base + ROW_HIZ_SLOT_WORD] !== NO_HIZ_SLOT) ints[base + ROW_HIZ_SLOT_WORD] = row
}
/** Row words of the colour map's atlas slot and of the material flags: what the shadow pass
 *  reads to cut a masked material, and so what a colour tile's arrival is matched against. */
export const ROW_MAP_LAYER_WORD = 22,
  ROW_FLAGS_WORD = 23
/** True when row `row` of the table `ints` is a cutout (`FLAG_MASK`): the bit `maskKeep` tests. */
export const rowCutout = (ints: Uint32Array, row: number) =>
  (ints[(row * PAGE_INFO_STRIDE) / 4 + ROW_FLAGS_WORD] & FLAG_MASK) !== 0
/** Row word of the surface's opacity, its colour factor's alpha (`PageInfo.blendCoverage`): the
 *  light a blended caster stops, and what a cutout multiplies its alpha by (`maskKeep`). */
export const ROW_BLEND_COVERAGE_WORD = 57
/** Declared volume transmission, read before replacing a caster row. */
export const ROW_TRANSMISSION_WORD = 38
/** Row word of the width a line page's quads widen to (`PageInfo.lineWidth`); zero for triangles. */
export const ROW_LINE_WIDTH_WORD = 61
/** Row words of a dashed line's dash and gap (`PageInfo.dash`, `lineDash`); zero on any other row. */
export const ROW_DASH_WORD = 28
/** Row words of a sprite's turn and size rule (`PageInfo.sprite`, `spriteAt`); zero on any other row. */
export const ROW_SPRITE_WORD = 36
/** Row word that carries the resolve class key (`PageInfo.materialClass`, `../../visibility/shader/materialClass.ts`). */
export const ROW_MATERIAL_CLASS_WORD = 63
/** Row word that holds how many indices the page draws: what the GPU reads to draw it, and so the
 *  only vertex count an image walk needs to reread. */
export const ROW_INDEX_WORDS = 25
/** Row word of the page's place in the geometry pool, in words (`PageInfo.pageOffset`): what a
 *  slot move writes again, the occupant kept (`writers.ts`, `replace`). */
export const ROW_OFFSET_WORD = 24
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
