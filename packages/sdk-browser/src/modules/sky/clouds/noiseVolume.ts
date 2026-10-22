import { computeBufferEntry } from '../../../gpu/core/computeBindings.ts'
import { generateTexture, storageBuffer } from './generation.ts'
import {
  noiseHashTable,
  NOISE_GROUP,
  NOISE_VOLUME_CODE,
  NOISE_VOLUME_ENTRY_POINTS,
  NOISE_VOLUME_SIZE,
} from './noiseVolumeWgsl.ts'

/**
 * THE NOISE VOLUME, generated once on the GPU (`noiseVolumeWgsl.ts` says what it holds): a 3D
 * `rgba16float` texture of 128 texels a side that tiles on every axis, one kernel and a table of
 * hashed numbers.
 */
export function createNoiseVolume(device: GPUDevice) {
  const label = 'Trillion3D cloud noise volume'
  const table = noiseHashTable()
  const hashes = storageBuffer(device, `${label} hashes`, table.byteLength)
  device.queue.writeBuffer(hashes, 0, table)
  return generateTexture(device, {
    label,
    code: NOISE_VOLUME_CODE,
    entryPoint: NOISE_VOLUME_ENTRY_POINTS[0],
    size: [NOISE_VOLUME_SIZE, NOISE_VOLUME_SIZE, NOISE_VOLUME_SIZE],
    groupTexels: NOISE_GROUP,
    extra: {
      entries: [computeBufferEntry(1, 'read-only-storage')],
      resources: [{ buffer: hashes }],
      temporaries: [hashes],
    },
  })
}
