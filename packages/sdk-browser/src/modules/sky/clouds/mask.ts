import { generateTexture } from './generation.ts'
import { MASK_CODE, MASK_ENTRY_POINTS, MASK_GROUP, MASK_SIZE } from './maskWgsl.ts'

/**
 * THE GLOBAL MASK, generated once on the GPU (`maskWgsl.ts` says what it holds): a 2D
 * `rgba16float` texture of 1024 texels a side, one kernel, no buffers, with the mip chain of the
 * group's filter (`mipsWgsl.ts`).
 */
export const createGlobalMask = (device: GPUDevice) =>
  generateTexture(device, {
    label: 'Trillion3D cloud global mask',
    code: MASK_CODE,
    entryPoint: MASK_ENTRY_POINTS[0],
    size: [MASK_SIZE, MASK_SIZE],
    mips: 'average',
    groupTexels: MASK_GROUP,
  })
