import { clusterErrorPixels, maxStretch } from '../sdk-core/index.ts';
import type * as THREE from 'three';

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
  matrix: THREE.Matrix4;
}
export interface PriorityCamera {
  matrixWorldInverse: THREE.Matrix4;
  near: number;
}

/** Request priorities: the streamer serves the smallest number first. The root cover needs none of
 *  them — it is asked for on its own, before anything else is offered. */
export const PRIORITY_VISIBLE = 1,
  PRIORITY_PREFETCH = 3;

function composeView(view: Float64Array, camera: ArrayLike<number>, world: ArrayLike<number>) {
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += camera[k * 4 + row] * world[column * 4 + k];
      view[column * 4 + row] = sum;
    }
}
/** View-space centre of a sphere given in the space `view` maps from; the radius is carried along
 *  untouched, exactly as the selection does, and stretched by the caller where it is used. */
function project(view: ArrayLike<number>, sphere: ArrayLike<number>, out: Float64Array) {
  const cx = sphere[0],
    cy = sphere[1],
    cz = sphere[2];
  out[0] = view[0] * cx + view[4] * cy + view[8] * cz + view[12];
  out[1] = view[1] * cx + view[5] * cy + view[9] * cz + view[13];
  out[2] = view[2] * cx + view[6] * cy + view[10] * cz + view[14];
  out[3] = sphere[3];
}
const centre = new Float64Array(4),
  bounds = new Float64Array(4);
function boundsSphere(record: PriorityRecord, out: Float64Array) {
  out[0] = (record.min[0] + record.max[0]) / 2;
  out[1] = (record.min[1] + record.max[1]) / 2;
  out[2] = (record.min[2] + record.max[2]) / 2;
  out[3] = Math.hypot(record.max[0] - out[0], record.max[1] - out[1], record.max[2] - out[2]);
  return out;
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
  camera: PriorityCamera,
  pixelScale: readonly number[],
  into: string[],
): string[] {
  into.length = 0;
  const focal = Math.max(pixelScale[0], pixelScale[1]),
    near = camera.near;
  const slots = new Map<string, Slot>();
  const views = new Map<THREE.Matrix4, { view: Float64Array; stretch: number }>();
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.array) continue;
    const key = record.streamUrl ?? record.url;
    let frame = views.get(record.matrix);
    if (!frame) {
      const view = new Float64Array(16);
      composeView(view, camera.matrixWorldInverse.elements, record.matrix.elements);
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
      project(frame.view, boundsSphere(record, bounds), centre);
      distance = Math.hypot(centre[0], centre[1], centre[2]);
      pixels = (centre[3] * frame.stretch * focal) / Math.max(distance, near);
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
/** Pixels per unit of view-space extent at unit depth, from a camera and its viewport. */
export function pixelScaleOf(
  camera: { projectionMatrix: THREE.Matrix4 },
  viewport: readonly number[] | undefined,
  into: number[],
) {
  const width = viewport?.[0] ?? 1,
    height = viewport?.[1] ?? 1;
  into[0] = (width * Math.abs(camera.projectionMatrix.elements[0])) / 2;
  into[1] = (height * Math.abs(camera.projectionMatrix.elements[5])) / 2;
  return into;
}
