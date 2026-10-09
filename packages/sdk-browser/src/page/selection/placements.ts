// A page record carries no placement value of its own: its world, its instance-buffer
// row and its winding are those of its root. One record serves every placement of its primitive, so
// an instance — a (placement, page) pair — is named by its packed rank, never by the record alone.
import type { MatrixElements } from '../../host/matrixElements.ts'
import { lastTrue } from '../../../../math/src/scalar/search.ts'

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

/** The packed rank of each root's first page, by root rank, increasing, and the ranks packed in
 *  all: nothing per packed rank, so the index grows with the roots, never with their pages. One per
 *  layout: the packed order is the instances, group by group. An engine holds ONE such object and
 *  rewrites it in place at each layout, growth or mount, so a reader built once reads the current
 *  index, never that of its creation. */
export type PlacementIndex = {
  baseOfRoot: Int32Array
  packedCount: number
  /** The root the last lookup found: a walk over consecutive ranks finds its next one there, or
   *  just behind, without a search (`rootOfPacked`). */
  last?: number
}

/** The root whose pages hold packed rank `packed`, or -1 past the packed ranks: the last root whose
 *  first rank is not past it — one of no page shares its base with the next and is never it. The
 *  root found last, or the one after it, is tried first: a walk over the ranks in order pays no
 *  search. */
export function rootOfPacked(index: PlacementIndex, packed: number) {
  const { baseOfRoot } = index
  if (!(packed >= 0 && packed < index.packedCount) || !baseOfRoot.length) return -1
  for (let rank = index.last ?? 0, k = 0; k < 2 && rank < baseOfRoot.length; k++, rank++)
    if (holds(baseOfRoot, rank, packed)) return (index.last = rank)
  return (index.last = lastTrue(0, baseOfRoot.length - 1, (rank) => baseOfRoot[rank] <= packed))
}

/** Whether root `rank` is the last whose first rank is not past `packed`. */
const holds = (baseOfRoot: Int32Array, rank: number, packed: number) =>
  baseOfRoot[rank] <= packed && (rank + 1 === baseOfRoot.length || baseOfRoot[rank + 1] > packed)

/**
 * Where the pages of a list are placed, in the order of that list: the roots, the packed rank of
 * each page and the index that names each packed rank's root. A reader that walks records from a
 * cut reads the placement of its `i`-th page with `locationOf`.
 */
export type PageLocations = {
  readonly roots: Placements
  readonly packed: ArrayLike<number>
  readonly placement: PlacementIndex
}

/** The root that places the `i`-th page of a located list. */
export function locationOf(locations: PageLocations, i: number) {
  return rootOf(locations.roots, rootOfPacked(locations.placement, locations.packed[i]))
}

/**
 * Posts each root's packed base, and writes the index that resolves a packed rank back to its root
 * into `into` — the engine's one index, a new one if none —, which it returns. What an engine does
 * once its roots were laid out, grown, mounted or removed, before any reader looks one up.
 */
export function postPackedBases(roots: readonly Ranked[], into?: PlacementIndex): PlacementIndex {
  let packed = 0
  for (let rank = 0; rank < roots.length; rank++) {
    roots[rank].packedBase = packed
    packed += roots[rank].pages.length
  }
  const baseOfRoot = new Int32Array(roots.length)
  for (let rank = 0; rank < roots.length; rank++) baseOfRoot[rank] = roots[rank].packedBase ?? 0
  return Object.assign(into ?? {}, { baseOfRoot, packedCount: packed })
}
