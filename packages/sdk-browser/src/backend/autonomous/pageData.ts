import type { PageRec } from '../../page/selection/selection.ts'
import { decodeGeometryPage, type DecodedGeometryPage } from '../../page/decode/geometryPage.ts'

/** A decoded position may leave the page's box by the page's own quantization error, no more. */
export function assertWithinBox(data: DecodedGeometryPage, rec: PageRec) {
  const positions = data.attributes.position,
    slack = 1e-5 + data.quantizationError
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3
    if (positions[i] < rec.min[axis] - slack || positions[i] > rec.max[axis] + slack)
      throw new Error('AUTONOMOUS_PAGE_BOUNDS')
  }
}

/** Components of a decoded attribute, by name; anything else is a UV pair. A skin's joints and
 * weights are four; the morph displacements six a target, the targets side by side. */
const ITEM_SIZE: Record<string, number> = {
  position: 3,
  normal: 3,
  color: 4,
  skinIndex: 4,
  skinWeight: 4,
  morph: 6,
}
export const itemSize = (name: string) => ITEM_SIZE[name] ?? 2

/** Each page cut again for its class, decoded once for as long as a record holds its bytes. */
const recutPages = new WeakMap<Uint8Array, DecodedGeometryPage>()

/** The page `rec` draws: the one cut again for its class in session (`PageRec.recut`),
 *  decoded once however many records share it or turn resident again, or else `read`. */
export function pageOf(rec: PageRec, read: DecodedGeometryPage | undefined) {
  if (!rec.recut) return read!
  let page = recutPages.get(rec.recut)
  if (!page) recutPages.set(rec.recut, (page = decodeGeometryPage(rec.recut)))
  return page
}
