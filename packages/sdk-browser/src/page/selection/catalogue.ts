import type { DeformationOutput, PageRec } from './types.ts'
import { rootOfPacked, type PlacementIndex } from './placements.ts'

/**
 * The packed instances of a layout, stored as nothing per instance (#1235): a rank is resolved
 * through the placement tables to its root and the root's shared `pages`, a cluster being its
 * primitive's page offset plus the instance's base.
 */
type PackedPages = {
  readonly length: number
  recordOf(packed: number): PageRec | undefined
  /** Where the instance's deformation writes the results of its page, none for a page that is not
   *  deformed (`ClusterRoot.deformationOutputs`). */
  outputOf?(packed: number): DeformationOutput | undefined
}

/** A list of packed pages: a flat array (a fixture) or a layout's view. */
export type PageList = readonly PageRec[] | PackedPages

/** The packed pages of `roots` as `placement` ranks them, read live: a growth that rewrites the
 *  tables in place (`postPackedBases(roots, placement)`) is followed with no copy. */
export function createPackedPages(
  roots: readonly {
    readonly pages: readonly PageRec[]
    readonly deformationOutputs?: readonly (DeformationOutput | undefined)[]
  }[],
  placement: PlacementIndex,
): PackedPages {
  return {
    get length() {
      return placement.packedCount
    },
    recordOf(packed: number) {
      const root = rootOfPacked(placement, packed)
      if (root < 0) return undefined
      return roots[root]?.pages[packed - placement.baseOfRoot[root]]
    },
    outputOf(packed: number) {
      const root = rootOfPacked(placement, packed)
      return root < 0
        ? undefined
        : roots[root]?.deformationOutputs?.[packed - placement.baseOfRoot[root]]
    },
  }
}

/**
 * The one catalogue accessor of an engine.
 *
 * A packed rank is the engine's identity for an instance — a (placement, page) pair — and this is
 * the only way a consumer turns it back into a record: `recordOf(packed)`. A rank outside the
 * catalogue yields nothing, like an id missing from the table. One record serves every placement of
 * its primitive (#1235), so a record names no single packed rank: the reverse direction does not
 * exist, and a reader that needs one takes it from the placement tables the layout owns.
 *
 * The cut and the residency route by packed ranks; no consumer builds a second catalogue or a
 * second record reference beside this one (#483 rule 4).
 */
export function createPageCatalogue(packedPages: PageList) {
  const recordOf =
    'recordOf' in packedPages
      ? packedPages.recordOf
      : (packed: number) => (packed >= 0 ? packedPages[packed] : undefined)
  const outputOf =
    'outputOf' in packedPages && packedPages.outputOf
      ? packedPages.outputOf
      : (): DeformationOutput | undefined => undefined
  return { recordOf, outputOf }
}
