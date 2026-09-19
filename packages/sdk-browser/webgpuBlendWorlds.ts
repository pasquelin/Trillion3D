import { boxIsEmpty, boxTransform } from '../sdk-core/index.ts';
import { readThreeBox } from './threeBounds.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

/**
 * World box of a transparent item, rebuilt from the LOCAL box of its geometry and the
 * matrix it carries — the source mesh's, never a snapshot. Nothing is baked at prepare: the
 * same function sets the first frame's box and the one that follows a move, so a box cannot
 * describe a placement other than the draw.
 *
 * `worldBox` is allocated once per item and never per frame. An empty or non-finite box drops
 * `bounds`: without a box, the frustum never rejects the item — a transparent does not vanish
 * because its bounds are doubtful.
 */
export function refreshBlendBounds(item: BlendGpuItem) {
  const box = item.worldBox;
  if (!box) return;
  const local = item.sourceGeometry.boundingBox;
  if (!local) {
    item.bounds = undefined;
    return;
  }
  readThreeBox(box, local);
  boxTransform(box, 0, box, 0, item.matrix.elements);
  item.bounds = !boxIsEmpty(box, 0) && box.every(Number.isFinite) ? box : undefined;
}

/**
 * World boxes of the transparent list, refreshed when the scene's matrices have changed. The
 * matrices themselves are not copied: each item already reads its source mesh's. Returns the
 * number of items whose box was rebuilt.
 */
export function refreshBlendWorlds(items: readonly BlendGpuItem[]) {
  let repris = 0;
  for (const item of items)
    if (item.worldBox) {
      refreshBlendBounds(item);
      repris++;
    }
  return repris;
}
