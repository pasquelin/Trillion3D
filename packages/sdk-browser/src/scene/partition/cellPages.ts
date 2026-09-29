/**
 * THE MANIFEST PAGES A PARTITION'S CELLS HOLD (#751). A cell placed holds the mesh pages its region
 * page names (`TableCell.meshPages`), counted once per cell: a page many cells share stays read
 * while one of them is placed. A cell that leaves releases them, and a page no placed cell holds
 * leaves the manifest with its primitives (`ManifestPages`). A hold that failed is asked again at
 * the next frame while its cell is placed. Without `pages` the manifest was read whole: nothing is
 * held, and every mesh the cells place has its primitive from the open.
 */
import type { ManifestPages } from '../../../../sdk-core/src/index.ts';
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts';

export function createCellPages(pages: ManifestPages | undefined, cells: readonly TableCell[]) {
  /** The cells whose pages are held, and those whose hold failed while they are placed. */
  const holding = new Set<number>(),
    failed = new Set<number>();
  let reads: Promise<void>[] = [];
  const hold = (cell: number) => {
    if (!pages || holding.has(cell)) return;
    holding.add(cell);
    const read = pages.hold(cells[cell].meshPages).catch(() => {
      // Nothing was counted: held again at the next frame, unless the cell left meanwhile.
      if (holding.delete(cell)) failed.add(cell);
    });
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
      if (holding.delete(cell)) pages!.release(cells[cell].meshPages);
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
