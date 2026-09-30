import { boxUnion, transformAffinePoint } from '../../../../sdk-core/src/index.ts';
import { hypot3 } from '../../../../sdk-core/src/math/primitives/hypot.ts';
import { rootOf, type PageRec } from '../../page/selection/selection.ts';
import type { Placements } from '../../page/selection/placements.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { forEachDirtyRun } from '../row/dirty.ts';
import { CLUSTER_SPHERE_FLOATS, clusterSpheres } from './rowBuffers.ts';

/**
 * World sphere of a cluster: the centre of its local box transformed by its root's world, and the
 * radius of the sphere circumscribed to the transformed box, overestimated term by term. It is an
 * overestimate, never an underestimate — a cluster is dropped only by being certainly outside the
 * volume.
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
    reach = root.reach ?? 0;
  const cx = (rec.min[0] + rec.max[0]) / 2,
    cy = (rec.min[1] + rec.max[1]) / 2,
    cz = (rec.min[2] + rec.max[2]) / 2;
  const hx = (rec.max[0] - rec.min[0]) / 2 + reach,
    hy = (rec.max[1] - rec.min[1]) / 2 + reach,
    hz = (rec.max[2] - rec.min[2]) / 2 + reach;
  transformAffinePoint(out, e, cx, cy, cz, base);
  out[base + 3] = hypot3(
    Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz,
    Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz,
    Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz,
  );
}

const sphereScratch = new Float32Array(CLUSTER_SPHERE_FLOATS);

/** Grows the flat box to the cluster's world sphere: an overestimate, never an underestimate. */
export function growClusterBox(rec: PageRec, roots: Placements, box: Float64Array, rank: number) {
  writeClusterSphere(rec, roots, sphereScratch, 0, rank);
  const [x, y, z, r] = sphereScratch;
  boxUnion(box, 0, x - r, y - r, z - r, x + r, y + r, z + r);
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
      base = row * CLUSTER_SPHERE_FLOATS;
    if (rec) writeClusterSphere(rec, roots, packed, base, rootOfRow(row));
    else packed[base + 3] = 0;
  }
  return packed;
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
    { casterSlots } = rt.layout.rows;
  if (lights.spheres && lights.spheres.rows === casterSlots) return lights.spheres;
  lights.spheres?.buffer.destroy();
  lights.spheres = clusterSpheres(device, casterSlots);
  return lights.spheres;
}

function uploadSphereRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  const spheres = rt.lights.spheres!;
  const { rows, selectionRoots, placement } = rt.layout;
  packClusterSpheres(
    rows.packedRecs,
    selectionRoots,
    spheres.packed,
    from,
    to,
    (row) => placement.rootOfPacked[rows.packedPageIndex[row]],
  );
  // Offset and size counted in floats: that is what `writeBuffer` expects of a typed array.
  rt.gpu.device!.queue.writeBuffer(
    spheres.buffer,
    from * CLUSTER_SPHERE_FLOATS * 4,
    spheres.packed,
    from * CLUSTER_SPHERE_FLOATS,
    (to - from + 1) * CLUSTER_SPHERE_FLOATS,
  );
}

/**
 * Writes the spheres of the rows the table declared dirty and pushes them run by run: a model whose
 * rows are scattered sends its own and none of the rows between them.
 */
export function uploadClusterSpheres(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const spheres = ensureClusterSpheres(rt, device),
    { rows } = rt.layout;
  forEachDirtyRun(
    rows.dirtyMarks,
    rows.dirtyFrom,
    Math.min(rows.dirtyTo, spheres.rows - 1),
    rt,
    uploadSphereRun,
  );
}
