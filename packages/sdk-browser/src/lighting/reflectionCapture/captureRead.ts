import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { CUBE_FACES } from '../../modules/sky/skyLight/layout.ts'
import type { ReflectionCaptureReadSet } from './compositeWgsl.ts'
import { CAPTURE_BLOCK_WORDS } from './layout.ts'

/**
 * WHAT THE LIGHTING READS OF THE REFLECTION CAPTURES, held once a device: the captures module (`capture.ts`) holds the set it made (`holdReflectionCaptureRead`), and the
 * groups that bind the captures read the set held, or a stand-in of no capture — a one-texel cube and a block that counts none — until
 * one is held, so that every group is made whatever the scene holds.
 */
const held = new WeakMap<GPUDevice, ReflectionCaptureReadSet>()

/** The stand-in set of a device: no capture. */
const standIn = oncePerDevice((device: GPUDevice): ReflectionCaptureReadSet => {
  const texture = device.createTexture({
    label: 'Trillion3D reflection captures stand-in',
    size: { width: 1, height: 1, depthOrArrayLayers: CUBE_FACES },
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const block = device.createBuffer({
    label: 'Trillion3D reflection captures stand-in records',
    size: CAPTURE_BLOCK_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM,
  })
  return {
    cube: texture.createView({ dimension: 'cube-array' }),
    sampler: postSamplers(device).mipped,
    block,
  }
})

/** The set the captures of `device` hold, or the stand-in of none. */
export const reflectionCaptureReadOf = (device: GPUDevice) => held.get(device) ?? standIn(device)

/** The captures of `device` hold `set`, or none (`undefined`). */
export function holdReflectionCaptureRead(
  device: GPUDevice,
  set: ReflectionCaptureReadSet | undefined,
) {
  if (set) held.set(device, set)
  else held.delete(device)
}

/** The stand-in's cube, which a capture module shows before its first cube array is made. */
export const reflectionCaptureStandInCube = (device: GPUDevice) => standIn(device).cube
