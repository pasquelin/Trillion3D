/**
 * WHICH CELLS OF A PARTITIONED SCENE ARE READ, derived and never tuned (#404).
 *
 * A cell is needed while one of its objects can colour a pixel beyond the error target. Its
 * largest object has diagonal `size`; seen from a distance `d` to the cell's box, at the focal
 * `f = H / (2·tan(fov/2))` pixels, anywhere in the frustum — the off-axis stretch of a pinhole is
 * at most `1 + tan²θ`, `θ` the half diagonal of the field, the same majorant the certified cluster
 * error takes (`screenErrorBound.ts`) — it covers at most `size·f·(1 + tan²θ) / d` pixels. Past
 * `size·f·(1 + tan²θ) / pixelError` it covers less than the error the cut itself leaves on screen
 * (a cluster whose error projects below it is replaced by its coarser parent): its absence is
 * within the image the engine converges to. Past the far plane — met on the frustum's diagonal at
 * `far·√(1 + tan²θ)` — nothing of it is drawn at all. With no error target (`pixelError` 0, the
 * exact image) only the far plane bounds the reach; an orthographic camera does not shrink what it
 * sees with distance, so every cell of its scene is read.
 *
 * A frame asks for the cells within their reach first, then — at the prefetch priority — those
 * within one cell diagonal past it, and a read cell leaves two diagonals past it: a camera that
 * crosses less than a cell while a cell loads never waits for one, and one that hovers on a border
 * does not read it again at every step. The first frame reads only what it draws.
 */
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts';

/** What the reach reads of a camera: its optics, whether it is orthographic, the drawn height. */
export type PartitionOptics = {
  fov: number;
  aspect: number;
  far: number;
  orthographic?: unknown;
};

/** The distance past which a cell whose largest object has diagonal `size` changes no pixel
 *  beyond `pixelError`, for `optics` drawn `height` pixels high. */
export function cellReach(
  size: number,
  optics: PartitionOptics,
  height: number,
  pixelError: number,
) {
  if (optics.orthographic) return Infinity;
  const tangent = Math.tan((optics.fov * Math.PI) / 360);
  const widen = 1 + tangent * tangent * (1 + optics.aspect * optics.aspect);
  const far = optics.far * Math.sqrt(widen);
  if (!(pixelError > 0)) return far;
  const focal = height / (2 * tangent);
  return Math.min(far, (size * focal * widen) / pixelError);
}

/** Distance from `eye` to the box `[minX, minY, minZ, maxX, maxY, maxZ]`, 0 inside it. */
export function boxDistance(bounds: readonly number[], eye: ArrayLike<number>) {
  let sum = 0;
  for (let axis = 0; axis < 3; axis++) {
    const gap = Math.max(bounds[axis] - eye[axis], 0, eye[axis] - bounds[axis + 3]);
    sum += gap * gap;
  }
  return Math.sqrt(sum);
}

/** The diagonal of a box: the margin a cell is read ahead of its reach and kept past it. */
export function boxDiagonal(bounds: readonly number[]) {
  const x = bounds[3] - bounds[0],
    y = bounds[4] - bounds[1],
    z = bounds[5] - bounds[2];
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * The cells `held` does not hold that a frame needs — `visible`, within their reach — and those it
 * reads ahead — `ahead`, within one diagonal past it —, each nearest first; and the held cells
 * past their reach plus two diagonals, which leave. `reach` maps a largest-object diagonal to its
 * distance (`cellReach` for the frame's camera).
 */
export function planCells(
  cells: readonly TableCell[],
  eye: ArrayLike<number>,
  reach: (size: number) => number,
  held: ReadonlySet<number>,
) {
  const visible: { cell: number; distance: number }[] = [],
    ahead: { cell: number; distance: number }[] = [];
  const leave: number[] = [];
  for (let cell = 0; cell < cells.length; cell++) {
    const { bounds, size } = cells[cell];
    const distance = boxDistance(bounds, eye),
      limit = reach(size),
      margin = boxDiagonal(bounds);
    if (held.has(cell)) {
      if (distance > limit + 2 * margin) leave.push(cell);
    } else if (distance <= limit) visible.push({ cell, distance });
    else if (distance <= limit + margin) ahead.push({ cell, distance });
  }
  const nearest = (list: typeof visible) =>
    list.sort((a, b) => a.distance - b.distance).map((entry) => entry.cell);
  return { visible: nearest(visible), ahead: nearest(ahead), leave };
}
