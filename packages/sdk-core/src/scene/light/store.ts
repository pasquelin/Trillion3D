import { EngineError } from '../../contracts/cache.ts'
import { grownLength, resized } from '../../../../math/src/sequence/resized.ts'
import {
  LIGHT_FUNCTION_STEP,
  LIGHT_KIND_SPAN,
  LIGHT_SETTINGS,
  SCENE_LIGHT_HEADER_FLOATS,
  type SceneLight,
  type SceneLightingView,
} from './contracts.ts'
import { type SceneEnvironment, validateSceneEnvironment } from '../core/environment.ts'
import { sameSceneLight } from './equal.ts'

import { LIGHT_FIELD, baseOf, writeLightFields } from './fields.ts'
import { createSunBlocks } from './sunBlocks.ts'
import { joined } from '../../runtime/joined.ts'
import { validateSceneLight } from './validate.ts'
import { createLightKinds } from './kinds.ts'
import { createLightRanks } from './lightRanks.ts'
import { createEnvironmentBlock } from './environmentBlock.ts'

/** The atmosphere's block as the GPU reads it, behind the environment's (`atmospherePack.ts`), and
 *  its versions. */
const airReads = (air: ReturnType<typeof createSunBlocks>['air']) => ({
  atmospherePacked: air.packed,
  /** Bumped when the air changes: what its lookup tables are made from. */
  get atmosphereVersion() {
    return air.version
  },
  /** Bumped when the air or its sun changes: what the sky shows and the sky light captures. */
  get atmosphereEpoch() {
    return air.epoch
  },
})

/** The lights of a scene as the GPU reads them, packed and kept up to date. */
export type SceneLightStore = ReturnType<typeof createSceneLightStore>

/**
 * Scene lights, as many as the scene declares: `capacity` slots, doubled when full and
 * never shrunk. Adding, setting or removing a light writes its floats and bumps its `revision`,
 * which tells a reader it changed: nothing is rebuilt per frame. The shadow scheduler reads the
 * light's shape itself, so an intensity or colour change stales no shadow page.
 */
export function createSceneLightStore() {
  let capacity = 0,
    packed = new Float32Array(0),
    header: Uint32Array,
    revision = new Uint32Array(0)
  const ids: string[] = []
  const indexOf = new Map<string, number>()
  const environment = createEnvironmentBlock()
  let view: SceneLightingView = 'auto',
    epoch = 1,
    /** Whether the air shades the lights: on unless the quality settings turn the atmosphere off. */
    airOn = true,
    /** The epoch's bumps that moved no light transport: a fog alone, a shadow slice alone. */
    notTransport = 0
  /** Twice the room, content kept: N lights cost log N copies. */
  const grow = () => {
    capacity = grownLength(capacity, 32)
    packed = resized(packed, baseOf(capacity))
    header = new Uint32Array(packed.buffer, 0, SCENE_LIGHT_HEADER_FLOATS)
    revision = resized(revision, capacity)
  }
  grow()
  /** A light's atlas slice lives in the buffer itself: it is not held twice. */
  const sliceOf = (slot: number) => packed[baseOf(slot) + LIGHT_FIELD.shadowSlice]
  const writeSlice = (slot: number, slice: number) => {
    packed[baseOf(slot) + LIGHT_FIELD.shadowSlice] = slice
  }
  /** A light's index in the light function table lives in its kind word, above the flags. */
  const lightFunctionOf = (slot: number) =>
    Math.floor(packed[baseOf(slot) + LIGHT_FIELD.kind] / LIGHT_FUNCTION_STEP)
  const writeLightFunction = (slot: number, index: number) => {
    packed[baseOf(slot) + LIGHT_FIELD.kind] =
      (packed[baseOf(slot) + LIGHT_FIELD.kind] % LIGHT_FUNCTION_STEP) + index * LIGHT_FUNCTION_STEP
  }
  /** Fields declared by the host. The shadow slice and the light function index are not: the
   *  scheduler and the light function atlas set them, and a write keeps them. */
  const write = (slot: number, light: SceneLight) => {
    const held = lightFunctionOf(slot)
    writeLightFields(packed, baseOf(slot), light)
    if (held) writeLightFunction(slot, held)
  }
  /** How many lights wear a light function: the atlas plans nothing at 0. */
  let wearing = 0
  const wears = (light: SceneLight | undefined) => (light?.lightFunction === undefined ? 0 : 1)
  const records = new Map<string, SceneLight>(),
    kinds = createLightKinds(),
    ranks = createLightRanks(),
    suns = createSunBlocks({
      ids,
      records,
      indexOf,
      rankOf: ranks.of,
      packed: () => packed,
      environment: () => environment.current,
      atmosphere: () => (airOn ? environment.current?.atmosphere : undefined),
      environmentPacked: environment.packed,
      write,
    })
  const store = {
    settings: LIGHT_SETTINGS,
    /** Every light, packed for the GPU: a new array when the table grows. */
    get packed() {
      return packed
    },
    environmentPacked: environment.packed,
    /** Bumped on every change, per slot. */
    get revision() {
      return revision
    },
    /** Slots the table holds: the GPU light buffer is this long. */
    get capacity() {
      return capacity
    },
    sliceOf,
    lightFunctionOf,
    /** Lights that wear a light function material. */
    get lightFunctionCount() {
      return wearing
    },
    /** A light's kind (`LIGHT_KIND`), read from the buffer as its slice is. */
    kindOf: (slot: number) => packed[baseOf(slot) + LIGHT_FIELD.kind] % LIGHT_KIND_SPAN,
    /** Each slot's light name. */
    ids,
    /** How many lights. */
    get count() {
      return ids.length
    },
    /** Bumped when the set of lights changes. */
    get epoch() {
      return epoch
    },
    /** Bumped with the epoch, except by a change of the fog alone or of a shadow slice alone: fog
     *  is a view-ray term and a slice where a light's maps are addressed, neither light transport,
     *  so what caches transported light (the bounce probes) keeps it. */
    get transportEpoch() {
      return epoch - notTransport
    },
    /** The scene's environment. */
    get environment() {
      return environment.current
    },
    /** The slot (its rank in `packed`) of the directional light the fog scatters, the one the fog's
     *  block holds (`fogSun.ts`); −1 without one. */
    get fogSunSlot() {
      return suns.fogSunSlot
    },
    /** The light held for the air's light `index` (0 or 1): the brightest directional light that
     *  may light the air as that index; none where there is none. */
    atmosphereLight: (index: number) => suns.held(index),
    /** View requested by the host, as-is: `auto` as long as it has asked for nothing. */
    get lightingView(): SceneLightingView {
      return view
    },
    /**
     * True when the image must come out as raw albedo, with no light. This is the default
     * behaviour as long as no light is declared: a scene without a source has nothing to light, and a
     * black image would help no geometry bench. As soon as a light exists, real lighting
     * takes over — unless the host has explicitly asked for the diagnostic view.
     */
    get unlit() {
      return view === 'unlit' || (view === 'auto' && ids.length === 0)
    },
    /** Sets what the host asks to see. */
    setView(next: SceneLightingView) {
      if (view === next) return
      view = next
      epoch++
    },
    /** The held record, the store's own: engines read it on the frame path and copy nothing.
     *  Not for the host — the public API hands out `cloneSceneLight` copies. */
    light(id: string) {
      return records.get(id)
    },
    /** The slot of a light. */
    slotOf(id: string) {
      return indexOf.get(id) ?? -1
    },
    /** Adds a light. */
    add(light: SceneLight) {
      const validated = validateSceneLight(light)
      if (indexOf.has(validated.id))
        throw new EngineError('DUPLICATE_SCENE_LIGHT', `light ${validated.id} already present`, {
          id: validated.id,
        })
      const slot = ids.length
      if (slot >= capacity) grow()
      ids.push(validated.id)
      indexOf.set(validated.id, slot)
      records.set(validated.id, validated)
      wearing += wears(validated)
      ranks.take(validated.id)
      kinds.tally(validated, 1)
      revision[slot]++
      write(slot, validated)
      // A new slot is zero in the buffer; without a slice, the published value is −1.
      writeSlice(slot, -1)
      header[0] = ids.length
      suns.added(validated)
      epoch++
      return slot
    },
    /** Changes a light. */
    set(id: string, patch: Partial<Omit<SceneLight, 'id'>>) {
      const slot = indexOf.get(id)
      const current = records.get(id)
      if (slot === undefined || !current)
        throw new EngineError('UNKNOWN_SCENE_LIGHT', `unknown light ${id}`, { id })
      const merged = validateSceneLight({ ...current, ...patch, id })
      // A light reset identically is not a change: neither its revision nor the epoch
      // move, so the scheduler stales no shadow page and the held frame stays.
      if (sameSceneLight(current, merged)) return
      kinds.tally(current, -1)
      kinds.tally(merged, 1)
      records.set(id, merged)
      wearing += wears(merged) - wears(current)
      revision[slot]++
      write(slot, merged)
      suns.changed(current, merged)
      epoch++
    },
    /** Removes a light. */
    remove(id: string) {
      const slot = indexOf.get(id)
      if (slot === undefined)
        throw new EngineError('UNKNOWN_SCENE_LIGHT', `unknown light ${id}`, { id })
      const last = ids.length - 1
      if (slot !== last) {
        const movedId = ids[last]
        ids[slot] = movedId
        indexOf.set(movedId, slot)
        revision[slot] = revision[last] + 1
        write(slot, records.get(movedId)!)
        writeSlice(slot, sliceOf(last))
        writeLightFunction(slot, lightFunctionOf(last))
      }
      const removed = records.get(id)!
      wearing -= wears(removed)
      ids.length = last
      indexOf.delete(id)
      kinds.tally(removed, -1)
      records.delete(id)
      ranks.free(id)
      revision[last] = 0
      packed.fill(0, baseOf(last), baseOf(last + 1))
      header[0] = ids.length
      suns.removed(removed)
      epoch++
    },
    /** Sets the environment. */
    setEnvironment(next: SceneEnvironment) {
      // Same rule as `set`: an exposure reset as-is does not stale the frame.
      const change = environment.set(validateSceneEnvironment(next))
      if (change === 'same') return
      if (change === 'untransported') notTransport++
      suns.environmentChanged()
      epoch++
    },
    /** Turns the air on or off for the lights (`atmosphereOn`, the quality settings): off, the scene's
     *  atmosphere tints no light and shows in no block, as if it were not set; the environment keeps
     *  it. */
    setAirOn(on: boolean) {
      if (on === airOn) return
      airOn = on
      suns.environmentChanged()
      epoch++
    },
    /** Records the index of the light function table entry a light reads, 0 for none, in its kind
     *  word, as `assignSlice` does its slice: nothing else of the light moves. */
    assignLightFunction(slot: number, index: number) {
      if (lightFunctionOf(slot) === index) return
      writeLightFunction(slot, index)
      epoch++
      notTransport++
    },
    /** Records the atlas slice a light occupies, without touching the rest of its fields. The store
     *  revision only rises if the slice actually changed: otherwise nothing is pushed to the GPU.
     *  Light transport stays as it was (`transportEpoch`): what the maps hold moves the shadows'
     *  own version, never their addresses. */
    assignSlice(slot: number, slice: number) {
      if (sliceOf(slot) === slice) return
      writeSlice(slot, slice)
      epoch++
      notTransport++
    },
  }
  return joined(store, kinds.counts, airReads(suns.air))
}
