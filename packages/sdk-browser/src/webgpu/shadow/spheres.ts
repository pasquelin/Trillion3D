import { writeSplitDouble } from '../../../../math/src/float/splitDouble.ts'
import { boxUnion, transformAffinePoint } from '../../../../sdk-core/src/index.ts'
import { sphereRadius } from '../../placement/rowSphere.ts'
import { boxCenter } from '../../../../math/src/geometry/box.ts'
import { rootOf, type PageRec } from '../../page/selection/selection.ts'
import type { Placements } from '../../page/selection/placements.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { CLUSTER_SPHERE_FLOATS, clusterSpheres } from './rowBuffers.ts'
import { rowBox, rowGrowth } from '../../hiz/corners.ts'
import { rootOfPacked } from '../../page/selection/placements.ts'

/**
 * World sphere of a cluster: the centre of its local box transformed by its root's world, and the
 * radius of the sphere about it that holds the transformed box (`../../placement/rowSphere.ts`, the
 * formula the rows pass evaluates). A dynamic page's box is where its vertices are this
 * frame (`moved`); another grows by its root's deformation reach.
 */
function writeClusterSphere(
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

const centreScratch = new Float64Array(3)
const extentScratch = new Float64Array(3)
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

/** Writes the spheres of rows `[from, to]`; a row without a record takes a zero radius. */
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

/**
 * World sphere of every caster row — the drawable rows, then the blended casters' —, in page-table
 * row order: the only geometric datum the shadow pass needs to drop a cluster, its sphere against
 * a light's range and against a face's cone. The rows pass writes the buffer
 * (`../../placement/rowWordsPass.ts`), for every row whose root moved or which was written; made
 * here at the table's caster rows while a light casts.
 */
export function ensureClusterSpheres(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights } = rt,
    { casterSlots } = rt.layout.rows
  if (lights.spheres && lights.spheres.rows === casterSlots) return lights.spheres
  lights.spheres?.buffer.destroy()
  lights.spheres = clusterSpheres(device, casterSlots)
  return lights.spheres
}

/**
 * The CPU copy of rows `[from, to]`'s spheres (`spheres.packed`), what the shadow raster sizes its
 * chunks from (`../../vsm/rowPageBound.ts`), made by the one sphere formula from the world a CPU
 * reader reads, while a light casts: the run is noted for the bins to follow (`closeSphereCopies`).
 * The buffer is the GPU's, the copy a reader's, and neither is written by the other.
 */
export function copyClusterSpheres(rt: WebgpuPagesRuntime, from: number, to: number) {
  const { spheres, rowsFollowed } = rt.lights
  if (!spheres || !rowsFollowed) return
  const last = Math.min(to, spheres.rows - 1)
  if (last < from) return
  ;(spheres.writing ??= []).push(from, last)
  const { rows, selectionRoots, placement } = rt.layout
  packClusterSpheres(rows.packedRecs, selectionRoots, spheres.packed, from, last, (row) =>
    rootOfPacked(placement, rows.packedPageIndex[row]),
  )
}

/** The runs copied since the last close, a new `written` epoch over them when any:
 *  `../../vsm/rowPageBound.ts` re-bins those rows alone. */
export function closeSphereCopies(rt: WebgpuPagesRuntime) {
  const spheres = rt.lights.spheres
  if (!spheres?.writing) return
  spheres.written = { epoch: spheres.written.epoch + 1, runs: spheres.writing }
  spheres.writing = undefined
}
