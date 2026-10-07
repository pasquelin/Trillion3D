import {
  DISPATCH_WORDS,
  HEADER_CLEAR_BYTES,
  LIST_HEADER,
  MODE_DEPTH_OCCLUDER,
  MODE_DEPTH_REST,
  MODE_ID,
  RASTER_CLASSES,
  rasterEntry,
} from './contract.ts'
import { RESOLVE, rasterSource } from './shader.ts'
import { SMALL_BINDINGS, atlasLayoutEntries, readOnly } from '../../webgpu/core/bindLayout.ts'
import { createRasterBindings } from './bindings.ts'
import { createRasterResolves } from './resolve.ts'
import { preparedComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import type { GpuRasterInput } from './types.ts'
import { ceilDiv, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { DEFAULT_GROUP_WIDTH, dispatchRows } from '../dispatch/grid.ts'

/**
 * Compute raster of the opaque and masked cut.
 *
 * `capacity` is the number of triangles a list can hold: every triangle of every drawable row.
 * Both lists therefore each hold the whole, and no frame loses one.
 */
export function createGpuRaster(
  device: GPUDevice,
  width: number,
  height: number,
  capacity: number,
) {
  const { targetBytes, listOffset, work, indirect } = rasterBuffers(device, width, height, capacity)
  const { computeLayout, ...pipelines } = rasterPipelines(device, capacity, listOffset)
  const r: Raster = {
    ...{ width, height, work, indirect, listOffset, ...pipelines },
    resolves: createRasterResolves(device, RESOLVE, work, targetBytes),
    bindings: createRasterBindings(device, computeLayout, work),
    group: undefined,
  }
  return {
    width,
    height,
    capacity,
    /**
     * Occluder half: binning the cut, occluder depth, and its merge into pyramid level zero and
     * the depth buffer the hardware raster just wrote. Returns the number of compute dispatches
     * encoded.
     */
    encodeOccluders: (encoder: GPUCommandEncoder, input: GpuRasterInput) =>
      encodeOccluders(r, encoder, input),
    /** Surviving tested half, after the pyramid verdict. */
    encodeRest(encoder: GPUCommandEncoder) {
      encodeMode(r, encoder, MODE_DEPTH_REST, 'Trillion3D raster tested depth')
      return RASTER_CLASSES.length
    },
    /** Identifier resolve over everything that was drawn, and the frame closed. */
    encodeIds(encoder: GPUCommandEncoder, input: GpuRasterInput) {
      encodeMode(r, encoder, MODE_ID, 'Trillion3D raster identifiers')
      r.resolves.encodeFinal(encoder, input, width, height)
      return RASTER_CLASSES.length
    },
    dispose() {
      work.destroy()
      indirect.destroy()
    },
  }
}

type Raster = Omit<ReturnType<typeof rasterPipelines>, 'computeLayout'> & {
  width: number
  height: number
  work: GPUBuffer
  indirect: GPUBuffer
  listOffset: number
  resolves: ReturnType<typeof createRasterResolves>
  bindings: ReturnType<typeof createRasterBindings>
  group: GPUBindGroup | undefined
}

/** One storage buffer for the image and for the lists: the compute stage is allowed only eight
 *  buffers on the poorest device WebGPU guarantees, and the raster uses them all. */
function rasterBuffers(device: GPUDevice, width: number, height: number, capacity: number) {
  const targetBytes = Math.max(8, width * height * 8),
    listOffset = targetBytes
  const work = device.createBuffer({
    label: 'Trillion3D raster target and lists',
    size: listOffset + Math.max(4, (LIST_HEADER + 2 * capacity) * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  // Dispatch words are copied out of the lists instead of being written by a binding, so no
  // pass holds the buffer it launches from.
  const indirect = device.createBuffer({
    label: 'Trillion3D raster dispatch',
    size: DISPATCH_WORDS * 4,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  })
  return { targetBytes, listOffset, work, indirect }
}

function rasterPipelines(device: GPUDevice, capacity: number, listOffset: number) {
  const b = SMALL_BINDINGS
  const compute = GPUShaderStage.COMPUTE
  const computeLayout = device.createBindGroupLayout({
    entries: [
      { binding: b.indices, visibility: compute, buffer: readOnly },
      { binding: b.positions, visibility: compute, buffer: readOnly },
      { binding: b.pages, visibility: compute, buffer: readOnly },
      { binding: b.hizFlags, visibility: compute, buffer: readOnly },
      { binding: b.uniform, visibility: compute, buffer: { type: 'uniform' } },
      { binding: b.uvs, visibility: compute, buffer: readOnly },
      ...atlasLayoutEntries(b.color, compute),
      { binding: b.sampler, visibility: compute, sampler: {} },
      { binding: b.work, visibility: compute, buffer: { type: 'storage' } },
      { binding: b.selectionMask, visibility: compute, buffer: readOnly },
    ],
  })
  const computeModule = device.createShaderModule({ code: rasterSource(capacity, listOffset / 4) })
  const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] })
  // Asked, compiled off the thread from now, the frames held on them: the raster is made at a
  // frame's entry (`../../webgpu/frame/framePipelines.ts`), and the frame that draws it finds them.
  const pipelineFor = (entryPoint: string) =>
    preparedComputePipeline(device, {
      layout: computePipelineLayout,
      compute: { module: computeModule, entryPoint },
    }).ask()
  const clear = pipelineFor('clear'),
    bin = pipelineFor('bin'),
    plan = pipelineFor('plan')
  /** One pipeline per class and per mode: the mode does not travel by a uniform, it IS the
   *  entry point, so no dispatch rereads a word to know what it does. */
  const raster = RASTER_CLASSES.map((klass) =>
    [MODE_DEPTH_OCCLUDER, MODE_DEPTH_REST, MODE_ID].map((mode) =>
      pipelineFor(rasterEntry(klass, mode)),
    ),
  )
  return { computeLayout, clear, bin, plan, raster }
}

/** The four indirect dispatches of a mode, in a single compute pass. */
function encodeMode(r: Raster, encoder: GPUCommandEncoder, mode: number, label: string) {
  const pass = encoder.beginComputePass({ label })
  pass.setBindGroup(0, r.group!)
  for (let klass = 0; klass < RASTER_CLASSES.length; klass++) {
    pass.setPipeline(r.raster[klass]![mode]!.get())
    pass.dispatchWorkgroupsIndirect(r.indirect, klass * 12)
  }
  pass.end()
}

function encodeOccluders(r: Raster, encoder: GPUCommandEncoder, input: GpuRasterInput) {
  const { width, height, work, listOffset } = r
  const group = (r.group = r.bindings(input))
  encoder.clearBuffer(work, listOffset, HEADER_CLEAR_BYTES)
  const binning = encoder.beginComputePass({ label: 'Trillion3D raster binning' })
  binning.setBindGroup(0, group)
  binning.setPipeline(r.clear.get())
  // A thread a pixel.
  dispatchRows(binning, ceilDiv(width * height, 64))
  binning.setPipeline(r.bin.get())
  // A group a page row, in rows; z: a page's triangles, at most 256 (`VIS_TRIANGLE_BITS`), 4 groups.
  dispatchRows(
    binning,
    Math.max(1, input.pageRows),
    DEFAULT_GROUP_WIDTH,
    workgroupCount(input.maxTriangles, 64),
  )
  binning.setPipeline(r.plan.get())
  binning.dispatchWorkgroups(1)
  binning.end()
  encoder.copyBufferToBuffer(work, listOffset + 24, r.indirect, 0, DISPATCH_WORDS * 4)
  // One pass per raster dispatch: two consecutive dispatches already see each other's
  // writes, so every class has written its depth before any chooses an identifier. An
  // identifier chosen before a class has written its depth would name a losing triangle.
  encodeMode(r, encoder, MODE_DEPTH_OCCLUDER, 'Trillion3D raster occluder depth')
  if (input.tested) r.resolves.encodeHiz(encoder, input, width, height)
  return 3 + RASTER_CLASSES.length
}
export type GpuRaster = ReturnType<typeof createGpuRaster>
