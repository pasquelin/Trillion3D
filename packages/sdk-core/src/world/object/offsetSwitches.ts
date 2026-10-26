import { noteNodeWrite } from '../../scene/core/nodeEdits.ts'
import { OBJECT_MOBILITIES, type ObjectMobility } from '../../contracts/objectAbi.ts'

/**
 * HOW A SCENE NODE HOLDS ITS WORLD POSITION OFFSET: the four switches of the object whose surfaces'
 * materials move vertices by a `worldPositionOffset` output (`Material.graph`), read by the
 * engine's rasters. `evaluateWorldPositionOffset` (true) turns the offset on for the object,
 * `worldPositionOffsetDisableDistance` (0, never) stops it past that many metres from the camera
 * to the centre of the object's bounds, `worldPositionOffsetWritesVelocity` (true) makes the
 * movement a motion for the temporal antialiasing and the motion blur, and `shadowCacheInvalidation`
 * says how its shadows are kept: `auto` (the default) draws them again while its offset is evaluated or the object
 * moves, `always` every image, `rigid` not for its offset, `static` not for its offset nor its moves.
 * A material's own `alwaysEvaluateWorldPositionOffset` overrides the first two, its
 * `maxWorldPositionOffset` limits how far the vertices go.
 *
 * `mobility` (`static`, `stationary` or `movable`) says whether the object is often moving: a
 * `movable` one is cached in the dynamic layer of the shadow maps from the frame it joins the scene,
 * the others in the static layer until they first move. Left unset (the default, `undefined`) it is
 * the object's own: `movable` for one whose vertices a skin or a morph moves, `static` otherwise;
 * the engine resolves it where it reads the object's shadows (`castFlagsOf`).
 *
 * Two more switches of the object are held beside them, as they are as seldom set:
 * `firstPerson` (false), an object drawn as a first-person one — in the view's space, close to the
 * camera, as the hands and the weapon of a player —, which casts no dynamic shadow of its own, and
 * `firstPersonWorldSpaceRepresentation` (false), the object that stands for a first-person one in the
 * world — the body of the player —, which the owner's view does not see and which casts its shadow
 * apart from the regular maps (`shadowFirstPersonClipmap`). A node is one or the other, never both.
 * Another, `castHiddenShadow` (false), lets an object that is hidden (`visible = false`, or under a
 * hidden node) go on casting its shadow; no view draws it. The world-space representation is hidden
 * from the view that owns it and casts, whatever this says. The last of them, `holdout` (false), holds
 * the object out of the image's alpha, where the alpha holdout is in effect (`primitiveAlphaHoldout`,
 * `../../contracts/filmOptions.ts`): its pixels draw black, lit by nothing, and punch a hole in the alpha.
 *
 * Held in a table of their own, so that a node that sets none costs nothing: a switch is written
 * through the node's property (`defineOffsetSwitches`), and noted as any node field no pose hook
 * hears (`noteNodeWrite`).
 */
export type ShadowCacheInvalidation = 'auto' | 'always' | 'rigid' | 'static'

/** The values of the shadow cache switch. */
const SHADOW_CACHE_INVALIDATIONS: readonly ShadowCacheInvalidation[] = [
  'auto',
  'always',
  'rigid',
  'static',
]

/** The switches of one node, and how many times any was written (`revision`): what a reader compares
 *  to know a node changed. */
export interface OffsetSwitches {
  evaluate: boolean
  disableDistance: number
  writesVelocity: boolean
  shadowCache: ShadowCacheInvalidation
  mobility: ObjectMobility | undefined
  firstPerson: boolean
  worldSpaceRepresentation: boolean
  castHiddenShadow: boolean
  holdout: boolean
  revision: number
}

const DEFAULTS: Readonly<OffsetSwitches> = {
  evaluate: true,
  disableDistance: 0,
  writesVelocity: true,
  shadowCache: 'auto',
  mobility: undefined,
  firstPerson: false,
  worldSpaceRepresentation: false,
  castHiddenShadow: false,
  holdout: false,
  revision: 0,
}

const held = new WeakMap<object, OffsetSwitches>()
let edits = 0

/** How many times any node's switch was written: a reader that holds what it read under a count reads
 *  it again when the count moves. */
export const offsetSwitchEdits = () => edits

/** The switches of `node`: the defaults for a node that set none. */
export const offsetSwitchesOf = (node: object): Readonly<OffsetSwitches> =>
  held.get(node) ?? DEFAULTS

/** The node property each switch is read and written by. */
const PROPERTIES = {
  evaluateWorldPositionOffset: 'evaluate',
  worldPositionOffsetDisableDistance: 'disableDistance',
  worldPositionOffsetWritesVelocity: 'writesVelocity',
  shadowCacheInvalidation: 'shadowCache',
  mobility: 'mobility',
  firstPerson: 'firstPerson',
  firstPersonWorldSpaceRepresentation: 'worldSpaceRepresentation',
  castHiddenShadow: 'castHiddenShadow',
  holdout: 'holdout',
} as const

/** What a value of switch `key` must be, or why it is refused. */
function refusal(property: string, value: unknown): string | undefined {
  if (property === 'worldPositionOffsetDisableDistance')
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? undefined
      : 'worldPositionOffsetDisableDistance is a distance in metres, 0 or more'
  if (property === 'shadowCacheInvalidation')
    return SHADOW_CACHE_INVALIDATIONS.includes(value as ShadowCacheInvalidation)
      ? undefined
      : `shadowCacheInvalidation is one of ${SHADOW_CACHE_INVALIDATIONS.join(', ')}`
  if (property === 'mobility')
    return value === undefined || OBJECT_MOBILITIES.includes(value as ObjectMobility)
      ? undefined
      : `mobility is one of ${OBJECT_MOBILITIES.join(', ')}, or undefined for the object's own`
  return typeof value === 'boolean' ? undefined : `${property} is true or false`
}

const EXCLUSIVE = 'firstPerson and firstPersonWorldSpaceRepresentation exclude each other'

/** Defines the switches as properties of `proto`, a scene node's prototype. */
export function defineOffsetSwitches(proto: object) {
  for (const [property, key] of Object.entries(PROPERTIES))
    Object.defineProperty(proto, property, {
      configurable: true,
      enumerable: true,
      get(this: object) {
        return offsetSwitchesOf(this)[key]
      },
      set(this: { readonly index: number }, value: unknown) {
        const problem = refusal(property, value)
        if (problem) throw new RangeError(problem)
        if (offsetSwitchesOf(this)[key] === value) return
        // A first-person object and its world-space representation exclude each other.
        if (
          value === true &&
          key === 'firstPerson' &&
          offsetSwitchesOf(this).worldSpaceRepresentation
        )
          throw new RangeError(EXCLUSIVE)
        if (
          value === true &&
          key === 'worldSpaceRepresentation' &&
          offsetSwitchesOf(this).firstPerson
        )
          throw new RangeError(EXCLUSIVE)
        noteNodeWrite(this)
        let own = held.get(this)
        if (!own) held.set(this, (own = { ...DEFAULTS }))
        ;(own[key] as unknown) = value
        own.revision++
        edits++
      },
    })
}

/** Gives `into` the switches of `source`, as a copy of a node does. */
export function copyOffsetSwitches(into: object, source: object) {
  const from = held.get(source)
  if (!from && !held.has(into)) return
  const target = into as Record<string, unknown>
  // The ones turned off first: a first-person switch turned on is refused while its other is on.
  const entries = Object.entries(PROPERTIES)
  for (const turnedOn of [false, true])
    for (const [property, key] of entries) {
      const value = (from ?? DEFAULTS)[key]
      // A light's own `mobility` is not this switch: a value it already holds is not written.
      if ((value === true) === turnedOn && offsetSwitchesOf(into)[key] !== value)
        target[property] = value
    }
}
