/**
 * THE MANIFEST PAGES A PARTITION'S CELLS HOLD (#751). A cell placed holds the mesh pages its region
 * page names (`TableCell.meshPages`), counted once per cell: a page many cells share stays read
 * while one of them is placed. A cell that leaves releases them, and a page no placed cell holds
 * leaves the manifest with its primitives (`ManifestPages`). A hold that failed is asked again at
 * the next frame while its cell is placed. Without `pages` the manifest was read whole: nothing is
 * held, and every mesh the cells place has its primitive from the open.
 */
import type { ManifestPages } from '../../../../sdk-core/src/manifest/paged.ts';
import type { PlacedMesh } from './rows.ts';

/** What a partition's cells hold: each rank's placed mesh, and the manifest pages the cells hold.
 *  Kept beside the cells, not on them: a model's public record carries the cells. */
export type CellHoldings = {
  meshes: ReadonlyMap<number, PlacedMesh>;
  manifest: ReturnType<typeof createCellPages>;
};
const holdings = new WeakMap<object, CellHoldings>();
/** `cells`, with `holding` kept beside them. */
export function withHoldings<T extends object>(holding: CellHoldings, cells: T): T {
  holdings.set(cells, holding);
  return cells;
}
/** What the cells `withHoldings` returned hold. */
export const cellHoldings = (cells: object) => holdings.get(cells)!;

/** The holds of the cells placed on `pages`, each cell's mesh pages read through `meshPagesOf`. */
export function createCellPages(
  pages: ManifestPages | undefined,
  meshPagesOf: (cell: number) => readonly string[],
) {
  /** The hold of each cell whose pages are held, and the cells whose hold failed while placed. A
   *  cell that leaves while its hold reads releases once it lands: a hold that fails counts
   *  nothing, and releasing it too would drop a page another cell holds. */
  type Hold = { slots: readonly string[]; landed: boolean; left: boolean };
  const holding = new Map<number, Hold>(),
    failed = new Set<number>();
  let reads: Promise<void>[] = [];
  const hold = (cell: number) => {
    if (!pages || holding.has(cell)) return;
    const slots = meshPagesOf(cell);
    const own: Hold = { slots, landed: false, left: false };
    holding.set(cell, own);
    const read = pages.hold(slots).then(
      () => {
        own.landed = true;
        if (own.left) pages.release(slots);
      },
      () => {
        // Nothing was counted: held again at the next frame, unless the cell left meanwhile.
        if (holding.get(cell) !== own) return;
        holding.delete(cell);
        failed.add(cell);
      },
    );
    reads.push(read);
  };
  return {
    /** The manifest's pages, `undefined` when it was read whole. */
    pages,
    /** `cell` was placed: its pages are held, and read if they are not. */
    hold,
    /** `cell` left: its pages are released. */
    release(cell: number) {
      failed.delete(cell);
      const own = holding.get(cell);
      if (!own) return;
      holding.delete(cell);
      if (own.landed) pages!.release(own.slots);
      else own.left = true;
    },
    /** The reads asked since the last call, the holds that failed asked again first. */
    reads() {
      for (const cell of failed) hold(cell);
      failed.clear();
      const asked = reads;
      reads = [];
      return asked;
    },
    /** How many cells hold their pages now. */
    held: () => holding.size,
  };
}
