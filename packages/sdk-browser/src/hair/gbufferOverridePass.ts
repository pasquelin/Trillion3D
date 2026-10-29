import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import {
  HAIR_DEPTH_OVERRIDE_WGSL,
  HAIR_GBUFFER_WRITE,
  hairGbufferOverrideWgsl,
} from './gbufferOverrideWgsl.ts'
import type { HairViewGpu } from './viewGpu.ts'
import { HAIR_ALL_TILES_DISPATCH, HAIR_ALL_TILES_DRAW } from './visibilityMath.ts'

const LABEL = `${HAIR_STRANDS_PASS_PREFIX}g-buffer override`

/** The kernel that writes the strands into the surfaces, one for each way (`HAIR_GBUFFER_WRITE`). */
const kernels = preparedPipelines(
  (write: number) => autoKernel(LABEL, hairGbufferOverrideWgsl(write), 'hairGbufferOverride'),
  (write) => write,
)

/** The group of the depth draw: the image block, the tiles, the nearest strand's depth. */
const depthLayout = oncePerDevice((device) =>
  device.createBindGroupLayout({
    label: `${LABEL} depth`,
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  }),
)

const DEPTH_LABEL = `${LABEL} depth`

const depthPipeline = oncePerDevice((device) => {
  const module = device.createShaderModule({ label: DEPTH_LABEL, code: HAIR_DEPTH_OVERRIDE_WGSL })
  return preparedPipeline(device, {
    label: DEPTH_LABEL,
    layout: device.createPipelineLayout({ bindGroupLayouts: [depthLayout(device)] }),
    vertex: { module, entryPoint: 'hairTileQuadVs' },
    fragment: { module, entryPoint: 'hairDepthOverrideFs', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' },
  })
})

/** What the override keeps for a view while its resources stay: the groups, made again when one moved. */
interface OverrideGroups {
  compute?: GPUBindGroup
  depth?: GPUBindGroup
  held: unknown[]
}
const groups = new WeakMap<HairViewGpu, OverrideGroups>()

/** The pass that writes the depth, its descriptor refilled in place for each image. */
const depthPass: GPURenderPassDescriptor & {
  depthStencilAttachment: GPURenderPassDepthStencilAttachment
} = {
  label: `${LABEL} depth`,
  colorAttachments: [],
  depthStencilAttachment: { view: undefined as never, depthLoadOp: 'load', depthStoreOp: 'store' },
}

/** The groups of the override over the resources of `view`, made again when one moved. */
function groupsOf(
  device: GPUDevice,
  view: HairViewGpu,
  pipeline: GPUComputePipeline,
  withDepth: boolean,
) {
  const { record, inputs } = view
  const { tiles } = record!.buffers
  const { nodes, targets } = record!
  const held = [
    pipeline,
    tiles,
    nodes,
    targets.nodeIndexView,
    targets.hairOnlyDepthView,
    inputs.surfaces,
  ]
  const kept = groups.get(view)
  if (
    kept &&
    !held.some((resource, at) => kept.held[at] !== resource) &&
    !withDepth === !kept.depth
  )
    return kept
  const image = { buffer: view.imageBlock.buffer }
  const made: OverrideGroups = {
    held,
    compute: device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: sequentialEntries([
        image,
        { buffer: tiles.counts },
        { buffer: tiles.data },
        targets.nodeIndexView,
        { buffer: nodes.nodeData },
        targets.hairOnlyDepthView,
        inputs.surfaces![0],
        inputs.surfaces![1],
      ]),
    }),
    depth: withDepth
      ? device.createBindGroup({
          layout: depthLayout(device),
          entries: sequentialEntries([image, { buffer: tiles.data }, targets.hairOnlyDepthView]),
        })
      : undefined,
  }
  groups.set(view, made)
  return made
}

/**
 * Writes the strands of `view` into its image's surfaces, `write` being the setting `hairWriteGBufferData`
 * (`HAIR_GBUFFER_WRITE`): called once the strands are laid on the image (`composeHairStrands`), for the
 * passes that read the surfaces next. The full write also takes the opaque depth `depth` to the nearest
 * strand's. Nothing where the setting is `none`, the view has no surfaces handed or a pipeline compiles.
 */
export function encodeHairGbufferOverride(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  view: HairViewGpu,
  write: number,
  depth: GPUTextureView | undefined,
) {
  const { record, inputs } = view
  if (write === HAIR_GBUFFER_WRITE.none || !record || !inputs.surfaces) return
  const pipeline = kernels.of(write)(device).get()
  const full = write === HAIR_GBUFFER_WRITE.full
  const depthDraw = full ? depthPipeline(device).get() : undefined
  if (!pipeline || (full && (!depthDraw || !depth))) return
  const made = groupsOf(device, view, pipeline, full)
  const { tiles } = record.buffers
  const compute = encoder.beginComputePass({ label: LABEL })
  compute.setPipeline(pipeline)
  compute.setBindGroup(0, made.compute!)
  compute.dispatchWorkgroupsIndirect(tiles.dispatchArgs, HAIR_ALL_TILES_DISPATCH)
  compute.end()
  if (!depthDraw || !depth) return
  depthPass.depthStencilAttachment.view = depth
  const pass = encoder.beginRenderPass(depthPass)
  pass.setViewport(0, 0, inputs.size[0], inputs.size[1], 0, 1)
  pass.setPipeline(depthDraw)
  pass.setBindGroup(0, made.depth!)
  pass.drawIndirect(tiles.drawArgs, HAIR_ALL_TILES_DRAW)
  pass.end()
}
