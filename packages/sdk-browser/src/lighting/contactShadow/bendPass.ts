import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import type { ContactShadowView } from '../../../../sdk-core/src/scene/light/contactShadowView.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { uniformStride } from '../../session/memory/pools.ts'
import { vsmWriteDepthFromDeviceZ } from '../shadows/vsm/constants.ts'
import { BEND_MAX_DISPATCHES, bendDispatchList } from './bendDispatches.ts'
import { BEND_BINDING, BEND_ENTRY, BEND_PARAMS, BEND_WGSL } from './bendWgsl.ts'

/** The intensity modes (`contactShadowIntensityMode`), the kernels' pipeline constant: by the surface the ray hit, by the pixel's depth,
 *  the casting intensity everywhere. */
export type BendIntensityMode = 0 | 1 | 2

const LABEL = 'Trillion3D contact shadow (screen-space march)'
/** One kernel a mode, once a device, compiled off the frame. */
const KERNELS = [0, 1, 2].map((mode) =>
  autoKernel(`${LABEL} mode ${mode}`, BEND_WGSL, BEND_ENTRY, { INTENSITY_MODE: mode }),
)

/** The kernels of the three modes as the stages a frame waits for before it runs the screen-space march. */
export const bendStages = (device: GPUDevice) => KERNELS.map((kernel) => kernel(device))

/** What a device holds for the march: the parameters of its dispatches, a slot each, and the groups bound over a frame's inputs. */
interface BendState {
  params: GPUBuffer
  stride: number
  floats: Float32Array<ArrayBuffer>
  words: Int32Array<ArrayBuffer>
  /** The next free slot of the parameters: each light of a frame takes its own, the buffer being written before the encoder is submitted. */
  cursor: number
}

/** The slots of the parameters, a light taking up to `BEND_MAX_DISPATCHES` of them: 32 lights a frame before the ring turns. */
const SLOTS = BEND_MAX_DISPATCHES * 32

const stateOf = oncePerDevice((device: GPUDevice): BendState => {
  const stride = uniformStride(device.limits)
  const params = device.createBuffer({
    label: `${LABEL} parameters`,
    size: stride * SLOTS,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const data = new ArrayBuffer(stride * BEND_MAX_DISPATCHES)
  return { params, stride, floats: new Float32Array(data), words: new Int32Array(data), cursor: 0 }
})

/** The settings of the march (`contactShadowMethod` 1): the view's (`ContactShadowView`) with the unit of the fade in metres. */
export interface BendSettings {
  mode: BendIntensityMode
  /** The thickness of a pixel's surface, a share of the depth left to the far plane (`contactShadowBendSurfaceThickness`). */
  surfaceThickness: number
  /** The depth where the shadow begins to fade from the non-casting intensity to the casting one, and the length of the fade, metres. */
  fadeStart: number
  fadeLength: number
}

/** The march's settings from the view's (`ContactShadowView`): the fade's depths in metres. */
export const bendSettingsOf = (view: ContactShadowView): BendSettings => ({
  mode: view.contactShadowIntensityMode as BendIntensityMode,
  surfaceThickness: view.contactShadowBendSurfaceThickness,
  fadeStart: view.contactShadowIntensityFadeStart / CENTIMETRES_PER_METRE,
  fadeLength: view.contactShadowIntensityFadeLength / CENTIMETRES_PER_METRE,
})

/** What a march reads and writes. */
export interface BendInputs {
  /** The scene's depth, reverse-Z (`texture_depth_2d`), and the surfaces' words (`texture_2d_array<u32>`, `SURFACE_WORDS.flags`). */
  depth: GPUTextureView
  flags: GPUTextureView
  /** The shadow, `BEND_OUTPUT_FORMAT`, the depth's size: 1 where lit. */
  output: GPUTextureView
  size: readonly [number, number]
  /** The light's clip position without the divide by w (`bendDispatchList`) and its intensities. */
  projection: readonly [number, number, number, number]
  casting: number
  nonCasting: number
  /** The rectangle of the screen the light reaches, inclusive. */
  min: readonly [number, number]
  max: readonly [number, number]
  /** The view-to-clip of the camera, column-major, and whether it is a perspective (the words that turn a device depth into a depth). */
  viewToClip: ArrayLike<number>
  perspective: boolean
  settings: BendSettings
}

/**
 * The screen-space shadow of one light, marched on the GPU into `output` (the reference's Bend method): the dispatches that cover the
 * light's rectangle (`bendDispatchList`), each of the kernel of the intensity mode, in `encoder`. False while the kernel compiles. The shadow
 * is then the light's contact shadow term at each pixel, multiplied into its mask. The pixels the waves do not reach keep what `output`
 * held: the caller fills it with 1 first.
 */
export function encodeBendContactShadow(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  inputs: BendInputs,
) {
  const kernel =
    KERNELS[Math.min(2, Math.max(0, Math.trunc(inputs.settings.mode) || 0))](device).get()
  if (!kernel) return false
  const state = stateOf(device)
  const list = bendDispatchList(inputs.projection, inputs.size, inputs.min, inputs.max)
  const at = BEND_PARAMS.at
  const { floats, words, stride } = state
  const { settings } = inputs
  list.dispatches.forEach((dispatch, k) => {
    const base = (k * stride) / 4
    floats.set(list.light, base + at.light)
    words.set(
      [dispatch.offset[0], dispatch.offset[1], inputs.size[0], inputs.size[1]],
      base + at.wave,
    )
    floats[base + at.tune] = settings.surfaceThickness
    floats.set(
      [inputs.casting, inputs.nonCasting, settings.fadeStart, 1 / settings.fadeLength],
      base + at.intensity,
    )
    vsmWriteDepthFromDeviceZ(floats, base + at.depthWords, inputs.viewToClip, inputs.perspective)
  })
  const used = list.dispatches.length
  if (used === 0) return true
  if (state.cursor + used > SLOTS) state.cursor = 0
  const first = state.cursor
  state.cursor += used
  device.queue.writeBuffer(state.params, first * stride, state.floats, 0, (used * stride) / 4)
  const pass = encoder.beginComputePass({ label: LABEL })
  pass.setPipeline(kernel)
  list.dispatches.forEach((dispatch, k) => {
    pass.setBindGroup(
      0,
      device.createBindGroup({
        label: `${LABEL} ${k}`,
        layout: kernel.getBindGroupLayout(0),
        entries: [
          {
            binding: BEND_BINDING.params,
            resource: {
              buffer: state.params,
              offset: (first + k) * stride,
              size: BEND_PARAMS.words * 4,
            },
          },
          { binding: BEND_BINDING.depth, resource: inputs.depth },
          { binding: BEND_BINDING.flags, resource: inputs.flags },
          { binding: BEND_BINDING.output, resource: inputs.output },
        ],
      }),
    )
    pass.dispatchWorkgroups(...dispatch.groups)
  })
  pass.end()
  return true
}
