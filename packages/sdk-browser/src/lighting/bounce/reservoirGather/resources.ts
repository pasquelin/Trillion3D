import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { FRAMES_FORMAT, LIGHT_FORMAT } from './commonWgsl.ts'
import { PARAM_SLOT, PARAM_SLOT_BYTES, RESERVOIR_VECTORS } from './params.ts'

/** The bytes of a reservoir: four `vec4f`. */
const RESERVOIR_BYTES = RESERVOIR_VECTORS * 16

/** One image-sized texture of the pixel kernels. */
const textureOf = (
  device: GPUDevice,
  size: readonly [number, number],
  format: GPUTextureFormat,
  label: string,
) =>
  device.createTexture({
    label: `Trillion3D reservoir ${label}`,
    size: [...size],
    format,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })

/** The textures of a pixel's light: its colour (and, in the alpha, whether it answered), its rough specular (and the variance) and, where they are a history, the frames it holds and its depth. */
export interface LightSet {
  readonly light: GPUTextureView
  readonly rest: GPUTextureView
  readonly frames?: GPUTextureView
}

/**
 * WHAT THE RESERVOIR GATHER KEEPS between images and within one, for an image of `size` reduced by `factor`: the two pools of reservoirs (the first rays' and the spatial passes' sets; the two sets the
 * last image's history alternates between), the upsampling's pair of textures, the two sets of the accumulation (the history alternates between them) and the bilateral filter's pair, and the parameters
 * of its dispatches. Made again, the old given back, when the size or the reduction moves; the history then starts over.
 */
export function createReservoirResources(
  device: GPUDevice,
  size: readonly [number, number],
  factor: number,
) {
  const reduced = [ceilDiv(size[0], factor), ceilDiv(size[1], factor)] as const
  const poolBytes = reduced[0] * reduced[1] * RESERVOIR_BYTES * 2
  const fits = poolBytes <= device.limits.maxStorageBufferBindingSize
  if (!fits) return undefined
  const pool = (label: string) =>
    device.createBuffer({
      label: `Trillion3D reservoir pool ${label}`,
      size: poolBytes,
      usage: GPUBufferUsage.STORAGE,
    })
  const textures: GPUTexture[] = []
  const lightSet = (label: string, frames: boolean): LightSet => {
    const light = textureOf(device, size, LIGHT_FORMAT, `${label} light`)
    const rest = textureOf(device, size, LIGHT_FORMAT, `${label} rough specular`)
    textures.push(light, rest)
    if (!frames) return { light: light.createView(), rest: rest.createView() }
    const kept = textureOf(device, size, FRAMES_FORMAT, `${label} frames`)
    textures.push(kept)
    return { light: light.createView(), rest: rest.createView(), frames: kept.createView() }
  }
  const pools = [pool('rays'), pool('history')] as const
  const params = device.createBuffer({
    label: 'Trillion3D reservoir parameters',
    size: PARAM_SLOT_BYTES * PARAM_SLOT.count,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return {
    size,
    factor,
    reduced,
    pools,
    params,
    upsampled: lightSet('upsampled', false),
    history: [lightSet('history 0', true), lightSet('history 1', true)] as const,
    filtered: lightSet('filtered', false),
    dispose() {
      retire(device, {
        destroy: () => {
          for (const buffer of [...pools, params]) buffer.destroy()
          for (const texture of textures) texture.destroy()
        },
      })
    },
  }
}
export type ReservoirResources = NonNullable<ReturnType<typeof createReservoirResources>>
