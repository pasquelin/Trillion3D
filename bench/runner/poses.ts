// Bench trajectory, views and poses. The trajectory is defined here: the repo is its source, and
// any host that wants to replay the same bench copies it from here. `PATH_VERSION` rises at every
// change of the points, so two readings only compare at equal trajectory.
import type { CameraPose } from '../../packages/sdk-core/src/contracts/base.ts';
import type { Street } from './street.ts';

const PATH_VERSION = 8;
/** Where a path point stands. `street`: at the model's street (`street.ts`), `x` and `z` as shares
 *  of its clearance — the radius no wall crosses at eye height — and `height` in eyes above its
 *  ground; every share stays within `STREET_REACH` of the column, so a segment between two street
 *  points stays in that disc. `over`: one eye above the model's top, `x` and `z` as shares of the
 *  box from its centre, or above the street's column (`overStreet`), where the path comes down
 *  into it and climbs out. The camera never crosses a wall: nothing here is read off one scene. */
interface PathPoint {
  x: number;
  z: number;
  height: number;
  at: 'street' | 'over' | 'overStreet';
}
export const STREET_REACH = 0.6;
const street = (x: number, height: number, z: number): PathPoint => ({
  x,
  z,
  height,
  at: 'street',
});
const over = (x: number, z: number): PathPoint => ({ x, z, height: 1, at: 'over' });
const overStreet: PathPoint = { x: 0, z: 0, height: 1, at: 'overStreet' };
const POINTS: PathPoint[] = [
  over(0.72, 0.78),
  overStreet,
  street(0.4, 1.2, 0.3),
  street(-0.4, 1.7, 0.4),
  street(-0.2, 1.5, 0.3),
  street(-0.2, 1.5, 0.3),
  overStreet,
  over(-0.38, -0.36),
  over(-0.48, 0.46),
  over(0.72, 0.78),
];
const FRAMES_PER_SEGMENT = 60;
/** One pose per frame, `FRAMES_PER_SEGMENT` frames between two consecutive points. */
export const PATH_POSES = POINTS.length * FRAMES_PER_SEGMENT;
export { PATH_VERSION, FRAMES_PER_SEGMENT };

/** Bench views this harness knows how to play, by index in the trajectory. */
export const VIEWS = {
  generale: { index: 0, segment: 'General view of the model' },
  sol: { index: 2 * FRAMES_PER_SEGMENT, segment: 'Move at reference level' },
  // Same segment as `sol`, at the lowest point of the trajectory: camera in the street.
  rue: { index: 2 * FRAMES_PER_SEGMENT + 30, segment: 'Move at reference level' },
  detail: { index: 4 * FRAMES_PER_SEGMENT, segment: 'Close-up on detailed geometry' },
};

/** The vertical extent a floor is read from: a full box (`poseAt`) or just its `y` (`plancherDuModele`). */
interface FloorBounds {
  min: { y: number };
  max: { y: number };
}

/** A model's axis-aligned box, as read off a `THREE.Box3` or a bench report's plain JSON bounds,
 *  and the street the bench read off its geometry (`street.ts`), when it did. */
export interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  street?: Street | null;
}

/**
 * Model floor, the bench's `streetLevel`: the origin plane if the geometry straddles it, otherwise
 * the bottom of its box. The camera poses there and lights hang there — one rule for both.
 */
export const plancherDuModele = (bounds: FloorBounds) =>
  bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y;

/** The camera's eye height on a model: a share of its footprint, at most two metres on a tall one. */
export function eyeHeight(bounds: Bounds) {
  const sx = bounds.max.x - bounds.min.x,
    sy = bounds.max.y - bounds.min.y,
    sz = bounds.max.z - bounds.min.z;
  return Math.max(Math.max(sx, sz) * 0.008, sy > 0 ? Math.min(2, sy * 0.03) : 1.6);
}

/** The bench pose at trajectory index `index`. The path is a loop (its last point is its first),
 *  so an index past `PATH_POSES` wraps: a run longer than the path goes round again. Without a
 *  street read off the model, the camera walks the box centre on its floor, with no room. */
export function poseAt(bounds: Bounds, index: number): CameraPose {
  const min = bounds.min,
    max = bounds.max;
  const cx = (min.x + max.x) / 2,
    cz = (min.z + max.z) / 2;
  const sx = max.x - min.x,
    sy = max.y - min.y,
    sz = max.z - min.z;
  const radius = Math.hypot(sx, sy, sz) / 2;
  const ground = plancherDuModele(bounds),
    eye = eyeHeight(bounds);
  const road = bounds.street ?? { x: cx, z: cz, ground, clearance: 0 };
  const place = ({ x, z, height, at }: PathPoint) =>
    at === 'street'
      ? [road.x + x * road.clearance, road.ground + height * eye, road.z + z * road.clearance]
      : at === 'overStreet'
        ? [road.x, max.y + height * eye, road.z]
        : [cx + x * sx, max.y + height * eye, cz + z * sz];
  const step = index % PATH_POSES,
    segment = Math.floor(step / FRAMES_PER_SEGMENT);
  const t = (step % FRAMES_PER_SEGMENT) / (FRAMES_PER_SEGMENT - 1);
  const a = place(POINTS[segment]),
    b = place(POINTS[segment + 1] ?? POINTS[0]);
  return {
    position: a.map((v, i) => v + (b[i] - v) * t) as [number, number, number],
    target: [cx, ground + eye * 2, cz],
    fov: 55,
    near: Math.max(radius / 10000, 0.01),
    far: radius * 20,
  };
}

/** One pose per frame along the trajectory from index `index`. */
export const trajectoryPoses = (bounds: Bounds, index: number, frames: number) =>
  Array.from({ length: frames }, (_, i) => poseAt(bounds, index + i));
