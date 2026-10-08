import { boxCornersInto } from '../../../sdk-core/src/index.ts'
import { transformPointRow } from '../../../math/src/vector/vector.ts'
import type { HizPage } from './types.ts'
import type { MatrixElements } from '../host/matrixElements.ts'

export const HIZ_BOUNDS_VALUES = 6

/** Doubles one box occupies in the world-corner layout: eight corners of three coordinates. */
export const BOX_CORNER_VALUES = 24
/** Screen AABB of eight world-space corners. Term for term the arithmetic of the one-shot path. */
export function projectCornersInto(
  corners: Float64Array,
  from: number,
  viewElements: ArrayLike<number>,
  viewProjElements: ArrayLike<number>,
  near: number,
  width: number,
  height: number,
  into: Float64Array,
  base: number,
) {
  let lowX = Infinity,
    lowY = Infinity,
    highX = -Infinity,
    highY = -Infinity,
    // In reverse-Z, the NEAREST corner is the one whose depth is the GREATEST: the bound the
    // occlusion test compares is therefore a maximum.
    nearestZ = -Infinity,
    clipsNear = false,
    projected = 0
  const v = viewElements,
    e = viewProjElements
  // An affine view — fourth row (0,0,0,1) — yields a denominator of exactly 1 for a finite
  // corner: the dot product is then not computed, and `viewZ * 1` is `viewZ`.
  const affine = v[3] === 0 && v[7] === 0 && v[11] === 0 && v[15] === 1
  // A perspective projection has fourth row (0,0,-1,0), of which `multiplyMatrices` makes
  // exactly the opposite of the view's third row: `cw` is then `-viewZ` to the bit — negation
  // is exact and `(-a) + (-b)` equals `-(a + b)` —, one fewer dot product per corner. Any
  // projection, orthographic or oblique, falls back on the product.
  const mirrored = e[3] === -v[2] && e[7] === -v[6] && e[11] === -v[10] && e[15] === -v[14]
  for (let i = 0; i < 8; i++) {
    const at = from + i * 3,
      x = corners[at],
      y = corners[at + 1],
      z = corners[at + 2]
    const viewZ = transformPointRow(v, 2, x, y, z)
    const vd = affine ? 1 : transformPointRow(v, 3, x, y, z)
    if (-(vd === 1 ? viewZ : viewZ * (1 / vd)) <= near) {
      // The result of a box that clips the near plane reads no corner: nothing to project.
      clipsNear = true
      break
    }
    const cw = mirrored ? -viewZ : transformPointRow(e, 3, x, y, z)
    if (cw <= 0 || !Number.isFinite(cw)) {
      clipsNear = true
      break
    }
    const ndcX = transformPointRow(e, 0, x, y, z) / cw,
      ndcY = transformPointRow(e, 1, x, y, z) / cw,
      ndcZ = transformPointRow(e, 2, x, y, z) / cw
    if (ndcX < lowX) lowX = ndcX
    if (ndcX > highX) highX = ndcX
    if (ndcY < lowY) lowY = ndcY
    if (ndcY > highY) highY = ndcY
    if (ndcZ > nearestZ) nearestZ = ndcZ
    projected++
  }
  if (!projected || clipsNear) {
    into[base] = 0
    into[base + 1] = 0
    into[base + 2] = 0
    into[base + 3] = 0
    into[base + 4] = 0
    into[base + 5] = 1
    return
  }
  // The NDC-to-screen passage is monotonic coordinate by coordinate — increasing in x,
  // decreasing in y: the extremum of the image is the image of the extremum, to the bit. The
  // four conversions happen once per box instead of twenty-four. Depth itself is already in
  // `[0, 1]`: the engine projection never leaves it otherwise (`../camera/depthConvention.ts`).
  into[base] = Math.floor((lowX * 0.5 + 0.5) * width)
  into[base + 1] = Math.floor((1 - (highY * 0.5 + 0.5)) * height)
  into[base + 2] = Math.ceil((highX * 0.5 + 0.5) * width)
  into[base + 3] = Math.ceil((1 - (lowY * 0.5 + 0.5)) * height)
  into[base + 4] = nearestZ
  into[base + 5] = 0
}
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
