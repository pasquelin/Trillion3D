import { noteNodeWrite } from '../../scene/core/nodeEdits.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import {
  NO_SHADOW_CAPSULES,
  OBJECT_CAPSULE_SHADOW_RULES,
  SHADOW_CAPSULES_EXPECTED,
  isShadowCapsules,
  type ShadowCapsuleBody,
} from '../../contracts/capsuleShadowOptions.ts'
import { OBJECT_MOBILITIES, type ObjectMobility } from '../../contracts/objectAbi.ts'
import {
  DEFAULT_LIGHTING_CHANNELS,
  internLightingChannels,
  isLightingChannels,
  LIGHTING_CHANNELS_EXPECTED,
  type LightingChannels,
} from '../../contracts/lightingChannelsAbi.ts'

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
 * from the view that owns it and casts, whatever this says. Another, `holdout` (false), holds
 * the object out of the image's alpha, where the alpha holdout is in effect (`primitiveAlphaHoldout`,
 * `../../contracts/filmOptions.ts`): its pixels draw black, lit by nothing, and punch a hole in the alpha.
 * One more, `castContactShadow` (true), says whether the object stops the contact shadow rays the lights
 * cast from the pixels around it (`../../contracts/contactShadowOptions.ts`); `false` lets them through.
 * `castCapsuleDirectShadow` and `castCapsuleIndirectShadow` (false) say whether the object casts the capsule shadows of its
 * `shadowCapsules` (none), spheres and capsules fitted to its bones, from the lights and on the sky and the indirect light
 * (`../../contracts/capsuleShadowOptions.ts`), `capsuleIndirectShadowMinVisibility` (0.1) the share of the indirect light that
 * stays under that shadow.
 * `lightingChannels` (channel 0 alone) says which of the three lighting channels the object is in: a light
 * lights it, and a light's shadow holds it, only where they share a channel (`../../contracts/lightingChannelsAbi.ts`).
 * And two that hide it by who looks: `ownerNoSee` (false) hides the object from the views that belong to
 * its owner, `onlyOwnerSee` (false) from every view but those (`Camera.owner`; a view with no owner
 * belongs to no one). The view that owns the object is the one whose camera's `owner` is the object
 * itself or a node above it; the casting of a world-space representation, until a camera names an owner,
 * keeps its own rule (`firstPersonWorldSpaceRepresentation`).
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
  castContactShadow: boolean
  castCapsuleDirectShadow: boolean
  castCapsuleIndirectShadow: boolean
  capsuleIndirectShadowMinVisibility: number
  shadowCapsules: readonly ShadowCapsuleBody[]
  lightingChannels: Readonly<LightingChannels>
  ownerNoSee: boolean
  onlyOwnerSee: boolean
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
  castContactShadow: true,
  castCapsuleDirectShadow: OBJECT_CAPSULE_SHADOW_RULES.castCapsuleDirectShadow.default,
  castCapsuleIndirectShadow: OBJECT_CAPSULE_SHADOW_RULES.castCapsuleIndirectShadow.default,
  capsuleIndirectShadowMinVisibility:
    OBJECT_CAPSULE_SHADOW_RULES.capsuleIndirectShadowMinVisibility.default,
  shadowCapsules: NO_SHADOW_CAPSULES,
  lightingChannels: DEFAULT_LIGHTING_CHANNELS,
  ownerNoSee: false,
  onlyOwnerSee: false,
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

/** A scene node, whose write the edits count hears (`noteNodeWrite`). */
type SwitchNode = { readonly index: number }

/** The switches that hold a value of their own, not counting the revision. */
type SwitchKey = Exclude<keyof OffsetSwitches, 'revision'>

/**
 * The rule of one switch, `key` of the node's table: what a value must be (`accepts`, said by `expects` when it is not), how it
 * is held (`normalize`: the value stored for one that was accepted) and how it is read and written, whatever its type. A value is
 * checked once, by `refusal`; `held` and `write` take one that passed.
 */
function switchRule<K extends SwitchKey>(
  key: K,
  accepts: (value: unknown) => value is OffsetSwitches[K],
  expects: string,
  normalize: (value: OffsetSwitches[K]) => OffsetSwitches[K] = (value) => value,
) {
  return {
    /** Why `value` is refused for the node's property `property`, or `undefined`. */
    refusal: (property: string, value: unknown) =>
      accepts(value) ? undefined : `${property} is ${expects}`,
    /** The value held for `value`, one `refusal` passed. */
    held: (value: unknown) => normalize(value as OffsetSwitches[K]),
    /** Writes `value`, one `refusal` passed, into `into`. */
    write(into: OffsetSwitches, value: unknown) {
      into[key] = normalize(value as OffsetSwitches[K])
    },
    /** The value `from` holds, and whether it is the default. */
    read: (from: Readonly<OffsetSwitches>) => from[key],
    isDefault: (from: Readonly<OffsetSwitches>) => from[key] === DEFAULTS[key],
  }
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isUnit = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= 1
const isDistance = (value: unknown): value is number => isFiniteNumber(value) && value >= 0
const isShadowCache = (value: unknown): value is ShadowCacheInvalidation =>
  SHADOW_CACHE_INVALIDATIONS.some((one) => one === value)
const isMobility = (value: unknown): value is ObjectMobility | undefined =>
  value === undefined || OBJECT_MOBILITIES.some((one) => one === value)

/** The node property each switch is read and written by, and its rule. */
const SWITCHES = {
  evaluateWorldPositionOffset: switchRule('evaluate', isBoolean, 'true or false'),
  worldPositionOffsetDisableDistance: switchRule(
    'disableDistance',
    isDistance,
    'a distance in metres, 0 or more',
  ),
  worldPositionOffsetWritesVelocity: switchRule('writesVelocity', isBoolean, 'true or false'),
  shadowCacheInvalidation: switchRule(
    'shadowCache',
    isShadowCache,
    `one of ${SHADOW_CACHE_INVALIDATIONS.join(', ')}`,
  ),
  mobility: switchRule(
    'mobility',
    isMobility,
    `one of ${OBJECT_MOBILITIES.join(', ')}, or undefined for the object's own`,
  ),
  firstPerson: switchRule('firstPerson', isBoolean, 'true or false'),
  firstPersonWorldSpaceRepresentation: switchRule(
    'worldSpaceRepresentation',
    isBoolean,
    'true or false',
  ),
  castHiddenShadow: switchRule('castHiddenShadow', isBoolean, 'true or false'),
  holdout: switchRule('holdout', isBoolean, 'true or false'),
  castContactShadow: switchRule('castContactShadow', isBoolean, 'true or false'),
  castCapsuleDirectShadow: switchRule('castCapsuleDirectShadow', isBoolean, 'true or false'),
  castCapsuleIndirectShadow: switchRule('castCapsuleIndirectShadow', isBoolean, 'true or false'),
  capsuleIndirectShadowMinVisibility: switchRule(
    'capsuleIndirectShadowMinVisibility',
    isUnit,
    'a number from 0 to 1',
  ),
  shadowCapsules: switchRule(
    'shadowCapsules',
    isShadowCapsules,
    SHADOW_CAPSULES_EXPECTED,
    (bodies) => (bodies.length ? Object.freeze([...bodies]) : NO_SHADOW_CAPSULES),
  ),
  // The channels held are the one frozen object of their mask: equal sets are the same value.
  lightingChannels: switchRule(
    'lightingChannels',
    isLightingChannels,
    LIGHTING_CHANNELS_EXPECTED,
    internLightingChannels,
  ),
  ownerNoSee: switchRule('ownerNoSee', isBoolean, 'true or false'),
  onlyOwnerSee: switchRule('onlyOwnerSee', isBoolean, 'true or false'),
}

/** The name of a switch as a node's property. */
type OffsetSwitchProperty = keyof typeof SWITCHES

/** The values of some switches, by the node's property: what a saved node holds of the ones not at their defaults. */
export type OffsetSwitchValues = {
  [property in OffsetSwitchProperty]?: ReturnType<(typeof SWITCHES)[property]['read']>
}

const RULES = Object.entries(SWITCHES)
const RULE_OF = new Map(RULES)

const EXCLUSIVE = 'firstPerson and firstPersonWorldSpaceRepresentation exclude each other'

/** Makes `next` the switches of `node`: refused if a first-person object would also be its own world-space representation; its revision and the
 *  count of edits move once. */
function commit(node: SwitchNode, next: OffsetSwitches) {
  if (next.firstPerson && next.worldSpaceRepresentation) throw new RangeError(EXCLUSIVE)
  noteNodeWrite(node)
  next.revision++
  held.set(node, next)
  edits++
}

/** The refusal of `value` for the node's property `property`, thrown. */
function refuse(property: string, rule: (typeof SWITCHES)[OffsetSwitchProperty], value: unknown) {
  const problem = rule.refusal(property, value)
  if (problem) throw new RangeError(problem)
}

/** Gives `node` the one switch `property`, its rule and the value written; nothing if the node holds it so already.
 *  @throws RangeError naming the value refused. */
function assignRule(
  node: SwitchNode,
  property: string,
  rule: (typeof SWITCHES)[OffsetSwitchProperty],
  value: unknown,
) {
  refuse(property, rule, value)
  const current = offsetSwitchesOf(node)
  if (rule.read(current) === rule.held(value)) return
  const next = { ...current }
  rule.write(next, value)
  commit(node, next)
}

/**
 * Gives `node` the switches of `writes`, each a node property, its rule and the value written: all or none. Every value is checked
 * against its rule before the first is written, and the switches that would result against each other (a first-person object is never
 * also its own world-space representation); the node's table is then written once, its revision and the count of edits moving once,
 * for the switches that changed, and not at all where none did.
 * @throws RangeError naming the first value refused.
 */
function assignRules(
  node: SwitchNode,
  writes: readonly (readonly [string, (typeof SWITCHES)[OffsetSwitchProperty], unknown])[],
) {
  for (const [property, rule, value] of writes) refuse(property, rule, value)
  const current = offsetSwitchesOf(node)
  let next: OffsetSwitches | undefined
  for (const [, rule, value] of writes)
    if (rule.read(next ?? current) !== rule.held(value))
      rule.write((next ??= { ...current }), value)
  if (next) commit(node, next)
}

/** Gives `node` the switches `values` names, by their node properties, or none of them (`assignRules`).
 *  @throws RangeError naming the first value refused. */
export function assignOffsetSwitches(node: SwitchNode, values: OffsetSwitchValues) {
  assignRules(
    node,
    Object.entries(values).flatMap(([property, value]) => {
      const rule = RULE_OF.get(property)
      return rule ? [[property, rule, value] as const] : []
    }),
  )
}

/** Whether `node` has had a switch written: one that has not holds every switch at its default. */
export const holdsOffsetSwitches = (node: object) => held.has(node)

/** The switches of `node` that are not at their defaults, by their node properties: what a saved node holds. */
export function offsetSwitchesSet(node: object): OffsetSwitchValues {
  const own = held.get(node)
  if (!own) return {}
  return Object.fromEntries(
    RULES.filter(([, rule]) => !rule.isDefault(own)).map(([property, rule]) => [
      property,
      rule.read(own),
    ]),
  )
}

/** Every switch of `node`, by its node property: the value `saved` holds, else the default; none (`undefined`) for a node that holds no
 *  switch, given none: it is at its defaults already. */
export function offsetSwitchValues(
  node: object,
  saved: OffsetSwitchValues,
): OffsetSwitchValues | undefined {
  const named = new Map(Object.entries(saved))
  if (!held.has(node) && RULES.every(([property]) => !named.has(property))) return undefined
  return Object.fromEntries(
    RULES.map(([property, rule]) => [property, named.get(property) ?? rule.read(DEFAULTS)]),
  )
}

/** Defines the switches as properties of `proto`, a scene node's prototype. */
export function defineOffsetSwitches(proto: object) {
  for (const [property, rule] of RULES)
    Object.defineProperty(proto, property, {
      configurable: true,
      enumerable: true,
      get(this: object) {
        return rule.read(offsetSwitchesOf(this))
      },
      set(this: SwitchNode, written: unknown) {
        assignRule(this, property, rule, written)
      },
    })
}

/** Gives `into` the switches of `source`, as a copy of a node does. */
export function copyOffsetSwitches(into: SwitchNode, source: object) {
  if (!held.has(source) && !held.has(into)) return
  const from = offsetSwitchesOf(source)
  assignRules(
    into,
    RULES.map(([property, rule]) => [property, rule, rule.read(from)] as const),
  )
}
