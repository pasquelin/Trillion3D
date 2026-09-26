/**
 * HOW MANY ROWS A PARTITIONED SCENE HOLDS AT ONCE (#404), wherever its page moves the core parents
 * its cells hang under: moving content never runs a mesh short of rows, so it never reopens a
 * session nor leaves a node undrawn (CONTRIBUTING.md §Streaming, rule 10).
 *
 * After a frame from any eye, every held cell has one of its boxes — one per parent it hangs nodes
 * under, in the root's frame (`boxes.ts`) — within `reach·(1 + KEEP)` of that eye (`planCells`).
 * The boxes a parent carries move together with it, so the ones held at once are close to one
 * another in that parent's own frame, however the parent stands; two parents, though, may bring
 * their cells together anywhere. The bound is therefore taken parent by parent — the most any one
 * of its boxes can be held with, counting each cell whole — and summed over the parents, never
 * past every node the cells place. It follows the reach and the cells' size, not the world's.
 *
 * In a parent's frame, `least` and `most` stretch the root's: a box is at most `√3·most·r` wider in
 * the root's frame than the ball of radius `r` around it (the box around a turned box), and a gap
 * there is at least `least` times the one in the parent's. Two boxes held together are thus within
 * `2·radius/least + √3·(most/least)·(r₁ + r₂)` in the parent's frame: a parent moved, turned or
 * scaled up keeps that span, and only one scaled down or stretched more unevenly than at sizing,
 * like a reach past the one sized, asks for the rows to be sized again (`cells.ts`).
 */
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { KEEP } from './plan.ts';

/** How far a frame stretches a distance of the root's: at least, at most. */
export type Stretch = readonly [least: number, most: number];
type Box = ArrayLike<number>;
type Sized = Pick<TableCell, 'parents' | 'meshes'>;

/** Distance between two boxes, 0 when they meet. */
function boxGap(a: Box, b: Box) {
  let sum = 0;
  for (let axis = 0; axis < 3; axis++) {
    const gap = Math.max(a[axis] - b[axis + 3], 0, b[axis] - a[axis + 3]);
    sum += gap * gap;
  }
  return Math.sqrt(sum);
}

/** A box as its ball: the centre, then the radius around it. */
function ball(box: Box) {
  const x = (box[3] - box[0]) / 2,
    y = (box[4] - box[1]) / 2,
    z = (box[5] - box[2]) / 2;
  return [box[0] + x, box[1] + y, box[2] + z, Math.sqrt(x * x + y * y + z * z)];
}
type Part = { cell: Sized; box: Box; ball: number[] };

/** Whether two boxes of one parent can both lie within `radius` of one eye of the root's frame. */
function together(radius: number, stretch: Stretch | null) {
  // The root's own frame: the boxes themselves.
  if (!stretch) return (a: Part, b: Part) => boxGap(a.box, b.box) <= 2 * radius;
  const [least, most] = stretch;
  return ({ ball: p }: Part, { ball: q }: Part) => {
    const dx = p[0] - q[0],
      dy = p[1] - q[1],
      dz = p[2] - q[2];
    const apart = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return least * apart <= 2 * radius + Math.sqrt(3) * most * (p[3] + q[3]);
  };
}

/** How many nodes of each mesh `cells` place. */
function meshTotals(cells: readonly Pick<TableCell, 'meshes'>[]) {
  const totals = new Map<number, number>();
  for (const cell of cells)
    for (const [mesh, nodes] of cell.meshes) totals.set(mesh, (totals.get(mesh) ?? 0) + nodes);
  return totals;
}

/**
 * How many nodes of each mesh can be held at once while the reach, in the root's frame, stays
 * within `reach` and each core parent within its `stretch`, wherever the parents stand.
 */
export function residentRows(
  cells: readonly Sized[],
  reach: number,
  stretch: ReadonlyMap<number, Stretch>,
) {
  const groups = new Map<number | null, Part[]>();
  for (const cell of cells)
    for (const [rank, box] of cell.parents) {
      const group = groups.get(rank) ?? [];
      groups.set(rank, group);
      group.push({ cell, box, ball: ball(box) });
    }
  const rows = new Map<number, number>();
  for (const [rank, parts] of groups) {
    const near = together(reach * (1 + KEEP), rank === null ? null : (stretch.get(rank) ?? [1, 1]));
    const most = new Map<number, number>();
    for (const anchor of parts) {
      const held = meshTotals(parts.filter((part) => near(anchor, part)).map((p) => p.cell));
      for (const [mesh, nodes] of held) most.set(mesh, Math.max(most.get(mesh) ?? 0, nodes));
    }
    for (const [mesh, nodes] of most) rows.set(mesh, (rows.get(mesh) ?? 0) + nodes);
  }
  const totals = meshTotals(cells);
  for (const [mesh, nodes] of rows) rows.set(mesh, Math.min(nodes, totals.get(mesh)!));
  return rows;
}

/** The rounding a recomposed world matrix carries, far above a double's and far below any scale a
 *  page sets: a parent turned and moved back keeps its stretch within it. */
const SLACK = 2 ** -20;

/** The stretch rows are sized for: each parent's `now`, widened by the rounding and `by` more. */
export const sizedStretch = (now: ReadonlyMap<number, Stretch>, by = 1) =>
  new Map(
    [...now].map(([rank, [least, most]]) => [
      rank,
      [(least * (1 - SLACK)) / by, most * (1 + SLACK) * by],
    ]),
  ) as ReadonlyMap<number, Stretch>;

/** Whether a parent stretches its cells' frame, `now`, past what rows `sized` for hold: a least
 *  stretch below the sized one, or a ratio of most to least above it (products, so a flattened
 *  frame compares without dividing by 0). */
export const outstretched = (
  now: ReadonlyMap<number, Stretch>,
  sized: ReadonlyMap<number, Stretch>,
) =>
  [...now].some(([rank, [least, most]]) => {
    const [low, high] = sized.get(rank) ?? [least, most];
    return least < low || most * low > high * least;
  });

/** Whether `rows` hold every node `cells` place: rows that many are never short. */
export function holdsEvery(
  rows: ReadonlyMap<number, number>,
  cells: readonly Pick<TableCell, 'meshes'>[],
) {
  return [...meshTotals(cells)].every(([mesh, nodes]) => (rows.get(mesh) ?? 0) >= nodes);
}
