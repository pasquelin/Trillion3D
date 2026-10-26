import type { RootOffsetRow } from '../../../geometry/rows/page/offsetRow.ts'
import { CASTS_NO_SHADOW } from '../../../visibility/shader/spriteWgsl.ts'
import {
  CACHE_STATIC_ROOT,
  FAR_SHADOW_ROOT,
  farTestedOf,
  WORLD_SPACE_ROOT,
  HIDDEN_SHADOW_ROOT,
} from '../../../visibility/shader/castingMark.ts'
import {
  MOBILITY_CACHE_STATIC,
  MOBILITY_DEFORMS,
  MOBILITY_FAR_SHADOW,
  MOBILITY_FAR_SKIPPED,
  MOBILITY_FAR_TESTED,
  MOBILITY_OFFSET_SILENT,
  MOBILITY_OFFSET_KEEPS_CACHE,
  MOBILITY_SHADOWLESS,
  MOBILITY_WORLD_SPACE,
  MOBILITY_HIDDEN_SHADOW,
} from '../mobilityBits.ts'

/** A root's casting bits as the mobility word holds them: casts no shadow (a root the cut no longer
 *  holds, a parked one, or one whose mark says so), casts far shadows, the far-shadow test's
 *  two flags — reached on the root's own account, never reached (`farTestedOf`) —, whether its
 *  transform never invalidates its cached shadows, whether a deformation moves its vertices, whether
 *  its object does not evaluate the offset its surfaces wear (an object that names no switches does)
 *  and whether it keeps that offset from invalidating its shadows (`'rigid'`, `'static'`);
 *  the shadow raster adds the world's shells and the view's rule to them (`vsmRenderFarFlags`). */
export const castFlagsOf = (
  root?: { mark?: number; parked?: boolean; deformation?: object },
  offsets?: Pick<RootOffsetRow, 'evaluate' | 'cache'>,
) => {
  const mark = root?.mark ?? 0
  return (
    (offsets && !offsets.evaluate ? MOBILITY_OFFSET_SILENT : 0) |
    (offsets?.cache === 'rigid' || offsets?.cache === 'static' ? MOBILITY_OFFSET_KEEPS_CACHE : 0) |
    (!root || root.parked || mark & CASTS_NO_SHADOW ? MOBILITY_SHADOWLESS : 0) |
    (mark & FAR_SHADOW_ROOT ? MOBILITY_FAR_SHADOW : 0) |
    // A parked root is out of the scene: no first-person clipmap stands for it.
    (mark & WORLD_SPACE_ROOT && !root?.parked ? MOBILITY_WORLD_SPACE : 0) |
    (mark & HIDDEN_SHADOW_ROOT ? MOBILITY_HIDDEN_SHADOW : 0) |
    (mark & CACHE_STATIC_ROOT ? MOBILITY_CACHE_STATIC : 0) |
    (root?.deformation ? MOBILITY_DEFORMS : 0) |
    (farTestedOf(mark, false) ? MOBILITY_FAR_TESTED : 0) |
    (farTestedOf(mark, true) ? 0 : MOBILITY_FAR_SKIPPED)
  )
}
