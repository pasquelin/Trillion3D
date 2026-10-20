import type { PageRec } from '../../page/selection/types.ts'
import { postPackedBases, type PlacementIndex } from '../../page/selection/placements.ts'
import { pageAddress } from './pageSlots.ts'
import type { PageList } from '../../page/selection/catalogue.ts'
import { countBy } from '../../../../math/src/sequence/counts.ts'

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

export function createPackedInstances(roots: readonly Root[], placement: PlacementIndex) {
  const byAddress = new Map<string, PrimitivePage[]>(),
    placementsOf = new Map<readonly PageRec[], number[]>(),
    /** The blended pages, each once per primitive: what the casters' rows follow
     *  (`blendCasters.ts`), never a walk over every page. */
    blended: PrimitivePage[] = []
  let indexed = 0,
    entries = 0
  /** How many packed ranks each address holds: the rows its pool slot feeds. */
  const counts = new Map<string, number>()
  /** Root `rank` joins its primitive's placements, the primitive's pages indexed at its first. */
  const indexRoot = (rank: number) => {
    const { pages } = roots[rank]
    let placements = placementsOf.get(pages)
    if (!placements) {
      placementsOf.set(pages, (placements = []))
      for (let offset = 0; offset < pages.length; offset++) {
        const address = pageAddress(pages[offset]),
          page = { placements, offset },
          list = byAddress.get(address)
        if (list) list.push(page)
        else byAddress.set(address, [page])
        if (pages[offset].transparent) blended.push(page)
        entries++
      }
    }
    placements.push(rank)
    return pages
  }
  const instances = {
    /** The most packed ranks one address holds, 1 at least: what the page table sizes by. */
    copiesMax: 1,
    /** Indexes the roots ranked from the last call on: those a growth appended. Each primitive
     *  that took placements counts each of its pages once, by those placements (#1235). */
    add() {
      const grown = new Map<readonly PageRec[], number>()
      for (; indexed < roots.length; indexed++) {
        const pages = indexRoot(indexed)
        countBy(grown, pages, 1)
      }
      for (const [pages, by] of grown)
        for (const page of pages) {
          const n = countBy(counts, pageAddress(page), by)
          instances.copiesMax = Math.max(instances.copiesMax, n)
        }
    },
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
    /** Hands `visit` the packed rank of every blended instance, primitive page by primitive page. */
    eachBlended(visit: (packed: number) => void) {
      for (const { placements, offset } of blended)
        for (const root of placements) visit(placement.baseOfRoot[root] + offset)
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
      return entries
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
