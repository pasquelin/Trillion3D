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
 * formula the compose rows pass evaluates). A dynamic page's box is where its vertices are this
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
 * row order.
 *
 * That is the only geometric datum the shadow pass needs to drop a cluster: its sphere against a
 * light's range and against a face's cone. It is written exactly on the rows the page table just
 * declared dirty — a moved row, a rewritten row, a moved node — and never otherwise: an image
 * with no change writes nothing.
 */
function ensureClusterSpheres(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights } = rt,
    { casterSlots } = rt.layout.rows
  if (lights.spheres && lights.spheres.rows === casterSlots) return lights.spheres
  lights.spheres?.buffer.destroy()
  lights.spheres = clusterSpheres(device, casterSlots)
  return lights.spheres
}

/**
 * The spheres the compose rows pass rewrites for the rows of roots linked to a parent
 * (`../../placement/gpuCompose.ts`), from the inputs each row keeps (`composedRowInputs.ts`).
 * Undefined while no light casts: no sphere is read.
 */
export function linkedRowSpheres(rt: WebgpuPagesRuntime) {
  const spheres = rt.lights.spheres
  if (!spheres || spheres.rows === 0) return undefined
  return spheres
}

function uploadSphereRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  const spheres = rt.lights.spheres!
  ;(spheres.writing ??= []).push(from, to)
  const { rows, selectionRoots, placement } = rt.layout
  packClusterSpheres(rows.packedRecs, selectionRoots, spheres.packed, from, to, (row) =>
    rootOfPacked(placement, rows.packedPageIndex[row]),
  )
  // Offset and size counted in floats: that is what `writeBuffer` expects of a typed array.
  rt.gpu.device!.queue.writeBuffer(
    spheres.buffer,
    from * CLUSTER_SPHERE_FLOATS * 4,
    spheres.packed,
    from * CLUSTER_SPHERE_FLOATS,
    (to - from + 1) * CLUSTER_SPHERE_FLOATS,
  )
}

/**
 * Writes the spheres of the rows the table declared dirty and pushes them run by run: a model whose
 * rows are scattered sends its own and none of the rows between them. An upload that writes rows
 * starts a new `written` epoch over them.
 */
export function uploadClusterSpheres(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const spheres = ensureClusterSpheres(rt, device),
    { rows } = rt.layout
  rows.forEachDirtyRun(rt, uploadSphereRun, spheres.rows - 1)
  // The runs it wrote, a new epoch when any: `vsm/rowPageBound.ts` re-bins those rows alone.
  if (spheres.writing) {
    spheres.written = { epoch: spheres.written.epoch + 1, runs: spheres.writing }
    spheres.writing = undefined
  }
}
