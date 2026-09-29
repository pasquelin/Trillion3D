/**
 * THE CELL INDEX OF A PARTITIONED SCENE (#575): the pages the cook cut the cells' records into
 * (`TableRegion`), each the cells of one region of space, walked as a tree from the root. A page
 * carries, per core parent its cells hang nodes under, the box around their boxes in that parent's
 * frame: in the root's frame now (`boxes.ts`) it holds every box of those cells wherever the page
 * moved the parents, as the box around a turned box holds the box around each of its parts. A
 * frame opens only the pages whose box meets the sphere it asks, and tests only the cells of the
 * region pages it opened: its work follows what that sphere holds, not the world's cell count.
 */
import { boxEmpty, boxUnion } from '../../../../sdk-core/src/math/primitives/box.ts';
import type { TableCell, TableRegion } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import { boxed, type Boxed, type createCellBoxes, type Parts } from './boxes.ts';
import { boxDistance } from './plan.ts';

type Page = { region: TableRegion; box: Boxed; pages: Page[] };

/** The box around `parts` per parent rank, in the order each rank first comes. */
function unionByParent(parts: Iterable<Parts>): Parts {
  const union = new Map<number | null, Float64Array>();
  for (const parents of parts)
    for (const [rank, box] of parents) {
      let around = union.get(rank);
      if (!around) boxEmpty((around = new Float64Array(6)), 0);
      union.set(rank, around);
      boxUnion(around, 0, box[0], box[1], box[2], box[3], box[4], box[5]);
    }
  return [...union];
}

/** The index of `cells` over the pages `regions`, their boxes read through `boxes`. */
export function createCellIndex(
  regions: readonly TableRegion[],
  cells: readonly Pick<TableCell, 'parents'>[],
  boxes: Pick<ReturnType<typeof createCellBoxes>, 'bounds'>,
) {
  const items = cells.map((cell) => boxed(cell.parents));
  const page = (region: TableRegion): Page => {
    const pages = region.pages.map(page);
    const parts = pages.length
      ? pages.map((below) => below.box.parents)
      : cells.slice(region.from, region.to).map((cell) => cell.parents);
    return { region, box: boxed(unionByParent(parts)), pages };
  };
  const top = regions.map(page);
  const distance = (cell: number, eye: ArrayLike<number>) =>
    boxDistance(boxes.bounds(items[cell]), eye);
  return {
    /** Visits each cell with a box within `radius` of `eye`, with its distance; returns the boxes
     *  it tested: the pages it met, and the cells of the region pages it opened. */
    near(eye: ArrayLike<number>, radius: number, visit: (cell: number, distance: number) => void) {
      const tested = { pages: 0, cells: 0 },
        open = [...top];
      for (let next = open.pop(); next; next = open.pop()) {
        tested.pages++;
        if (boxDistance(boxes.bounds(next.box), eye) > radius) continue;
        if (next.pages.length) {
          open.push(...next.pages);
          continue;
        }
        for (let cell = next.region.from; cell < next.region.to; cell++) {
          tested.cells++;
          const away = distance(cell, eye);
          if (away <= radius) visit(cell, away);
        }
      }
      return tested;
    },
    /** How far `cell`'s nearest box lies from `eye`. */
    distance,
  };
}

export type CellIndex = ReturnType<typeof createCellIndex>;
