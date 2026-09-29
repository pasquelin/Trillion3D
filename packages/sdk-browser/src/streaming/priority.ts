import {
  clusterErrorPixels,
  maxStretch,
  multiplyMatrix4,
  transformAffinePoint,
} from '../../../sdk-core/src/index.ts';
import { clipWeight } from '../../../sdk-core/src/math/primitives/camera.ts';
import { copyElements } from '../math/matrixElements.ts';
import { hypot3 } from '../../../sdk-core/src/math/primitives/hypot.ts';
import { rootOf, type Placements } from '../page/selection/placements.ts';
import {
  begin,
  createPendingScratch,
  note,
  sortInto,
  viewSlot,
  type PendingScratch,
} from './pendingOrder.ts';

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
  /** Rank of the root whose world places it (`rootOf`). */
  placementIndex?: number;
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
  // `Float64Array`s (`packages/sdk-core/src/math/matrix/matrix4.ts`). Sixteen numbers per DISTINCT matrix, not per record.
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
  out[at + 3] = hypot3(x1 - out[at], y1 - out[at + 1], z1 - out[at + 2]);
  return out;
}
function boundsSphere(record: PriorityRecord, out: Float64Array) {
  const { min, max } = record;
  return boxSphere(out, min[0], min[1], min[2], max[0], max[1], max[2]);
}

/** The storage every call reuses, frame after frame (`pendingOrder.ts`). */
const shared = createPendingScratch();
/**
 * Orders the bundles a frame is waiting on, most costly absence first.
 *
 * A missing cluster is drawn by a coarser stand-in, and the error of that stand-in is exactly the
 * screen error of the cluster that replaces it: that is what the viewer sees, so it is what decides
 * who is fetched first. At equal error the nearer bundle wins, because the camera is more likely to
 * keep looking at it. A bundle carries dozens of clusters and one request makes them all drawable,
 * so it inherits the worst error among the clusters it carries. The storage is `scratch`'s, kept
 * across calls: a frame no larger than an earlier one allocates nothing.
 */
export function orderPendingUrls(
  records: readonly PriorityRecord[],
  roots: Placements,
  cam: PriorityCamera,
  pixelScale: readonly number[],
  into: string[],
  scratch: PendingScratch = shared,
): string[] {
  const focal = Math.max(pixelScale[0], pixelScale[1]),
    near = cam.near,
    perspective = cam.perspective ?? 1;
  begin(scratch);
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.array) continue;
    const world = rootOf(roots, record).world;
    let at = viewSlot(scratch, world);
    if (at < 0) {
      at = ~at;
      copyElements(worldMirror, world.elements);
      multiplyMatrix4(scratch.views[at], cam.view, worldMirror);
      scratch.stretches[at] = maxStretch(scratch.views[at] as unknown as readonly number[]);
    }
    const view = scratch.views[at],
      stretch = scratch.stretches[at];
    const sphere = record.parentSphere ?? record.sphere;
    const error = record.parentError ?? record.lodError;
    let pixels: number;
    if (sphere && sphere.length === 4) {
      project(view, sphere, centre);
      pixels =
        error == null
          ? Infinity
          : clusterErrorPixels(
              error,
              stretch,
              centre[0],
              centre[1],
              centre[2],
              centre[3],
              focal,
              near,
              perspective,
            );
    } else {
      // No cluster error: fall back on the screen footprint of the bounds, which orders the same way.
      const hull = boundsSphere(record, bounds);
      pixels = sphereScreenRadius(hull, view, stretch, focal, near, perspective);
    }
    note(scratch, record.streamUrl ?? record.url, pixels, hypot3(centre[0], centre[1], centre[2]));
  }
  return sortInto(scratch, into);
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
  const distance = hypot3(centre[0], centre[1], centre[2]);
  const w = clipWeight(perspective, distance);
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

const footprintViewport = [1, 1],
  footprintScale = [0, 0];
/**
 * World size of one pixel per unit of view depth under a perspective projection, or the size of
 * one pixel under an orthographic one: the reciprocal of `pixelScaleOf`'s vertical scale. The
 * shadow read chooses its level from it; the scheduler, from its value at the near plane.
 */
export function pixelFootprintOf(projection: ArrayLike<number>, height: number) {
  footprintViewport[1] = Math.max(1, height);
  return 1 / pixelScaleOf(projection, footprintViewport, footprintScale)[1];
}

/** A pixel's footprint at the near plane: the finest any pixel of the view has. */
export const pixelNearOf = (projection: ArrayLike<number>, height: number, near: number) =>
  pixelFootprintOf(projection, height) * (projection[15] === 0 ? near : 1);
