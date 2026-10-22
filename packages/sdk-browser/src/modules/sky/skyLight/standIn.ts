import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { standInTexture } from '../../../gpu/core/standInTexture.ts'
import { CUBE_FACES, HARMONICS_SET_BYTES, HARMONICS_SETS, SKY_LIGHT_CUBE_FORMAT } from './layout.ts'
import { createSkyLightSampler, SKY_LIGHT_READ_WORDS, type SkyLightReadSet } from './read.ts'

/**
 * THE SKY LIGHT OF A SCENE WITH NONE (`SkyLightReadSet`): one black texel for the cube, harmonics
 * at zero, and a uniform whose colour is black and whose cube is not there (`skyLightApplied`
 * false). Made once for a device and kept as long as it lives: every program that reads the light
 * is given it where the capture has not made a cube yet, and the light gives nothing.
 */
export const skyLightStandIn = oncePerDevice((device: GPUDevice): SkyLightReadSet => {
  const cube = standInTexture(device, 'Trillion3D no sky light', SKY_LIGHT_CUBE_FORMAT, {
    layers: CUBE_FACES,
  })
  const zeroes = (label: string, bytes: number) =>
    device.createBuffer({ label, size: bytes, usage: GPUBufferUsage.UNIFORM })
  return {
    cube: cube.createView({ dimension: 'cube-array' }),
    sampler: createSkyLightSampler(device),
    harmonics: zeroes('Trillion3D no sky light harmonics', HARMONICS_SET_BYTES * HARMONICS_SETS),
    params: zeroes('Trillion3D no sky light', SKY_LIGHT_READ_WORDS * 4),
  }
})
