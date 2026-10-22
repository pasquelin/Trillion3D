import {
  computeBufferEntry,
  computeStorageTextureEntry,
  sequentialEntries,
} from '../../../gpu/core/computeBindings.ts'
import { compileKernels, runGenerator, storageBuffer } from './generation.ts'
import {
  PATTERN_BINS,
  PATTERN_CODE,
  PATTERN_ENTRY_POINTS,
  PATTERN_GROUP,
  PATTERN_SIZE,
} from './patternWgsl.ts'

/**
 * THE LAYOUT PATTERN, generated once on the GPU (`patternWgsl.ts` says what it holds): a 2D
 * `rgba16float` texture of 1024 texels a side that tiles. Its fields, histograms and column
 * distances live in buffers freed once the texture is written.
 */
export async function createLayoutPattern(device: GPUDevice) {
  const label = 'Trillion3D cloud layout pattern'
  const texels = PATTERN_SIZE * PATTERN_SIZE
  const { layout, pipelines } = await compileKernels(
    device,
    label,
    PATTERN_CODE,
    [
      computeBufferEntry(0, 'storage'),
      computeBufferEntry(1, 'storage'),
      computeBufferEntry(2, 'storage'),
      computeBufferEntry(3, 'storage'),
      computeStorageTextureEntry(4, 'rgba16float'),
    ],
    PATTERN_ENTRY_POINTS,
  )
  const texture = device.createTexture({
    label,
    size: [PATTERN_SIZE, PATTERN_SIZE],
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const buffers = [
    storageBuffer(device, `${label} fields`, texels * 16),
    storageBuffer(device, `${label} columns`, texels * 16),
    storageBuffer(device, `${label} histogram`, 4 * PATTERN_BINS * 4),
    storageBuffer(device, `${label} thresholds`, 16),
  ]
  const group = device.createBindGroup({
    label,
    layout,
    entries: sequentialEntries([...buffers.map((buffer) => ({ buffer })), texture.createView()]),
  })
  const side = PATTERN_SIZE / PATTERN_GROUP
  const pass = (kernel: (typeof PATTERN_ENTRY_POINTS)[number], x: number, y = 1) => ({
    pipeline: pipelines[kernel],
    group,
    workgroups: [x, y, 1] as const,
  })
  runGenerator(
    device,
    label,
    [
      pass('fieldMain', side, side),
      pass('thresholdMain', 1),
      pass('columnMain', side, side),
      pass('rowMain', side, side),
    ],
    buffers,
  )
  return texture
}
