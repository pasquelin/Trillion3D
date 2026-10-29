/**
 * THE MARK'S BITS, each named once: a root's mark (`ClusterRoot.mark`) holds the bits below, and,
 * above the 16th bit, the half-float reach (`../../deformation/halfFloat.ts`). Every home of a bit
 * takes its value from this table — the sprite's (`spriteWgsl.ts`), the casting bits here, the draw
 * distance's (`DRAW_DISTANCE_MARK`, `DRAW_INSTANCE_MARK`) and the assembly parent's (`ROOT_PARENT_MARK`,
 * `../../geometry/dag/frameTable.ts`), the world DAG's (`WORLD_ROOT_MARK`,
 * `../../geometry/dag/worlds/worldLinks.ts`) — and a test holds that no two are alike.
 */
export const MARK_BITS = {
  sprite: 1,
  spriteNeverCulled: 2,
  shadowless: 4,
  drawDistance: 8,
  worldRoot: 16,
  rootParent: 256,
  drawInstance: 512,
  cacheStatic: 1024,
  worldSpaceRepresentation: 2048,
  hiddenShadow: 4096,
  movable: 8192,
  immovable: 16384,
  shadowMapless: 32768,
} as const

/**
 * THE CASTING BITS OF A ROOT'S MARK (`ClusterRoot.mark`), and the one value a node's shadow flags
 * make (`nodeCasting`): the bits a placement row keeps (`PlacementRows.casting`), the root takes
 * (`markCasting`) and the shadow casters' flags read (`castFlagsOf`,
 * `../../lighting/shadows/casters/castFlags.ts`).
 * Their values are the table's (`MARK_BITS`).
 */

/** The bit of a root whose node, or the row placing it, casts no shadow (`castShadow = false`): the
 *  shadow raster leaves its rows out. */
export const SHADOWLESS_ROOT = MARK_BITS.shadowless
/** The bit of a root whose node, or the row placing it, leaves its surface out of the shadow maps
 *  (`castsShadowMaps = false`) while another primitive of its mesh casts into them: the shadow raster
 *  leaves its rows out, the distance fields, the cards and the views keep it. A mesh no primitive of
 *  which casts into the maps casts none at all: every primitive is `SHADOWLESS_ROOT` (`nodeCasting`). */
export const SHADOW_MAPLESS_ROOT = MARK_BITS.shadowMapless
/** The bit of a root whose node says its shadow cache is not invalidated by a change of its transform
 *  (`shadowCacheInvalidation` `'static'`): a pose it takes is not drawn again in the shadow maps. */
export const CACHE_STATIC_ROOT = MARK_BITS.cacheStatic
/** The bit of a root whose node stands, in the world, for a first-person one
 *  (`firstPersonWorldSpaceRepresentation`): it casts into the suns' first-person clipmaps alone,
 *  never the regular ones. */
export const WORLD_SPACE_ROOT = MARK_BITS.worldSpaceRepresentation
/** The bit of a root whose node says it is often moving (`mobility` `'movable'`), and that of a root
 *  whose node says it is not (`'static'`, `'stationary'`); neither, a root a skin or a morph deforms
 *  is often moving and any other is not (`castFlagsOf`). */
export const MOVABLE_ROOT = MARK_BITS.movable
export const IMMOVABLE_ROOT = MARK_BITS.immovable
/** The bit of a root whose node casts its shadow while it is hidden (`castHiddenShadow`): no view
 *  draws it then, the shadow maps do (`settleRoot`, `hiddenFromViews`). */
export const HIDDEN_SHADOW_ROOT = MARK_BITS.hiddenShadow
/** The bits a node's shadow flags set. */
const CASTING_BITS =
  SHADOWLESS_ROOT |
  SHADOW_MAPLESS_ROOT |
  CACHE_STATIC_ROOT |
  WORLD_SPACE_ROOT |
  HIDDEN_SHADOW_ROOT |
  MOVABLE_ROOT |
  IMMOVABLE_ROOT

/** The groups that stand for a mesh of several primitives, one host mesh each (`holdPrimitiveGroup`). */
const primitiveGroups = new WeakSet<object>()
/** Records `group` as the parent of a mesh's primitives: they cast into the shadow maps as one mesh does. */
export const holdPrimitiveGroup = (group: object) => void primitiveGroups.add(group)
/** Whether `group` was recorded by `holdPrimitiveGroup`. */
export const isPrimitiveGroup = (group: object) => primitiveGroups.has(group)

/** Whether the mesh of `node` casts into the shadow maps: its primitives are those of its group, and one of them says
 *  it does (`castsShadowMaps` is not `false`), else the node alone is its mesh. */
const meshCastsIntoMaps = (node: {
  castsShadowMaps?: boolean
  parent?: { readonly children: readonly { readonly castsShadowMaps?: boolean }[] } | null
}) =>
  node.castsShadowMaps !== false ||
  (!!node.parent &&
    primitiveGroups.has(node.parent) &&
    node.parent.children.some((part) => part.castsShadowMaps !== false))

/** What a node says of its shadows, as the mark's bits: `SHADOWLESS_ROOT` when it casts none (or is a
 *  first-person object, or its mesh casts into no shadow map, the distance fields' too: no primitive of it does),
 *  `SHADOW_MAPLESS_ROOT` when its surface is left out of the shadow maps alone
 *  (`castsShadowMaps` `false`, another primitive of its mesh casting into them), `WORLD_SPACE_ROOT` when it stands for one, `HIDDEN_SHADOW_ROOT` when
 *  it casts while hidden, `CACHE_STATIC_ROOT` when it says its transform never
 *  invalidates its cached shadows, `MOVABLE_ROOT` or `IMMOVABLE_ROOT` when it says it is often moving
 *  or not. */
export const nodeCasting = (node: {
  castShadow: boolean
  castsShadowMaps?: boolean
  parent?: { readonly children: readonly { readonly castsShadowMaps?: boolean }[] } | null
  shadowCacheInvalidation?: string
  mobility?: string
  firstPerson?: boolean
  firstPersonWorldSpaceRepresentation?: boolean
  castHiddenShadow?: boolean
}) => {
  // Asked once: it scans the node's siblings.
  const meshCasts = meshCastsIntoMaps(node)
  return (
    // A first-person object casts no dynamic shadow of its own.
    (node.castShadow && !node.firstPerson && meshCasts ? 0 : SHADOWLESS_ROOT) |
    (node.castsShadowMaps === false && meshCasts ? SHADOW_MAPLESS_ROOT : 0) |
    (node.firstPersonWorldSpaceRepresentation ? WORLD_SPACE_ROOT : 0) |
    // The reference reads the hidden shadow of an object that is no world-space representation alone.
    (node.castHiddenShadow && !node.firstPersonWorldSpaceRepresentation ? HIDDEN_SHADOW_ROOT : 0) |
    (node.shadowCacheInvalidation === 'static' ? CACHE_STATIC_ROOT : 0) |
    (node.mobility === 'movable' ? MOVABLE_ROOT : node.mobility ? IMMOVABLE_ROOT : 0)
  )
}

/** `mark` with its casting bits set to `casting` (`nodeCasting`), its other bits kept. */
export const withCasting = (mark: number, casting: number) => (mark & ~CASTING_BITS) | casting

/** Sets `root`'s casting bits to `casting`; true when its mark changed. */
export function markCasting(root: { mark?: number }, casting: number) {
  const before = root.mark ?? 0,
    mark = withCasting(before, casting)
  root.mark = mark || undefined
  return mark !== before
}
