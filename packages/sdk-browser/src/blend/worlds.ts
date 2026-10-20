import { boxIsEmpty, boxTransform } from '../../../math/src/geometry/box.ts'
import { readHostBox } from '../scene/host/world/bounds.ts'
import type { BlendGpuItem } from './state.ts'

/** The local box an item's triangles lie in, six bounds into `out` from `at`: its pages' box
 *  (`pageBox`) when known, else its geometry's; false, `out` untouched, when it knows neither. */
function readItemBox(
  item: Pick<BlendGpuItem, 'pageBox' | 'sourceGeometry'>,
  out: Float64Array,
  at: number,
) {
  const local = item.sourceGeometry?.boundingBox
  if (item.pageBox) out.set(item.pageBox, at)
  else if (local) readHostBox(local, out, at)
  return !!(item.pageBox || local)
}

/**
 * World box of a transparent item, rebuilt from its LOCAL box (`readItemBox`) and the
 * matrix it carries — the source mesh's, never a snapshot. Nothing is baked at prepare: the
 * same function sets the first frame's box and the one that follows a move, so a box cannot
 * describe a placement other than the draw.
 *
 * `worldBox` is allocated once per item and never per frame. An empty or non-finite box drops
 * `bounds`: without a box, the frustum never rejects the item — a transparent does not vanish
 * because its bounds are doubtful.
 */
export function refreshBlendBounds(item: BlendGpuItem) {
  const box = item.worldBox
  if (!box) return
  if (!readItemBox(item, box, 0)) {
    item.bounds = undefined
    return
  }
  boxTransform(box, 0, box, 0, item.matrix.elements)
  item.bounds = !boxIsEmpty(box, 0) && box.every(Number.isFinite) ? box : undefined
}

/**
 * World boxes of the transparent list, refreshed when the scene's matrices have changed. The
 * matrices themselves are not copied: each item already reads its source mesh's. Returns the
 * number of items whose box was rebuilt.
 */
export function refreshBlendWorlds(items: readonly BlendGpuItem[]) {
  let repris = 0
  for (const item of items)
    if (item.worldBox) {
      refreshBlendBounds(item)
      repris++
    }
  return repris
}
