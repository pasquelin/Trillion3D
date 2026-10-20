import { boxEmpty, boxTransform, boxUnion } from '../../../../math/src/geometry/box.ts'
import { transformPointRow } from '../../../../math/src/vector/vector.ts'
import { clipPixelX, clipPixelY } from '../../../../math/src/projection/clip.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'
import { rootWorldBox } from '../../page/selection/rootWorld.ts'
import { movedPagesBox, rootLocalBound } from '../pages/render/movedGeometry.ts'

/** A clip `w` at or under which a corner lies on or behind the eye: its rectangle is unbounded. */
const NEAR_W = 1e-6

const union = new Float64Array(6),
  local = new Float64Array(6),
  carried = new Float64Array(6)

/** Unites into `union` the world box `root` may draw in: its world box as the engine keeps it
 *  (`rootWorldBox`), or, for a root whose pages moved or whose deformation reaches past them, its
 *  local bound (`rootLocalBound`) carried by its world. False for a root with no box. */
function uniteRoot(root: ClusterRoot<PageRec>) {
  if (!rootLocalBound(local, root)) return false
  let from: ArrayLike<number> | undefined =
    !movedPagesBox(root.pages) && !root.reach ? rootWorldBox(root) : undefined
  if (!from) {
    boxTransform(carried, 0, local, 0, root.world.elements)
    from = carried
  }
  boxUnion(union, 0, from[0], from[1], from[2], from[3], from[4], from[5])
  return true
}

/**
 * The world box the roots `ranks[0..count)` of `roots` may draw in, into `out` (six bounds): the
 * union of each one's (`uniteRoot`). False when one has no box: they may draw anywhere. It moves
 * with the scene, never with the view: a camera that moves reprojects it alone (`boxRect`).
 */
export function rootsBox(
  out: Float64Array,
  roots: readonly ClusterRoot<PageRec>[],
  ranks: readonly number[],
  count: number,
) {
  boxEmpty(union, 0)
  for (let k = 0; k < count; k++) if (!uniteRoot(roots[ranks[k]])) return false
  out.set(union)
  return true
}

/**
 * The display rectangle world box `box` covers through `viewProj` onto a `width × height`
 * display, into `out` as `[x0, y0, x1, y1]` pixels, clamped to it; none (a box unbounded), or a
 * corner on or behind the eye, takes the whole display; a rectangle of no area means nothing of it
 * shows. Conservative: what lies in the box projects inside. Allocates nothing.
 */
export function boxRect(
  out: Float64Array,
  box: Float64Array | undefined,
  viewProj: ArrayLike<number>,
  width: number,
  height: number,
) {
  if (!box) return whole(out, width, height)
  out[0] = out[1] = Infinity
  out[2] = out[3] = -Infinity
  for (let i = 0; i < 8; i++) {
    const x = box[i & 1 ? 3 : 0],
      y = box[i & 2 ? 4 : 1],
      z = box[i & 4 ? 5 : 2]
    const w = transformPointRow(viewProj, 3, x, y, z)
    if (!(w > NEAR_W)) return whole(out, width, height)
    const px = clipPixelX(transformPointRow(viewProj, 0, x, y, z), w, width),
      py = clipPixelY(transformPointRow(viewProj, 1, x, y, z), w, height)
    out[0] = Math.min(out[0], px)
    out[1] = Math.min(out[1], py)
    out[2] = Math.max(out[2], px)
    out[3] = Math.max(out[3], py)
  }
  out[0] = Math.max(0, Math.floor(out[0]))
  out[1] = Math.max(0, Math.floor(out[1]))
  out[2] = Math.min(width, Math.ceil(out[2]))
  out[3] = Math.min(height, Math.ceil(out[3]))
  return out
}

function whole(out: Float64Array, width: number, height: number) {
  out[0] = out[1] = 0
  out[2] = width
  out[3] = height
  return out
}
