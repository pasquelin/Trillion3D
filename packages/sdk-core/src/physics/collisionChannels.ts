import { EngineError } from '../contracts/cache.ts'

/**
 * COLLISION CHANNELS AND RESPONSES. A body has an object type, one of 64 channels, and a response to
 * each channel — `ignore`, `overlap` or `block`. Two bodies meet by what each answers to the other's
 * channel, the lesser of the two answers deciding: both `block` and they collide; the lesser an
 * `overlap` and they pass through each other and report that they overlap; either `ignore`s and
 * they do not know each other. A scene query has a channel and responses of its own and meets the
 * bodies by the same rule (`channelsMeet`).
 *
 * The first eight channels are the engine's own; six more are reserved, and fifty are the game's, to
 * name as it pleases. A named PROFILE sets an object type, which bodies move or sense, and a response
 * to every channel in one word; the profiles below are the engine's defaults.
 */
export const COLLISION_CHANNELS = [
  'worldStatic',
  'worldDynamic',
  'pawn',
  'visibility',
  'camera',
  'physicsBody',
  'vehicle',
  'destructible',
  ...Array.from({ length: 6 }, (_, i) => `engineTrace${i + 1}` as const),
  ...Array.from({ length: 50 }, (_, i) => `gameTrace${i + 1}` as const),
] as const
/** A channel by name. */
export type CollisionChannel = (typeof COLLISION_CHANNELS)[number]
/** How many channels a body distinguishes. */
const CHANNEL_COUNT = COLLISION_CHANNELS.length
/** The number of each channel by name. */
const CHANNEL_NUMBERS: ReadonlyMap<unknown, number> = new Map(
  COLLISION_CHANNELS.map((name, index) => [name, index]),
)
/** The bit of each channel in a mask. */
const CHANNEL_BITS = Array.from({ length: CHANNEL_COUNT }, (_, i) => 1n << BigInt(i))
/** The bit of channel number `index` in a mask (bit `i` is channel `i`). */
const channelBit = (index: number) => CHANNEL_BITS[index]
/** The halves of a 64-bit mask, low word first: the two words the physics module takes it in. */
export const maskWords = (mask: bigint): [number, number] => [
  Number(mask & 0xffffffffn),
  Number(mask >> 32n),
]

/** What a body answers to a channel, from least to most: it does not know it, it passes through
 *  it and reports, it stops against it. */
export const RESPONSE = { ignore: 0, overlap: 1, block: 2 } as const
/** The response of each code of `RESPONSE`. */
const RESPONSE_NAMES = ['ignore', 'overlap', 'block'] as const
/** A response by name. */
export type CollisionResponse = keyof typeof RESPONSE

/** Which of a body's two natures are on: it takes part in the simulation (`physics`) and in the
 *  scene queries and overlaps (`query`). */
export type CollisionEnabled = 'noCollision' | 'queryOnly' | 'physicsOnly' | 'queryAndPhysics'

/** One profile: what its bodies are, and the responses that differ from `block`. */
interface ProfileSpec {
  enabled: CollisionEnabled
  objectType: CollisionChannel
  responses?: Partial<Record<CollisionChannel, CollisionResponse>>
}

/** Every body channel of the engine's own eight, set to `response`. */
const engineEight = (response: CollisionResponse) =>
  Object.fromEntries(COLLISION_CHANNELS.slice(0, 8).map((name) => [name, response])) as Partial<
    Record<CollisionChannel, CollisionResponse>
  >

/** The engine's collision profiles. Every channel not named answers `block`. */
export const COLLISION_PROFILES = {
  NoCollision: {
    enabled: 'noCollision',
    objectType: 'worldStatic',
    responses: { visibility: 'ignore', camera: 'ignore' },
  },
  BlockAll: { enabled: 'queryAndPhysics', objectType: 'worldStatic' },
  OverlapAll: {
    enabled: 'queryOnly',
    objectType: 'worldStatic',
    responses: engineEight('overlap'),
  },
  BlockAllDynamic: { enabled: 'queryAndPhysics', objectType: 'worldDynamic' },
  OverlapAllDynamic: {
    enabled: 'queryOnly',
    objectType: 'worldDynamic',
    responses: engineEight('overlap'),
  },
  IgnoreOnlyPawn: {
    enabled: 'queryOnly',
    objectType: 'worldDynamic',
    responses: { pawn: 'ignore', vehicle: 'ignore' },
  },
  OverlapOnlyPawn: {
    enabled: 'queryOnly',
    objectType: 'worldDynamic',
    responses: { pawn: 'overlap', vehicle: 'overlap', camera: 'ignore' },
  },
  Pawn: { enabled: 'queryAndPhysics', objectType: 'pawn', responses: { visibility: 'ignore' } },
  Spectator: {
    enabled: 'queryOnly',
    objectType: 'pawn',
    responses: { ...engineEight('ignore'), worldStatic: 'block' },
  },
  CharacterMesh: {
    enabled: 'queryOnly',
    objectType: 'pawn',
    responses: { pawn: 'ignore', vehicle: 'ignore', visibility: 'ignore' },
  },
  PhysicsActor: { enabled: 'queryAndPhysics', objectType: 'physicsBody' },
  Destructible: { enabled: 'queryAndPhysics', objectType: 'destructible' },
  InvisibleWall: {
    enabled: 'queryAndPhysics',
    objectType: 'worldStatic',
    responses: { visibility: 'ignore' },
  },
  InvisibleWallDynamic: {
    enabled: 'queryAndPhysics',
    objectType: 'worldDynamic',
    responses: { visibility: 'ignore' },
  },
  Trigger: {
    enabled: 'queryOnly',
    objectType: 'worldDynamic',
    responses: { ...engineEight('overlap'), visibility: 'ignore' },
  },
  Ragdoll: {
    enabled: 'queryAndPhysics',
    objectType: 'physicsBody',
    responses: { pawn: 'ignore', visibility: 'ignore' },
  },
  Vehicle: { enabled: 'queryAndPhysics', objectType: 'vehicle' },
  UI: {
    enabled: 'queryOnly',
    objectType: 'worldDynamic',
    responses: { ...engineEight('overlap'), visibility: 'block' },
  },
} as const satisfies Record<string, ProfileSpec>
/** A profile by name. */
export type CollisionProfileName = keyof typeof COLLISION_PROFILES

/** A body's collision, as `obj.physics` takes it: a profile, then what differs from it. */
export interface CollisionOptions {
  /** A profile to start from. @defaultValue by the body: `BlockAll` when it is static,
   *  `PhysicsActor` when it is dynamic, `BlockAllDynamic` when it is kinematic. */
  profile?: CollisionProfileName
  /** The channel the body is: what the others answer to. @defaultValue the profile's */
  objectType?: CollisionChannel | number
  /** What the body answers to channels, over the profile's; a channel is a name or its number. */
  responses?:
    Partial<Record<CollisionChannel, CollisionResponse>> | Record<number, CollisionResponse>
  /** Whether the body takes part in the simulation, in the queries, in both or in neither.
   *  @defaultValue the profile's */
  enabled?: CollisionEnabled
}

/** A body's collision settled: its channel, and which channels it blocks and overlaps as bit
 *  masks (bit `i` is channel `i`). */
export interface ResolvedCollision {
  /** The channel, from 0. */ objectType: number
  /** Bit `i` set: the body blocks channel `i`. */ block: bigint
  /** Bit `i` set: the body overlaps channel `i`. */ overlap: bigint
  /** Takes part in the scene queries and overlaps. */ query: boolean
  /** Takes part in the simulation. */ physics: boolean
}

/** The number of a channel given by name or number; refuses what is neither. */
export function channelIndex(channel: CollisionChannel | number): number {
  const index = typeof channel === 'number' ? channel : (CHANNEL_NUMBERS.get(channel) ?? -1)
  if (!Number.isInteger(index) || index < 0 || index >= CHANNEL_COUNT)
    throw new EngineError(
      'COLLISION_CHANNEL',
      `Collision channel ${JSON.stringify(channel)} does not exist: one of ${CHANNEL_COUNT} channels, by name or from 0 to ${CHANNEL_COUNT - 1}.`,
      { channel },
    )
  return index
}

/** The bit mask of `channels`. */
export const channelMask = (channels: readonly (CollisionChannel | number)[]) =>
  channels.reduce((mask, channel) => mask | channelBit(channelIndex(channel)), 0n)

/** The profile a body is made with when it names none (`CollisionOptions.profile`). */
export const defaultProfile = (
  type: 'static' | 'dynamic' | 'kinematic',
  sensor = false,
): CollisionProfileName => (sensor ? 'OverlapAllDynamic' : MOTION_PROFILES[type])

/** The profile of a body that is not a sensor, by its motion. */
const MOTION_PROFILES = {
  static: 'BlockAll',
  dynamic: 'PhysicsActor',
  kinematic: 'BlockAllDynamic',
} as const satisfies Record<'static' | 'dynamic' | 'kinematic', CollisionProfileName>

const ENABLED = {
  noCollision: { query: false, physics: false },
  queryOnly: { query: true, physics: false },
  physicsOnly: { query: false, physics: true },
  queryAndPhysics: { query: true, physics: true },
} as const satisfies Record<CollisionEnabled, { query: boolean; physics: boolean }>

/** The masks of the channels a response table blocks and overlaps. */
interface ResponseMasks {
  block: bigint
  overlap: bigint
}

/** The response named `name`, refused when no response. */
function responseOf(name: unknown, channel: unknown): number {
  const response = RESPONSE[name as CollisionResponse]
  if (response === undefined)
    throw new EngineError(
      'COLLISION_RESPONSE',
      `Collision response ${JSON.stringify(name)} for channel ${JSON.stringify(channel)} does not exist: ignore, overlap or block.`,
      { channel, response: name },
    )
  return response
}

/** The masks `masks` become when the responses of `table`, a record by channel name or number, are
 *  set over them: each channel it names takes the answer it gives. */
function overridden(table: CollisionOptions['responses'], masks: ResponseMasks): ResponseMasks {
  let { block, overlap } = masks
  for (const [channel, name] of Object.entries(table ?? {})) {
    const bit = channelBit(
      channelIndex(/^\d+$/.test(channel) ? Number(channel) : (channel as CollisionChannel)),
    )
    const response = responseOf(name, channel)
    block = response === RESPONSE.block ? block | bit : block & ~bit
    overlap = response === RESPONSE.overlap ? overlap | bit : overlap & ~bit
  }
  return { block, overlap }
}

/** The masks of each profile, made when first asked. */
const profileMasks = new Map<CollisionProfileName, ResponseMasks>()

/**
 * A body's collision settled from `options` and the `fallback` profile it starts from when it names
 * none: the profile's responses (every channel not named `block`), then `responses` over them, the
 * channel `objectType` and the `enabled` switch over the profile's.
 */
export function resolveCollision(
  options: CollisionOptions | undefined,
  fallback: CollisionProfileName,
): ResolvedCollision {
  const name = options?.profile ?? fallback
  const profile: ProfileSpec | undefined = COLLISION_PROFILES[name]
  if (!profile)
    throw new EngineError(
      'COLLISION_PROFILE',
      `Collision profile ${JSON.stringify(name)} does not exist: one of ${Object.keys(COLLISION_PROFILES).join(', ')}.`,
      { profile: name },
    )
  let own = profileMasks.get(name)
  if (!own)
    profileMasks.set(
      name,
      (own = overridden(profile.responses as CollisionOptions['responses'], {
        block: (1n << BigInt(CHANNEL_COUNT)) - 1n,
        overlap: 0n,
      })),
    )
  const { block, overlap } = overridden(options?.responses, own)
  const { query, physics } = ENABLED[options?.enabled ?? profile.enabled]
  return {
    objectType: channelIndex(options?.objectType ?? profile.objectType),
    block,
    overlap,
    query,
    physics,
  }
}

/** The response `a` and `b` meet with: each answers to the other's channel, the lesser deciding. */
export function channelsMeet(a: ResolvedCollision, b: ResolvedCollision): CollisionResponse {
  const seen = (mine: ResolvedCollision, other: ResolvedCollision) => {
    const bit = channelBit(other.objectType)
    return mine.block & bit
      ? RESPONSE.block
      : mine.overlap & bit
        ? RESPONSE.overlap
        : RESPONSE.ignore
  }
  const met = Math.min(seen(a, b), seen(b, a))
  return RESPONSE_NAMES[met]
}

/** The channel, then the two words of each of the masks of a collision: the five words a scene query holds its answers in. */
export const channelWords = (r: ResolvedCollision): readonly number[] => [
  r.objectType,
  ...maskWords(r.block),
  ...maskWords(r.overlap),
]

/** What a collision's key holds before the motion class, made once for a collision (a body made with no options shares its). */
const keyStems = new WeakMap<ResolvedCollision, string>()

/** A key that two collisions share when they are one filter in the module (`FILTER`): same
 *  channel, same answers, same switches, same motion class. */
export function filterKey(r: ResolvedCollision, isStatic: boolean) {
  let stem = keyStems.get(r)
  if (stem === undefined)
    keyStems.set(
      r,
      (stem = `${r.objectType}/${r.block.toString(16)}/${r.overlap.toString(16)}/${+r.query}${+r.physics}`),
    )
  return stem + +isStatic
}

/** What debris answers: it meets the static world alone, every other channel ignored. */
const DEBRIS_RESPONSES: CollisionOptions['responses'] = Object.fromEntries(
  COLLISION_CHANNELS.map((name) => [name, name === 'worldStatic' ? 'block' : 'ignore']),
) as Record<CollisionChannel, CollisionResponse>

/** The debris' options, one object. */
const DEBRIS_OPTIONS: CollisionOptions = { responses: DEBRIS_RESPONSES }
/** The collisions of the bodies that name none, by the profile they start from: shared, a body's collision being read, never written. */
const PLAIN_COLLISIONS = new Map<CollisionProfileName, ResolvedCollision>()
const DEBRIS_COLLISIONS = new Map<CollisionProfileName, ResolvedCollision>()

/**
 * The collision of a body made with `options`: the one it names (`collision`), else the debris'
 * (`decorative`), else its motion's profile (`defaultProfile`), a `sensor` being a trigger volume.
 * The last two are one collision for all the bodies that have them.
 */
export function bodyCollision(options: {
  type: 'static' | 'dynamic' | 'kinematic'
  sensor?: boolean
  decorative?: boolean
  collision?: CollisionOptions
}): ResolvedCollision {
  const fallback = defaultProfile(options.type, options.sensor)
  if (options.collision) return resolveCollision(options.collision, fallback)
  const held = options.decorative ? DEBRIS_COLLISIONS : PLAIN_COLLISIONS
  let collision = held.get(fallback)
  if (!collision)
    held.set(
      fallback,
      (collision = resolveCollision(options.decorative ? DEBRIS_OPTIONS : undefined, fallback)),
    )
  return collision
}
