import { ceilDiv, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { TRANSPARENT_COMPACT_SHADER } from './shader.ts'
import { dispatchRows } from '../../gpu/dispatch/grid.ts'
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts'
import { TRANSPARENT_GROUP, type TransparentTable } from './table.ts'

const UNIFORM_WORDS = 8

export type TransparentCompaction = NonNullable<
  Awaited<ReturnType<typeof createTransparentCompaction>>
>

/** The compaction's layout: its nine buffers, the uniform at 1, the inputs read-only. */
function compactLayout(device: GPUDevice) {
  const readOnly = [0, 2, 7, 8]
  return device.createBindGroupLayout({
    entries: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer:
        binding === 1
          ? { type: 'uniform' as const }
          : readOnly.includes(binding)
            ? { type: 'read-only-storage' as const }
            : { type: 'storage' as const },
    })),
  })
}

/** The compute half: the three passes that turn the frame's selection mask into instance lists. */
async function compactPasses(
  device: GPUDevice,
  table: TransparentTable,
  bound: readonly GPUBuffer[],
  uniforms: GPUBuffer,
) {
  if (typeof device.createComputePipeline !== 'function') return undefined
  const layout = compactLayout(device)
  const module = device.createShaderModule({ code: TRANSPARENT_COMPACT_SHADER })
  if (typeof module.getCompilationInfo === 'function') {
    const info = await module.getCompilationInfo()
    if (info.messages.some((message) => message.type === 'error')) return undefined
  }
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const entryPoints = [
    'countTransparentGroups',
    'prefixTransparentItems',
    'scatterTransparentGroups',
  ] as const
  const stages = await buildComputeStages(device, pipelineLayout, module, entryPoints)
  const pipelines = entryPoints.map((entry) => stages[entry])
  const bindTo = (mask: GPUBuffer) =>
    device.createBindGroup({
      layout,
      entries: [
        bound[0],
        uniforms,
        mask,
        bound[1],
        bound[2],
        bound[3],
        bound[4],
        bound[5],
        bound[6],
      ].map((buffer, binding) => ({ binding, resource: { buffer } })),
    })
  let boundMask = bound[0],
    bindGroup = bindTo(boundMask)
  const uniData = new Uint32Array(UNIFORM_WORDS)
  const groups = workgroupCount(table.length, TRANSPARENT_GROUP)
  const items = Math.max(1, table.pagedItems.length)
  // A thread a group, an item, an entry.
  const launches = [ceilDiv(groups, 64), ceilDiv(items, 64), groups]
  return (encoder: GPUCommandEncoder, mask: GPUBuffer, maskOffset: number) => {
    uniData[0] = table.length
    uniData[1] = groups
    uniData[2] = table.pagedItems.length
    uniData[3] = maskOffset
    uniData[4] = table.maxVertexWords
    if (mask !== boundMask) bindGroup = bindTo((boundMask = mask))
    device.queue.writeBuffer(uniforms, 0, uniData)
    const pass = encoder.beginComputePass({ label: 'Trillion3D transparent compaction' })
    pass.setBindGroup(0, bindGroup)
    for (let step = 0; step < 3; step++) {
      pass.setPipeline(pipelines[step])
      dispatchRows(pass, launches[step])
    }
    pass.end()
  }
}

/**
 * What a transparent draw reads, and the GPU compaction that fills it.
 *
 * Three buffers outlive every image: the span of each cluster in the page cache, the compacted
 * instance list, and the indirect command of each item. Nothing here is rebuilt per image — the
 * spans move only when a page enters or leaves the cache, and the instance list is written by the
 * GPU from the selection mask of the frame being drawn. `encode` is absent on a device that
 * refuses the kernels, which then refuses the scene (`prepareWebgpuPages`).
 */
export async function createTransparentCompaction(device: GPUDevice, table: TransparentTable) {
  if (!table.length) return undefined
  const buffers: GPUBuffer[] = []
  try {
    const made = compactBuffers(device, table, buffers)
    const { instanceBuffer, occludedBuffer, spanBuffer, diagnosticBuffer, indirectBuffer } = made
    device.queue.writeBuffer(made.entriesBuf, 0, table.entries)
    device.queue.writeBuffer(made.itemRangesBuf, 0, table.itemRanges)
    device.queue.writeBuffer(spanBuffer, 0, table.spans)
    const encode = await compactPasses(
      device,
      table,
      [
        made.entriesBuf,
        made.groupCounts,
        made.groupOffsets,
        instanceBuffer,
        indirectBuffer,
        made.itemRangesBuf,
        occludedBuffer,
      ],
      made.uniforms,
    )
    return {
      instanceBuffer,
      occludedBuffer,
      spanBuffer,
      diagnosticBuffer,
      indirectBuffer,
      encode,
      /** Uploads the spans the last residency change rewrote, and nothing else. */
      uploadSpans(first: number, count: number) {
        device.queue.writeBuffer(spanBuffer, first * 16, table.spans.buffer, first * 16, count * 16)
      },
      uploadDiagnostic(source: Uint32Array<ArrayBuffer>) {
        device.queue.writeBuffer(diagnosticBuffer, 0, source)
      },
      dispose() {
        for (const buffer of buffers) buffer.destroy()
      },
    }
  } catch {
    for (const buffer of buffers)
      try {
        buffer.destroy()
      } catch {
        /* Partial transparent compaction setup must not leak. */
      }
    return undefined
  }
}

/** The compaction's buffers for `table`, each pushed into `buffers` as soon as it is made: a setup
 *  that fails part-way destroys those it made. */
function compactBuffers(device: GPUDevice, table: TransparentTable, buffers: GPUBuffer[]) {
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const make = (label: string, size: number, usage = storage) => {
    const buffer = device.createBuffer({ label, size: Math.max(8, size), usage })
    buffers.push(buffer)
    return buffer
  }
  const items = Math.max(1, table.pagedItems.length)
  const entriesBuf = make('Trillion3D transparent entries', table.capacity * 4)
  const itemRangesBuf = make('Trillion3D transparent item ranges', items * 8)
  const uniforms = make(
    'Trillion3D transparent compaction uniforms',
    UNIFORM_WORDS * 4,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  const groupCounts = make('Trillion3D transparent group counts', table.groupCount * 4)
  const groupOffsets = make('Trillion3D transparent group offsets', table.groupCount * 4)
  const instanceBuffer = make('Trillion3D transparent instances', table.capacity * 4)
  const spanBuffer = make('Trillion3D transparent cluster spans', table.capacity * 16)
  // Occlusion verdict of each entry, written by the transparent Hi-Z test a little earlier in the
  // same submission. Zero before any image, and zero on an image without a pyramid: nothing is then
  // dropped from the table.
  // `COPY_SRC` only serves the audit, which rereads the verdicts; no image copies them.
  const occludedBuffer = make(
    'Trillion3D transparent occlusion verdicts',
    table.capacity * 4,
    storage | GPUBufferUsage.COPY_SRC,
  )
  const diagnosticBuffer = make('Trillion3D transparent cluster identity', table.capacity * 4)
  const indirectBuffer = make(
    'Trillion3D transparent indirect',
    items * 16,
    storage | GPUBufferUsage.INDIRECT,
  )
  return {
    entriesBuf,
    itemRangesBuf,
    uniforms,
    groupCounts,
    groupOffsets,
    instanceBuffer,
    spanBuffer,
    occludedBuffer,
    diagnosticBuffer,
    indirectBuffer,
  }
}
