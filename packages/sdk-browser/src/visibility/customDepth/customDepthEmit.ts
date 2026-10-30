import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { FULLSCREEN_ENTRY } from '../../gpu/shader/fullscreenTriangle.ts'
import { CUSTOM_DEPTH_PASS } from '../../diagnostic/stage/passLabels.ts'
import { boundGroups } from '../../hair/ribbonBinds.ts'
import type { CustomDepthTargets } from './customDepthTargets.ts'
import { CUSTOM_DEPTH_EMIT_WGSL, CUSTOM_STENCIL_FORMAT } from './customDepthWgsl.ts'

const module = oncePerDevice((device) =>
  device.createShaderModule({ label: CUSTOM_DEPTH_PASS, code: CUSTOM_DEPTH_EMIT_WGSL }),
)

/** The emission's pipeline: `emitDepth` alone, or `emitDepthStencil` into the stencil target. Written over any depth, the pass clearing every pixel before. */
const pipelines = oncePerDevice((device) => {
  const code = module(device)
  const make = (entryPoint: string, targets: GPUColorTargetState[]) =>
    preparedPipeline(device, {
      label: `${CUSTOM_DEPTH_PASS} ${entryPoint}`,
      layout: 'auto',
      vertex: { module: code, entryPoint: FULLSCREEN_ENTRY },
      fragment: { module: code, entryPoint, targets },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' },
    })
  return {
    depth: make('emitDepth', []),
    depthStencil: make('emitDepthStencil', [{ format: CUSTOM_STENCIL_FORMAT }]),
  }
})

/** What the emission reads: the identifiers and the depth of the view that drew the objects asking for the custom depth, its page records and the placements' records. */
export interface CustomDepthInputs {
  readonly ids: GPUTextureView
  readonly drawn: GPUTextureView
  readonly pages: GPUBuffer
  readonly placements: GPUBuffer
}

/** The bind group of a pipeline over the inputs, kept while they stay; the depth alone leaves the placements out, which it does not read. */
const groups = (withPlacements: boolean) =>
  boundGroups<GPUTextureView, GPUTextureView, GPUBuffer, GPUBuffer>(
    1,
    (device, pipeline, ids, drawn, pages, placements) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: sequentialEntries([
          ids,
          drawn,
          { buffer: pages },
          ...(withPlacements ? [{ buffer: placements }] : []),
        ]),
      }),
  )
const depthGroups = groups(false)
const depthStencilGroups = groups(true)

/**
 * Writes the custom depth of an image into `targets` (made, `createCustomDepthTargets`): the depth of each pixel that shows a cluster, the
 * far elsewhere, and with a stencil target the value of its object (`CUSTOM_DEPTH_EMIT_WGSL`). With no `inputs` the image drew no
 * cluster and the targets are only cleared; while the pipeline compiles they keep the clear.
 */
export function encodeCustomDepthEmit(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  targets: CustomDepthTargets,
  inputs: CustomDepthInputs | undefined,
) {
  const { depthView, stencilView, size } = targets
  if (!depthView) return false
  const set = pipelines(device)
  const draw = inputs && (stencilView ? set.depthStencil : set.depth).get()
  const pass = encoder.beginRenderPass({
    label: CUSTOM_DEPTH_PASS,
    colorAttachments: stencilView
      ? [{ view: stencilView, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }]
      : [],
    depthStencilAttachment: {
      view: depthView,
      depthLoadOp: 'clear',
      depthClearValue: 0,
      depthStoreOp: 'store',
    },
  })
  if (inputs && draw) {
    const bind = (stencilView ? depthStencilGroups : depthGroups)(
      device,
      draw,
      inputs.ids,
      inputs.drawn,
      inputs.pages,
      inputs.placements,
    )
    pass.setViewport(0, 0, size[0], size[1], 0, 1)
    pass.setPipeline(draw)
    pass.setBindGroup(0, bind)
    pass.draw(3)
  }
  pass.end()
}
