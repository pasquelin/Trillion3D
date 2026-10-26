import type { PageRec } from '../selection/types.ts'
import { postPackedBases, type PlacementIndex } from '../selection/placements.ts'
import { pageAddress } from './page/pageSlots.ts'
import type { PageList } from '../selection/catalogue.ts'
import { appendTo, countBy } from '../../../../math/src/sequence/counts.ts'

type Root = { readonly pages: readonly PageRec[] }
/** One page of a primitive: the root ranks of the primitive's placements, shared by all its pages,
 *  and the page's offset in each of them. */
type PrimitivePage = { readonly placements: number[]; readonly offset: number }

/**
 * The packed ranks of each pool address, stored per PRIMITIVE page: one entry per page of
 * a primitive, whatever the number of its placements, and each rank derived from a placement's
 * packed base plus the page's offset: an instance stores nothing per page, its clusters being its
 * primitive's page range read from the instance's base.
 */
export type PackedInstances = ReturnType<typeof createPackedInstances>

/** What the index keeps: the entries of each address, the placements of each primitive, and the
 *  counts. */
interface InstanceIndex {
  byAddress: Map<string, PrimitivePage[]>
  placementsOf: Map<readonly PageRec[], number[]>
  /** How many packed ranks each address holds: the rows its pool slot feeds. */
  counts: Map<string, number>
  indexed: number
  entries: number
  copiesMax: number
}

/** Root `rank` joins its primitive's placements, the primitive's pages indexed at its first. */
function indexRoot(ix: InstanceIndex, roots: readonly Root[], rank: number) {
  const { pages } = roots[rank]
  let placements = ix.placementsOf.get(pages)
  if (!placements) {
    ix.placementsOf.set(pages, (placements = []))
    for (let offset = 0; offset < pages.length; offset++) {
      const page = { placements, offset }
      appendTo(ix.byAddress, pageAddress(pages[offset]), page)
      ix.entries++
    }
  }
  placements.push(rank)
  return pages
}

/** Indexes the roots ranked from the last call on: those a growth appended. Each primitive
 *  that took placements counts each of its pages once, by those placements (#1235). */
function addRoots(ix: InstanceIndex, roots: readonly Root[]) {
  const grown = new Map<readonly PageRec[], number>()
  for (; ix.indexed < roots.length; ix.indexed++) {
    const pages = indexRoot(ix, roots, ix.indexed)
    countBy(grown, pages, 1)
  }
  for (const [pages, by] of grown)
    for (const page of pages) {
      const n = countBy(ix.counts, pageAddress(page), by)
      ix.copiesMax = Math.max(ix.copiesMax, n)
    }
}

export function createPackedInstances(roots: readonly Root[], placement: PlacementIndex) {
  const ix: InstanceIndex = {
    byAddress: new Map<string, PrimitivePage[]>(),
    placementsOf: new Map<readonly PageRec[], number[]>(),
    counts: new Map<string, number>(),
    indexed: 0,
    entries: 0,
    copiesMax: 1,
  }
  const { byAddress } = ix
  const instances = {
    /** The most packed ranks one address holds, 1 at least: what the page table sizes by. */
    get copiesMax() {
      return ix.copiesMax
    },
    add: () => addRoots(ix, roots),
    /** Hands `visit` every packed rank at `address`; false when the address holds none. */
    each(address: string, visit: (packed: number) => void) {
      const list = byAddress.get(address)
      if (!list) return false
      for (const { placements, offset } of list)
        for (const root of placements) visit(placement.baseOfRoot[root] + offset)
      return true
    },
    /** Hands `visit` the least packed rank of each primitive page at `address`: one call a
     *  primitive, whatever its placements — what a table kept per primitive follows. */
    eachPrimitive(address: string, visit: (packed: number) => void) {
      for (const { placements, offset } of byAddress.get(address) ?? [])
        visit(placement.baseOfRoot[placements[0]] + offset)
    },
    /** The least packed rank at `address`, the one that names it: the address's first entry's
     *  first placement. Entries follow the root order their primitive first appears in, roots are
     *  only appended, and packed bases grow with the root rank (`postPackedBases`), so no later
     *  entry or placement ranks lower. */
    first(address: string) {
      const page = byAddress.get(address)?.[0]
      return page && placement.baseOfRoot[page.placements[0]] + page.offset
    },
    /** Entries stored: one per primitive page, never one per packed rank. */
    get size() {
      return ix.entries
    },
  }
  instances.add()
  return instances
}

/** The instances of a flat list of pages, each its own rank: one root holds them all. A layout
 *  hands its own instead (`createWebgpuPagesLayout`): this is a table built without one. */
export function flatInstances(list: PageList) {
  const pages =
    'recordOf' in list ? Array.from({ length: list.length }, (_, i) => list.recordOf(i)!) : list
  const roots = [{ pages }]
  return createPackedInstances(roots, postPackedBases(roots))
}
