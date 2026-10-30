import { retire } from '../../../gpu/core/frameRetire.ts'
import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
} from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { SIMPLE_HEADER } from '../../../../../sdk-core/src/scene/light/fields.ts'
import type { SceneLightStore } from '../../../../../sdk-core/src/scene/light/store.ts'
import { environmentBrdfTable } from '../../../../../sdk-core/src/lighting/environmentBrdf.ts'
import { shadingEnergyWords } from '../../../../../sdk-core/src/lighting/shadingEnergy.ts'
import { sheenLtcHalves } from '../../../../../sdk-core/src/lighting/sheenLtc.ts'
import { ltcTable } from '../../../../../sdk-core/src/lighting/ltcTable.ts'
import { HEAD_BYTES, LIGHT_BUFFER_AT } from './lightBufferLayout.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import type { WebgpuLightState } from './lights.ts'

const SLOT_BYTES = SCENE_LIGHT_FLOATS * 4
/** Light slots of the buffer: the store's, then the room of the simple lights (they follow the store's lights), and never fewer than a tile
 *  list's, the light array the narrow tile pass declares (`../../../lighting/tiles/shader.ts`). */
const bufferSlots = (store: SceneLightStore) =>
  Math.max(store.capacity + store.simple.capacity, LIGHT_SETTINGS.tileLights)

/** Contract light buffer for the store's light slots — the header, the environment's irradiance,
 *  the atmosphere's regions, the fitted lobe of the rectangles, the environment BRDF and the GGX energy table, written here once, then every
 *  slot. */
export function createSceneLightContractBuffer(device: GPUDevice, store: SceneLightStore) {
  const buffer = device.createBuffer({
    label: 'Trillion3D direct lights v1',
    size: LIGHT_BUFFER_AT.items + bufferSlots(store) * SLOT_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  device.queue.writeBuffer(buffer, LIGHT_BUFFER_AT.ltc, ltcTable())
  device.queue.writeBuffer(buffer, LIGHT_BUFFER_AT.envBrdf, environmentBrdfTable())
  device.queue.writeBuffer(buffer, LIGHT_BUFFER_AT.shadingEnergy, shadingEnergyWords())
  device.queue.writeBuffer(buffer, LIGHT_BUFFER_AT.sheen, sheenLtcHalves())
  return buffer
}

/** The ranks of the directional lights of the store, after their count, in a buffer of as many words
 *  as the light buffer has slots, and one: the list the sun's pass walks in place of a cell's
 *  (`../../../lighting/deferred/lightPassWgsl.ts`). */
export function createSunRanksBuffer(device: GPUDevice, store: SceneLightStore) {
  return device.createBuffer({
    label: 'Trillion3D sun ranks v1',
    size: (1 + bufferSlots(store)) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
}

/** The words of the sun ranks written, grown as the lights are. */
let sunWords = new Uint32Array(1)

/** Writes the count of the store's directional lights and their ranks (their slots) into `buffer`. */
function writeSunRanks(device: GPUDevice, buffer: GPUBuffer, store: SceneLightStore) {
  if (sunWords.length < 1 + store.count) sunWords = new Uint32Array(1 + store.count * 2)
  let suns = 0
  for (let slot = 0; slot < store.count; slot++)
    if (store.kindOf(slot) === LIGHT_KIND.directional) sunWords[1 + suns++] = slot
  sunWords[0] = suns
  device.queue.writeBuffer(buffer, 0, sunWords, 0, 1 + suns)
}

/** The header words after the store's: how many simple lights follow its lights (the rank of the first is the store's count), then whether the hair
 *  strands are lit by them and how many of them only the classic pass lights (`SIMPLE_HEADER`). */
const simpleHeader = new Uint32Array(2)
export const SIMPLE_HEADER_AT = 8

/** Writes the simple lights into the slots after the store's own, and their count in the header. */
function writeSimpleLights(device: GPUDevice, buffer: GPUBuffer, store: SceneLightStore) {
  const { simple } = store
  simpleHeader[0] = simple.count
  simpleHeader[1] =
    (simple.hairLit ? SIMPLE_HEADER.hair : 0) | (simple.classicCount << SIMPLE_HEADER.classicShift)
  device.queue.writeBuffer(buffer, SIMPLE_HEADER_AT, simpleHeader)
  if (simple.count)
    device.queue.writeBuffer(
      buffer,
      LIGHT_BUFFER_AT.items + store.count * SLOT_BYTES,
      simple.packed,
      0,
      simple.count * SCENE_LIGHT_FLOATS,
    )
}

/** Light slots `buffer` holds. */
const contractBufferSlots = (buffer: GPUBuffer) =>
  (buffer.size - LIGHT_BUFFER_AT.items) / SLOT_BYTES

/** What the environment and atmosphere blocks of a light buffer last held, by buffer: a revision
 *  that moved the lights alone writes neither block again. */
const written = new WeakMap<GPUBuffer, { environment: Float32Array; atmosphere: Float32Array }>()

/** Writes `block` at `at` of `buffer` unless it is what `kept` already holds; `kept` then holds it. */
function writeBlock(
  device: GPUDevice,
  buffer: GPUBuffer,
  at: number,
  block: Float32Array<ArrayBuffer>,
  kept: Float32Array,
) {
  if (kept.length === block.length && sameValues(kept, block)) return
  kept.set(block)
  device.queue.writeBuffer(buffer, at, block)
}

/**
 * Pushes the store to the GPU if and only if its revision has changed since the last image. A store grown past the buffer's slots
 * gets a new buffer first, the old one released: its holders — the tile pass, the resolve, the blend pass, bounce — compare the
 * buffer they bound with `lights.buffer` and bind the new one. The strengths go up as the store holds them: the exposure is no
 * part of the buffer, which every view reads (a light that follows it carries its blend, and each pass applies it with its own
 * view's exposure, `lightStrength`).
 */
export function uploadSceneLights(device: GPUDevice, lights: WebgpuLightState) {
  const { store } = lights
  if (!lights.buffer) return false
  if (contractBufferSlots(lights.buffer) !== bufferSlots(store)) {
    // This image's commands may still name it: retired, destroyed after the frame's submit.
    retire(device, lights.buffer)
    lights.buffer = createSceneLightContractBuffer(device, store)
    if (lights.sunRanks) retire(device, lights.sunRanks)
    lights.sunRanks = createSunRanksBuffer(device, store)
    lights.uploadedEpoch = -1
  }
  const { simple } = store
  const storeMoved = lights.uploadedEpoch !== store.epoch
  if (!storeMoved && lights.uploadedSimple === simple.epoch) return false
  lights.uploadedSimple = simple.epoch
  // Lights handed at every image (a particle's) move the simple slots alone: the store's are not written again.
  if (!storeMoved) {
    writeSimpleLights(device, lights.buffer, store)
    return true
  }
  lights.uploadedEpoch = store.epoch
  const { buffer } = lights,
    { packed } = store
  device.queue.writeBuffer(buffer, 0, packed, 0, SCENE_LIGHT_HEADER_FLOATS)
  let kept = written.get(buffer)
  if (!kept)
    written.set(
      buffer,
      (kept = {
        environment: new Float32Array(store.environmentPacked.length).fill(NaN),
        atmosphere: new Float32Array(store.atmospherePacked.length).fill(NaN),
      }),
    )
  writeBlock(device, buffer, HEAD_BYTES, store.environmentPacked, kept.environment)
  writeBlock(device, buffer, LIGHT_BUFFER_AT.atmosphere, store.atmospherePacked, kept.atmosphere)
  // Only the declared slots: those past the count are never read.
  device.queue.writeBuffer(
    buffer,
    LIGHT_BUFFER_AT.items,
    packed,
    SCENE_LIGHT_HEADER_FLOATS,
    store.count * SCENE_LIGHT_FLOATS,
  )
  writeSimpleLights(device, buffer, store)
  if (lights.sunRanks) writeSunRanks(device, lights.sunRanks, store)
  return true
}
