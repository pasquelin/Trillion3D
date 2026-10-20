import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { FULLSCREEN_VERTEX } from '../../lighting/deferred/shaders.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { FRAME_DIFFERENCE_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** How many times the frame-difference view amplifies a change: a step of one 8-bit level in the
 *  display shows as eight. */
export const FRAME_DIFFERENCE_GAIN = 8

/** The display image against the one before, pixel for pixel: the luminance of their difference,
 *  in display values — what the eye sees change —, amplified (`FRAME_DIFFERENCE_GAIN`) and shown as
 *  grey. A still pixel is black to the bit. */
export const FRAME_DIFFERENCE_WGSL = wgslProgram(
  `
@group(0) @binding(0) var current:texture_2d<f32>;
@group(0) @binding(1) var previous:texture_2d<f32>;
@fragment fn difference(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);
 let step=textureLoad(current,coord,0).rgb-textureLoad(previous,coord,0).rgb;
 return vec4f(vec3f(saturate(abs(luminance(step))*${FRAME_DIFFERENCE_GAIN}.0)),1.0);
}`,
  [FULLSCREEN_VERTEX, luminance],
)

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
  const pipeline = preparedPipeline(device, {
    label: 'Trillion3D frame difference',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint: 'difference', targets: [{ format: 'bgra8unorm' }] },
    primitive: { topology: 'triangle-list' },
  }).ask()
  let previous: GPUTexture | undefined,
    source: GPUTexture | undefined,
    group: GPUBindGroup | undefined
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
  const release = () => {
    previous?.destroy()
    previous = source = group = undefined
  }
  return {
    /** Draws `display`'s difference with the image before onto `canvas`, then keeps `display`. */
    encode(encoder: GPUCommandEncoder, display: GPUTexture, canvas: GPUTextureView) {
      const extent = { width: display.width, height: display.height }
      if (source !== display || !previous || !group) {
        release()
        previous = device.createTexture({
          label: 'Trillion3D previous display',
          size: extent,
          format: display.format,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })
        group = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: display.createView() },
            { binding: 1, resource: previous.createView() },
          ],
        })
        source = display
        encoder.copyTextureToTexture({ texture: display }, { texture: previous }, extent)
      }
      target.view = canvas
      const pass = encoder.beginRenderPass(descriptor)
      pass.setPipeline(pipeline.get())
      pass.setBindGroup(0, group)
      pass.draw(3)
      pass.end()
      encoder.copyTextureToTexture({ texture: display }, { texture: previous }, extent)
    },
    dispose: release,
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
