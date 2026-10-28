import { EngineError } from '../../contracts/cache.ts'
import { grownLength, resized } from '../../../../math/src/sequence/resized.ts'
import {
  LIGHT_FUNCTION_BITS,
  LIGHT_FUNCTION_SHIFT,
  LIGHT_PROFILE_BITS,
  LIGHT_PROFILE_SHIFT,
  LIGHT_UNDRAWN_SHIFT,
  SCENE_LIGHT_HEADER_FLOATS,
  type SceneLight,
  type SceneLightingView,
} from './contracts.ts'
import { type SceneEnvironment, validateSceneEnvironment } from '../core/environment.ts'
import { sameSceneLight } from './equal.ts'
import {
  LIGHT_FIELD,
  baseOf,
  kindWordOf,
  writeContactGi,
  writeDrawRange,
  writeLightFields,
  DRAW_LANES,
  type LightLanes,
} from './fields.ts'
import { NO_LIGHT_RANGE_VIEW, type LightRangeView } from './drawRange.ts'
import { createSunBlocks } from './sunBlocks.ts'
import { validateSceneLight } from './validate.ts'
import { createLightKinds } from './kinds.ts'
import { NO_CONTACT_SHADOW_VIEW, type ContactShadowView } from './contactShadowView.ts'
import { NO_LIGHT_SHADOW_VIEW, type LightShadowView } from './shadowedBits.ts'
import { contactShadowOfLight, sameLightContactShadow } from './lightContactShadow.ts'
import { createLightRanks } from './lightRanks.ts'
import { profileLaneOf, profileSliceOf } from './lightProfile.ts'
import { createEnvironmentBlock } from './environmentBlock.ts'

/** What a light store holds: the packed table and its parts, the lights' records and the counters
 *  that tell a reader something changed. The functions below are its operations. */
export interface LightTable extends LightLanes {
  capacity: number
  packed: Float32Array<ArrayBuffer>
  /** The same buffer as words: the lanes that hold whole numbers (`LIGHT_FIELD.kind`) are written through it. */
  words: Uint32Array<ArrayBuffer>
  header: Uint32Array<ArrayBuffer>
  revision: Uint32Array<ArrayBuffer>
  /** The draw range of each light, `DRAW_LANES` floats a slot, the CPU's alone (`writeDrawRange`, `lightDrawn`). */
  draw: Float32Array<ArrayBuffer>
  readonly ids: string[]
  readonly indexOf: Map<string, number>
  readonly records: Map<string, SceneLight>
  readonly environment: ReturnType<typeof createEnvironmentBlock>
  readonly kinds: ReturnType<typeof createLightKinds>
  readonly ranks: ReturnType<typeof createLightRanks>
  suns: ReturnType<typeof createSunBlocks>
  view: SceneLightingView
  epoch: number
  /** Whether the air shades the lights: on unless the quality settings turn the atmosphere off. */
  airOn: boolean
  /** The epoch's bumps that moved no light transport: a fog alone, a shadow slice alone. */
  notTransport: number
  /** How many lights wear a light function: the atlas plans nothing at 0. */
  wearing: number
  /** The view's contact shadow settings the lights' lanes are folded with (`writeContactShadow`). */
  readonly contactView: ContactShadowView
  /** Whether the view's dynamic shadows are on, which the lights' shadowed values are written under (`kindWordOf`). */
  readonly shadowView: LightShadowView
  /** The view's settings the lights' draw ranges are folded with (`writeDrawRange`). */
  readonly rangeView: LightRangeView
  /** Rises when a light that names a profile is added or removed, or a light's profile changes: what the profile
   *  atlas's sync (`lighting/lightProfile/profileSync.ts`) waits on, so that it scans the lights only then. */
  profileEpoch: number
}

/** Twice the room, content kept: N lights cost log N copies. */
function growTable(table: LightTable) {
  table.capacity = grownLength(table.capacity, 32)
  table.packed = resized(table.packed, baseOf(table.capacity))
  table.words = new Uint32Array(table.packed.buffer)
  table.header = new Uint32Array(table.packed.buffer, 0, SCENE_LIGHT_HEADER_FLOATS)
  table.revision = resized(table.revision, table.capacity)
  table.draw = resized(table.draw, table.capacity * DRAW_LANES)
}

/** A light's atlas slice lives in the buffer itself: it is not held twice. */
export const sliceOf = (table: LightTable, slot: number) =>
  table.packed[baseOf(slot) + LIGHT_FIELD.shadowSlice]

function writeSlice(table: LightTable, slot: number, slice: number) {
  table.packed[baseOf(slot) + LIGHT_FIELD.shadowSlice] = slice
}

/** A light's index in the light function table lives in its kind word, above the flags. */
export const lightFunctionOf = (table: LightTable, slot: number) =>
  (table.words[baseOf(slot) + LIGHT_FIELD.kind] >>> LIGHT_FUNCTION_SHIFT) % 2 ** LIGHT_FUNCTION_BITS

/** Records whether the view draws the light of `slot` (`lightDrawn`), in the bit of its kind word that says it leaves it out: the
 *  view's decision, not the light's, so no epoch moves and no shadow page is staled. Whether the bit changed. */
export function assignDrawn(table: LightTable, slot: number, drawn: boolean) {
  const at = baseOf(slot) + LIGHT_FIELD.kind
  const word = table.words[at]
  if (((word >>> LIGHT_UNDRAWN_SHIFT) & 1) === (drawn ? 0 : 1)) return false
  table.words[at] = (word ^ (1 << LIGHT_UNDRAWN_SHIFT)) >>> 0
  return true
}

/** The profile lane of a light's kind word: its profile's atlas slice plus one, 0 for none. */
const profileLaneAt = (table: LightTable, slot: number) =>
  (table.words[baseOf(slot) + LIGHT_FIELD.kind] >>> LIGHT_PROFILE_SHIFT) % 2 ** LIGHT_PROFILE_BITS

/** The atlas slice of a light's profile, held in its kind word; −1 for none. */
export const lightProfileSliceOf = (table: LightTable, slot: number) =>
  profileSliceOf(profileLaneAt(table, slot))

/** 1 where a light names a light function. */
const wears = (light: SceneLight | undefined) => (light?.lightFunction === undefined ? 0 : 1)

/** Writes a light's kind word again, with `index` for its light function's — a change of the index moves
 *  its shadowed value — and `lane` for its profile's; both default to the ones the slot holds. */
function writeKind(
  table: LightTable,
  slot: number,
  light: SceneLight,
  index = lightFunctionOf(table, slot),
  lane = profileLaneAt(table, slot),
) {
  table.words[baseOf(slot) + LIGHT_FIELD.kind] = kindWordOf(light, table.shadowView, index, lane)
}

/** Fields declared by the host, and the light function index and profile lane the slot holds (`index`, `lane`). The shadow
 *  slice is not one: the scheduler sets it, and a write keeps it. */
function writeSlot(
  table: LightTable,
  slot: number,
  light: SceneLight,
  index = lightFunctionOf(table, slot),
  lane = profileLaneAt(table, slot),
) {
  writeLightFields(table, baseOf(slot), light, index, lane)
  writeDrawRange(table.draw, slot, light, table.rangeView)
}

export function createLightTable(): LightTable {
  const contactView = { ...NO_CONTACT_SHADOW_VIEW }
  const shadowView = { ...NO_LIGHT_SHADOW_VIEW }
  const table: LightTable = {
    capacity: 0,
    packed: new Float32Array(0),
    words: new Uint32Array(0),
    header: new Uint32Array(0),
    revision: new Uint32Array(0),
    draw: new Float32Array(0),
    ids: [],
    indexOf: new Map<string, number>(),
    records: new Map<string, SceneLight>(),
    environment: createEnvironmentBlock(),
    kinds: createLightKinds(contactView, shadowView),
    ranks: createLightRanks(),
    suns: undefined as unknown as ReturnType<typeof createSunBlocks>,
    view: 'auto',
    epoch: 1,
    airOn: true,
    notTransport: 0,
    wearing: 0,
    contactView,
    shadowView,
    rangeView: { ...NO_LIGHT_RANGE_VIEW },
    profileEpoch: 0,
  }
  growTable(table)
  table.suns = createSunBlocks({
    ids: table.ids,
    records: table.records,
    indexOf: table.indexOf,
    rankOf: table.ranks.of,
    packed: () => table.packed,
    header: () => table.header,
    environment: () => table.environment.current,
    atmosphere: () => (table.airOn ? table.environment.current?.atmosphere : undefined),
    environmentPacked: table.environment.packed,
    write: (slot, light) => writeSlot(table, slot, light),
  })
  return table
}

/** Adds a light, and returns its slot. */
export function addLight(table: LightTable, light: SceneLight) {
  const validated = validateSceneLight(light)
  if (table.indexOf.has(validated.id))
    throw new EngineError('DUPLICATE_SCENE_LIGHT', `light ${validated.id} already present`, {
      id: validated.id,
    })
  const slot = table.ids.length
  if (slot >= table.capacity) growTable(table)
  table.ids.push(validated.id)
  table.indexOf.set(validated.id, slot)
  table.records.set(validated.id, validated)
  table.wearing += wears(validated)
  if (validated.iesProfile !== undefined) table.profileEpoch++
  table.ranks.take(validated.id)
  table.kinds.tally(validated, 1)
  table.revision[slot]++
  writeSlot(table, slot, validated)
  // A new slot is zero in the buffer; without a slice, the published value is −1.
  writeSlice(table, slot, -1)
  table.header[0] = table.ids.length
  table.suns.added(validated)
  table.epoch++
  return slot
}

/**
 * A light whose contact shadow alone changed: its lanes are written again and the epoch published, as a
 * change of the view is (`setTableContactView`) — its revision stays, so no shadow page of its is staled.
 * The light transport moved only if its indirect lighting factor did.
 */
function setContactShadow(
  table: LightTable,
  slot: number,
  current: SceneLight,
  merged: SceneLight,
) {
  table.kinds.tally(current, -1)
  table.kinds.tally(merged, 1)
  table.records.set(merged.id, merged)
  writeContactGi(table.packed, baseOf(slot), merged, table.contactView)
  table.suns.changed(current, merged)
  table.epoch++
  if (
    contactShadowOfLight(current).indirectLightingIntensity ===
    contactShadowOfLight(merged).indirectLightingIntensity
  )
    table.notTransport++
}

/** Changes a light. */
export function setLight(table: LightTable, id: string, patch: Partial<Omit<SceneLight, 'id'>>) {
  const slot = table.indexOf.get(id)
  const current = table.records.get(id)
  if (slot === undefined || !current)
    throw new EngineError('UNKNOWN_SCENE_LIGHT', `unknown light ${id}`, { id })
  const merged = validateSceneLight({ ...current, ...patch, id })
  // A light reset identically is not a change: neither its revision nor the epoch
  // move, so the scheduler stales no shadow page and the held frame stays.
  if (sameSceneLight(current, merged)) {
    if (!sameLightContactShadow(current, merged)) setContactShadow(table, slot, current, merged)
    return
  }
  table.kinds.tally(current, -1)
  table.kinds.tally(merged, 1)
  table.records.set(id, merged)
  table.wearing += wears(merged) - wears(current)
  table.revision[slot]++
  // Another profile has no slice until the atlas gives it one.
  const renamed = merged.iesProfile !== current.iesProfile
  if (renamed) table.profileEpoch++
  writeSlot(table, slot, merged, undefined, renamed ? 0 : undefined)
  table.suns.changed(current, merged)
  table.epoch++
}

/** Removes a light: the last one takes its slot. */
export function removeLight(table: LightTable, id: string) {
  const { ids, indexOf, records, revision } = table
  const slot = indexOf.get(id)
  if (slot === undefined)
    throw new EngineError('UNKNOWN_SCENE_LIGHT', `unknown light ${id}`, { id })
  const last = ids.length - 1
  if (slot !== last) {
    const movedId = ids[last]
    ids[slot] = movedId
    indexOf.set(movedId, slot)
    revision[slot] = revision[last] + 1
    writeSlot(
      table,
      slot,
      records.get(movedId)!,
      lightFunctionOf(table, last),
      profileLaneAt(table, last),
    )
    writeSlice(table, slot, sliceOf(table, last))
  }
  const removed = records.get(id)!
  table.wearing -= wears(removed)
  if (removed.iesProfile !== undefined) table.profileEpoch++
  ids.length = last
  indexOf.delete(id)
  table.kinds.tally(removed, -1)
  records.delete(id)
  table.ranks.free(id)
  revision[last] = 0
  table.packed.fill(0, baseOf(last), baseOf(last + 1))
  table.draw.fill(0, last * DRAW_LANES, (last + 1) * DRAW_LANES)
  table.header[0] = ids.length
  table.suns.removed(removed)
  table.epoch++
}

/** Sets the environment. */
export function setTableEnvironment(table: LightTable, next: SceneEnvironment) {
  // Same rule as `setLight`: an exposure reset as-is does not stale the frame.
  const change = table.environment.set(validateSceneEnvironment(next))
  if (change === 'same') return
  if (change === 'untransported') table.notTransport++
  table.suns.environmentChanged()
  table.epoch++
}

/** Turns the air on or off for the lights. */
export function setTableAir(table: LightTable, on: boolean) {
  if (on === table.airOn) return
  table.airOn = on
  table.suns.environmentChanged()
  table.epoch++
}

/**
 * Folds the lights with the view's settings `view`, the fields `held` carries (the others of `view` are not the lights'): when any differs
 * from what the lights were folded with, `held` takes them, `rewrite` writes the lanes that depend on them again for every light, `after`
 * (the counts that depend on them) runs and the epoch is published, as a change of the air is (`setTableAir`); no light moved, no
 * shadow page is staled, and no light transport changed.
 */
function foldView<V extends object>(
  table: LightTable,
  held: V,
  view: V,
  rewrite: (slot: number, light: SceneLight) => void,
  after?: () => void,
) {
  const fields = Object.keys(held) as (keyof V)[]
  if (fields.every((field) => held[field] === view[field])) return
  for (const field of fields) held[field] = view[field]
  for (const [slot, id] of table.ids.entries()) rewrite(slot, table.records.get(id)!)
  after?.()
  table.epoch++
  table.notTransport++
}

/** Folds the lights' contact shadows with the view's settings (`writeContactShadow`): the contact lanes of every light are written again, and the
 *  lights that cast one of their own counted again. */
export function setTableContactView(table: LightTable, view: ContactShadowView) {
  foldView(
    table,
    table.contactView,
    view,
    (slot, light) => writeContactGi(table.packed, baseOf(slot), light, table.contactView),
    () => table.kinds.recountContacts(table.records.values()),
  )
}

/** Hands the lights the view's shadow settings (`LightShadowView`): when the dynamic shadows flipped, the kind word of every light is written
 *  again (its shadowed value, `kindWordOf`) and the lights that cast a contact shadow of their own are counted again. */
export function setTableShadowView(table: LightTable, view: LightShadowView) {
  foldView(
    table,
    table.shadowView,
    view,
    (slot, light) => writeKind(table, slot, light),
    () => table.kinds.recountContacts(table.records.values()),
  )
}

/** Folds the lights' draw ranges with the view's settings (`writeDrawRange`): the draw lanes of every light are written again. */
export function setTableRangeView(table: LightTable, view: LightRangeView) {
  foldView(table, table.rangeView, view, (slot, light) =>
    writeDrawRange(table.draw, slot, light, table.rangeView),
  )
}

/** Records the index of the light function table entry a light reads, 0 for none, in its kind
 *  word, as `assignSlice` does its slice: nothing else of the light moves. */
export function assignLightFunction(table: LightTable, slot: number, index: number) {
  if (lightFunctionOf(table, slot) === index) return
  writeKind(table, slot, table.records.get(table.ids[slot])!, index)
  table.epoch++
  table.notTransport++
}

/** Records the atlas slice of the profile a light names, −1 for none, in its kind word, as `assignLightFunction` does the
 *  index of its light function: nothing else of the light moves. */
export function assignLightProfile(table: LightTable, slot: number, slice: number) {
  if (lightProfileSliceOf(table, slot) === slice) return
  writeKind(table, slot, table.records.get(table.ids[slot])!, undefined, profileLaneOf(slice))
  table.epoch++
  table.notTransport++
}

/** Records the atlas slice a light occupies, without touching the rest of its fields. The store
 *  revision only rises if the slice actually changed: otherwise nothing is pushed to the GPU.
 *  Light transport stays as it was (`transportEpoch`): what the maps hold moves the shadows'
 *  own version, never their addresses. */
export function assignSlice(table: LightTable, slot: number, slice: number) {
  if (sliceOf(table, slot) === slice) return
  writeSlice(table, slot, slice)
  table.epoch++
  table.notTransport++
}
