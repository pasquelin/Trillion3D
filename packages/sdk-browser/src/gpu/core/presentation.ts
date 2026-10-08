import { sharedGpuDevice } from './sessionHandle.ts'
import { PRESENT_SHADER } from './presentWgsl.ts'
import { preparedPipeline, started } from '../../lighting/deferred/fullscreen.ts'
import { createPresentAt, type PresentRect } from './presentAt.ts'
import { canvasImageKept, canvasImageReplaced, closeCanvasImage } from './canvasHandover.ts'

/** Configures `context` on `device` itself — WebGPU refuses a session's handle, no `GPUDevice` —:
 *  configuring blanks the canvas, so the image of a closed session stays until this one draws. */
function configureCanvas(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
) {
  canvasImageReplaced(canvas)
  context.configure({
    device: sharedGpuDevice(device),
    format,
    alphaMode: 'opaque',
    colorSpace: 'srgb',
  })
}

/** What a presenter knows of its canvas: whether it is configured — at once, or at the first
 *  present for a canvas that keeps a closed session's image —, the image the whole canvas holds at
 *  its size — nothing once anything else may have reached it —, and the canvas texture the whole
 *  image was last drawn into: a view is placed on it alone. */
function canvasHold(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
) {
  let configured = false,
    heldImage: GPUTexture | undefined,
    heldWidth = 0,
    heldHeight = 0,
    shown: GPUTexture | undefined
  const forget = () => void (heldImage = undefined)
  const configure = () => {
    if (configured) return
    configureCanvas(device, canvas, context, format)
    configured = true
  }
  if (!canvasImageKept(canvas)) configure()
  return {
    get configured() {
      return configured
    },
    get shown() {
      return shown
    },
    forget,
    /** The whole canvas's texture this frame, blank until a composition fills it (`composed`). */
    targetView(width: number, height: number) {
      configure()
      forget()
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      shown = context.getCurrentTexture()
      return shown.createView()
    },
    /** `image`, `width` × `height`, was just drawn over the whole canvas: the canvas holds it. */
    composed(image: GPUTexture, width: number, height: number) {
      heldImage = image
      heldWidth = width
      heldHeight = height
    },
    /** Whether the canvas still shows `image` whole, at `width` × `height` and at that size. */
    holds: (image: GPUTexture, width: number, height: number) =>
      heldImage === image &&
      heldWidth === width &&
      heldHeight === height &&
      canvas.width === width &&
      canvas.height === height,
    /** Nothing shown any more. */
    release() {
      shown = undefined
      forget()
    },
  }
}

/** The program that draws a display image over the whole canvas, compiled off the frame. */
function presentProgram(device: GPUDevice, format: GPUTextureFormat) {
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  })
  const module = device.createShaderModule({ code: PRESENT_SHADER })
  const pipeline = started(
    preparedPipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreen' },
      fragment: { module, entryPoint: 'present', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  )
  return { layout, pipeline }
}

/** Draws `group`'s image over `view`, cleared first, in `encoder`. */
function drawWhole(
  encoder: GPUCommandEncoder,
  view: GPUTextureView,
  pipeline: GPURenderPipeline,
  group: GPUBindGroup,
) {
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D direct present',
    colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.draw(3)
  pass.end()
}

/** Unconfigures `context`, once no session follows on a kept canvas (`closeCanvasImage`). */
function withdraw(canvas: HTMLCanvasElement, context: GPUCanvasContext) {
  closeCanvasImage(canvas, () => {
    context.unconfigure()
    // Unconfiguring replaces the drawing buffer with transparent black, but a reader that copies
    // the canvas (`drawImage`, `copyExternalImageToTexture`) still sees the last image in
    // Chromium: resetting the bitmap the HTML way — a size write — makes the withdrawal hold for
    // every reader.
    const { width } = canvas
    canvas.width = width
  })
}

/** Source is already display encoded. No second tone map or color conversion. A canvas that keeps
 *  its image across sessions (`canvasHandover.ts`) is configured at the first present only.
 *
 *  The canvas keeps the image last presented into it: WebGPU replaces its drawing buffer only when
 *  a new texture is taken (`getCurrentTexture`), when it is configured or when it is sized. So the
 *  presenter knows which display image, at which size, the canvas holds (`holds`), and a held frame
 *  that would copy that same image again encodes nothing. */
export function createGpuPresenter(device: GPUDevice, canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgpu')
  if (!context) throw new Error('WEBGPU_CANVAS_UNAVAILABLE')
  const format: GPUTextureFormat = 'bgra8unorm'
  const hold = canvasHold(device, canvas, context, format)
  try {
    return presenterOf(device, canvas, context, format, hold)
  } catch (error) {
    if (hold.configured) context.unconfigure()
    throw error
  }
}

/** The presenter of `hold`'s canvas, its program built (`createGpuPresenter`). */
function presenterOf(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  format: GPUTextureFormat,
  hold: ReturnType<typeof canvasHold>,
) {
  const { layout, pipeline } = presentProgram(device, format)
  let texture: GPUTexture | undefined, group: GPUBindGroup | undefined
  const presentAt = createPresentAt(device, layout, format)
  return {
    canvas,
    targetView: hold.targetView,
    composed: hold.composed,
    holds: hold.holds,
    /** What the canvas shows is no longer known: sized by its owner, or a frame was drawn. */
    forget: hold.forget,
    /** Compiles off the frame what presents a view placed at a rectangle of the canvas: asked
     *  when the first one is added, before it presents. */
    preparePlaced: presentAt.prepare,
    /** The image over the whole canvas, sized to it; at `at`, a persistent view's rectangle of
     *  the canvas, which keeps its size and what else it shows this frame. */
    present(
      encoder: GPUCommandEncoder,
      image: GPUTexture,
      width: number,
      height: number,
      at?: PresentRect,
    ) {
      if (at) {
        // Not this frame's whole image (its targets still asked, say): the canvas keeps the
        // last frame it showed, never a blank one with this view alone on it. Either way the
        // canvas no longer holds one image whole.
        hold.forget()
        if (!hold.configured) return
        const current = context.getCurrentTexture()
        if (current === hold.shown)
          presentAt.present(encoder, current.createView(), image, at, canvas)
        return
      }
      const view = hold.targetView(width, height)
      if (texture !== image) {
        texture = image
        group = device.createBindGroup({
          layout,
          entries: [{ binding: 0, resource: image.createView() }],
        })
      }
      drawWhole(encoder, view, pipeline.get(), group!)
      hold.composed(image, width, height)
    },
    /** Withdraws the image: nothing that samples the canvas afterwards reads a frame of this
     *  device — at once, or once no session follows on a kept canvas (`closeCanvasImage`). */
    dispose() {
      group = texture = undefined
      hold.release()
      if (hold.configured) withdraw(canvas, context)
    },
  }
}
