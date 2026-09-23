/**
 * The street segments of the grid: one per pitch of grid line that borders a built block, is
 * not inside the stadium's superblock, crosses no water and runs through nothing already placed
 * (the harbour). A segment knows its axis, its junction and the cells on its two sides.
 */
import type { Vec3 } from '../../plan/contract.ts';
import { segmentBox, type Xz } from './frame.ts';
import { gridPoint, key, type Cell } from './grid.ts';
import type { Placer } from './placement.ts';
import { dry } from './site.ts';

export type Axis = 'h' | 'v';
/** A segment from junction (i, j) one pitch along its axis, and the cells on its two sides. */
export type Segment = {
  axis: Axis;
  i: number;
  j: number;
  sides: [Cell | undefined, Cell | undefined];
};

export const local = (axis: Axis, along: number, across: number): Xz =>
  axis === 'h' ? [along, across] : [across, along];
export const busy = (cell?: Cell) => cell?.district === 'downtown' || cell?.district === 'midrise';

export function segments(placer: Placer, cells: Map<string, Cell>): Segment[] {
  const found: Segment[] = [],
    list = [...cells.values()];
  const is = (i: number, j: number) => cells.get(key(i, j));
  const lines = new Set(
    list.flatMap((c) => [
      `h${c.i},${c.j}`,
      `h${c.i},${c.j + 1}`,
      `v${c.i},${c.j}`,
      `v${c.i + 1},${c.j}`,
    ]),
  );
  for (const line of [...lines].sort()) {
    const axis = line[0] as Axis,
      [i, j] = line.slice(1).split(',').map(Number);
    const sides: Segment['sides'] =
      axis === 'h' ? [is(i, j - 1), is(i, j)] : [is(i - 1, j), is(i, j)];
    if (sides[0]?.group && sides[0].group === sides[1]?.group) continue;
    const { pitch, street } = placer.site,
      wet = [0, 0.25, 0.5, 0.75, 1].some(
        (t) => !dry(placer.site, at(placer, axis, i, j, t * pitch, 0)),
      ),
      taken = placer.occupied(
        segmentBox(at(placer, axis, i, j, 0, 0), at(placer, axis, i, j, pitch, 0), street / 2),
      );
    if (!wet && !taken) found.push({ axis, i, j, sides });
  }
  return found;
}

/** A world point `along` a segment from its junction, `across` toward its +side cell. */
export function at(
  placer: Placer,
  axis: Axis,
  i: number,
  j: number,
  along: number,
  across: number,
): Xz {
  const [u, v] = local(axis, along, across);
  return gridPoint(placer.site, [i * placer.site.pitch + u, j * placer.site.pitch + v]);
}

export const ground = (placer: Placer, [x, z]: Xz): Vec3 => [x, placer.site.plan.height(x, z), z];
