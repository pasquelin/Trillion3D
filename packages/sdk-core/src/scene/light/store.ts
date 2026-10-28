import {
  LIGHT_KIND_SPAN,
  LIGHT_SETTINGS,
  type SceneLight,
  type SceneLightingView,
} from './contracts.ts'
import type { SceneEnvironment } from '../core/environment.ts'
import type { ContactShadowView } from './contactShadowView.ts'
import type { LightShadowView } from './shadowedBits.ts'
import type { LightRangeView } from './drawRange.ts'
import { LIGHT_FIELD, baseOf } from './fields.ts'
import { createSunBlocks } from './sunBlocks.ts'
import { joined } from '../../runtime/joined.ts'
import {
  addLight,
  assignDrawn,
  assignLightFunction,
  assignLightProfile,
  assignSlice,
  createLightTable,
  lightFunctionOf,
  lightProfileSliceOf,
  removeLight,
  setLight,
  setTableAir,
  setTableContactView,
  setTableShadowView,
  setTableEnvironment,
  setTableRangeView,
  sliceOf,
  type LightTable,
} from './storeTable.ts'

/** The atmosphere's block as the GPU reads it, behind the environment's (`atmospherePack.ts`), and
 *  its versions. */
const airReads = (air: ReturnType<typeof createSunBlocks>['air']) => ({
  atmospherePacked: air.packed,
  /** Bumped when the air changes: what its lookup tables are made from. */
  get atmosphereVersion() {
    return air.version
  },
})

/** The lights of a scene as the GPU reads them, packed and kept up to date. */
export type SceneLightStore = ReturnType<typeof createSceneLightStore>

/** The table's layout and counters, as a reader sees them. */
function layoutReaders(table: LightTable) {
  return {
    settings: LIGHT_SETTINGS,
    /** Every light, packed for the GPU: a new array when the table grows. */
    get packed() {
      return table.packed
    },
    environmentPacked: table.environment.packed,
    /** Each light's draw range, `DRAW_LANES` floats a slot (`DRAW_SHARE`, `DRAW_FARTHEST`): the CPU's alone, a new array when the table grows. */
    get draw() {
      return table.draw
    },
    /** Bumped on every change, per slot. */
    get revision() {
      return table.revision
    },
    /** Slots the table holds: the GPU light buffer is this long. */
    get capacity() {
      return table.capacity
    },
    sliceOf: (slot: number) => sliceOf(table, slot),
    lightFunctionOf: (slot: number) => lightFunctionOf(table, slot),
    /** The atlas slice of a light's profile, held in its kind word; −1 for none. */
    lightProfileSliceOf: (slot: number) => lightProfileSliceOf(table, slot),
    /** Bumped when a light that names a profile is added or removed, or a light's profile changes: the profile atlas follows it. */
    get profileEpoch() {
      return table.profileEpoch
    },
    /** Lights that wear a light function material. */
    get lightFunctionCount() {
      return table.wearing
    },
    /** A light's kind (`LIGHT_KIND`), read from the buffer as its slice is. */
    kindOf: (slot: number) => table.words[baseOf(slot) + LIGHT_FIELD.kind] % LIGHT_KIND_SPAN,
    /** Each slot's light name. */
    ids: table.ids,
    /** How many lights. */
    get count() {
      return table.ids.length
    },
    /** Bumped when the set of lights changes. */
    get epoch() {
      return table.epoch
    },
    /** Bumped with the epoch, except by a change of the fog alone or of a shadow slice alone: fog
     *  is a view-ray term and a slice where a light's maps are addressed, neither light transport,
     *  so what caches transported light (the bounce probes) keeps it. */
    get transportEpoch() {
      return table.epoch - table.notTransport
    },
  }
}

/** The environment, the held lights and the view a reader asks about. */
function lightReaders(table: LightTable) {
  const { suns, records, indexOf, ids } = table
  const unlitAsked = () => table.view === 'unlit'
  return {
    /** The scene's environment. */
    get environment() {
      return table.environment.current
    },
    /** The light held for the air's light `index` (0 or 1): the brightest directional light that
     *  may light the air as that index; none where there is none. */
    atmosphereLight: (index: number) => suns.held(index),
    /** The slot of the directional light the forward readers take — of the highest
     *  `forwardShadingPriority`, then the greatest declared colour times intensity —, −1 without
     *  one (`forwardLight.ts`). */
    get forwardDirectionalSlot() {
      return suns.forwardSlot
    },
    /** View requested by the host, as-is: `auto` as long as it has asked for nothing. */
    get lightingView(): SceneLightingView {
      return table.view
    },
    /**
     * True when the host has asked the unlit view itself: the raw-albedo view whatever the scene holds. The one source of `unlit`.
     */
    get unlitAsked() {
      return unlitAsked()
    },
    /**
     * True when the image must come out as raw albedo, with no light. This is the default
     * behaviour as long as no light is declared: a scene without a source has nothing to light, and a
     * black image would help no geometry bench. As soon as a light exists, real lighting
     * takes over — unless the host has explicitly asked for the diagnostic view (`unlitAsked`).
     */
    get unlit() {
      return unlitAsked() || (table.view === 'auto' && ids.length === 0)
    },
    /** The held record, the store's own: engines read it on the frame path and copy nothing.
     *  Not for the host — the public API hands out `cloneSceneLight` copies. */
    light: (id: string) => records.get(id),
    /** The slot of a light. */
    slotOf: (id: string) => indexOf.get(id) ?? -1,
  }
}

/** What changes the table. */
function writers(table: LightTable) {
  return {
    /** Sets what the host asks to see. */
    setView(next: SceneLightingView) {
      if (table.view === next) return
      table.view = next
      table.epoch++
    },
    add: (light: SceneLight) => addLight(table, light),
    set: (id: string, patch: Partial<Omit<SceneLight, 'id'>>) => setLight(table, id, patch),
    remove: (id: string) => removeLight(table, id),
    setEnvironment: (next: SceneEnvironment) => setTableEnvironment(table, next),
    /** Turns the air on or off for the lights (`atmosphereOn`, the quality settings): off, the scene's
     *  atmosphere tints no light and shows in no block, as if it were not set; the environment keeps
     *  it. */
    setAirOn: (on: boolean) => setTableAir(table, on),
    /** Whether the atmosphere's block holds the lights of the air where the scene has no atmosphere:
     *  the clouds light a medium by them, so a clouds part that draws there asks for them
     *  (`packAtmosphere`); off by default, the block of a scene with no atmosphere all zero. */
    setAirlessSuns(on: boolean) {
      if (table.suns.setAirless(on)) table.epoch++
    },
    /** Folds the lights' contact shadows with the view's settings: the lanes of every light are
     *  written again when they differ from the last fold (`setTableContactView`). */
    setContactShadowView: (view: ContactShadowView) => setTableContactView(table, view),
    /** Hands the lights the view's shadow settings: the kind words are written again when the dynamic shadows
     *  flipped (`setTableShadowView`). */
    setShadowView: (view: LightShadowView) => setTableShadowView(table, view),
    /** Folds the lights' draw ranges with the view's settings: the draw lanes of every light are written again
     *  when they differ from the last fold (`setTableRangeView`). */
    setRangeView: (view: LightRangeView) => setTableRangeView(table, view),
    /** Records whether the view draws the light of `slot` (`lightDrawn`) in its kind word, without a change of the lights: whether it
     *  changed (`assignDrawn`). */
    assignDrawn: (slot: number, drawn: boolean) => assignDrawn(table, slot, drawn),
    assignLightFunction: (slot: number, index: number) => assignLightFunction(table, slot, index),
    assignLightProfile: (slot: number, slice: number) => assignLightProfile(table, slot, slice),
    assignSlice: (slot: number, slice: number) => assignSlice(table, slot, slice),
  }
}

/**
 * Scene lights, as many as the scene declares: `capacity` slots, doubled when full and
 * never shrunk. Adding, setting or removing a light writes its floats and bumps its `revision`,
 * which tells a reader it changed: nothing is rebuilt per frame. The shadow scheduler reads the
 * light's shape itself, so an intensity or colour change stales no shadow page.
 */
export function createSceneLightStore() {
  const table = createLightTable()
  return joined(
    layoutReaders(table),
    lightReaders(table),
    writers(table),
    table.kinds.counts,
    airReads(table.suns.air),
  )
}
