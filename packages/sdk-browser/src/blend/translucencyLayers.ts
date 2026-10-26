import { toHalf } from '../../../math/src/float/half.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { computeSamplerEntry, computeTextureEntry } from '../gpu/core/computeBindings.ts'
import { postSamplers } from '../gpu/core/postSamplers.ts'

/**
 * HOW A PASS READS THE TRANSLUCENCY OF AN IMAGE (`translucency.ts`): one bind group of three
 * bindings, the translucency target (`layers`), the modulation target (`modulation`) and the
 * bilinear sampler a layer drawn below the size of the image is read through; the layout is
 * every pass's that composes layers (`translucencyCompose.ts`, the depth of field's recombine).
 * An image with no layer binds `noLayers`: no light, a transmittance of 1 and a modulation of white
 * covering nothing, which leave the image as it is.
 */
export const LAYERS_BINDINGS = { layers: 0, modulation: 1, sampler: 2 } as const

/** The layout of the group (`LAYERS_BINDINGS`). */
export const layersLayout = oncePerDevice((device: GPUDevice) => {
  const seen = GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE
  return device.createBindGroupLayout({
    label: 'Trillion3D translucency',
    entries: [
      computeTextureEntry(LAYERS_BINDINGS.layers, 'float', '2d', seen),
      computeTextureEntry(LAYERS_BINDINGS.modulation, 'float', '2d', seen),
      computeSamplerEntry(LAYERS_BINDINGS.sampler, 'filtering', seen),
    ],
  })
})

/** The group reading the translucency target `layers` and the modulation target `modulation`. */
export const layersGroup = (
  device: GPUDevice,
  label: string,
  layers: GPUTextureView,
  modulation: GPUTextureView,
) =>
  device.createBindGroup({
    label,
    layout: layersLayout(device),
    entries: [
      { binding: LAYERS_BINDINGS.layers, resource: layers },
      { binding: LAYERS_BINDINGS.modulation, resource: modulation },
      { binding: LAYERS_BINDINGS.sampler, resource: postSamplers(device).clamped },
    ],
  })

/** The half float 1. */
const ONE_HALF = toHalf(1)

/** A 1×1 texture of the texel `halves` (the half floats of its four channels). */
function standIn(device: GPUDevice, label: string, halves: readonly number[]) {
  const texture = device.createTexture({
    label,
    size: [1, 1],
    format: HDR_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture },
    new Uint16Array(halves),
    { bytesPerRow: texelBytesOf(HDR_FORMAT) },
    [1, 1],
  )
  return texture
}

/** A 1×1 texture of what a texel no layer covers holds: no light and a transmittance of 1. */
export const createNoTranslucency = (device: GPUDevice) =>
  standIn(device, 'Trillion3D no translucency', [0, 0, 0, ONE_HALF])

/** The texel of what holds no modulation: white, covering nothing. */
const createNoModulation = (device: GPUDevice) =>
  standIn(device, 'Trillion3D no modulation', [ONE_HALF, ONE_HALF, ONE_HALF, 0])

/** The view of a white modulation, once a device: what the composition reads where no layer of the
 *  image multiplied the scene. */
export const noModulationView = oncePerDevice((device: GPUDevice) =>
  createNoModulation(device).createView(),
)

/** The group of an image with no layer, once a device. */
export const noLayers = oncePerDevice((device: GPUDevice) =>
  layersGroup(
    device,
    'Trillion3D no translucency',
    createNoTranslucency(device).createView(),
    noModulationView(device),
  ),
)
