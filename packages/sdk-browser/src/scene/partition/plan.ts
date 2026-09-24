/**
 * WHICH CELLS OF A PARTITIONED SCENE ARE READ, derived and never tuned (#404).
 *
 * A cell is read while the camera can draw any of it: until its box is past the far plane — met
 * on the frustum's diagonal at `far·√(1 + tan²θ)`, `θ` the half diagonal of the field, the same
 * off-axis majorant the certified cluster error takes (`screenErrorBound.ts`). Nothing coarser
 * stands for a cell that is not read (its merged proxy is #23), so its objects are drawn wherever
 * the far plane lets them be, however small they project: dropping one below the error target
 * would leave it out of the image for good, not replace it by a coarser one. An orthographic
 * camera does not shrink what it sees with distance, so every cell of its scene is read.
 *
 * A frame asks for the cells within the reach first, then — at the prefetch priority — those
 * within one cell diagonal past it, and a read cell leaves two diagonals past it, so one that
 * hovers on a border is not read again at every step. The first frame reads only what it draws.
 */
import { invertMatrix4, MATRIX_VALUES } from '../../../../sdk-core/src/index.ts';
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts';

const inverse = new Float64Array(MATRIX_VALUES);

/** What the reach reads of a camera: its optics and whether it is orthographic. */
export type PartitionOptics = {
  fov: number;
  aspect: number;
  far: number;
  orthographic?: unknown;
};

/** The distance past which nothing `optics` sees is drawn. */
export function cellReach(optics: PartitionOptics) {
  if (optics.orthographic) return Infinity;
  const tangent = Math.tan((optics.fov * Math.PI) / 360);
  return optics.far * Math.sqrt(1 + tangent * tangent * (1 + optics.aspect * optics.aspect));
}

/**
 * `eye` and `reach` in the frame the cells' boxes are written in — the scene root's, whose world
 * matrix `world` a world may pose, turn and scale. A world distance is at least the root's smallest
 * stretch times the distance there: what this reach reads holds every cell the world's reach needs.
 */
export function inCellFrame(world: ArrayLike<number>, eye: ArrayLike<number>, reach: number) {
  const least = Math.min(...[0, 4, 8].map((c) => Math.hypot(world[c], world[c + 1], world[c + 2])));
  invertMatrix4(inverse, world);
  const local = [0, 1, 2].map(
    (a) =>
      inverse[a] * eye[0] + inverse[4 + a] * eye[1] + inverse[8 + a] * eye[2] + inverse[12 + a],
  );
  return { eye: local, reach: reach / least };
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
 * The cells `held` does not hold that a frame needs — `visible`, within `reach` — and those it
 * reads ahead — `ahead`, within one diagonal past it —, each nearest first; and the held cells
 * past the reach plus two diagonals, which leave. `reach` is the frame camera's (`cellReach`).
 */
export function planCells(
  cells: readonly TableCell[],
  eye: ArrayLike<number>,
  reach: number,
  held: ReadonlySet<number>,
) {
  const visible: { cell: number; distance: number }[] = [],
    ahead: { cell: number; distance: number }[] = [];
  const leave: number[] = [];
  for (let cell = 0; cell < cells.length; cell++) {
    const { bounds } = cells[cell];
    const distance = boxDistance(bounds, eye),
      margin = boxDiagonal(bounds);
    if (held.has(cell)) {
      if (distance > reach + 2 * margin) leave.push(cell);
    } else if (distance <= reach) visible.push({ cell, distance });
    else if (distance <= reach + margin) ahead.push({ cell, distance });
  }
  const nearest = (list: typeof visible) =>
    list.sort((a, b) => a.distance - b.distance).map((entry) => entry.cell);
  return { visible: nearest(visible), ahead: nearest(ahead), leave };
}
