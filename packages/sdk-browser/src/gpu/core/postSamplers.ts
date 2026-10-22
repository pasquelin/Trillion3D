import { oncePerDevice } from './oncePerDevice.ts'

/**
 * THE POST PASSES' SAMPLERS, once a device: the bilinear one clamping to the edge (`clamped`), the
 * bilinear one repeating (`wrapped`) and the nearest one clamping (`point`). The filters, the bloom's
 * convolution, the depth of field and the motion blur read their images through them; one object each
 * per device, whoever asks.
 */
export const postSamplers = oncePerDevice((device: GPUDevice) => {
  const make = (label: string, filter: GPUFilterMode, wrap: GPUAddressMode) =>
    device.createSampler({
      label: `Trillion3D post ${label}`,
      magFilter: filter,
      minFilter: filter,
      addressModeU: wrap,
      addressModeV: wrap,
    })
  return {
    clamped: make('clamped sampler', 'linear', 'clamp-to-edge'),
    wrapped: make('wrapped sampler', 'linear', 'repeat'),
    point: make('point sampler', 'nearest', 'clamp-to-edge'),
  }
})
