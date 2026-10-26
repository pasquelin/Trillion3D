import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { feedbackConstants } from '../../materials/virtual/requestWgsl.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { DISTORTION_BINDINGS } from '../stagePipelines.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { heldGroup } from '../../gpu/bind/bindIdentity.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'

/** The distortion's accumulation group: the deferred view, the opaque depth. */
export const distortionLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D distortion accumulation',
    entries: [
      computeUniformEntry(DISTORTION_BINDINGS.view, {}, GPUShaderStage.FRAGMENT),
      computeTextureEntry(DISTORTION_BINDINGS.depth, 'depth', '2d', GPUShaderStage.FRAGMENT),
    ],
  }),
)

/** The distortion's application group: the deferred view, the offsets, the scene copy — read
 *  bilinear by the sampler, rgba16float filtering — and the sampler. */
const applyLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D distortion apply',
    entries: [
      computeUniformEntry(DISTORTION_BINDINGS.view, {}, GPUShaderStage.FRAGMENT),
      computeTextureEntry(
        DISTORTION_BINDINGS.offsets,
        'unfilterable-float',
        '2d',
        GPUShaderStage.FRAGMENT,
      ),
      computeTextureEntry(DISTORTION_BINDINGS.scene, 'float', '2d', GPUShaderStage.FRAGMENT),
      computeSamplerEntry(DISTORTION_BINDINGS.sampler, 'filtering', GPUShaderStage.FRAGMENT),
    ],
  }),
)

/** The full-screen application's group 0, which it reads nothing of: an empty layout and group. */
const emptyLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({ label: 'Trillion3D empty', entries: [] }),
)
export const emptyGroup = oncePerDevice((device: GPUDevice) =>
  device.createBindGroup({ label: 'Trillion3D empty', layout: emptyLayout(device), entries: [] }),
)

/** The engine's held group (`heldGroup`) of `layout` over a uniform buffer and one or two texture
 *  views at `bindings`, in that order, with the fixed entries `fixed` beside them: made again only
 *  when one of them moved, a frame that names the same resources allocating nothing. */
function viewsGroup(
  device: GPUDevice,
  label: string,
  layout: () => GPUBindGroupLayout,
  bindings: readonly number[],
  fixed: readonly GPUBindGroupEntry[] = [],
) {
  const held = heldGroup()
  return (buffer: GPUBuffer, first: GPUTextureView, second?: GPUTextureView) => {
    const { identity } = held,
      { next } = identity
    next[0] = buffer
    next[1] = first
    next[2] = second
    if (identity.moved() || !held.group) {
      const resources = [{ buffer }, first, second]
      held.group = device.createBindGroup({
        label,
        layout: layout(),
        entries: [
          ...bindings.map((binding, at) => ({ binding, resource: resources[at]! })),
          ...fixed,
        ],
      })
    }
    return held.group
  }
}

/** The distortion's application pipeline and its two held groups. */
export function distortionApply(
  device: GPUDevice,
  module: GPUShaderModule,
  constants: ReturnType<typeof feedbackConstants>,
) {
  const distortionGroup = viewsGroup(
    device,
    'Trillion3D distortion accumulation',
    () => distortionLayout(device),
    [DISTORTION_BINDINGS.view, DISTORTION_BINDINGS.depth],
  )
  const applyGroup = viewsGroup(
    device,
    'Trillion3D distortion apply',
    () => applyLayout(device),
    [DISTORTION_BINDINGS.view, DISTORTION_BINDINGS.offsets, DISTORTION_BINDINGS.scene],
    [{ binding: DISTORTION_BINDINGS.sampler, resource: postSamplers(device).clamped }],
  )
  // The application, full screen: no vertex buffer, no
  // depth, the pixels without an offset dropped by its fragment (\`distortedScene\`).
  const apply = preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      module,
      [emptyLayout(device), applyLayout(device)],
      'fsDistortionApply',
      [{ format: HDR_FORMAT }],
      'Trillion3D distortion apply',
      constants,
    ),
  )
  return { apply, distortionGroup, applyGroup }
}
