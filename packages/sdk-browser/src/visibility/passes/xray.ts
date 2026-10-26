import { preparedPipeline, type PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { SEE_THROUGH_BACKGROUND_PASS, XRAY_PASS } from '../../diagnostic/stage/passLabels.ts'
import { VIS_XRAY_FRAGMENT, VIS_XRAY_VERTEX, visXrayShader } from '../shader/visWgsl.ts'
import { ADD_ONE } from '../../blend/equations.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { walkSlots } from './slotWalk.ts'
import { seeThrough } from './binning.ts'
import type { Clipping } from '../../gpu/core/clipDistances.ts'

/** Each visibility group layout's x-ray pipeline: made with the first see-through image of its
 *  device, dropped with the layout. */
const xrayPipelines = new WeakMap<GPUBindGroupLayout, PreparedPipeline<GPURenderPipeline>>()

/** The x-ray pipeline of `layout`, asked: the frames wait for its compile, once. Every triangle's
 *  both faces, no culling, no depth, added into the HDR colour's three channels — its alpha the
 *  background's one (`encodeSeeThroughBackground`); its module cuts at a view's plane the way the
 *  raster's does (`clipping`). */
function xrayPipeline(device: GPUDevice, layout: GPUBindGroupLayout, clipping?: Clipping) {
  let pipeline = xrayPipelines.get(layout)
  if (!pipeline) {
    const module = device.createShaderModule({ label: XRAY_PASS, code: visXrayShader(clipping) })
    pipeline = preparedPipeline(device, {
      label: XRAY_PASS,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: VIS_XRAY_VERTEX },
      fragment: {
        module,
        entryPoint: VIS_XRAY_FRAGMENT,
        targets: [
          {
            format: HDR_FORMAT,
            blend: { color: ADD_ONE, alpha: ADD_ONE },
            writeMask: GPUColorWrite.RED | GPUColorWrite.GREEN | GPUColorWrite.BLUE,
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    })
    xrayPipelines.set(layout, pipeline)
  }
  return pipeline.ask()
}

/**
 * A see-through view's background, laid over the lit image before its transparents: the view's
 * clear colour, at an alpha of one, which the sky, the fog and the clouds drawn over its resolve's
 * paint leave out of sight. Opaque, every edge drawn over it — the transparents', then the cut's
 * (`encodeXray`) — is shown, the raw output of a diagnostic view taking the colour as it is.
 */
export function encodeSeeThroughBackground(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  clear: GPUColorDict,
) {
  const { gpu } = rt
  if (!seeThrough(rt) || !gpu.hdrView) return
  encoder
    .beginRenderPass({
      label: SEE_THROUGH_BACKGROUND_PASS,
      colorAttachments: [
        { view: gpu.hdrView, loadOp: 'clear', clearValue: clear, storeOp: 'store' },
      ],
    })
    .end()
}

/** Both halves, the main pass's first. */
const HALVES = [false, true] as const

/**
 * THE X-RAY PASS of the `wireframe` and `xray` views (`../shader/visWgsl.ts`), over
 * their background (`encodeSeeThroughBackground`) and their transparents: what the GPU cut
 * submitted this image — the visibility's indirect slots, both halves, as the hardware raster
 * drew them, and the software raster's rows from their own slots (`walkSlots`) — drawn again as
 * edges, seen through every surface, with no depth target: the
 * scene's depth stays as the image wrote it. An image whose visibility drew nothing
 * (`run.depthDrawn`) draws no slot, its commands not this image's.
 */
export function encodeXray(rt: WebgpuPagesRuntime, device: GPUDevice, encoder: GPUCommandEncoder) {
  const { gpu, vis, run } = rt
  if (!seeThrough(rt) || !run.depthDrawn || !gpu.hdrView || !vis.visBindGroupLayout) return
  const pipeline = xrayPipeline(device, vis.visBindGroupLayout, rt.setup.clipping)
  const program = pipeline.get()
  if (!program) return
  const pass = encoder.beginRenderPass({
    label: XRAY_PASS,
    colorAttachments: [{ view: gpu.hdrView, loadOp: 'load', storeOp: 'store' }],
  })
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  pass.setPipeline(program)
  for (const rest of HALVES)
    run.gpuDrawCalls += walkSlots(rt, device, pass, rest, undefined, true).draws
  pass.end()
}
