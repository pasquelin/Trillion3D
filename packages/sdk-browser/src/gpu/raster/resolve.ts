import type { GpuRasterInput } from './types.ts'
import { DEPTH_COMPARE_OR_EQUAL } from '../../camera/depthConvention.ts'
import { VIS_UNIFORM_BYTES } from '../../webgpu/core/bindLayout.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'

const RESOLVE_DEPTH = {
  format: 'depth32float' as const,
  depthWriteEnabled: true,
  depthCompare: DEPTH_COMPARE_OR_EQUAL,
}

/**
 * Full-screen hardware resolves of the visibility buffer.
 *
 * The hardware raster opens and clears the attachments — identifiers, opaque depth, pyramid
 * level zero — and writes its triangles there; these resolves then merge those of the compute
 * raster, under the same depth test, keeping what is already there (`load`). A pixel both
 * producers reach goes to the nearest, and on a tie to compute, which runs last:
 * `greater-equal`, otherwise the second resolve would lose the depth the first just wrote.
 *
 * `encodeHiz` serves between the two halves: it writes compute occluder depth into level zero
 * and the buffer, before any identifier is resolved.
 */
export function createRasterResolves(
  device: GPUDevice,
  code: string,
  work: GPUBuffer,
  targetBytes: number,
) {
  const z: Resolves = {
    ...{ device, work, targetBytes, ...resolvePipelines(device, code) },
    group: undefined,
    ...{ idsFor: undefined, depthFor: undefined, hizFor: undefined },
    ...{ hizPass: undefined, finalPass: undefined },
  }
  return {
    /** Compute occluder depth, in the level zero the pyramid reduces and in the depth
     *  buffer; no identifier. */
    encodeHiz(encoder: GPUCommandEncoder, input: GpuRasterInput, width: number, height: number) {
      refresh(z, input)
      const pass = encoder.beginRenderPass(z.hizPass!)
      pass.setViewport(0, 0, width, height, 0, 1)
      pass.setPipeline(z.hizOnly.get())
      pass.setBindGroup(0, bound(z, input.uniform))
      pass.draw(3)
      pass.end()
    },
    /** Closed frame: identifiers, depth, and the pyramid reset to the whole cut. */
    encodeFinal(encoder: GPUCommandEncoder, input: GpuRasterInput, width: number, height: number) {
      refresh(z, input)
      const pass = encoder.beginRenderPass(z.finalPass!)
      pass.setViewport(0, 0, width, height, 0, 1)
      pass.setPipeline((input.hizView ? z.two : z.one).get())
      pass.setBindGroup(0, bound(z, input.uniform))
      pass.draw(3)
      pass.end()
    },
  }
}

type Resolves = ReturnType<typeof resolvePipelines> & {
  device: GPUDevice
  work: GPUBuffer
  targetBytes: number
  group: GPUBindGroup | undefined
  /**
   * The two pass descriptors, kept as-is until the next set of views. They depend only on the
   * views, and the views change only on target resize — which releases this whole raster.
   * Rebuilding them per frame allocated seven objects to rewrite the same fields.
   */
  idsFor: GPUTextureView | undefined
  depthFor: GPUTextureView | undefined
  hizFor: GPUTextureView | undefined
  hizPass: GPURenderPassDescriptor | undefined
  finalPass: GPURenderPassDescriptor | undefined
}

function resolvePipelines(device: GPUDevice, code: string) {
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  })
  const module = device.createShaderModule({ code })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const vertex = { module, entryPoint: 'vs' }
  const primitive = { topology: 'triangle-list' as const }
  // Asked, compiled off the thread from now, the frames held on them, as the raster's own
  // (`raster.ts`).
  const makeFinal = (two: boolean) =>
    preparedPipeline(device, {
      layout: pipelineLayout,
      vertex,
      fragment: {
        module,
        entryPoint: two ? 'two' : 'one',
        targets: two
          ? [{ format: 'r32uint' as const }, { format: 'r32float' as const }]
          : [{ format: 'r32uint' as const }],
      },
      primitive,
      depthStencil: RESOLVE_DEPTH,
    })
  const one = makeFinal(false).ask(),
    two = makeFinal(true).ask()
  const hizOnly = preparedPipeline(device, {
    layout: pipelineLayout,
    vertex,
    fragment: { module, entryPoint: 'hiz', targets: [{ format: 'r32float' as const }] },
    primitive,
    depthStencil: RESOLVE_DEPTH,
  }).ask()
  return { layout, one, two, hizOnly }
}

const bound = (z: Resolves, uniform: GPUBuffer) =>
  (z.group ??= z.device.createBindGroup({
    layout: z.layout,
    entries: [
      { binding: 0, resource: { buffer: z.work, offset: 0, size: z.targetBytes } },
      { binding: 1, resource: { buffer: uniform, offset: 0, size: VIS_UNIFORM_BYTES } },
    ],
  }))

/** A colour attachment kept as the hardware raster left it. */
const kept = (view: GPUTextureView) => ({
  view,
  loadOp: 'load' as const,
  storeOp: 'store' as const,
})
const depthKept = (view: GPUTextureView) => ({
  view,
  depthLoadOp: 'load' as const,
  depthStoreOp: 'store' as const,
})

/** Rebuilds both descriptors when, and only when, one of the three views has changed. */
function refresh(z: Resolves, input: GpuRasterInput) {
  if (z.idsFor === input.idsView && z.depthFor === input.depthView && z.hizFor === input.hizView)
    return
  z.idsFor = input.idsView
  z.depthFor = input.depthView
  z.hizFor = input.hizView
  z.hizPass = {
    label: 'Trillion3D raster occluder hiz',
    colorAttachments: [kept(input.hizView!)],
    depthStencilAttachment: depthKept(input.depthView),
  }
  z.finalPass = {
    label: 'Trillion3D raster resolve',
    colorAttachments: input.hizView
      ? [kept(input.idsView), kept(input.hizView)]
      : [kept(input.idsView)],
    depthStencilAttachment: depthKept(input.depthView),
  }
}
