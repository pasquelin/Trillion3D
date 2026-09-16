import {
  clusterErrorPixels,
  maxStretch,
  multiplyMatrix4,
  transformAffinePoint,
} from '../sdk-core/index.ts';
import { copyElements, type MatrixElements } from './matrixElements.ts';

/** Everything the order needs from a cluster record; a superset of `PageRec`. */
export interface PriorityRecord {
  array?: Uint32Array;
  url: string;
  streamUrl?: string;
  lodError?: number;
  sphere?: number[];
  parentError?: number | null;
  parentSphere?: number[] | null;
  min: number[];
  max: number[];
  matrix: MatrixElements;
}
/** Ce que l'ordre lit de la caméra du moteur : sa vue et son plan proche, rien d'autre. */
export interface PriorityCamera {
  view: Float64Array;
  near: number;
}

/** Request priorities: the streamer serves the smallest number first. The root cover needs none of
 *  them — it is asked for on its own, before anything else is offered. */
export const PRIORITY_VISIBLE = 1,
  PRIORITY_PREFETCH = 3;

/** View-space centre of a sphere given in the space `view` maps from; the radius is carried along
 *  untouched, exactly as the selection does, and stretched by the caller where it is used. */
function project(view: ArrayLike<number>, sphere: ArrayLike<number>, out: Float64Array) {
  transformAffinePoint(out, view, sphere[0], sphere[1], sphere[2]);
  out[3] = sphere[3];
}
const centre = new Float64Array(4),
  bounds = new Float64Array(4),
  // La pose de l'hôte recopiée dans un tampon possédé : le produit du socle ne lit et n'écrit que
  // des `Float64Array` (`mathMatrix4.ts`). Seize nombres par matrice DISTINCTE, pas par fiche.
  worldMirror = new Float64Array(16);
/** Sphère `[x, y, z, r]` d'une boîte à six bornes : centre au milieu, rayon jusqu'au coin `max`. */
function boxSphere(
  out: Float64Array,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
) {
  out[0] = (x0 + x1) / 2;
  out[1] = (y0 + y1) / 2;
  out[2] = (z0 + z1) / 2;
  out[3] = Math.hypot(x1 - out[0], y1 - out[1], z1 - out[2]);
  return out;
}
function boundsSphere(record: PriorityRecord, out: Float64Array) {
  const { min, max } = record;
  return boxSphere(out, min[0], min[1], min[2], max[0], max[1], max[2]);
}

interface Slot {
  url: string;
  error: number;
  distance: number;
}
/**
 * Orders the bundles a frame is waiting on, most costly absence first.
 *
 * A missing cluster is drawn by a coarser stand-in, and the error of that stand-in is exactly the
 * screen error of the cluster that replaces it: that is what the viewer sees, so it is what decides
 * who is fetched first. At equal error the nearer bundle wins, because the camera is more likely to
 * keep looking at it. A bundle carries dozens of clusters and one request makes them all drawable,
 * so it inherits the worst error among the clusters it carries.
 */
export function orderPendingUrls(
  records: readonly PriorityRecord[],
  cam: PriorityCamera,
  pixelScale: readonly number[],
  into: string[],
): string[] {
  into.length = 0;
  const focal = Math.max(pixelScale[0], pixelScale[1]),
    near = cam.near;
  const slots = new Map<string, Slot>();
  const views = new Map<MatrixElements, { view: Float64Array; stretch: number }>();
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.array) continue;
    const key = record.streamUrl ?? record.url;
    let frame = views.get(record.matrix);
    if (!frame) {
      const view = new Float64Array(16);
      copyElements(worldMirror, record.matrix.elements);
      multiplyMatrix4(view, cam.view, worldMirror);
      frame = { view, stretch: maxStretch(view as unknown as readonly number[]) };
      views.set(record.matrix, frame);
    }
    const sphere = record.parentSphere ?? record.sphere;
    const error = record.parentError ?? record.lodError;
    let pixels: number, distance: number;
    if (sphere && sphere.length === 4) {
      project(frame.view, sphere, centre);
      pixels =
        error == null
          ? Infinity
          : clusterErrorPixels(
              error,
              frame.stretch,
              centre[0],
              centre[1],
              centre[2],
              centre[3],
              focal,
              near,
            );
      distance = Math.hypot(centre[0], centre[1], centre[2]);
    } else {
      // No cluster error: fall back on the screen footprint of the bounds, which orders the same way.
      pixels = boundsScreenRadius(record, frame.view, frame.stretch, focal, near);
      distance = Math.hypot(centre[0], centre[1], centre[2]);
    }
    const held = slots.get(key);
    if (!held) {
      slots.set(key, { url: key, error: pixels, distance });
      continue;
    }
    if (pixels > held.error || (pixels === held.error && distance < held.distance)) {
      held.error = pixels;
      held.distance = distance;
    }
  }
  if (slots.size === 0) return into;
  const ordered = [...slots.values()].sort((a, b) => b.error - a.error || a.distance - b.distance);
  for (let index = 0; index < ordered.length; index++) into.push(ordered[index].url);
  return into;
}
/**
 * Rayon écran, en pixels, de la boîte d'un enregistrement vu par `view`. C'est la mesure que la
 * priorité des textures emploie : ce que l'œil voit d'une surface, et non ce qu'elle porte de
 * triangles. Les tampons de travail sont ceux du module, réécrits sur place.
 */
export function boundsScreenRadius(
  record: Pick<PriorityRecord, 'min' | 'max'>,
  view: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
) {
  return sphereScreenRadius(
    boundsSphere(record as PriorityRecord, bounds),
    view,
    stretch,
    focal,
    near,
  );
}

/** Rayon écran, en pixels, d'une boîte monde à six bornes à plat vue par `view`. */
export function worldBoxScreenRadius(
  box: ArrayLike<number>,
  view: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
) {
  boxSphere(bounds, box[0], box[1], box[2], box[3], box[4], box[5]);
  return sphereScreenRadius(bounds, view, stretch, focal, near);
}

/** Rayon écran d'une sphère `[x, y, z, r]` vue par `view` ; `centre` garde la projection. */
function sphereScreenRadius(
  sphere: Float64Array,
  view: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
) {
  project(view, sphere, centre);
  const distance = Math.hypot(centre[0], centre[1], centre[2]);
  return (centre[3] * stretch * focal) / Math.max(distance, near);
}

/** Pixels par unité d'étendue en repère de vue à profondeur unité, d'une projection et d'un viewport. */
export function pixelScaleOf<T extends number[]>(
  projection: ArrayLike<number>,
  viewport: readonly number[] | undefined,
  into: T,
) {
  const width = viewport?.[0] ?? 1,
    height = viewport?.[1] ?? 1;
  into[0] = (width * Math.abs(projection[0])) / 2;
  into[1] = (height * Math.abs(projection[5])) / 2;
  return into;
}
