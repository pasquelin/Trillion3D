import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../../diagnostic/stage/passLabels.ts'
import { RENDER_CURVE_COMPOSE_WGSL } from './rasterWgsl.ts'

const LABEL = `${HAIR_STRANDS_PASS_PREFIX}curve raster compose`

/** What the colour premultiplied by its coverage leaves of what is under it: the image under, less the coverage. */
const OVER: GPUBlendComponent = {
  srcFactor: 'one',
  dstFactor: 'one-minus-src-alpha',
  operation: 'add',
}

const pipeline = oncePerDevice((device) => {
  const module = device.createShaderModule({ label: LABEL, code: RENDER_CURVE_COMPOSE_WGSL })
  return preparedPipeline(device, {
    label: LABEL,
    layout: 'auto',
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: {
      module,
      entryPoint: 'composeCurves',
      targets: [{ format: HDR_FORMAT, blend: { color: OVER, alpha: OVER } }],
    },
    primitive: { topology: 'triangle-list' },
  })
})

/** Lays the image the curve raster drew (`RenderCurve.output`) on the lit image `target`. Nothing while the pipeline compiles. */
export function encodeRenderCurveCompose(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  curves: GPUTextureView,
  target: GPUTextureView,
) {
  const draw = pipeline(device).get()
  if (!draw) return
  const pass = encoder.beginRenderPass({
    label: LABEL,
    colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
  })
  pass.setPipeline(draw)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: draw.getBindGroupLayout(0),
      entries: sequentialEntries([curves]),
    }),
  )
  pass.draw(3)
  pass.end()
}
