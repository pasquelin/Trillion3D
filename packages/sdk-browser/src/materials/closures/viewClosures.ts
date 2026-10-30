import { MAX_CLOSURES } from '../../../../sdk-core/src/world/material/graph/closures.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { carriesWeight } from '../../../../sdk-core/src/world/material/graph/closureFlatten.ts'
import type { CompiledGraph } from '../graph/compile.ts'

/** The closures a compiled graph shades a pixel with: its flattened tree's, one without a tree. */
export const closureCountOf = (compiled: Pick<CompiledGraph, 'closures'>) =>
  compiled.closures?.flat.closures.length ?? 1

/**
 * The closures a view must hold a pixel for to show this graph: its count, and two for a tree that flattens to one closure that
 * carries a weight (`carriesWeight`), the record keeping the coverage of the first closure only when it holds several.
 */
export const closureSlotsOf = (compiled: Pick<CompiledGraph, 'closures'>) => {
  const count = closureCountOf(compiled)
  return compiled.closures && count === 1 && carriesWeight(compiled.closures.flat.closures[0])
    ? 2
    : count
}

/** The closures a view keeps a pixel: the most of the materials seen `viewMax` when the count is
 *  taken from the materials, else the project's `closuresPerPixel`; held between one and the format's most. */
export function effectiveMaxClosures(
  fromMaterial: boolean,
  viewMax: number,
  closuresPerPixel: number,
) {
  return clamp(
    fromMaterial ? Math.min(viewMax, closuresPerPixel) : closuresPerPixel,
    1,
    MAX_CLOSURES,
  )
}
