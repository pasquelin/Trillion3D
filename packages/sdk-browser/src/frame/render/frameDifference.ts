import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { FRAME_DIFFERENCE_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { FRAME_DIFFERENCE_WGSL } from './frameDifferenceWgsl.ts'
import { CANVAS_FORMAT } from '../../gpu/core/canvasFormat.ts'

/** The arguments of a copy of one texture into another. */
type TextureCopy = Parameters<GPUCommandEncoder['copyTextureToTexture']>

/**
 * The display image before the current one, kept at the display's size and format with the bind
 * group that reads both. Made again when the display is another texture: that first image is
 * compared with itself.
 */
function createKeptDisplay(device: GPUDevice, layout: GPUBindGroupLayout) {
  /** `copy`: the copy of `source` into `previous`, its arguments made once with the group. */
  let kept:
    | {
        source: GPUTexture
        previous: GPUTexture
        group: GPUBindGroup
        copy: TextureCopy
      }
    | undefined
  const release = () => {
    kept?.previous.destroy()
    kept = undefined
  }
  return {
    /** The bind group that reads `display` and the image before it. */
    groupOf(encoder: GPUCommandEncoder, display: GPUTexture) {
      if (kept?.source === display) return kept.group
      release()
      const previous = device.createTexture({
        label: 'Trillion3D previous display',
        size: { width: display.width, height: display.height },
        format: display.format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      const group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: display.createView() },
          { binding: 1, resource: previous.createView() },
        ],
      })
      const copy: TextureCopy = [
        { texture: display },
        { texture: previous },
        { width: display.width, height: display.height },
      ]
      kept = { source: display, previous, group, copy }
      encoder.copyTextureToTexture(...copy)
      return group
    },
    /** Keeps the display of the last `groupOf` as the image before the next one. */
    keep(encoder: GPUCommandEncoder) {
      if (kept) encoder.copyTextureToTexture(...kept.copy)
    },
    release,
  }
}

/**
 * The frame-difference view (`frame-difference`): each image's final display colour — after the
 * temporal resolve, the effects and the composition, before any guide — against the image before,
 * drawn onto the canvas (`FRAME_DIFFERENCE_WGSL`), then copied into the one image it keeps, the
 * display's size and format. Made when the view is chosen and destroyed when it is left
 * (`followFrameDifference`, `../backend/pages.ts`): no other view holds a byte of it nor runs any of it.
 * The first image after a (re)making, of a new display size or target, is compared with itself:
 * black.
 */
export function createFrameDifference(device: GPUDevice) {
  const fragment = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    entries: [
      computeTextureEntry(0, 'float', '2d', fragment),
      computeTextureEntry(1, 'float', '2d', fragment),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D frame difference',
    code: FRAME_DIFFERENCE_WGSL,
  })
  // Asked now, off the frame: the frames wait for it rather than compile it.
  const pipeline = preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      module,
      layout,
      'difference',
      [{ format: CANVAS_FORMAT }],
      'Trillion3D frame difference',
    ),
  ).ask()
  const held = createKeptDisplay(device, layout)
  const target: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 1],
  }
  const descriptor: GPURenderPassDescriptor = {
    label: FRAME_DIFFERENCE_PASS,
    colorAttachments: [target],
  }
  return {
    /** Draws `display`'s difference with the image before onto `canvas`, then keeps `display`. */
    encode(encoder: GPUCommandEncoder, display: GPUTexture, canvas: GPUTextureView) {
      // Not compiled: nothing is drawn and the image before stays, compared with the next.
      const program = pipeline.get()
      if (!program) return
      const group = held.groupOf(encoder, display)
      target.view = canvas
      drawFullscreenTriangle(encoder, descriptor, program, group)
      held.keep(encoder)
    },
    dispose: held.release,
  }
}

/** The frame-difference view's resources (`createFrameDifference`). */
export type FrameDifference = ReturnType<typeof createFrameDifference>

/** The frame-difference view's resources followed to the view chosen: made when it is, its pass
 *  asked off the frame, and destroyed, every byte, when another view is. */
export function followFrameDifference(rt: Pick<WebgpuPagesRuntime, 'gpu' | 'run'>) {
  const { gpu } = rt
  if (rt.run.diagnostic === 'frame-difference') {
    if (gpu.device) gpu.frameDifference ??= createFrameDifference(gpu.device)
    return
  }
  gpu.frameDifference?.dispose()
  gpu.frameDifference = undefined
}
