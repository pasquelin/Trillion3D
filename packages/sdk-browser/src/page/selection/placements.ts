// A page record carries no placement value of its own: its world, its instance-buffer
// row and its winding are those of its root. One record serves every placement of its primitive, so
// an instance — a (placement, page) pair — is named by its packed rank, never by the record alone.
import type { MatrixElements } from '../../math/matrixElements.ts'

/** What a reader takes of the roots, by rank: their worlds. */
export type Placements = readonly { readonly world: MatrixElements; readonly reach?: number }[]

/** The root of rank `rank` in `roots`. */
export function rootOf<R>(roots: readonly R[], rank: number): R {
  const root = roots[rank]
  if (root === undefined) throw new Error('PAGE_PLACEMENT_MISSING')
  return root
}

/** A root the layout ranked: its pages and the packed rank of its first page. */
type Ranked = { packedBase?: number; pages: readonly unknown[] }

/**
 * Where the pages of a list are placed, in the order of that list: the roots, the packed rank of
 * each page and the root each packed rank belongs to. A reader that walks records from a cut reads
 * the placement of its `i`-th page with `locationOf`.
 */
export type PageLocations = {
  readonly roots: Placements
  readonly packed: ArrayLike<number>
  readonly rootOfPacked: Int32Array
}

/** The root that places the `i`-th page of a located list. */
export function locationOf(locations: PageLocations, i: number) {
  return rootOf(locations.roots, locations.rootOfPacked[locations.packed[i]])
}

/** The packed rank of each root's first page, by root rank, and the root rank of each packed rank.
 *  One table per layout: the packed order is the instances, group by group. An engine
 *  holds ONE such object and rewrites its two tables in place at each layout, growth or mount, so a
 *  reader built once reads the current tables, never those of its creation. */
export type PlacementIndex = {
  baseOfRoot: Int32Array
  rootOfPacked: Int32Array
}

/**
 * Posts each root's packed base, and writes the two tables that resolve a packed rank back to its
 * root into `into` — the engine's one index, a new one if none —, which it returns. What an engine
 * does once its roots were laid out, grown, mounted or removed, before any reader looks one up.
 */
export function postPackedBases(roots: readonly Ranked[], into?: PlacementIndex): PlacementIndex {
  let packed = 0
  for (let rank = 0; rank < roots.length; rank++) {
    roots[rank].packedBase = packed
    packed += roots[rank].pages.length
  }
  const baseOfRoot = new Int32Array(roots.length),
    rootOfPacked = new Int32Array(packed)
  for (let rank = 0; rank < roots.length; rank++) {
    const base = roots[rank].packedBase ?? 0,
      end = base + roots[rank].pages.length
    baseOfRoot[rank] = base
    for (let at = base; at < end; at++) rootOfPacked[at] = rank
  }
  return Object.assign(into ?? {}, { baseOfRoot, rootOfPacked })
}
