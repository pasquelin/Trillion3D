// Bench trajectory, views and poses. The trajectory is defined here: the repo is its source, and
// any host that wants to replay the same bench copies it from here. `PATH_VERSION` rises at every
// change of the points, so two readings only compare at equal trajectory.
const PATH_VERSION = 5;
const POINTS = [
  [0.72, 28, 0.78],
  [0.2, 8, 0.26],
  [0.05, 1.2, 0.08],
  [-0.08, 1.7, 0.12],
  [-0.03, 1.5, 0.04],
  [-0.03, 1.5, 0.04],
  [0.3, 10, -0.26],
  [-0.38, 8, -0.36],
  [-0.48, 12, 0.46],
  [0.72, 28, 0.78],
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

/**
 * Model floor, the bench's `streetLevel`: the origin plane if the geometry straddles it, otherwise
 * the bottom of its box. The camera poses there and lights hang there — one rule for both.
 */
export const plancherDuModele = (bounds) =>
  bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y;

/** The bench pose at trajectory index `index`, of `PATH_POSES`. */
export function poseAt(bounds, index) {
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
  const segment = Math.floor(index / FRAMES_PER_SEGMENT),
    frame = index % FRAMES_PER_SEGMENT;
  const t = frame / (FRAMES_PER_SEGMENT - 1);
  const a = POINTS[segment],
    b = POINTS[segment + 1] ?? POINTS[0];
  const p = a.map((v, i) => v + (b[i] - v) * t);
  return {
    position: [cx + p[0] * sx, Math.max(ground + eye, ground + p[1] * eye), cz + p[2] * sz],
    target: [cx, ground + eye * 2, cz],
    fov: 55,
    near: Math.max(radius / 10000, 0.01),
    far: radius * 20,
  };
}
