import * as G from '../../host/graph/graph.fixture.ts'
import type { MatrixElements } from '../../host/matrixElements.ts'
import type { PageLocations, PlacementIndex, Placements } from './placements.ts'

/** Every index of an empty list reads 0: a page of the single identity root. */
const zeros = () =>
  new Proxy<number[]>([], { get: (_t, p) => (typeof p === 'symbol' ? undefined : 0) })

/** The index of a packing whose page `p` is root `ranks[p]`'s, the ranks never decreasing, over
 *  `roots` roots: each root's first page, a root of no page at the next one's. */
export function indexOfRanks(
  ranks: ArrayLike<number>,
  roots = ranks.length ? ranks[ranks.length - 1] + 1 : 0,
): PlacementIndex {
  const baseOfRoot = new Int32Array(roots)
  for (let r = 0, page = 0; r < roots; r++) {
    while (page < ranks.length && ranks[page] < r) page++
    baseOfRoot[r] = page
  }
  return { baseOfRoot, packedCount: ranks.length }
}

type Identity = Placements & PageLocations

/**
 * One root at the identity, and the location of every page: what a test page of the identity root
 * is placed by. It is both a `Placements` — an array of one root — and a `PageLocations` whose
 * `roots` names itself and whose every packed rank maps to that root, so a test can hand
 * it to either reader.
 */
export const identityRoots = (): Identity => {
  const roots = [{ world: new G.Matrix4() as MatrixElements }] as unknown as Identity
  Object.assign(roots, {
    packed: zeros(),
    placement: { baseOfRoot: Int32Array.of(0), packedCount: Infinity },
  })
  ;(roots as { roots: Placements }).roots = roots
  return roots
}

/** Locations of `roots`, the `i`-th page placed by root `i`: the fixture every test uses. */
export function locatedBy(roots: Placements): PageLocations {
  return {
    roots,
    packed: Array.from({ length: roots.length }, (_, i) => i),
    placement: indexOfRanks(Array.from({ length: roots.length }, (_, i) => i)),
  }
}

/** Locations of `count` pages all placed by the single identity root. */
export const identityLocations = (_count: number): PageLocations => identityRoots()
