import { PRESENT_AT_SHADER } from './presentWgsl.ts'
import { preparedPipeline, started } from '../../lighting/deferred/fullscreen.ts'
import { DIRECT_PRESENT_PASS, VIEW_PRESENT_PASS } from '../../stage/passLabels.ts'
import { computeTextureEntry, sequentialEntries } from './computeBindings.ts'

/** A rectangle of the canvas, in canvas pixels from the top left. */
export type PresentRect = { x: number; y: number; width: number; height: number }

/**
 * THE ONE PRESENT PROGRAM: an image copied texel for pixel to the canvas at an origin — the whole
 * canvas at the origin 0, cleared first (`whole`), or a persistent view's rectangle, what the main
 * view and the other views presented there this frame kept (`at`). The origin rides in the draw's
 * first instance (`PRESENT_AT_SHADER`), so one pipeline serves both, compiled off the frame as the
 * presenter is made (`presentation.ts`).
 */
export function createPresent(device: GPUDevice, format: GPUTextureFormat) {
  const layout = device.createBindGroupLayout({
    entries: [computeTextureEntry(0, 'unfilterable-float', '2d', GPUShaderStage.FRAGMENT)],
  })
  const module = device.createShaderModule({ code: PRESENT_AT_SHADER })
  const pipeline = started(
    preparedPipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreenAt' },
      fragment: { module, entryPoint: 'presentAt', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    }),
  )
  // One group an image, kept as long as the image: every view presents its own each frame
  // (`webgpu/core/bindIdentity.ts`, its one exception).
  const groups = new WeakMap<GPUTexture, GPUBindGroup>()
  const group = (image: GPUTexture) => {
    let made = groups.get(image)
    if (!made) {
      made = device.createBindGroup({
        layout,
        entries: sequentialEntries([image.createView()]),
      })
      groups.set(image, made)
    }
    return made
  }
  return {
    /** Compiles the program off the frame — already asked when it was made —, before a view
     *  placed on the canvas presents. */
    prepare: () => pipeline.prepare(),
    /** Draws `image` over the whole of `view`, cleared first. */
    whole(encoder: GPUCommandEncoder, view: GPUTextureView, image: GPUTexture) {
      const pass = encoder.beginRenderPass({
        label: DIRECT_PRESENT_PASS,
        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      })
      pass.setPipeline(pipeline.get())
      pass.setBindGroup(0, group(image))
      pass.draw(3)
      pass.end()
    },
    /** Draws `image` at `at` of `view`, the rest kept. `canvas` is the canvas's size: the part of
     *  `at` past its right or bottom edge is not drawn, and a rectangle that starts left of or
     *  above it is not drawn at all. */
    at(
      encoder: GPUCommandEncoder,
      view: GPUTextureView,
      image: GPUTexture,
      at: PresentRect,
      canvas: { width: number; height: number },
    ) {
      const width = Math.min(at.width, canvas.width - at.x),
        height = Math.min(at.height, canvas.height - at.y)
      if (width <= 0 || height <= 0 || at.x < 0 || at.y < 0) return
      const pass = encoder.beginRenderPass({
        label: VIEW_PRESENT_PASS,
        colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setPipeline(pipeline.get())
      pass.setBindGroup(0, group(image))
      pass.setViewport(at.x, at.y, width, height, 0, 1)
      pass.setScissorRect(at.x, at.y, width, height)
      pass.draw(3, 1, 0, at.x + at.y * 65536)
      pass.end()
    },
  }
}
