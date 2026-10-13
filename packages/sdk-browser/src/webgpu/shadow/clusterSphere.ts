import { writeSplitDouble } from '../../../../math/src/float/splitDouble.ts'
import { transformAffinePoint } from '../../../../sdk-core/src/index.ts'
import { sphereRadius } from '../../placement/rowSphere.ts'
import { boxCenter } from '../../../../math/src/geometry/box.ts'
import { rootOf, type PageRec } from '../../page/selection/selection.ts'
import type { Placements } from '../../page/selection/placements.ts'
import { rowBox, rowGrowth } from '../../hiz/corners.ts'

const centreScratch = new Float64Array(3)
const extentScratch = new Float64Array(3)

/**
 * World sphere of a cluster, written at `base` of `out` as the spheres' buffer holds it (centre high,
 * radius, centre low, pad): the centre of its local box transformed by its root's world, and the
 * radius of the sphere about it that holds the transformed box (`../../placement/rowSphere.ts`, the
 * formula the rows pass evaluates). A dynamic page's box is where its vertices are this
 * frame (`moved`); another grows by its root's deformation reach. What a CPU change box reads
 * (`growClusterBox`); the GPU's spheres are the rows pass's alone.
 */
export function writeClusterSphere(
  rec: PageRec,
  roots: Placements,
  out: Float32Array,
  base: number,
  rank: number,
) {
  const root = rootOf(roots, rank),
    e = root.world.elements,
    { min, max } = rowBox(rec),
    reach = rowGrowth(rec, root.reach)
  const c = centreScratch,
    h = extentScratch
  boxCenter(c, 0, min[0], min[1], min[2], max[0], max[1], max[2])
  for (let axis = 0; axis < 3; axis++) h[axis] = (max[axis] - min[axis]) / 2 + reach
  const radius = sphereRadius(e, c, h)
  transformAffinePoint(c, e, c[0], c[1], c[2], 0)
  for (let axis = 0; axis < 3; axis++)
    writeSplitDouble(out, base + axis, base + 4 + axis, centreScratch[axis])
  out[base + 3] = radius
  out[base + 7] = 0
}
