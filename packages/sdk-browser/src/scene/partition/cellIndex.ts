/**
 * THE CELL INDEX OF A PARTITIONED SCENE, READ AS THE VIEW REACHES IT (#575). The cook cut the
 * cells' records into pages (`partition/pages.rs`), each the cells of one region of space, under
 * index pages; the root names the top ones, each boxed at the declared poses. Before its first
 * frame the runtime reads that root and the pages on the first camera's way (`cells.ts`, `prime`).
 * A frame walks the pages from it: a page whose box, where the parents its cells hang under stand
 * now (`boxes.ts`, `around`), meets its sphere is read — decoded in the pool and
 * opened within the one integration budget (`cells.ts`) — then its pages are walked, or its cells
 * tested. A page past the keep sphere with no cell placed is closed again: the index holds the
 * pages the view reached, never the world's, and a frame's work follows what its sphere holds.
 */
import type {
  readCellPage,
  TableCell,
} from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import type { TableSlot } from '../../../../sdk-core/src/scene/core/tablePages.ts';
import type { StreamPage } from '../../streaming/types.ts';
import { boxed, type Boxed, type CellBoxes, type Declared } from './boxes.ts';
import { boxDistance } from './plan.ts';

/** A page of the index: its file, its boxes, and once opened the pages it lists or its cells. */
export type IndexPage = Declared & {
  slot: StreamPage;
  body: { pages: IndexPage[] } | { cells: number[] } | null;
};
/** A cell the index holds: its record, its file's address, its boxes. */
type Cell = TableCell & { item: Boxed };
/** A page's body as the pool reads it. */
export type PageBody = ReturnType<typeof readCellPage>;

/** The index under the root's `slots`, whose files lie beside `base`, boxed through `boxes`. */
export function createCellIndex(slots: readonly TableSlot[], base: string, boxes: CellBoxes) {
  const cells = new Map<number, Cell>();
  let opened = 0,
    forgotten: string[] = [];
  const pageOf = ({ page, bounds, parents }: TableSlot): IndexPage => ({
    slot: { ...page, url: new URL(page.url, base).href },
    declared: bounds,
    parents,
    box: new Float64Array(6),
    written: -1,
    body: null,
  });
  const top = slots.map(pageOf);
  const distance = (cell: number, eye: ArrayLike<number>) =>
    boxDistance(boxes.bounds(cells.get(cell)!.item), eye);
  /** Whether `page` holds no cell of `held`. */
  const idle = (page: IndexPage, held: { has(cell: number): boolean }): boolean =>
    !page.body ||
    ('pages' in page.body
      ? page.body.pages.every((below) => idle(below, held))
      : !page.body.cells.some((cell) => held.has(cell)));
  const close = (page: IndexPage) => {
    const body = page.body;
    if (!body) return;
    opened--;
    page.body = null;
    if ('pages' in body)
      for (const below of body.pages) {
        forgotten.push(below.slot.url);
        close(below);
      }
    else
      for (const cell of body.cells) {
        forgotten.push(cells.get(cell)!.url);
        cells.delete(cell);
      }
  };
  return {
    /** The root's pages, the files the streamer's catalogue holds at open. */
    slots: top.map((page) => page.slot),
    /** The record of a cell the index holds. */
    cell: (cell: number): TableCell => cells.get(cell)!,
    /** How many pages the index holds opened, and cells. */
    stats: () => ({ pages: opened, cells: cells.size }),
    /** Opens `page` on its decoded `body`; returns the files it names, which the catalogue takes. */
    open(page: IndexPage, body: PageBody): StreamPage[] {
      opened++;
      if (body.pages) {
        const pages = body.pages.map(pageOf);
        page.body = { pages };
        return pages.map((below) => below.slot);
      }
      // A cell is its cook's rank, whatever page opens first: the world roots name it so (#1237).
      const ids = body.cells.map((record, at) => {
        const url = new URL(record.url, base).href;
        cells.set(body.first + at, { ...record, url, item: boxed(record.parents) });
        return body.first + at;
      });
      page.body = { cells: ids };
      return ids.map((id) => {
        const { url, bytes, sha256 } = cells.get(id)!;
        return { url, bytes, sha256 };
      });
    },
    /**
     * Walks the pages from the root: visits each cell with a box within `radius` of `eye`, with
     * its distance, and each page within it not yet opened (`unread`); closes each opened page
     * past `keep` whose cells `held` holds none. Returns the boxes it tested: the pages it met,
     * and the cells of the region pages it walked.
     */
    near(
      eye: ArrayLike<number>,
      radius: number,
      keep: number,
      held: { has(cell: number): boolean },
      visit: (cell: number, distance: number) => void,
      unread: (page: IndexPage, distance: number) => void,
    ) {
      const tested = { pages: 0, cells: 0 },
        open = [...top];
      for (let page = open.pop(); page; page = open.pop()) {
        tested.pages++;
        const away = boxDistance(boxes.around(page), eye);
        if (away > radius) {
          if (away > keep && idle(page, held)) close(page);
        } else if (!page.body) unread(page, away);
        else if ('pages' in page.body) open.push(...page.body.pages);
        else
          for (const cell of page.body.cells) {
            tested.cells++;
            const at = distance(cell, eye);
            if (at <= radius) visit(cell, at);
          }
      }
      return tested;
    },
    /** How far `cell`'s nearest box lies from `eye`. */
    distance,
    /** The files the pages closed since the last call named: the catalogue lets them go. */
    forgotten() {
      const out = forgotten;
      forgotten = [];
      return out;
    },
  };
}

export type CellIndex = ReturnType<typeof createCellIndex>;
