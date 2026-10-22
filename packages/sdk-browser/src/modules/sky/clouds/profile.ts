import { generateTexture } from './generation.ts'
import { PROFILE_CODE, PROFILE_ENTRY_POINTS, PROFILE_GROUP, PROFILE_SIZE } from './profileWgsl.ts'

/**
 * THE HEIGHT PROFILE, generated once on the GPU (`profileWgsl.ts` says what it holds): a 2D
 * `rgba16float` texture of 256 texels a side, one kernel, no buffers.
 */
export const createHeightProfile = (device: GPUDevice) =>
  generateTexture(device, {
    label: 'Trillion3D cloud height profile',
    code: PROFILE_CODE,
    entryPoint: PROFILE_ENTRY_POINTS[0],
    size: [PROFILE_SIZE, PROFILE_SIZE],
    groupTexels: PROFILE_GROUP,
  })
