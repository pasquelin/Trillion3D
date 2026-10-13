import { boxCornersInto } from '../../../sdk-core/src/index.ts'
import type { HizPage } from './types.ts'
import type { MatrixElements } from '../host/matrixElements.ts'

export const HIZ_BOUNDS_VALUES = 6

/** Doubles one box occupies in the world-corner layout: eight corners of three coordinates. */
export const BOX_CORNER_VALUES = 24
/** The box `page`'s row is bounded by this frame: a dynamic page's where its vertices are
 *  (`moved`), else its own, which grows by `rowGrowth`. */
export const rowBox = (page: HizPage) => page.moved ?? page
/** How far `rowBox` grows on every side: nothing for a dynamic page's moved box, else its root's
 *  `reach`, the farthest a deformation moved a vertex from where its page is bounded. */
export const rowGrowth = (page: HizPage, reach = 0) => (page.moved ? 0 : reach)

/**
 * World-space corners of `page`'s box, written in `out` from `at`: eight corners of three doubles,
 * derived from its local bounds and the `world` of its root on every read, as the GPU partition receives
 * them per row. Nothing is kept per page — a host table of every packed page cost 24 doubles each
 * —, and the arithmetic is `projectBoxInto`'s (`projection.fixture.ts`), so the doubles are the
 * same bit for bit. A
 * dynamic page's box is where its vertices are this frame (`moved`); another grows by its
 * root's `reach` on every side, the farthest a deformation moved a vertex from where its page is
 * bounded, as every cut and sphere grows it: an occlusion test of the rest box would reject a page
 * whose moved triangles show past its occluder.
 */
export function pageCornersInto(
  out: Float64Array,
  at: number,
  page: HizPage,
  world: MatrixElements,
  reach = 0,
) {
  const { min, max } = rowBox(page)
  reach = rowGrowth(page, reach)
  boxCornersInto(
    out,
    at,
    min[0] - reach,
    min[1] - reach,
    min[2] - reach,
    max[0] + reach,
    max[1] + reach,
    max[2] + reach,
    world.elements,
  )
}
