/**
 * THE MANIFEST PAGES AND WORLD BUNDLES A PARTITION'S CELLS HOLD (#751, #1237). A cell placed holds
 * the mesh pages its region page names (`TableCell.meshPages`), counted once per cell: a page many
 * cells share stays read while one of them is placed. A cell that leaves releases them, and a page
 * no placed cell holds leaves the manifest with its primitives (`ManifestPages`). It holds the
 * same way the world bundles past the pinned top its objects' roots depend on (`world`,
 * `../scene/worldRoots.ts`). A hold that failed holds nothing and is asked again at the next frame while
 * its cell is placed. Without `pages` the manifest was read whole: every mesh the cells place has
 * its primitive from the open.
 */
import type { ManifestPages } from '../../../sdk-core/src/manifest/paged.ts';
import type { PlacedMesh } from './rows.ts';
import type { WorldRootsHold } from '../scene/worldRoots.ts';

/** What a placed cell holds from one source, counted per cell. */
type Holder = Pick<WorldRootsHold, 'hold' | 'release'>;

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

/** The holds of the cells placed on `pages` and `world`, each cell's mesh pages read through
 *  `meshPagesOf` when it is held and kept until it is released: its index page may close first. */
export function createCellPages(
  pages: ManifestPages | undefined,
  meshPagesOf: (cell: number) => readonly string[],
  world?: Holder,
) {
  const holders: Holder[] = world ? [world] : [];
  if (pages) {
    // Counted per hold landed: a cell that left and came back while its first hold read lands
    // twice, and each release lets one go.
    const slotsOf = new Map<number, { slots: readonly string[]; holds: number }>();
    holders.push({
      async hold(cell) {
        const slots = meshPagesOf(cell);
        await pages.hold(slots);
        const own = slotsOf.get(cell);
        if (own) own.holds++;
        else slotsOf.set(cell, { slots, holds: 1 });
      },
      release(cell) {
        const own = slotsOf.get(cell)!;
        pages.release(own.slots);
        if (--own.holds === 0) slotsOf.delete(cell);
      },
    });
  }
  /** The hold of each cell whose pages are held, and the cells whose hold failed while placed. A
   *  cell that leaves while its hold reads releases once it lands: a hold that fails counts
   *  nothing, and releasing it too would drop a page another cell holds. */
  type Hold = { landed: boolean; left: boolean };
  const holding = new Map<number, Hold>(),
    failed = new Set<number>();
  let reads: Promise<void>[] = [];
  const hold = (cell: number) => {
    if (!holders.length || holding.has(cell)) return;
    const own: Hold = { landed: false, left: false };
    holding.set(cell, own);
    const read = Promise.allSettled(holders.map((holder) => holder.hold(cell))).then((held) => {
      const landed = holders.filter((_, at) => held[at].status === 'fulfilled');
      if (landed.length === holders.length) {
        own.landed = true;
        if (own.left) for (const holder of holders) holder.release(cell);
        return;
      }
      // What landed is let go: held again whole at the next frame, unless the cell left meanwhile.
      for (const holder of landed) holder.release(cell);
      if (holding.get(cell) !== own) return;
      holding.delete(cell);
      failed.add(cell);
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
      const own = holding.get(cell);
      if (!own) return;
      holding.delete(cell);
      if (own.landed) for (const holder of holders) holder.release(cell);
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
