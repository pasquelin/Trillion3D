// The spheres of rows `[from, to]` by the CPU's formula (`clusterSphere.ts`), the oracle the tests
// hold the rows pass's against: the engine keeps no CPU copy of them.
import type { PageRec } from '../../page/selection/types.ts'
import type { Placements } from '../../page/selection/placements.ts'
import { CLUSTER_SPHERE_FLOATS } from '../../gpu/shadow/sphereContract.ts'
import { writeClusterSphere } from './clusterSphere.ts'

/** Writes the spheres of rows `[from, to]` into `packed`; a row without a record takes a zero
 *  radius. */
export function packClusterSpheres(
  packedRecs: ArrayLike<PageRec | undefined>,
  roots: Placements,
  packed: Float32Array,
  from: number,
  to: number,
  rootOfRow: (row: number) => number,
) {
  for (let row = from; row <= to; row++) {
    const rec = packedRecs[row],
      base = row * CLUSTER_SPHERE_FLOATS
    if (rec) writeClusterSphere(rec, roots, packed, base, rootOfRow(row))
    else packed.fill(0, base, base + CLUSTER_SPHERE_FLOATS)
  }
  return packed
}
