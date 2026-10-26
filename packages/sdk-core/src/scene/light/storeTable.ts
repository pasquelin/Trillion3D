import { EngineError } from '../../contracts/cache.ts'
import { grownLength, resized } from '../../../../math/src/sequence/resized.ts'
import {
  LIGHT_FUNCTION_STEP,
  SCENE_LIGHT_HEADER_FLOATS,
  type SceneLight,
  type SceneLightingView,
} from './contracts.ts'
import { type SceneEnvironment, validateSceneEnvironment } from '../core/environment.ts'
import { sameSceneLight } from './equal.ts'
import { LIGHT_FIELD, baseOf, writeLightFields } from './fields.ts'
import { createSunBlocks } from './sunBlocks.ts'
import { validateSceneLight } from './validate.ts'
import { createLightKinds } from './kinds.ts'
import { createLightRanks } from './lightRanks.ts'
import { createEnvironmentBlock } from './environmentBlock.ts'

/** What a light store holds: the packed table and its parts, the lights' records and the counters
 *  that tell a reader something changed. The functions below are its operations. */
export interface LightTable {
  capacity: number
  packed: Float32Array<ArrayBuffer>
  header: Uint32Array<ArrayBuffer>
  revision: Uint32Array<ArrayBuffer>
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
}

/** Twice the room, content kept: N lights cost log N copies. */
function growTable(table: LightTable) {
  table.capacity = grownLength(table.capacity, 32)
  table.packed = resized(table.packed, baseOf(table.capacity))
  table.header = new Uint32Array(table.packed.buffer, 0, SCENE_LIGHT_HEADER_FLOATS)
  table.revision = resized(table.revision, table.capacity)
}

/** A light's atlas slice lives in the buffer itself: it is not held twice. */
export const sliceOf = (table: LightTable, slot: number) =>
  table.packed[baseOf(slot) + LIGHT_FIELD.shadowSlice]

function writeSlice(table: LightTable, slot: number, slice: number) {
  table.packed[baseOf(slot) + LIGHT_FIELD.shadowSlice] = slice
}

/** A light's index in the light function table lives in its kind word, above the flags. */
export const lightFunctionOf = (table: LightTable, slot: number) =>
  Math.floor(table.packed[baseOf(slot) + LIGHT_FIELD.kind] / LIGHT_FUNCTION_STEP)

function writeLightFunction(table: LightTable, slot: number, index: number) {
  const word = baseOf(slot) + LIGHT_FIELD.kind
  table.packed[word] = (table.packed[word] % LIGHT_FUNCTION_STEP) + index * LIGHT_FUNCTION_STEP
}

/** Fields declared by the host. The shadow slice and the light function index are not: the
 *  scheduler and the light function atlas set them, and a write keeps them. */
function writeSlot(table: LightTable, slot: number, light: SceneLight) {
  const held = lightFunctionOf(table, slot)
  writeLightFields(table.packed, baseOf(slot), light)
  if (held) writeLightFunction(table, slot, held)
}

const wears = (light: SceneLight | undefined) => (light?.lightFunction === undefined ? 0 : 1)

export function createLightTable(): LightTable {
  const table: LightTable = {
    capacity: 0,
    packed: new Float32Array(0),
    header: new Uint32Array(0),
    revision: new Uint32Array(0),
    ids: [],
    indexOf: new Map<string, number>(),
    records: new Map<string, SceneLight>(),
    environment: createEnvironmentBlock(),
    kinds: createLightKinds(),
    ranks: createLightRanks(),
    suns: undefined as unknown as ReturnType<typeof createSunBlocks>,
    view: 'auto',
    epoch: 1,
    airOn: true,
    notTransport: 0,
    wearing: 0,
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

/** Changes a light. */
export function setLight(table: LightTable, id: string, patch: Partial<Omit<SceneLight, 'id'>>) {
  const slot = table.indexOf.get(id)
  const current = table.records.get(id)
  if (slot === undefined || !current)
    throw new EngineError('UNKNOWN_SCENE_LIGHT', `unknown light ${id}`, { id })
  const merged = validateSceneLight({ ...current, ...patch, id })
  // A light reset identically is not a change: neither its revision nor the epoch
  // move, so the scheduler stales no shadow page and the held frame stays.
  if (sameSceneLight(current, merged)) return
  table.kinds.tally(current, -1)
  table.kinds.tally(merged, 1)
  table.records.set(id, merged)
  table.wearing += wears(merged) - wears(current)
  table.revision[slot]++
  writeSlot(table, slot, merged)
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
    writeSlot(table, slot, records.get(movedId)!)
    writeSlice(table, slot, sliceOf(table, last))
    writeLightFunction(table, slot, lightFunctionOf(table, last))
  }
  const removed = records.get(id)!
  table.wearing -= wears(removed)
  ids.length = last
  indexOf.delete(id)
  table.kinds.tally(removed, -1)
  records.delete(id)
  table.ranks.free(id)
  revision[last] = 0
  table.packed.fill(0, baseOf(last), baseOf(last + 1))
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

/** Records the index of the light function table entry a light reads, 0 for none, in its kind
 *  word, as `assignSlice` does its slice: nothing else of the light moves. */
export function assignLightFunction(table: LightTable, slot: number, index: number) {
  if (lightFunctionOf(table, slot) === index) return
  writeLightFunction(table, slot, index)
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
