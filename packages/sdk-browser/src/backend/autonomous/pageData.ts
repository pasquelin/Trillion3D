import type { PageRec } from '../../page/selection/selection.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';

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
