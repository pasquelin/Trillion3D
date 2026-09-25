/**
 * WHICH CELLS OF A PARTITIONED SCENE ARE READ, derived from the camera, never from the scene (#404).
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
 * within `AHEAD` of it past it, and a read cell leaves once its box is `KEEP` of the reach past it,
 * so one that hovers on a border is not read again at every step. Both margins are fractions of
 * the reach, never of the cell: a cell the compiler cut wider than the view (its split counts
 * bytes, not metres) is kept only while its box meets that sphere. The first frame reads only
 * what it draws.
 *
 * The rows are sized once, when the session opens, for every placement that can be held at once
 * within a reach wherever the page moves the cells' parents (`sizing.ts`): nothing grows while a
 * session draws.
 */
import { invertMatrix4, MATRIX_VALUES } from '../../../../sdk-core/src/index.ts';
import { boxPointDistance } from '../../../../sdk-core/src/math/primitives/box.ts';
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts';

/** A cell as the plan reads it: its boxes in the scene root's frame now, six values per parent
 *  (`boxes.ts`), and how many nodes of each mesh it places. */
export type BoxedCell = { bounds: ArrayLike<number>; meshes: TableCell['meshes'] };

const inverse = new Float64Array(MATRIX_VALUES);

/** How far past the reach, as a fraction of it, a cell is read ahead at the prefetch priority. */
export const AHEAD = 0.25;
/** How far past the reach, as a fraction of it, a read cell is kept: past `AHEAD`, so a cell read
 *  ahead is not dropped by the next step. */
export const KEEP = 0.5;

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

/** Distance from `eye` to the nearest box `[minX, minY, minZ, maxX, maxY, maxZ]` of `bounds`,
 *  six values each; 0 inside one. */
export function boxDistance(bounds: ArrayLike<number>, eye: ArrayLike<number>) {
  let nearest = Infinity;
  for (let at = 0; at < bounds.length; at += 6)
    nearest = Math.min(nearest, boxPointDistance(bounds, at, eye[0], eye[1], eye[2]));
  return nearest;
}

/**
 * The cells `held` does not hold that a frame needs — `visible`, within `reach` — and those it
 * reads ahead — `ahead`, within `reach·(1 + AHEAD)` —, each nearest first; and the held cells
 * past `reach·(1 + KEEP)`, which leave. `reach` is the frame camera's (`cellReach`).
 */
export function planCells(
  cells: readonly BoxedCell[],
  eye: ArrayLike<number>,
  reach: number,
  held: ReadonlySet<number>,
) {
  const visible: { cell: number; distance: number }[] = [],
    ahead: { cell: number; distance: number }[] = [];
  const leave: number[] = [];
  for (let cell = 0; cell < cells.length; cell++) {
    const distance = boxDistance(cells[cell].bounds, eye);
    if (held.has(cell)) {
      if (distance > reach * (1 + KEEP)) leave.push(cell);
    } else if (distance <= reach) visible.push({ cell, distance });
    else if (distance <= reach * (1 + AHEAD)) ahead.push({ cell, distance });
  }
  const nearest = (list: typeof visible) =>
    list.sort((a, b) => a.distance - b.distance).map((entry) => entry.cell);
  return { visible: nearest(visible), ahead: nearest(ahead), leave };
}
