import {
  ceilFloat32,
  writeSplitDouble,
} from '../../../../sdk-core/src/math/primitives/splitDouble.ts'
import { boxUnion, transformAffinePoint } from '../../../../sdk-core/src/index.ts'
import { hypot3 } from '../../../../sdk-core/src/math/primitives/hypot.ts'
import { rootOf, type PageRec } from '../../page/selection/selection.ts'
import type { Placements } from '../../page/selection/placements.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { forEachDirtyRun } from '../row/dirty.ts'
import { CLUSTER_SPHERE_FLOATS, clusterSpheres } from './rowBuffers.ts'
import { rowBox, rowGrowth } from '../../hiz/corners.ts'
import { packDoubles } from '../../placement/composedMotion.ts'

/**
 * World sphere of a cluster: the centre of its local box transformed by its root's world, and the
 * radius of the sphere circumscribed to the transformed box, overestimated term by term. It is an
 * overestimate, never an underestimate — a cluster is dropped only by being certainly outside the
 * volume. A dynamic page's box is where its vertices are this frame (`moved`, #573); another grows
 * by its root's deformation reach.
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
  const cx = (min[0] + max[0]) / 2,
    cy = (min[1] + max[1]) / 2,
    cz = (min[2] + max[2]) / 2
  const hx = (max[0] - min[0]) / 2 + reach,
    hy = (max[1] - min[1]) / 2 + reach,
    hz = (max[2] - min[2]) / 2 + reach
  transformAffinePoint(centreScratch, e, cx, cy, cz, 0)
  let centreError = 0
  for (let axis = 0; axis < 3; axis++) {
    writeSplitDouble(out, base + axis, base + 4 + axis, centreScratch[axis])
    centreError += (centreScratch[axis] - (out[base + axis] + out[base + 4 + axis])) ** 2
  }
  const radius = hypot3(
    Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz,
    Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz,
    Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz,
  )
  out[base + 3] = ceilFloat32(radius + Math.sqrt(centreError))
  out[base + 7] = 0
}

const centreScratch = new Float64Array(3)
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
  lights.spheres?.local?.destroy()
  lights.spheres = clusterSpheres(device, casterSlots)
  return lights.spheres
}

/** Words of a row's local box (`clusterSpheres`' `local`): six doubles, each two words. */
const LOCAL_BOX_WORDS = 12
const localScratch = new Float64Array(6)

/** Writes the local boxes of rows `[from, to]` — centre, then half extent grown by the reach, as
 *  `writeClusterSphere` derives them —; a row without a record takes a zero box. */
function packLocalBoxes(rt: WebgpuPagesRuntime, out: Uint32Array, from: number, to: number) {
  const { rows, selectionRoots, placement } = rt.layout
  for (let row = from; row <= to; row++) {
    const rec = rows.packedRecs[row],
      base = row * LOCAL_BOX_WORDS
    if (!rec) {
      out.fill(0, base, base + LOCAL_BOX_WORDS)
      continue
    }
    const root = rootOf(selectionRoots, placement.rootOfPacked[rows.packedPageIndex[row]]),
      { min, max } = rowBox(rec),
      reach = rowGrowth(rec, root.reach)
    for (let axis = 0; axis < 3; axis++) {
      localScratch[axis] = (min[axis] + max[axis]) / 2
      localScratch[3 + axis] = (max[axis] - min[axis]) / 2 + reach
    }
    packDoubles(out, base, localScratch)
  }
}

/** Sends the local boxes of rows `[from, to]`, once they are kept. */
function uploadLocalBoxes(rt: WebgpuPagesRuntime, from: number, to: number) {
  const { local, localPacked } = rt.lights.spheres!
  if (!local || !localPacked) return
  packLocalBoxes(rt, localPacked, from, to)
  rt.gpu.device!.queue.writeBuffer(
    local,
    from * LOCAL_BOX_WORDS * 4,
    localPacked,
    from * LOCAL_BOX_WORDS,
    (to - from + 1) * LOCAL_BOX_WORDS,
  )
}

/**
 * The spheres the compose rows pass rewrites for the rows of roots linked to a parent
 * (`../../placement/gpuCompose.ts`), with each row's local box it makes them from: the boxes are
 * kept from the first frame a parent composes rows while a light casts — every row once, then the
 * rows each upload writes. Undefined while no light casts: no sphere is read.
 */
export function linkedRowSpheres(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const spheres = rt.lights.spheres
  if (!spheres || spheres.rows === 0) return undefined
  if (!spheres.local) {
    spheres.localPacked = new Uint32Array(spheres.rows * LOCAL_BOX_WORDS)
    spheres.local = device.createBuffer({
      label: 'Trillion3D cluster local boxes',
      size: spheres.localPacked.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    uploadLocalBoxes(rt, 0, spheres.rows - 1)
  }
  return spheres as typeof spheres & { local: GPUBuffer }
}

function uploadSphereRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  const spheres = rt.lights.spheres!
  ;(spheres.writing ??= []).push(from, to)
  const { rows, selectionRoots, placement } = rt.layout
  packClusterSpheres(
    rows.packedRecs,
    selectionRoots,
    spheres.packed,
    from,
    to,
    (row) => placement.rootOfPacked[rows.packedPageIndex[row]],
  )
  uploadLocalBoxes(rt, from, to)
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
  forEachDirtyRun(
    rows.dirtyMarks,
    rows.dirtyFrom,
    Math.min(rows.dirtyTo, spheres.rows - 1),
    rt,
    uploadSphereRun,
  )
  // The runs it wrote, a new epoch when any: `vsm/rowPageBound.ts` re-bins those rows alone.
  if (spheres.writing) {
    spheres.written = { epoch: spheres.written.epoch + 1, runs: spheres.writing }
    spheres.writing = undefined
  }
}
