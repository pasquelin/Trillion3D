import { boxCenter, boxRadius, boxUnionBox } from '../../../../math/src/geometry/box.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { worldSpaceRanks } from '../../frame/render/hiddenFromViews.ts'
import { rootWorldBox } from '../../geometry/selection/rootWorld.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** The union's box, scratch, and its centre. */
const union = new Float64Array(6)
const centre = new Float64Array(3)

/**
 * THE SPHERE THAT HOLDS THE FIRST-PERSON STAND-INS, in the world (`ReflectionView.firstPerson`), into the four numbers of `out` as `[x, y, z, radius]`: the union of the
 * bounds of every root marked `WORLD_SPACE_ROOT` that is placed and shown, a root's bound being its world box (`rootWorldBox`) and the sphere about
 * it. Two bounds are added as a box and a sphere both: the box of the two, its centre the sphere's, and for radius the box's own sphere or, if it is
 * less, the farthest reach of the two spheres from that centre. One sphere for the scene, whatever the view: the stand-ins lie close together. The
 * radius is 0 when the scene has none.
 *
 * The ranks of the marked roots are the views' (`worldSpaceRanks`); the boxes are read each image, a stand-in following its first-person object.
 */
export function firstPersonBoundsOf(rt: WebgpuPagesRuntime, out: Float64Array): Float64Array {
  const roots = rt.layout.selectionRoots
  out[0] = out[1] = out[2] = out[3] = 0
  let have = false
  for (const rank of worldSpaceRanks(rt)) {
    const root = roots[rank]!,
      box = root.parked || root.hidden ? undefined : rootWorldBox(root)
    if (!box) continue
    const radius = boxRadius(box)
    boxCenter(centre, 0, box[0]!, box[1]!, box[2]!, box[3]!, box[4]!, box[5]!)
    if (have) {
      const ox = out[0]!,
        oy = out[1]!,
        oz = out[2]!,
        before = out[3]!
      boxUnionBox(union, 0, box)
      boxCenter(out, 0, union[0]!, union[1]!, union[2]!, union[3]!, union[4]!, union[5]!)
      const cx = out[0]!,
        cy = out[1]!,
        cz = out[2]!
      out[3] = clamp(
        length3(centre[0]! - cx, centre[1]! - cy, centre[2]! - cz) + radius,
        length3(ox - cx, oy - cy, oz - cz) + before,
        boxRadius(union),
      )
    } else {
      union.set(box)
      out[0] = centre[0]!
      out[1] = centre[1]!
      out[2] = centre[2]!
      out[3] = radius
      have = true
    }
  }
  return out
}
