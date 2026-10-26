import { oncePerDevice } from './oncePerDevice.ts'

/**
 * THE SHARED SAMPLERS, once a device: the bilinear one clamping to the edge (`clamped`), the
 * trilinear one clamping (`mipped`), the bilinear one repeating (`wrapped`) and the nearest one
 * clamping (`point`). The engine's passes read their images through them; one object each per
 * device, whoever asks.
 */
export const postSamplers = oncePerDevice((device: GPUDevice) => {
  const make = (
    label: string,
    filter: GPUFilterMode,
    wrap: GPUAddressMode,
    mipmapFilter: GPUMipmapFilterMode = 'nearest',
  ) =>
    device.createSampler({
      label: `Trillion3D post ${label}`,
      magFilter: filter,
      minFilter: filter,
      mipmapFilter,
      addressModeU: wrap,
      addressModeV: wrap,
    })
  return {
    clamped: make('clamped sampler', 'linear', 'clamp-to-edge'),
    mipped: make('mipped sampler', 'linear', 'clamp-to-edge', 'linear'),
    wrapped: make('wrapped sampler', 'linear', 'repeat'),
    point: make('point sampler', 'nearest', 'clamp-to-edge'),
  }
})
