import { transformAffinePoint } from '../sdk-core/index.ts';
import type { PageRec } from './pageSelection.ts';
import type { WebgpuLightState } from './webgpuPagesStateLights.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Flottants d'une sphère monde de cluster : centre puis rayon. */
const CLUSTER_SPHERE_FLOATS = 4;

/**
 * La sphère monde d'un cluster : le centre de sa boîte locale transformé par sa matrice monde, et
 * le rayon de la sphère circonscrite à la boîte transformée, majoré terme à terme. C'est un
 * majorant, jamais un minorant — un cluster n'est écarté qu'en étant certainement hors du volume.
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

/** Écrit les sphères des lignes `[from, to]` ; une ligne sans fiche prend un rayon nul. */
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
 * La sphère monde de chaque ligne dessinable, dans l'ordre des lignes de la table de pages.
 *
 * C'est la seule donnée géométrique dont la passe d'ombres a besoin pour écarter un cluster : sa
 * sphère contre la portée d'une lampe et contre le cône d'une face. Elle est écrite exactement sur
 * l'intervalle de lignes que la table de pages vient de déclarer sale — une ligne déplacée, une
 * ligne réécrite, un nœud déplacé — et jamais autrement : une image sans changement n'écrit rien.
 */
function ensureClusterSpheres(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights } = rt,
    { drawSlots } = rt.layout;
  if (lights.spheres && lights.spheres.rows === drawSlots) return lights.spheres;
  lights.spheres?.buffer.destroy();
  const buffer = device.createBuffer({
    label: 'WG cluster spheres v1',
    size: Math.max(1, drawSlots) * CLUSTER_SPHERE_FLOATS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const packed = new Float32Array(drawSlots * CLUSTER_SPHERE_FLOATS);
  lights.spheres = { buffer, packed, rows: drawSlots };
  return lights.spheres;
}

/** Écrit les sphères des lignes `[from, to]` et pousse exactement cet intervalle au GPU. */
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
  // Décalage et taille comptés en flottants : c'est ce que `writeBuffer` attend d'un tableau typé.
  device.queue.writeBuffer(
    spheres.buffer,
    from * CLUSTER_SPHERE_FLOATS * 4,
    spheres.packed,
    from * CLUSTER_SPHERE_FLOATS,
    (last - from + 1) * CLUSTER_SPHERE_FLOATS,
  );
}

const sphereScratch = new Float32Array(CLUSTER_SPHERE_FLOATS),
  boxMin = [0, 0, 0],
  boxMax = [0, 0, 0];

/**
 * Une page entre dans la résidence ou en sort : la géométrie du monde a changé là où elle est, donc
 * les cartes d'ombre des lampes dont la portée touche cette boîte ne décrivent plus la scène et
 * redeviennent candidates. Sans cela, une carte en cache continuerait d'afficher l'ombre d'un
 * cluster parti, ou d'ignorer celle d'un cluster arrivé. La boîte déclarée est celle de la sphère
 * monde du cluster : un majorant, jamais un minorant.
 */
export function noteResidenceChange(lights: WebgpuLightState, rec: PageRec) {
  const { store, plan } = lights;
  if (!store.count) return;
  writeClusterSphere(rec, sphereScratch, 0);
  const radius = sphereScratch[3];
  for (let axis = 0; axis < 3; axis++) {
    boxMin[axis] = sphereScratch[axis] - radius;
    boxMax[axis] = sphereScratch[axis] + radius;
  }
  plan.worldChanged(boxMin, boxMax);
}
