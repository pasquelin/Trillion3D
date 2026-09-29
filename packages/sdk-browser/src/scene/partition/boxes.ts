/**
 * Where the cells of a partitioned scene are now (#404). A cell carries the box around its nodes
 * in the frame of each core parent it hangs them under (`TableCell.parents`); a page may move that
 * parent (`getObjectByName`), and the rows follow it (`cells.ts`). The plan reads each cell's boxes
 * in the scene root's frame, one per parent, rewritten once a parent moved relative to the root,
 * so a cell is read where its objects stand, not where the file declared them. A page of the cell
 * index is boxed at the declared poses, in the root's frame (#575): what it holds now lies within
 * that box and the box carried by each parent moved since the declaration (`around`).
 */
import {
  boxTransform,
  determinantMatrix4,
  invertMatrix4,
  MATRIX_VALUES,
  maxStretch,
  multiplyMatrix4,
} from '../../../../sdk-core/src/index.ts';
import { boxUnion } from '../../../../sdk-core/src/math/primitives/box.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { hostWorldChainInto } from '../../host/world/chain.ts';

const rootWorld = new Float64Array(MATRIX_VALUES),
  rootInverse = new Float64Array(MATRIX_VALUES),
  parentWorld = new Float64Array(MATRIX_VALUES),
  relative = new Float64Array(MATRIX_VALUES),
  inverse = new Float64Array(MATRIX_VALUES),
  carried = new Float64Array(6);

/** The least and the most `matrix` stretches a distance — its smallest and largest singular
 *  values —; a flattened frame, or one so nearly flat its inverse overflows, stretches it by 0. */
export function stretchOf(matrix: ArrayLike<number>): readonly [least: number, most: number] {
  const most = maxStretch(matrix);
  if (determinantMatrix4(matrix) === 0) return [0, most];
  const back = invertMatrix4(inverse, matrix).every(Number.isFinite)
    ? maxStretch(inverse)
    : Infinity;
  return [1 / back, most];
}

/** What carries boxes — a cell —: its `[core rank, box]` per parent, its boxes in the root's frame
 *  when last written, and at which `refresh`. */
export type Boxed = { parents: Parts; bounds: Float64Array; written: number };
/** `[core rank, box]` per parent: the box in that parent's frame (`TableCell.parents`). */
export type Parts = readonly (readonly [number | null, ArrayLike<number>])[];
/** A `Boxed` over `parents`, never written. */
export const boxed = (parents: Parts): Boxed => ({
  parents,
  bounds: new Float64Array(6 * parents.length),
  written: -1,
});
/** A page of the cell index as it is boxed: at the declared poses, and now, written at a `refresh`. */
export type Declared = { declared: ArrayLike<number>; box: Float64Array; written: number };

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  for (let at = 0; at < MATRIX_VALUES; at++) if (!Object.is(a[at], b[at])) return false;
  return true;
};
const relativeInto = (out: Float64Array, parent: Object3D) =>
  multiplyMatrix4(out, rootInverse, hostWorldChainInto(parentWorld, parent));

/**
 * The frames of the core parents of ranks `ranks` relative to `root`, the node their scene hangs
 * on; `parents[rank]` is the host node of each core rank, standing where the file declares it when
 * this is called. `refresh` reads the frames again. `bounds` gives the boxes of a `Boxed` in the
 * root's frame, six values per parent, in the order of its `parents`, written again only when one
 * of those parents moved since, so a frame pays for the boxes it reads, never for every cell a
 * moved parent carries (#575); `around`, the box of a page of the index where the parents stand.
 */
export function createCellBoxes(
  ranks: Iterable<number>,
  root: Object3D,
  parents: readonly Object3D[],
) {
  type Frame = { matrix: Float64Array; declared: Float64Array; back: Float64Array; moved: number };
  const frames = new Map<number, Frame>();
  /** Each parent moved since the declaration: what carries its declared frame to where it is. */
  const displaced = new Map<number, Float64Array>();
  invertMatrix4(rootInverse, hostWorldChainInto(rootWorld, root));
  for (const rank of ranks) {
    const declared = relativeInto(new Float64Array(MATRIX_VALUES), parents[rank]);
    const back = invertMatrix4(new Float64Array(MATRIX_VALUES), declared);
    frames.set(rank, { matrix: declared.slice(), declared, back, moved: 0 });
  }
  let now = 0,
    shifted = 0;
  const refresh = () => {
    now++;
    if (frames.size) invertMatrix4(rootInverse, hostWorldChainInto(rootWorld, root));
    for (const [rank, frame] of frames) {
      relativeInto(relative, parents[rank]);
      if (same(relative, frame.matrix)) continue;
      frame.matrix.set(relative);
      frame.moved = shifted = now;
      if (same(relative, frame.declared)) displaced.delete(rank);
      else displaced.set(rank, multiplyMatrix4(new Float64Array(MATRIX_VALUES), relative, frame.back));
    }
  };
  const moved = ([rank]: Parts[number], since: number) =>
    rank !== null && frames.get(rank)!.moved > since;
  const bounds = (item: Boxed) => {
    if (item.written >= 0 && !item.parents.some((part) => moved(part, item.written)))
      return item.bounds;
    item.parents.forEach(([rank, box], part) => {
      if (rank === null) item.bounds.set(box, 6 * part);
      else boxTransform(item.bounds, 6 * part, box, 0, frames.get(rank)!.matrix);
    });
    item.written = now;
    return item.bounds;
  };
  const around = (page: Declared) => {
    if (page.written >= 0 && page.written >= shifted) return page.box;
    page.box.set(page.declared);
    for (const carry of displaced.values()) {
      boxTransform(carried, 0, page.declared, 0, carry);
      boxUnion(page.box, 0, carried[0], carried[1], carried[2], carried[3], carried[4], carried[5]);
    }
    page.written = now;
    return page.box;
  };
  return { refresh, bounds, around };
}

export type CellBoxes = ReturnType<typeof createCellBoxes>;
