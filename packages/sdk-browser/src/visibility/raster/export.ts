import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import type { GpuRasterInput } from './types.ts'
import {
  DEPTH_EXPORT_SHADER,
  EXPORT_BINDINGS,
  EXPORT_DEPTH,
  EXPORT_IDS,
  EXPORT_SCENE_DEPTH,
  exportSource,
} from './exportWgsl.ts'
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
import { VIS_UNIFORM_BYTES } from '../../gpu/bind/bindLayout.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import {
  RASTER_DEPTH_EXPORT_PASS,
  RASTER_OCCLUDER_HIZ_PASS,
  RASTER_RESOLVE_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

/** The threads a side of the export's workgroup (`exportWgsl.ts`). */
const EXPORT_SIDE = 8

/** The scene's depth is written whole, no test: the export decided every pixel. */
const EXPORT_DEPTH_STATE: GPUDepthStencilState = {
  format: DEPTH_FORMAT,
  depthWriteEnabled: true,
  depthCompare: 'always',
}

/** The resources the export's group names, in the identity that tells when one moved. */
function followExport(
  next: unknown[],
  input: GpuRasterInput,
  wide: boolean,
  hardware: GPUTextureView | undefined,
) {
  next[0] = input.uniform
  next[1] = input.hizView
  next[2] = input.idsView
  next[3] = wide ? undefined : input.depthView
  next[4] = wide ? undefined : hardware
  next[5] = input.pages
  next[6] = input.classBins
  next.length = 7
}

/** The entries of the export's group over the image's resources. */
function exportEntries(
  work: GPUBuffer,
  mask: GPUTextureView,
  input: GpuRasterInput,
  wide: boolean,
  hardware: GPUTextureView | undefined,
): GPUBindGroupEntry[] {
  return [
    { binding: EXPORT_BINDINGS.pages, resource: { buffer: input.pages } },
    { binding: EXPORT_BINDINGS.bins, resource: input.classBins },
    { binding: EXPORT_BINDINGS.mask, resource: mask },
    { binding: EXPORT_BINDINGS.work, resource: { buffer: work } },
    {
      binding: EXPORT_BINDINGS.uniform,
      resource: { buffer: input.uniform, offset: 0, size: VIS_UNIFORM_BYTES },
    },
    { binding: EXPORT_BINDINGS.level0, resource: input.hizView },
    { binding: EXPORT_BINDINGS.ids, resource: input.idsView },
    ...(wide
      ? []
      : [
          { binding: EXPORT_BINDINGS.hwDepth, resource: input.depthView },
          { binding: EXPORT_BINDINGS.hwIds, resource: hardware! },
        ]),
  ]
}

/** The render pass that writes the scene's depth into `view`. */
const depthExportPass = (view: GPUTextureView): GPURenderPassDescriptor => ({
  label: RASTER_DEPTH_EXPORT_PASS,
  colorAttachments: [],
  depthStencilAttachment: {
    view,
    depthClearValue: DEPTH_CLEAR,
    depthLoadOp: 'clear',
    depthStoreOp: 'store',
  },
})

const dispatchExport = (
  compute: GPUComputePassEncoder,
  stage: { get(): GPUComputePipeline | undefined },
  width: number,
  height: number,
) => {
  const pipeline = stage.get()
  if (!pipeline) return
  compute.setPipeline(pipeline)
  compute.dispatchWorkgroups(ceilDiv(width, EXPORT_SIDE), ceilDiv(height, EXPORT_SIDE))
}

const DEPTH_PASS: GPUComputePassDescriptor = { label: RASTER_OCCLUDER_HIZ_PASS }
const RESOLVE_PASS: GPUComputePassDescriptor = { label: RASTER_RESOLVE_PASS }

/**
 * The export of the visibility buffer both rasters wrote (`visWriteWgsl`) into what every consumer
 * reads (`exportWgsl.ts`): compute passes over the image at its allocated size, each texel written,
 * so each texture is rewritten whole and never loaded — past the drawn size it holds the background.
 * The identifiers' pass writes each pixel's shading mask with its identifier: the class of its page
 * as the bins hold it (`../shader/shadeBinsWgsl.ts`), once, for the bins' kernels to read.
 * The bins are assigned before the image submits (`../../materials/classes/shadeBins.ts`), so the
 * head this pass reads is the one the image's kernels and shading use.
 *
 * `encodeDepth` serves between the two halves of the image: the pyramid needs the occluders' depth
 * before any identifier is chosen, so it writes level zero alone. `encodeClose` closes the image:
 * the identifiers and the shading masks the surface passes classify by and, in a render pass of
 * its own, the scene's depth attachment from the level zero the last `encodeDepth` wrote (which
 * the identifiers do not change). `wide` is the device with the 64-bit word; without it the
 * hardware raster's depth and identifiers (`hardware`) merge into what the buffer holds.
 */
export function createRasterExport(
  device: GPUDevice,
  wide: boolean,
  work: GPUBuffer,
  width: number,
  height: number,
  hardware?: GPUTextureView,
) {
  const z = exportPipelines(device, wide)
  // The shading masks, written with the identifiers at the image's allocated size.
  const maskTexture = device.createTexture({
    label: 'Trillion3D shading masks',
    size: [width, height],
    format: 'r32uint',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const maskView = maskTexture.createView()
  const identity = createWebgpuBindIdentity(),
    depthIdentity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined, depthGroup: GPUBindGroup | undefined
  let depthFor: GPUTextureView | undefined, depthPass: GPURenderPassDescriptor | undefined
  /** The export's group over the image's resources, made again when one moved. */
  const grouped = (input: GpuRasterInput) => {
    followExport(identity.next, input, wide, hardware)
    if (identity.moved())
      group = device.createBindGroup({
        layout: z.layout,
        entries: exportEntries(work, maskView, input, wide, hardware),
      })
    return group!
  }
  return {
    /** The shading masks of the closed image (`packShadingMask`), the bins' kernels' input. */
    mask: maskView,
    dispose: () => maskTexture.destroy(),
    /** The depth of the buffer, into the level zero the pyramid reduces; no identifier. */
    encodeDepth(steps: ComputeRun, input: GpuRasterInput) {
      const compute = steps.pass(DEPTH_PASS)
      compute.setBindGroup(0, grouped(input))
      dispatchExport(compute, z.depth, width, height)
    },
    /** The closed image: the identifiers, then the scene's depth over the viewport `[w, h]`. */
    encodeClose(
      steps: ComputeRun,
      input: GpuRasterInput,
      viewportWidth: number,
      viewportHeight: number,
    ) {
      const compute = steps.pass(RESOLVE_PASS)
      compute.setBindGroup(0, grouped(input))
      dispatchExport(compute, z.ids, width, height)
      depthIdentity.next[0] = input.hizView
      if (depthIdentity.moved())
        depthGroup = device.createBindGroup({
          layout: z.depthLayout,
          entries: sequentialEntries([input.hizView]),
        })
      if (depthFor !== input.depthView) {
        depthFor = input.depthView
        depthPass = depthExportPass(input.depthView)
      }
      drawFullscreenTriangle(
        steps.apart(),
        depthPass!,
        z.sceneDepth.get(),
        depthGroup!,
        viewportWidth,
        viewportHeight,
      )
    },
  }
}

/** The export's layout and compute stages, and the scene depth's pipeline, asked now and compiled off
 *  the thread (as the raster's own, `raster.ts`). */
function exportPipelines(device: GPUDevice, wide: boolean) {
  const b = EXPORT_BINDINGS
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(b.work, 'read-only-storage'),
      computeUniformEntry(b.uniform, { minBindingSize: VIS_UNIFORM_BYTES }),
      computeStorageTextureEntry(b.level0, 'r32float'),
      computeStorageTextureEntry(b.ids, 'r32uint'),
      computeBufferEntry(b.pages, 'read-only-storage'),
      computeTextureEntry(b.bins, 'uint', '2d-array'),
      computeStorageTextureEntry(b.mask, 'r32uint'),
      ...(wide
        ? []
        : [computeTextureEntry(b.hwDepth, 'depth'), computeTextureEntry(b.hwIds, 'uint')]),
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const module = device.createShaderModule({ code: exportSource(wide) })
  const stage = (entry: string) => preparedComputeStage(device, pipelineLayout, module, entry).ask()
  const depthLayout = device.createBindGroupLayout({
    entries: [computeTextureEntry(0, 'unfilterable-float', '2d', GPUShaderStage.FRAGMENT)],
  })
  const sceneDepth = preparedPipeline(device, {
    ...fullscreenDescriptor(
      device,
      device.createShaderModule({ code: DEPTH_EXPORT_SHADER }),
      depthLayout,
      EXPORT_SCENE_DEPTH,
      [],
    ),
    depthStencil: EXPORT_DEPTH_STATE,
  }).ask()
  return {
    layout,
    depthLayout,
    depth: stage(EXPORT_DEPTH),
    ids: stage(EXPORT_IDS),
    sceneDepth,
  }
}
