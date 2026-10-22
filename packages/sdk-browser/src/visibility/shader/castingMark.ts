/**
 * THE CASTING BITS OF A ROOT'S MARK (`ClusterRoot.mark`), and the one value a node's shadow flags
 * make (`nodeCasting`): the bits a placement row keeps (`PlacementRows.casting`), the root takes
 * (`markCasting`) and the shadow raster's rows read (`../../lighting/shadows/casters/bounds.ts`).
 * The mark's bits, all in one place: 1 and 2 the sprite's (`spriteWgsl.ts`), 4 and 32 here, 16 the
 * world DAG's (`WORLD_ROOT_MARK`, `../../geometry/dag/worlds/worldLinks.ts`), and above the 16th bit
 * the half-float reach (`../../deformation/halfFloat.ts`): no two alike.
 */

/** The bit of a root whose node, or the row placing it, casts no shadow (`castShadow = false`): the
 *  shadow raster leaves its rows out. */
export const SHADOWLESS_ROOT = 4
/** The bit of a root whose node, or the row placing it, casts far shadows (`castFarShadow`): a sun's
 *  far-shadow test never leaves its rows out. */
export const FAR_SHADOW_ROOT = 32
/** The bits a node's shadow flags set. */
const CASTING_BITS = SHADOWLESS_ROOT | FAR_SHADOW_ROOT

/** What a node says of its shadows, as the mark's bits: `SHADOWLESS_ROOT` when it casts none,
 *  `FAR_SHADOW_ROOT` when it casts far ones. */
export const nodeCasting = (node: { castShadow: boolean; castFarShadow?: boolean }) =>
  (node.castShadow ? 0 : SHADOWLESS_ROOT) | (node.castFarShadow ? FAR_SHADOW_ROOT : 0)

/** `mark` with its casting bits set to `casting` (`nodeCasting`), its other bits kept. */
export const withCasting = (mark: number, casting: number) => (mark & ~CASTING_BITS) | casting

/** Sets `root`'s casting bits to `casting`; true when its mark changed. */
export function markCasting(root: { mark?: number }, casting: number) {
  const before = root.mark ?? 0,
    mark = withCasting(before, casting)
  root.mark = mark || undefined
  return mark !== before
}
