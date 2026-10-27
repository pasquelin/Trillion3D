import { boxUnion } from '../../../../../math/src/geometry/box.ts'
import type { PageRec } from '../../../geometry/selection/types.ts'
import type { Placements } from '../../../geometry/selection/placements.ts'
import { CLUSTER_SPHERE_FLOATS } from '../sphereContract.ts'
import { writeClusterSphere } from './clusterSphere.ts'

const sphereScratch = new Float32Array(CLUSTER_SPHERE_FLOATS)

/** Grows the flat box to the cluster's world sphere: an overestimate, never an underestimate. What
 *  a change the CPU declares is boxed by (a cell's switch, a surface). */
export function growClusterBox(rec: PageRec, roots: Placements, box: Float64Array, rank: number) {
  writeClusterSphere(rec, roots, sphereScratch, 0, rank)
  const x = sphereScratch[0] + sphereScratch[4],
    y = sphereScratch[1] + sphereScratch[5],
    z = sphereScratch[2] + sphereScratch[6],
    r = sphereScratch[3]
  boxUnion(box, 0, x - r, y - r, z - r, x + r, y + r, z + r)
}
