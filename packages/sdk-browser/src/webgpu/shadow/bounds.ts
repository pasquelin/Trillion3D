import { boxEmpty, boxUnion, transformAffinePoint } from '../../../../sdk-core/src/index.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Floats of a cluster world sphere: centre then radius. */
const CLUSTER_SPHERE_FLOATS = 4;

/**
 * World sphere of a cluster: the centre of its local box transformed by its world matrix, and the
 * radius of the sphere circumscribed to the transformed box, overestimated term by term. It is an
 * overestimate, never an underestimate — a cluster is dropped only by being certainly outside the
 * volume.
 */
function writeClusterSphere(rec: PageRec, out: Float32Array, base: number) {
  const e = rec.matrix.elements;
  const cx = (rec.min[0] + rec.max[0]) / 2,
    cy = (rec.min[1] + rec.max[1]) / 2,
    cz = (rec.min[2] + rec.max[2]) / 2;
  const hx = (rec.max[0] - rec.min[0]) / 2,
    hy = (rec.max[1] - rec.min[1]) / 2,
    hz = (rec.max[2] - rec.min[2]) / 2;
  transformAffinePoint(out, e, cx, cy, cz, base);
  out[base + 3] = Math.hypot(
    Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz,
    Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz,
    Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz,
  );
}

/** Writes the spheres of rows `[from, to]`; a row without a record takes a zero radius. */
export function packClusterSpheres(
  packedRecs: ArrayLike<PageRec | undefined>,
  packed: Float32Array,
  from: number,
  to: number,
) {
  for (let row = from; row <= to; row++) {
    const rec = packedRecs[row],
      base = row * CLUSTER_SPHERE_FLOATS;
    if (rec) writeClusterSphere(rec, packed, base);
    else packed[base + 3] = 0;
  }
  return packed;
}

/**
 * World sphere of every drawable row, in page-table row order.
 *
 * That is the only geometric datum the shadow pass needs to drop a cluster: its sphere against a
 * light's range and against a face's cone. It is written exactly on the row interval the page table
 * just declared dirty — a moved row, a rewritten row, a moved node — and never otherwise: an image
 * with no change writes nothing.
 */
function ensureClusterSpheres(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights } = rt,
    { drawSlots } = rt.layout;
  if (lights.spheres && lights.spheres.rows === drawSlots) return lights.spheres;
  lights.spheres?.buffer.destroy();
  const buffer = device.createBuffer({
    label: 'Trillion3D cluster spheres v1',
    size: Math.max(1, drawSlots) * CLUSTER_SPHERE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const packed = new Float32Array(drawSlots * CLUSTER_SPHERE_FLOATS);
  lights.spheres = { buffer, packed, rows: drawSlots };
  return lights.spheres;
}

/** Writes the spheres of rows `[from, to]` and pushes exactly that interval to the GPU. */
export function uploadClusterSpheres(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  from: number,
  to: number,
) {
  const spheres = ensureClusterSpheres(rt, device);
  const last = Math.min(to, spheres.rows - 1);
  if (last < from) return;
  packClusterSpheres(rt.layout.rows.packedRecs, spheres.packed, from, last);
  // Offset and size counted in floats: that is what `writeBuffer` expects of a typed array.
  device.queue.writeBuffer(
    spheres.buffer,
    from * CLUSTER_SPHERE_FLOATS * 4,
    spheres.packed,
    from * CLUSTER_SPHERE_FLOATS,
    (last - from + 1) * CLUSTER_SPHERE_FLOATS,
  );
}

/**
 * Mobility word of rows `[from, to]` — 1 for a row whose placement moves — pushed on the same dirty
 * interval as the spheres, and every row once when a placement turns moving: what the page cull
 * splits a page's casters by, static layer or moving casters.
 */
export function uploadRowMobility(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  from: number,
  to: number,
) {
  const { lights, layout } = rt,
    { drawSlots, rows, selectionRoots } = layout;
  const { mobility } = lights;
  mobility.ensure(selectionRoots.length, drawSlots);
  if (!lights.mobilityRows || lights.mobilityRows.size !== mobility.rowWords.byteLength) {
    lights.mobilityRows?.destroy();
    lights.mobilityRows = device.createBuffer({
      label: 'Trillion3D shadow row mobility v1',
      size: mobility.rowWords.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    from = 0;
    to = drawSlots - 1;
  }
  const buffer = lights.mobilityRows;
  mobility.writeRows(
    (row) => rows.packedRecs[row]?.placementIndex ?? -1,
    drawSlots,
    from,
    to,
    (first, count) => device.queue.writeBuffer(buffer, first * 4, mobility.rowWords, first, count),
  );
}

const sphereScratch = new Float32Array(CLUSTER_SPHERE_FLOATS);

/** Grows the flat box to the cluster's world sphere: an overestimate, never an underestimate. */
export function growClusterBox(rec: PageRec, box: Float64Array) {
  writeClusterSphere(rec, sphereScratch, 0);
  const [x, y, z, r] = sphereScratch;
  boxUnion(box, 0, x - r, y - r, z - r, x + r, y + r, z + r);
}

/** One flat world box and its two halves, allocated once: what a change is declared with. */
export const changeBox = new Float64Array(6),
  changeMin = changeBox.subarray(0, 3),
  changeMax = changeBox.subarray(3, 6);

/**
 * A page entered residency or left it since the last plan: the scene is drawn at another
 * precision where it is, so the shadow maps of lights whose range touches this box
 * no longer describe it exactly and become candidates again — once the camera rests, since
 * the change is one of representation, not of the world. Without that, a settled map would
 * keep the shadow of a cluster that left, or ignore that of a cluster that arrived (#159). The
 * declared box is that of the cluster's world sphere.
 */
export function noteResidenceChange(lights: WebgpuLightState, rec: PageRec) {
  const { store, plan } = lights;
  if (!store.count) return;
  boxEmpty(changeBox, 0);
  growClusterBox(rec, changeBox);
  plan.representationChanged(changeMin, changeMax);
}
