import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { computeBufferEntry, computeTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import { createCachedGroup } from '../../../gpu/bind/cachedGroup.ts'
import { uniformBlock } from '../../../gpu/core/uniformBlock.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { DISPLAY_FORMAT } from '../../../scene/targetFormats.ts'
import { preparedPipeline } from '../../deferred/fullscreen.ts'
import { VISUALIZE_MODE } from '../visualizeModes.ts'

/**
 * THE SCREEN PROBES' HISTORY BYTE over the display image (the scene view's modes 22 and 23): the image's grey mixed four fifths of the way toward a red of the amount the byte holds
 * (the fast update's, in the high four bits, or the frames held, in the low four; sixteenths), everywhere: a zero amount gives the grey's fifth, near black, not the grey. The byte is the second word of the pixel's
 * shading (`SCREEN_PROBE_FORMATS.shading`), the one the image just drawn left.
 */

const LABEL = 'Trillion3D debug screen probe history'
/** The share of the red over the image's grey. */
const SHARE = 0.8

/** The bits of the byte a mode shows, and how far they are shifted down. */
const FIELD_OF_MODE: Readonly<Record<number, readonly [mask: number, shift: number]>> = {
  [VISUALIZE_MODE.screenProbeFastUpdate]: [0xf0, 4],
  [VISUALIZE_MODE.screenProbeFramesAccumulated]: [0x0f, 0],
}

export const HISTORY_VISUALIZE_WGSL = wgslProgram(
  `struct HistoryView{size:vec4f,field:vec4u}
@group(0) @binding(0) var<uniform> shown:HistoryView;
@group(0) @binding(1) var shadingTexture:texture_2d<u32>;
@group(0) @binding(2) var imageCopy:texture_2d<f32>;
// size: the display, then the image the history was drawn at; field: the mask of the bits shown, and their shift.
@fragment fn historyVisualizeFs(@builtin(position) at:vec4f)->@location(0) vec4f{
 let grey=dot(textureLoad(imageCopy,vec2i(at.xy),0).rgb,vec3f(1.0))/3.0;
 let texel=min(vec2i(at.xy/shown.size.xy*shown.size.zw),vec2i(shown.size.zw)-vec2i(1));
 let bits=(textureLoad(shadingTexture,texel,0).y&shown.field.x)>>shown.field.y;
 let amount=saturate(f32(bits)/15.0);
 return vec4f(mix(vec3f(grey),vec3f(amount,0.0,0.0),${SHARE}),1.0);
}`,
  [FULLSCREEN_VERTEX],
)

const pipelineOf = oncePerDevice((device: GPUDevice) => {
  const FRAGMENT = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: LABEL,
    entries: [
      computeBufferEntry(0, 'uniform', FRAGMENT),
      computeTextureEntry(1, 'uint', '2d', FRAGMENT),
      computeTextureEntry(2, 'unfilterable-float', '2d', FRAGMENT),
    ],
  })
  const module = device.createShaderModule({ label: LABEL, code: HISTORY_VISUALIZE_WGSL })
  return {
    layout,
    draw: preparedPipeline(device, {
      label: LABEL,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreen' },
      fragment: { module, entryPoint: 'historyVisualizeFs', targets: [{ format: DISPLAY_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    }).ask(),
  }
})

/** The pass that shows a field of the screen probes' history over the display image: a copy of the image it reads the grey from, kept between images. */
export function createHistoryVisualize(device: GPUDevice) {
  const uniform = uniformBlock(device, `${LABEL} parameters`, 32)
  const { f: floats, u: uints } = uniform.words
  let copy: { texture: GPUTexture; view: GPUTextureView } | undefined
  // Two kept groups: the shading texture takes turns between the two sides of its pair, so that neither is made again while the display stands.
  const cached = createCachedGroup(2)
  return {
    /** Draws the field of mode `mode` over `rt`'s display image; false where the view has no history to show yet. */
    encode(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder, mode: number): boolean {
      const screen = rt.gpu.screenProbes
      const display = rt.gpu.displayTexture
      const target = rt.gpu.displayView
      const field = FIELD_OF_MODE[mode]
      const draw = pipelineOf(device).draw.get()
      if (!screen?.image || !display || !target || !field || !draw) return false
      const { width, height } = display
      if (copy?.texture.width !== width || copy.texture.height !== height) {
        copy?.texture.destroy()
        const texture = device.createTexture({
          label: `${LABEL} image`,
          size: [width, height],
          format: DISPLAY_FORMAT,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        })
        copy = { texture, view: texture.createView() }
      }
      encoder.copyTextureToTexture({ texture: display }, { texture: copy.texture }, [width, height])
      floats[0] = width
      floats[1] = height
      floats[2] = screen.image.width
      floats[3] = screen.image.height
      uints.set(field, 4)
      uniform.send()
      // The image this view just drew left its history in the side the next one does not read.
      const side = 1 - screen.turn
      const shading = screen.resources.shading[side]
      const pass = encoder.beginRenderPass({
        label: LABEL,
        colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
      })
      pass.setPipeline(draw)
      const { layout } = pipelineOf(device)
      const group = cached.over(
        device,
        layout,
        [
          { binding: 0, resource: { buffer: uniform.buffer } },
          { binding: 1, resource: shading },
          { binding: 2, resource: copy.view },
        ],
        LABEL,
      )
      pass.setBindGroup(0, group)
      pass.draw(3)
      pass.end()
      return true
    },
    dispose() {
      uniform.buffer.destroy()
      copy?.texture.destroy()
      copy = undefined
    },
  }
}

/** The pass that shows the screen probes' history (`createHistoryVisualize`). */
export type HistoryVisualize = ReturnType<typeof createHistoryVisualize>
