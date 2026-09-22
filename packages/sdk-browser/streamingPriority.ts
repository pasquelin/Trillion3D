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
/** What the order reads of the engine camera: its view, its near plane and its projection's
 *  clip-w weight (`EngineCamera.perspective`, 1 when absent), nothing else. */
export interface PriorityCamera {
  view: Float64Array;
  near: number;
  perspective?: number;
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
  // The host pose copied into an owned buffer: the base product only reads and writes
  // `Float64Array`s (`mathMatrix4.ts`). Sixteen numbers per DISTINCT matrix, not per record.
  worldMirror = new Float64Array(16);
/** Sphere `[x, y, z, r]` of a six-bound box, written at `at`: centre in the middle, radius to the corner. */
function boxSphere(
  out: Float64Array,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  at = 0,
) {
  out[at] = (x0 + x1) / 2;
  out[at + 1] = (y0 + y1) / 2;
  out[at + 2] = (z0 + z1) / 2;
  out[at + 3] = Math.hypot(x1 - out[at], y1 - out[at + 1], z1 - out[at + 2]);
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
    near = cam.near,
    perspective = cam.perspective ?? 1;
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
              perspective,
            );
      distance = Math.hypot(centre[0], centre[1], centre[2]);
    } else {
      // No cluster error: fall back on the screen footprint of the bounds, which orders the same way.
      const lens = [frame.stretch, focal, near, perspective] as const;
      pixels = sphereScreenRadius(boundsSphere(record, bounds), frame.view, ...lens);
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
/** Screen radius of a sphere `[x, y, z, r]` as seen by `view`, divided by the clip weight of its
 *  distance (1 under an orthographic projection); `centre` keeps the projection. */
function sphereScreenRadius(
  sphere: Float64Array,
  view: ArrayLike<number>,
  stretch: number,
  focal: number,
  near: number,
  perspective: number,
) {
  project(view, sphere, centre);
  const distance = Math.hypot(centre[0], centre[1], centre[2]);
  const w = perspective * distance + (1 - perspective);
  return (centre[3] * stretch * focal) / Math.max(w, perspective * near);
}

/** Pixels per unit of extent in view space at unit depth, from a projection and a viewport. */
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
