import type { PageRec } from '../../page/selection/selection.ts';
import { decodeGeometryPage, type DecodedGeometryPage } from '../../page/decode/geometryPage.ts';

/** A decoded position may leave the page's box by the page's own quantization error, no more. */
export function assertWithinBox(data: DecodedGeometryPage, rec: PageRec) {
  const positions = data.attributes.position,
    slack = 1e-5 + data.quantizationError;
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    if (positions[i] < rec.min[axis] - slack || positions[i] > rec.max[axis] + slack)
      throw new Error('AUTONOMOUS_PAGE_BOUNDS');
  }
}

/** Components of a decoded attribute, by name; anything else is a UV pair. */
const ITEM_SIZE: Record<string, number> = { position: 3, normal: 3, color: 4 };
export const itemSize = (name: string) => ITEM_SIZE[name] ?? 2;

/** The page `rec` draws: the one cut again for its class in session (`PageRec.recut`, #846),
 *  decoded once per store however many records share it, or else `read`, the page's own. */
export function pageOf(
  rec: PageRec,
  read: DecodedGeometryPage | undefined,
  decoded: Map<Uint8Array, DecodedGeometryPage>,
) {
  if (!rec.recut) return read!;
  let page = decoded.get(rec.recut);
  if (!page) decoded.set(rec.recut, (page = decodeGeometryPage(rec.recut)));
  return page;
}
