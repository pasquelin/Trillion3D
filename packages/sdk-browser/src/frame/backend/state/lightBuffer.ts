import { retire } from '../../../gpu/core/frameRetire.ts'
import {
  LIGHT_SETTINGS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
} from '../../../../../sdk-core/src/scene/light/contracts.ts'
import type { SceneLightStore } from '../../../../../sdk-core/src/scene/light/store.ts'
import { ltcTable } from '../../../../../sdk-core/src/lighting/ltcTable.ts'
import { HEAD_BYTES, LIGHT_BUFFER_AT } from './lightBufferLayout.ts'
import type { WebgpuLightState } from './lights.ts'

const SLOT_BYTES = SCENE_LIGHT_FLOATS * 4
/** Light slots of the buffer: the store's, and never fewer than a tile list's, the light array
 *  the narrow tile pass declares (`../../../lighting/tiles/shader.ts`). */
const bufferSlots = (store: SceneLightStore) => Math.max(store.capacity, LIGHT_SETTINGS.tileLights)

/** Contract light buffer for the store's light slots — the header, the environment's irradiance,
 *  the atmosphere's regions, the fitted lobe of the rectangles, written here once, then every
 *  slot. */
export function createSceneLightContractBuffer(device: GPUDevice, store: SceneLightStore) {
  const buffer = device.createBuffer({
    label: 'Trillion3D direct lights v1',
    size: LIGHT_BUFFER_AT.items + bufferSlots(store) * SLOT_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  device.queue.writeBuffer(buffer, LIGHT_BUFFER_AT.ltc, ltcTable())
  return buffer
}

/** Light slots `buffer` holds. */
const contractBufferSlots = (buffer: GPUBuffer) =>
  (buffer.size - LIGHT_BUFFER_AT.items) / SLOT_BYTES

/**
 * Pushes the store to the GPU if and only if its revision has changed since the last image. A
 * store grown past the buffer's slots gets a new buffer first, the old one released: its holders
 * — the tile pass, the resolve, the blend pass, bounce — compare the buffer they
 * bound with `lights.buffer` and bind the new one.
 */
export function uploadSceneLights(device: GPUDevice, lights: WebgpuLightState) {
  const { store } = lights
  if (!lights.buffer) return false
  if (contractBufferSlots(lights.buffer) !== bufferSlots(store)) {
    // This image's commands may still name it: retired, destroyed after the frame's submit.
    retire(device, lights.buffer)
    lights.buffer = createSceneLightContractBuffer(device, store)
    lights.uploadedEpoch = -1
  }
  if (lights.uploadedEpoch === store.epoch) return false
  lights.uploadedEpoch = store.epoch
  const { buffer } = lights,
    { packed } = store
  device.queue.writeBuffer(buffer, 0, packed, 0, SCENE_LIGHT_HEADER_FLOATS)
  device.queue.writeBuffer(buffer, HEAD_BYTES, store.environmentPacked)
  device.queue.writeBuffer(buffer, LIGHT_BUFFER_AT.atmosphere, store.atmospherePacked)
  // Only the declared slots: those past the count are never read.
  device.queue.writeBuffer(
    buffer,
    LIGHT_BUFFER_AT.items,
    packed,
    SCENE_LIGHT_HEADER_FLOATS,
    store.count * SCENE_LIGHT_FLOATS,
  )
  return true
}
