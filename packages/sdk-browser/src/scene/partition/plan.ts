/**
 * WHICH CELLS OF A PARTITIONED SCENE ARE READ, derived from the camera, never from the scene (#404).
 *
 * A cell is read while the camera can draw any of it: until its box is past the frustum's farthest
 * corner — for a perspective camera `far·√(1 + tan²θ)`, `θ` the half diagonal of the field its
 * zoom narrows or widens (`perspectiveSlope`), the same off-axis majorant the certified cluster
 * error takes (`screenErrorBound.ts`); for an orthographic one the far corner of its zoomed box
 * (`orthographicView`). Nothing coarser stands for a cell that is not read (its merged proxy is
 * #23), so its objects are drawn wherever the far plane lets them be, however small they project:
 * dropping one below the error target would leave it out of the image for good, not replace it by
 * a coarser one.
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
import {
  invertMatrix4,
  MATRIX_VALUES,
  transformAffinePoint,
} from '../../../../sdk-core/src/index.ts';
import { boxPointDistance } from '../../../../sdk-core/src/math/primitives/box.ts';
import {
  orthographicView,
  perspectiveSlope,
} from '../../../../sdk-core/src/math/primitives/camera.ts';
import type { CameraOptics } from '../../camera/engineCamera.ts';
import { stretchOf } from './boxes.ts';
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts';

/** A cell as the plan reads it: its boxes in the scene root's frame now, six values per parent
 *  (`boxes.ts`), and how many nodes of each mesh it places. */
export type BoxedCell = { bounds: ArrayLike<number>; meshes: TableCell['meshes'] };

const inverse = new Float64Array(MATRIX_VALUES),
  view = new Float64Array(4);

/** How far past the reach, as a fraction of it, a cell is read ahead at the prefetch priority. */
export const AHEAD = 0.25;
/** How far past the reach, as a fraction of it, a read cell is kept: past `AHEAD`, so a cell read
 *  ahead is not dropped by the next step. */
export const KEEP = 0.5;

/** What the reach reads of a camera: the optics its projection is composed from. */
export type PartitionOptics = Pick<
  CameraOptics,
  'fov' | 'aspect' | 'near' | 'far' | 'zoom' | 'orthographic'
>;

/** The distance past which nothing `optics` sees is drawn: the frustum's farthest corner. */
export function cellReach(optics: PartitionOptics) {
  const { far, orthographic } = optics,
    zoom = optics.zoom || 1; // a zoom of 0 draws nothing: read as 1, never as an empty reach
  if (orthographic) {
    const [x, y, width, height] = orthographicView(orthographic, zoom, view);
    // Its depth range may reach behind the eye: a negative `near` draws there. A box given right
    // to left, or top to bottom, is as wide.
    const depth = Math.max(Math.abs(far), Math.abs(optics.near));
    return Math.hypot(depth, Math.abs(x) + Math.abs(width), Math.abs(y) + Math.abs(height));
  }
  const slope = perspectiveSlope(optics.fov, zoom);
  return far * Math.sqrt(1 + slope * slope * (1 + optics.aspect * optics.aspect));
}

/**
 * `eye` and `reach` in the frame the cells' boxes are written in — the scene root's, whose world
 * matrix `world` a world may pose, turn, scale and shear. A world distance is at least the root's
 * least stretch (`stretchOf`: its smallest singular value, not its shortest column, which a shear
 * lengthens) times the distance there: what this reach reads holds every cell the world's reach
 * needs; a flattened root, which stretches some distance by 0, reads every cell.
 */
export function inCellFrame(world: ArrayLike<number>, eye: ArrayLike<number>, reach: number) {
  invertMatrix4(inverse, world);
  const local = transformAffinePoint([0, 0, 0], inverse, eye[0], eye[1], eye[2]);
  return { eye: local, reach: reach / stretchOf(world)[0] };
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
