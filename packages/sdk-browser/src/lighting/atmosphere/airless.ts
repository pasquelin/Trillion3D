import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { standInTexture } from '../../gpu/core/standInTexture.ts'
import { FRAME_FLOATS } from './frame.ts'

/**
 * THE AIR OF A SCENE WITH NO ATMOSPHERE, as the clouds read it: what a program that binds the air's
 * tables finds where the scene has none. The transmittance table is white (the light reaches the
 * medium whole), the multiple-scattering table and the buffer of the haze's volumes are empty, the
 * sampler is the tables', and the frame is a buffer of the image's own (`writeAirFrame`, with the
 * planet the clouds stand on), written each image that draws clouds over it. The lights' share of
 * it is the light buffer's own (`packAtmosphere`, the lights of the air with no air).
 *
 * Made once for a device and kept as long as it lives: a scene with no clouds never asks for it.
 */
export interface AirlessAir {
  readonly transmittance: GPUTextureView
  readonly multiScatter: GPUTextureView
  readonly sampler: GPUSampler
  /** The haze's volumes: none is read, there is no haze. */
  readonly volumes: GPUBuffer
  /** The image's frame, `FRAME_FLOATS` floats. */
  readonly frame: GPUBuffer
}

/** The bytes of the volumes' stand-in: one `vec2u`. */
const VOLUMES_BYTES = 8

export const airlessAirOf = oncePerDevice((device: GPUDevice): AirlessAir => {
  const white = standInTexture(device, 'Trillion3D no air transmittance', 'rgba8unorm', {
    fill: 255,
  })
  const none = standInTexture(device, 'Trillion3D no air scattering', 'rgba8unorm')
  return {
    transmittance: white.createView(),
    multiScatter: none.createView(),
    sampler: device.createSampler({
      label: 'Trillion3D no air tables',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    }),
    volumes: device.createBuffer({
      label: 'Trillion3D no air volumes',
      size: VOLUMES_BYTES,
      usage: GPUBufferUsage.STORAGE,
    }),
    frame: device.createBuffer({
      label: 'Trillion3D no air frame',
      size: FRAME_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  }
})
