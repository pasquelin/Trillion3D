import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

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
  farShadow: 32,
  farTest: 64,
  farSkip: 128,
  rootParent: 256,
  drawInstance: 512,
  cacheStatic: 1024,
  worldSpaceRepresentation: 2048,
  hiddenShadow: 4096,
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
/** The bit of a root whose node, or the row placing it, casts far shadows (`castFarShadow`): a sun's
 *  far-shadow test never leaves its rows out. */
export const FAR_SHADOW_ROOT = MARK_BITS.farShadow
/** The bit of a root whose node says a sun's far-shadow test reaches it (`farShadowTest` `true`),
 *  and that of a root whose node says it never does (`false`); neither, the view's rule decides
 *  (`farShadowCullsAllMeshes`, the world's merged shells). */
const FAR_TEST_ROOT = MARK_BITS.farTest
const FAR_SKIP_ROOT = MARK_BITS.farSkip
/** The bit of a root whose node says its shadow cache is not invalidated by a change of its transform
 *  (`shadowCacheInvalidation` `'static'`): a pose it takes is not drawn again in the shadow maps. */
export const CACHE_STATIC_ROOT = MARK_BITS.cacheStatic
/** The bit of a root whose node stands, in the world, for a first-person one
 *  (`firstPersonWorldSpaceRepresentation`): it casts into the suns' first-person clipmaps alone,
 *  never the regular ones. */
export const WORLD_SPACE_ROOT = MARK_BITS.worldSpaceRepresentation
/** The bit of a root whose node casts its shadow while it is hidden (`castHiddenShadow`): no view
 *  draws it then, the shadow maps do (`settleRoot`, `hiddenFromViews`). */
export const HIDDEN_SHADOW_ROOT = MARK_BITS.hiddenShadow
/** The bits a node's shadow flags set. */
const CASTING_BITS =
  SHADOWLESS_ROOT |
  FAR_SHADOW_ROOT |
  FAR_TEST_ROOT |
  FAR_SKIP_ROOT |
  CACHE_STATIC_ROOT |
  WORLD_SPACE_ROOT |
  HIDDEN_SHADOW_ROOT

/** The bit a far-shadow test setting sets: `FAR_TEST_ROOT` for `true`, `FAR_SKIP_ROOT` for `false`,
 *  none for a setting that is left out (`null`, `undefined`). */
const farTestBits = (test: boolean | null | undefined) =>
  test === true ? FAR_TEST_ROOT : test === false ? FAR_SKIP_ROOT : 0

/** What a node says of its shadows, as the mark's bits: `SHADOWLESS_ROOT` when it casts none (or is a
 *  first-person object), `WORLD_SPACE_ROOT` when it stands for one, `HIDDEN_SHADOW_ROOT` when it casts while hidden,
 *  `FAR_SHADOW_ROOT` when it casts far ones, `FAR_TEST_ROOT` or `FAR_SKIP_ROOT` when it says the
 *  far-shadow test reaches it or never does, `CACHE_STATIC_ROOT` when it says its transform never
 *  invalidates its cached shadows. */
export const nodeCasting = (node: {
  castShadow: boolean
  castFarShadow?: boolean
  farShadowTest?: boolean | null
  shadowCacheInvalidation?: string
  firstPerson?: boolean
  firstPersonWorldSpaceRepresentation?: boolean
  castHiddenShadow?: boolean
}) =>
  // A first-person object casts no dynamic shadow of its own.
  (node.castShadow && !node.firstPerson ? 0 : SHADOWLESS_ROOT) |
  (node.firstPersonWorldSpaceRepresentation ? WORLD_SPACE_ROOT : 0) |
  // The reference reads the hidden shadow of an object that is no world-space representation alone.
  (node.castHiddenShadow && !node.firstPersonWorldSpaceRepresentation ? HIDDEN_SHADOW_ROOT : 0) |
  (node.castFarShadow ? FAR_SHADOW_ROOT : 0) |
  (node.shadowCacheInvalidation === 'static' ? CACHE_STATIC_ROOT : 0) |
  farTestBits(node.farShadowTest)

/**
 * Whether a sun's far-shadow test reaches a root of mark `mark` (its casting bits, and the world
 * DAG's own bit `MARK_BITS.worldRoot` for a placement of the world DAG: its merged shells are
 * reached by default): the root says it is reached (`FAR_TEST_ROOT`), or it is one of the shells, or
 * the view says every mesh is (`allMeshes`), unless the root says it never is (`FAR_SKIP_ROOT`,
 * which wins). The one truth of the test: the shadow raster's caster flags (`casters/castFlags.ts`
 * and the WGSL that reads them) and the distance-field cascade's object flags
 * (`lighting/distanceField/objectCasting.ts`) are built from it, so the maps and the cascade
 * shadow a mesh alike — one of them, never both nor neither.
 */
export const farTestedOf = (mark: number, allMeshes: boolean) =>
  !(mark & FAR_SKIP_ROOT) && (allMeshes || (mark & (FAR_TEST_ROOT | MARK_BITS.worldRoot)) !== 0)

/** The same rule in WGSL, over the three facts it reads: the root is reached on its own account
 *  (its own say or the world's shells'), it is skipped, the view says every mesh is reached. */
export const FAR_TESTED_WGSL = wgslFn(
  'farTestedOf',
  [],
  'fn farTestedOf(reached:bool,skipped:bool,allMeshes:bool)->bool{return !skipped&&(reached||allMeshes);}',
)

/** `casting` with the far-shadow test the compiled scene names for the placement (`test`, the job's
 *  `farShadowTest` of the object) when `casting` says none of its own: a node's own setting at run
 *  time wins over the compiled one. */
export const withCompiledFarTest = (casting: number, test: boolean | undefined) =>
  casting & (FAR_TEST_ROOT | FAR_SKIP_ROOT) ? casting : casting | farTestBits(test)

/** `mark` with its casting bits set to `casting` (`nodeCasting`), its other bits kept. */
export const withCasting = (mark: number, casting: number) => (mark & ~CASTING_BITS) | casting

/** Sets `root`'s casting bits to `casting`; true when its mark changed. */
export function markCasting(root: { mark?: number }, casting: number) {
  const before = root.mark ?? 0,
    mark = withCasting(before, casting)
  root.mark = mark || undefined
  return mark !== before
}
