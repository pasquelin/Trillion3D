import type { PageRec } from '../../page/selection/selection.ts';
import { postPackedBases, type PlacementIndex } from '../../page/selection/placements.ts';
import { pageAddress } from './pageSlots.ts';
import type { PageList } from '../pages/prepare/catalogue.ts';

type Root = { readonly pages: readonly PageRec[] };
/** One page of a primitive: the root ranks of the primitive's placements, shared by all its pages,
 *  and the page's offset in each of them. */
type PrimitivePage = { readonly placements: number[]; readonly offset: number };

/**
 * The packed ranks of each pool address, stored per PRIMITIVE page (#1235): one entry per page of
 * a primitive, whatever the number of its placements, and each rank derived from a placement's
 * packed base plus the page's offset — Nanite's instance, which stores nothing per page, its
 * clusters being its primitive's page range read from the instance's base.
 */
export type PackedInstances = ReturnType<typeof createPackedInstances>;

export function createPackedInstances(roots: readonly Root[], placement: PlacementIndex) {
  const byAddress = new Map<string, PrimitivePage[]>(),
    placementsOf = new Map<readonly PageRec[], number[]>();
  let indexed = 0,
    entries = 0;
  const instances = {
    /** Indexes the roots ranked from the last call on: those a growth appended. */
    add() {
      for (; indexed < roots.length; indexed++) {
        const { pages } = roots[indexed];
        let placements = placementsOf.get(pages);
        if (!placements) {
          placementsOf.set(pages, (placements = []));
          for (let offset = 0; offset < pages.length; offset++) {
            const address = pageAddress(pages[offset]),
              page = { placements, offset },
              list = byAddress.get(address);
            if (list) list.push(page);
            else byAddress.set(address, [page]);
            entries++;
          }
        }
        placements.push(indexed);
      }
    },
    /** Hands `visit` every packed rank at `address`; false when the address holds none. */
    each(address: string, visit: (packed: number) => void) {
      const list = byAddress.get(address);
      if (!list) return false;
      for (const { placements, offset } of list)
        for (const root of placements) visit(placement.baseOfRoot[root] + offset);
      return true;
    },
    /** The least packed rank at `address`, the one that names it: a primitive's first placement
     *  holds its least base, packed bases growing with the root rank (`postPackedBases`). */
    first(address: string) {
      const list = byAddress.get(address);
      let least: number | undefined;
      for (const { placements, offset } of list ?? []) {
        const packed = placement.baseOfRoot[placements[0]] + offset;
        if (least === undefined || packed < least) least = packed;
      }
      return least;
    },
    /** Entries stored: one per primitive page, never one per packed rank. */
    get size() {
      return entries;
    },
  };
  instances.add();
  return instances;
}

/** The instances of a flat list of pages, each its own rank: one root holds them all. A layout
 *  hands its own instead (`createWebgpuPagesLayout`): this is a table built without one. */
export function flatInstances(list: PageList) {
  const pages =
    'recordOf' in list ? Array.from({ length: list.length }, (_, i) => list.recordOf(i)!) : list;
  const roots = [{ pages }];
  return createPackedInstances(roots, postPackedBases(roots));
}
