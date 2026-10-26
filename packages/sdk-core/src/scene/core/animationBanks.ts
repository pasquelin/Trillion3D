/**
 * THE SCENE'S ANIMATION BANKS (`animation-banks.bin`,
 * `packages/asset-compiler-rust/src/compiler/tables/motion/bank.rs`): the clips its instanced skinned
 * objects play on the GPU, each sampled once by the compiler. A BAKE is one skin's clip at its own
 * rate, in frames a second (`BankBake.rate`): each joint's inverse bind matrix as the three rows
 * of its affine part, and for each frame each joint's transform in the skin's frame — the node its
 * top joints hang under —, its translation then its rotation (`ANIMATION_BANK_KEY_FLOATS`). An ITEM
 * is what an object plays: a bake on a mesh, whether its track loops, the second it starts from,
 * its play rate, the screen size under which it rests (0 the run-time setting's, negative never),
 * and its sampled bounds in the frame's space. One item is one track at run time: every instance of
 * it is in one pose (`../../world/animation/bankClock.ts`). Read once with the scene; a file of
 * another version, or one whose records name what it does not hold, is refused by name.
 */
import { EngineError } from '../../contracts/cache.ts'
import type { AnimationBanksDescriptor } from '../../contracts/geometry.ts'
import {
  ANIMATION_BANK_BAKE_WORDS,
  ANIMATION_BANK_INVERSE_FLOATS,
  ANIMATION_BANK_ITEM_WORDS,
  ANIMATION_BANK_KEY_FLOATS,
  ANIMATION_BANK_LOOPING,
  ANIMATION_BANKS_HEADER_WORDS,
  ANIMATION_BANKS_MAGIC,
  ANIMATION_BANKS_VERSION,
} from '../../contracts/writtenFormats.ts'
import type { BankClock } from '../../world/animation/bankClock.ts'

/** One skin's clip, sampled: its joints, its frames, where its inverse binds and its keys start
 *  in the pool, in floats, and the rate its keys are sampled at, in frames a second. */
export type BankBake = {
  readonly joints: number
  readonly frames: number
  readonly inverseAt: number
  readonly keysAt: number
  readonly rate: number
}

/** What an object plays: its bake, whether its track loops, the second it starts from, its play
 *  rate, the screen size under which it rests, its sampled bounds in its skin frame's space —
 *  `[minX, minY, minZ, maxX, maxY, maxZ]`, scaled as its job asked — and its mesh's rank. */
export type BankItem = {
  readonly bake: number
  readonly looping: boolean
  readonly position: number
  readonly playRate: number
  readonly minScreenSize: number
  readonly bounds: Float64Array
  readonly mesh: number
}

/** The banks as their file holds them. */
export type DecodedBanks = {
  readonly bakes: readonly BankBake[]
  readonly items: readonly BankItem[]
  /** Every bake's inverse binds and keys, end to end. */
  readonly pool: Float32Array
}

/** The scene's banks and the clock its tracks play by (`createBankClock`). */
export type AnimationBanks = DecodedBanks & { readonly clock: BankClock }

/** A bank's track of `item` as a placement plays it: the banks, and the item's rank in them. */
export type BankTrack = { readonly banks: AnimationBanks; readonly item: number }

/** Each banks' tracks, by item, made on first ask (`bankTrack`). */
const tracksOf = new WeakMap<AnimationBanks, BankTrack[]>()

/** THE TRACK OF `item` OF `banks`: one object for each item, whoever asks — the meshes a banked
 *  node draws, the rows a cell places it on, the deformation that poses it —, so a track is known
 *  by its identity and no read of one allocates. */
export function bankTrack(banks: AnimationBanks, item: number): BankTrack {
  let tracks = tracksOf.get(banks)
  if (!tracks) tracksOf.set(banks, (tracks = []))
  return (tracks[item] ??= { banks, item })
}

/** The refusal of a banks' entry or file that breaks its own layout. */
const refused = (message: string, details: Record<string, unknown> = {}) =>
  new EngineError('INVALID_SCENE_TABLES', message, details)
/** The refusal of a file of `url` that breaks its own layout. */
const invalid = (url: string, message: string, details: Record<string, unknown> = {}) =>
  refused(`${url}: ${message}`, { url, ...details })

/**
 * Rejects a manifest entry this engine cannot read before a byte of the file is asked.
 * @throws EngineError `UNSUPPORTED_SCENE_TABLES` for another version, `INVALID_SCENE_TABLES` for
 * an entry missing a field.
 */
export function assertAnimationBanks(value: unknown): asserts value is AnimationBanksDescriptor {
  const entry = value as Partial<AnimationBanksDescriptor> | null
  if (!entry || typeof entry !== 'object')
    throw refused('the animation banks entry is not an object')
  if (entry.version !== ANIMATION_BANKS_VERSION)
    throw new EngineError(
      'UNSUPPORTED_SCENE_TABLES',
      `animation banks version ${String(entry.version)} is not the ${ANIMATION_BANKS_VERSION} this runtime reads`,
      { version: entry.version ?? null },
    )
  if (typeof entry.url !== 'string' || !entry.url || typeof entry.sha256 !== 'string')
    throw refused('the animation banks entry names no file')
  for (const key of ['bytes', 'items'] as const)
    if (!Number.isSafeInteger(entry[key]) || entry[key]! < 0)
      throw refused(`the animation banks entry misses ${key}`, { key })
}

/**
 * The banks `bytes` hold, read from `url`: every bake's and item's record checked against the
 * pool and the bakes it names, the pool read in place.
 * @throws EngineError `UNSUPPORTED_SCENE_TABLES` for another magic or version,
 * `INVALID_SCENE_TABLES` for a record naming what the file does not hold.
 */
export function decodeAnimationBanks(bytes: ArrayBuffer, url = 'animation banks'): DecodedBanks {
  const head = ANIMATION_BANKS_HEADER_WORDS
  if (bytes.byteLength < head * 4 || bytes.byteLength % 4)
    throw invalid(url, 'is shorter than its header', { bytes: bytes.byteLength })
  const words = new Uint32Array(bytes)
  const floats = new Float32Array(bytes)
  const [magic, version, bakeCount, itemCount, poolFloats] = words
  if (magic !== ANIMATION_BANKS_MAGIC || version !== ANIMATION_BANKS_VERSION)
    throw new EngineError(
      'UNSUPPORTED_SCENE_TABLES',
      `${url} is not a version ${ANIMATION_BANKS_VERSION} animation bank file`,
      { url, version },
    )
  const bakesAt = head,
    itemsAt = bakesAt + bakeCount * ANIMATION_BANK_BAKE_WORDS,
    poolAt = itemsAt + itemCount * ANIMATION_BANK_ITEM_WORDS
  if (poolAt + poolFloats !== words.length)
    throw invalid(url, 'holds another length than its records say', { bytes: bytes.byteLength })
  const pool = floats.subarray(poolAt, poolAt + poolFloats)
  const bakes = Array.from({ length: bakeCount }, (_, b): BankBake => {
    const at = bakesAt + b * ANIMATION_BANK_BAKE_WORDS
    const [joints, frames, inverseAt, keysAt] = words.subarray(at, at + ANIMATION_BANK_BAKE_WORDS)
    const rate = floats[at + 4]
    const fits =
      joints > 0 &&
      frames > 0 &&
      rate > 0 &&
      Number.isFinite(rate) &&
      inverseAt + joints * ANIMATION_BANK_INVERSE_FLOATS <= poolFloats &&
      keysAt + frames * joints * ANIMATION_BANK_KEY_FLOATS <= poolFloats
    if (!fits) throw invalid(url, `bake ${b} names floats the pool does not hold`, { bake: b })
    return { joints, frames, inverseAt, keysAt, rate }
  })
  const items = Array.from({ length: itemCount }, (_, i): BankItem => {
    const at = itemsAt + i * ANIMATION_BANK_ITEM_WORDS
    const bake = words[at]
    if (bake >= bakeCount) throw invalid(url, `item ${i} names no bake`, { item: i, bake })
    return {
      bake,
      looping: (words[at + 1] & ANIMATION_BANK_LOOPING) !== 0,
      position: floats[at + 2],
      playRate: floats[at + 3],
      minScreenSize: floats[at + 4],
      bounds: Float64Array.from(floats.subarray(at + 5, at + 11)),
      mesh: words[at + 11],
    }
  })
  return { bakes, items, pool }
}
