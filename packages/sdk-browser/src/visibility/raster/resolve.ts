import type { GpuRasterInput } from './types.ts'
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
import { VIS_UNIFORM_BYTES } from '../../gpu/bind/bindLayout.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { RASTER_OCCLUDER_HIZ_PASS, RASTER_RESOLVE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import { sequentialEntries, computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'

/** The closing resolve writes every pixel's depth: no test, the visibility buffer decided. */
const RESOLVE_DEPTH: GPUDepthStencilState = {
  format: DEPTH_FORMAT,
  depthWriteEnabled: true,
  depthCompare: 'always',
}

/**
 * Full-screen resolves of the visibility buffer both rasters wrote (`VIS_WRITE_WGSL`) into the
 * attachments every consumer reads, each pixel written, so each attachment is cleared, never
 * loaded: past the drawn size, it holds the background.
 *
 * `encodeDepthLevel` serves between the two halves: it writes the occluder depth into the level
 * zero the pyramid reduces, before any identifier is resolved. `encodeFinal` closes the frame:
 * identifiers, depth, and level zero again, the whole cut's.
 */
export function createRasterResolves(
  device: GPUDevice,
  code: string,
  work: GPUBuffer,
  targetBytes: number,
) {
  const z: Resolves = {
    ...{ device, work, targetBytes, ...resolvePipelines(device, code) },
    ...{ bound: createWebgpuBindIdentity(), group: undefined },
    ...{ idsFor: undefined, depthFor: undefined, hizFor: undefined },
    ...{ levelPass: undefined, finalPass: undefined },
  }
  return {
    /** The occluder depth, into the level zero the pyramid reduces; no identifier. */
    encodeDepthLevel(
      encoder: GPUCommandEncoder,
      input: GpuRasterInput,
      width: number,
      height: number,
    ) {
      refresh(z, input)
      drawResolve(encoder, z, z.levelPass!, z.depthLevel, input.uniform, width, height)
    },
    /** Closed frame: identifiers, depth, and the pyramid's level zero over the whole cut. */
    encodeFinal(encoder: GPUCommandEncoder, input: GpuRasterInput, width: number, height: number) {
      refresh(z, input)
      drawResolve(encoder, z, z.finalPass!, z.resolved, input.uniform, width, height)
    },
  }
}

/** One full-screen resolve over the view's `uniform`; the pipeline is asked for only once its
 *  pass is open. */
function drawResolve(
  encoder: GPUCommandEncoder,
  z: Resolves,
  desc: GPURenderPassDescriptor,
  pipeline: Resolves['resolved'],
  uniform: GPUBuffer,
  width: number,
  height: number,
) {
  const pass = encoder.beginRenderPass(desc)
  pass.setViewport(0, 0, width, height, 0, 1)
  pass.setPipeline(pipeline.get())
  pass.setBindGroup(0, bound(z, uniform))
  pass.draw(3)
  pass.end()
}

type Resolves = ReturnType<typeof resolvePipelines> & {
  device: GPUDevice
  work: GPUBuffer
  targetBytes: number
  /** The group over the raster's target and the view uniform, made again when the uniform moved. */
  bound: WebgpuBindIdentity
  group: GPUBindGroup | undefined
  /**
   * The two pass descriptors, kept as-is until the next set of views. They depend only on the
   * views, and the views change only on target resize — which releases this whole raster.
   * Rebuilding them per frame allocated seven objects to rewrite the same fields.
   */
  idsFor: GPUTextureView | undefined
  depthFor: GPUTextureView | undefined
  hizFor: GPUTextureView | undefined
  levelPass: GPURenderPassDescriptor | undefined
  finalPass: GPURenderPassDescriptor | undefined
}

function resolvePipelines(device: GPUDevice, code: string) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'read-only-storage', GPUShaderStage.FRAGMENT),
      computeBufferEntry(1, 'uniform', GPUShaderStage.FRAGMENT),
    ],
  })
  const module = device.createShaderModule({ code })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const vertex = { module, entryPoint: 'fullscreen' }
  const primitive = { topology: 'triangle-list' as const }
  // Asked, compiled off the thread from now, the frames held on them, as the raster's own
  // (`raster.ts`).
  const resolved = preparedPipeline(device, {
    layout: pipelineLayout,
    vertex,
    fragment: {
      module,
      entryPoint: 'resolved',
      targets: [{ format: 'r32uint' as const }, { format: 'r32float' as const }],
    },
    primitive,
    depthStencil: RESOLVE_DEPTH,
  }).ask()
  const depthLevel = preparedPipeline(device, {
    layout: pipelineLayout,
    vertex,
    fragment: { module, entryPoint: 'depthLevel', targets: [{ format: 'r32float' as const }] },
    primitive,
  }).ask()
  return { layout, resolved, depthLevel }
}

function bound(z: Resolves, uniform: GPUBuffer) {
  z.bound.next[0] = uniform
  if (z.bound.moved())
    z.group = z.device.createBindGroup({
      layout: z.layout,
      entries: sequentialEntries([
        { buffer: z.work, offset: 0, size: z.targetBytes },
        { buffer: uniform, offset: 0, size: VIS_UNIFORM_BYTES },
      ]),
    })
  return z.group!
}

/** A colour attachment the resolve writes whole, cleared to `clear`: identifiers to the
 *  background, level zero to the far plane — a clear to 1 would put the near plane under every
 *  uncovered texel, and the pyramid's minimum reduction would reject whatever projects there. */
const written = (view: GPUTextureView, clear: number) => ({
  view,
  loadOp: 'clear' as const,
  storeOp: 'store' as const,
  clearValue: { r: clear, g: 0, b: 0, a: 1 },
})

/** Rebuilds both descriptors when, and only when, one of the three views has changed. */
function refresh(z: Resolves, input: GpuRasterInput) {
  if (z.idsFor === input.idsView && z.depthFor === input.depthView && z.hizFor === input.hizView)
    return
  z.idsFor = input.idsView
  z.depthFor = input.depthView
  z.hizFor = input.hizView
  z.levelPass = {
    label: RASTER_OCCLUDER_HIZ_PASS,
    colorAttachments: [written(input.hizView, DEPTH_CLEAR)],
  }
  z.finalPass = {
    label: RASTER_RESOLVE_PASS,
    colorAttachments: [written(input.idsView, 0), written(input.hizView, DEPTH_CLEAR)],
    depthStencilAttachment: {
      view: input.depthView,
      depthClearValue: DEPTH_CLEAR,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  }
}
