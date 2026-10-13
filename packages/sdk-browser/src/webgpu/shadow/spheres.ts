import { boxUnion } from '../../../../sdk-core/src/index.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { Placements } from '../../page/selection/placements.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { createCastChanges, spheresMadeAnew } from './castChanges.ts'
import { clusterSpheres } from './rowBuffers.ts'
import { CLUSTER_SPHERE_FLOATS } from '../../gpu/shadow/sphereContract.ts'
import { writeClusterSphere } from './clusterSphere.ts'

const sphereScratch = new Float32Array(CLUSTER_SPHERE_FLOATS)

/** Grows the flat box to the cluster's world sphere: an overestimate, never an underestimate. */
export function growClusterBox(rec: PageRec, roots: Placements, box: Float64Array, rank: number) {
  writeClusterSphere(rec, roots, sphereScratch, 0, rank)
  const x = sphereScratch[0] + sphereScratch[4],
    y = sphereScratch[1] + sphereScratch[5],
    z = sphereScratch[2] + sphereScratch[6],
    r = sphereScratch[3]
  boxUnion(box, 0, x - r, y - r, z - r, x + r, y + r, z + r)
}

/**
 * World sphere of every caster row — the drawable rows, then the blended casters' —, in page-table
 * row order: the only geometric datum the shadow pass needs to drop a cluster, its sphere against
 * a light's range and against a face's cone. The rows pass writes the buffer
 * (`../../placement/rowWordsPass.ts`), for every row whose root moved or which was written; made
 * here at the table's caster rows while a light casts, with the list the rows pass appends the
 * rows' shadow changes to (`castChanges.ts`).
 */
export function ensureClusterSpheres(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights } = rt,
    { casterSlots } = rt.layout.rows
  lights.casts ??= createCastChanges(device)
  if (lights.spheres && lights.spheres.rows === casterSlots) return lights.spheres
  lights.spheres?.buffer.destroy()
  lights.spheres = clusterSpheres(device, casterSlots)
  spheresMadeAnew(lights)
  return lights.spheres
}
