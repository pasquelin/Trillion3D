// The light of the store tests and the helpers reading its packed words.
import { LIGHT_FIELD, baseOf } from './fields.ts'
import { type SceneLightStore } from './store.ts'
import { LIGHT_CHANNELS_SHIFT, type SceneLight } from './contracts.ts'

/** The kind word of light `id` as the store packs it (`LIGHT_FIELD.kind`): a whole number held in the bits of its float, read through the
 *  words of the same buffer. */
export const kindWord = (store: SceneLightStore, id: string) =>
  new Uint32Array(store.packed.buffer)[baseOf(store.slotOf(id)) + LIGHT_FIELD.kind]!
/** The rank and the flags of a kind word: the bits under the channels. */
export const rankAndFlags = (word: number) => word % 2 ** LIGHT_CHANNELS_SHIFT

export const LIGHT: SceneLight = {
  id: 'l0',
  kind: 'point',
  position: [1, 2, 3],
  color: [1, 0.5, 0.25],
  intensity: 4,
  range: 10,
  castsShadow: true,
}
