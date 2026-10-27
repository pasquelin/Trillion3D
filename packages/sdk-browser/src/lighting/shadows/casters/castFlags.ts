import type { RootOffsetRow } from '../../../geometry/rows/page/offsetRow.ts'
import { CASTS_NO_SHADOW } from '../../../visibility/shader/spriteWgsl.ts'
import {
  CACHE_STATIC_ROOT,
  FAR_SHADOW_ROOT,
  farTestedOf,
  WORLD_SPACE_ROOT,
  HIDDEN_SHADOW_ROOT,
  IMMOVABLE_ROOT,
  MOVABLE_ROOT,
} from '../../../visibility/shader/castingMark.ts'
import {
  MOBILITY_CACHE_STATIC,
  MOBILITY_DEFORMS,
  MOBILITY_FAR_SHADOW,
  MOBILITY_FAR_SKIPPED,
  MOBILITY_FAR_TESTED,
  MOBILITY_OFFSET_ALWAYS,
  MOBILITY_OFFSET_SILENT,
  MOBILITY_OFFSET_KEEPS_CACHE,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_OFTEN_MOVING,
  MOBILITY_SHADOWLESS,
  MOBILITY_WORLD_SPACE,
  MOBILITY_HIDDEN_SHADOW,
} from '../mobilityBits.ts'

/** A root's casting bits as the mobility word holds them: casts no shadow (a root the cut no longer
 *  holds, a parked one, or one whose mark says so), casts far shadows, the far-shadow test's
 *  two flags — reached on the root's own account, never reached (`farTestedOf`) —, whether its
 *  transform never invalidates its cached shadows, whether a deformation moves its vertices, whether
 *  its object does not evaluate the offset its surfaces wear (an object that names no switches does)
 *  and whether it keeps that offset from invalidating its shadows (`'rigid'`, `'static'`) or wears one
 *  that may invalidate them, one of which evaluates it whatever the distance says, and whether it is
 *  often moving: its object says so (`mobility`), else a skin or a morph deforms it.
 *  A root that is banked and reads its rest pose this frame (`resting`) deforms nothing now. A
 *  deformation sets the deforming bit, which has the pages its casters draw invalidated as they are
 *  drawn, only where `invalidates` (`shadowCacheDeformableMeshesInvalidate`); the root is often
 *  moving either way.
 *  The shadow raster adds the world's shells and the view's rule to them (`vsmRenderFarFlags`). */
export const castFlagsOf = (
  root?: { mark?: number; parked?: boolean; deformation?: object },
  offsets?: Pick<RootOffsetRow, 'evaluate' | 'cache' | 'worn' | 'always'>,
  resting = false,
  invalidates = true,
) => {
  const mark = root?.mark ?? 0
  const keeps = offsets?.cache === 'rigid' || offsets?.cache === 'static'
  const deforms = !!root?.deformation && (mark & IMMOVABLE_ROOT) === 0
  const often = (mark & MOVABLE_ROOT) !== 0 || deforms
  return (
    (offsets && !offsets.evaluate ? MOBILITY_OFFSET_SILENT : 0) |
    (keeps ? MOBILITY_OFFSET_KEEPS_CACHE : 0) |
    (offsets?.worn && !keeps && (offsets.evaluate || offsets.always)
      ? MOBILITY_OFFSET_INVALIDATES
      : 0) |
    (offsets?.always ? MOBILITY_OFFSET_ALWAYS : 0) |
    (often ? MOBILITY_OFTEN_MOVING : 0) |
    (!root || root.parked || mark & CASTS_NO_SHADOW ? MOBILITY_SHADOWLESS : 0) |
    (mark & FAR_SHADOW_ROOT ? MOBILITY_FAR_SHADOW : 0) |
    // A parked root is out of the scene: no first-person clipmap stands for it.
    (mark & WORLD_SPACE_ROOT && !root?.parked ? MOBILITY_WORLD_SPACE : 0) |
    (mark & HIDDEN_SHADOW_ROOT ? MOBILITY_HIDDEN_SHADOW : 0) |
    (mark & CACHE_STATIC_ROOT ? MOBILITY_CACHE_STATIC : 0) |
    (root?.deformation && !resting && invalidates ? MOBILITY_DEFORMS : 0) |
    (farTestedOf(mark, false) ? MOBILITY_FAR_TESTED : 0) |
    (farTestedOf(mark, true) ? 0 : MOBILITY_FAR_SKIPPED)
  )
}
