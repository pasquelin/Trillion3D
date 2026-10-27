import type { RootOffsetRow } from '../../../geometry/rows/page/offsetRow.ts'
import { CASTS_NO_SHADOW_MAP } from '../../../visibility/shader/spriteWgsl.ts'
import {
  CACHE_STATIC_ROOT,
  WORLD_SPACE_ROOT,
  HIDDEN_SHADOW_ROOT,
  IMMOVABLE_ROOT,
  MOVABLE_ROOT,
} from '../../../visibility/shader/castingMark.ts'
import {
  MOBILITY_CACHE_STATIC,
  MOBILITY_DEFORMS,
  MOBILITY_OFFSET_ALWAYS,
  MOBILITY_OFFSET_SILENT,
  MOBILITY_OFFSET_KEEPS_CACHE,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_OFTEN_MOVING,
  MOBILITY_SHADOWLESS,
  MOBILITY_WORLD_SPACE,
  MOBILITY_HIDDEN_SHADOW,
  mobilityChannelsOf,
} from '../mobilityBits.ts'

type CastRoot = { mark?: number; parked?: boolean; deformation?: object }
type CastOffsets = Pick<RootOffsetRow, 'evaluate' | 'cache' | 'worn' | 'always' | 'bits'>

/** The bits of the offset a root's surfaces wear (`castFlagsOf`): whether its object evaluates none,
 *  keeps it from invalidating its shadows (`'rigid'`, `'static'`) or wears one that may invalidate
 *  them, whether it evaluates it whatever the distance says, and the lighting channels it is in. */
const offsetFlagsOf = (offsets?: CastOffsets) => {
  const keeps = offsets?.cache === 'rigid' || offsets?.cache === 'static'
  const invalidates = !!offsets?.worn && !keeps && !!(offsets.evaluate || offsets.always)
  return (
    (offsets && !offsets.evaluate ? MOBILITY_OFFSET_SILENT : 0) |
    (keeps ? MOBILITY_OFFSET_KEEPS_CACHE : 0) |
    (invalidates ? MOBILITY_OFFSET_INVALIDATES : 0) |
    (offsets?.always ? MOBILITY_OFFSET_ALWAYS : 0) |
    mobilityChannelsOf(offsets?.bits ?? 0)
  )
}

/** The bits a root's mark gives (`castFlagsOf`): casts no shadow (a root whose surface is left out
 *  of the shadow maps, `CASTS_NO_SHADOW_MAP`, casts none into them: the word is the maps' alone),
 *  the world's shells, the hidden shadow, the cached static one and the deformation. */
const markFlagsOf = (root: CastRoot | undefined, resting: boolean) => {
  const mark = root?.mark ?? 0
  return (
    (!root || root.parked || mark & CASTS_NO_SHADOW_MAP ? MOBILITY_SHADOWLESS : 0) |
    // A parked root is out of the scene: no first-person clipmap stands for it.
    (mark & WORLD_SPACE_ROOT && !root?.parked ? MOBILITY_WORLD_SPACE : 0) |
    (mark & HIDDEN_SHADOW_ROOT ? MOBILITY_HIDDEN_SHADOW : 0) |
    (mark & CACHE_STATIC_ROOT ? MOBILITY_CACHE_STATIC : 0) |
    (root?.deformation && !resting ? MOBILITY_DEFORMS : 0)
  )
}

/** A root's casting bits as the mobility word holds them: casts no shadow (a root the cut no longer
 *  holds, a parked one, or one whose mark says so), whether its
 *  transform never invalidates its cached shadows, whether a deformation moves its vertices, whether
 *  its object does not evaluate the offset its surfaces wear (an object that names no switches does)
 *  and whether it keeps that offset from invalidating its shadows (`'rigid'`, `'static'`) or wears one
 *  that may invalidate them, one of which evaluates it whatever the distance says, and whether it is
 *  often moving: its object says so (`mobility`), a skin or a morph deforms it, or `wpoMoves` — a
 *  surface of it wears an offset or a displacement and the session does not cache the primitives that
 *  wear one (`shadowCacheWpoPrimitives`, decided where the words are written, `rootWords.ts`).
 *  A root that is banked and reads its rest pose this frame (`resting`) deforms nothing now; one
 *  that a deformation moves sets the deforming bit, which caches its pages as dynamic.
 *  The object's lighting channels go with them, stored as the object holds them. */
export const castFlagsOf = (
  root?: CastRoot,
  offsets?: CastOffsets,
  resting = false,
  wpoMoves = false,
) => {
  const mark = root?.mark ?? 0
  const deforms = !!root?.deformation && (mark & IMMOVABLE_ROOT) === 0
  const often = (mark & MOVABLE_ROOT) !== 0 || deforms || wpoMoves
  return offsetFlagsOf(offsets) | (often ? MOBILITY_OFTEN_MOVING : 0) | markFlagsOf(root, resting)
}
