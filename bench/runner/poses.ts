// Bench trajectory, views and poses. The trajectory is defined here: the repo is its source, and
// any host that wants to replay the same bench copies it from here. `PATH_VERSION` rises at every
// change of the points, so two readings only compare at equal trajectory.
import type { CameraPose } from '../../packages/sdk-core/src/contracts/base.ts';

const PATH_VERSION = 7;
/** Share of the box from its centre within which a street or courtyard runs clear of the
 *  arcades and galleries along the edges. A path point is in that street, or over the model's
 *  top: every segment then stays in one or the other and the camera never crosses a wall. */
export const STREET_HALF_WIDTH = 0.06;
/** `x` and `z` as shares of the box from its centre; `height` in eye heights above the floor
 *  (`street`) or above the model's top (`over`). */
interface PathPoint {
  x: number;
  z: number;
  height: number;
  over: boolean;
}
const street = (x: number, height: number, z: number) => ({ x, z, height, over: false });
const over = (x: number, height: number, z: number) => ({ x, z, height, over: true });
const POINTS: PathPoint[] = [
  over(0.72, 1, 0.78),
  over(0.06, 1, 0.02),
  street(0.05, 1.2, 0.04),
  street(-0.06, 1.7, 0.06),
  street(-0.03, 1.5, 0.04),
  street(-0.03, 1.5, 0.04),
  over(-0.03, 1, 0.04),
  over(-0.38, 1, -0.36),
  over(-0.48, 1, 0.46),
  over(0.72, 1, 0.78),
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

/** A model's axis-aligned box, as read off a `THREE.Box3` or a bench report's plain JSON bounds. */
export interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/**
 * Model floor, the bench's `streetLevel`: the origin plane if the geometry straddles it, otherwise
 * the bottom of its box. The camera poses there and lights hang there — one rule for both.
 */
export const plancherDuModele = (bounds: FloorBounds) =>
  bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y;

/** The bench pose at trajectory index `index`. The path is a loop (its last point is its first),
 *  so an index past `PATH_POSES` wraps: a run longer than the path goes round again. */
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
    block = Math.max(sx, sz);
  const eye = Math.max(block * 0.008, sy > 0 ? Math.min(2, sy * 0.03) : 1.6);
  const place = ({ x, z, height, over }: PathPoint) => [
    cx + x * sx,
    over ? max.y + height * eye : ground + Math.max(1, height) * eye,
    cz + z * sz,
  ];
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
