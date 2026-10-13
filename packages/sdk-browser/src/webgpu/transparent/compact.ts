import { ceilDiv, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { TRANSPARENT_COMPACT_SHADER } from './shader.ts'
import { dispatchRows } from '../../gpu/dispatch/grid.ts'
import { shaderFailed } from '../../gpu/core/shaderModule.ts'
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts'
import { TRANSPARENT_GROUP, type TransparentTable } from './table.ts'
import { TRANSPARENT_COMPACTION_PASS } from '../../stage/passLabels.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'

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

/** The compute half's kernels: the three passes that turn the frame's selection mask into instance
 *  lists, compiled once whatever the table's size. Undefined on a device that refuses them. */
async function compactKernels(device: GPUDevice) {
  const layout = compactLayout(device)
  const module = device.createShaderModule({ code: TRANSPARENT_COMPACT_SHADER })
  if (await shaderFailed(module)) return undefined
  const entryPoints = [
    'countTransparentGroups',
    'prefixTransparentItems',
    'scatterTransparentGroups',
  ] as const
  const stages = await buildComputeStages(device, [layout], module, entryPoints)
  return { layout, pipelines: entryPoints.map((entry) => stages[entry]) }
}

type Kernels = NonNullable<Awaited<ReturnType<typeof compactKernels>>>
type Held = ReturnType<typeof compactBuffers>

/** The passes on the buffers `held` names, for the table as it stands at each image. */
function compactPasses(
  device: GPUDevice,
  kernels: Kernels,
  table: TransparentTable,
  held: () => Held,
) {
  const { layout, pipelines } = kernels
  const bindTo = (mask: GPUBuffer, made: Held) =>
    device.createBindGroup({
      layout,
      entries: sequentialEntries(
        [
          made.entriesBuf,
          made.uniforms,
          mask,
          made.groupCounts,
          made.groupOffsets,
          made.instanceBuffer,
          made.indirectBuffer,
          made.itemRangesBuf,
          made.occludedBuffer,
        ].map((buffer) => ({ buffer })),
      ),
    })
  // The group over the mask and the held buffers, made again when either moved.
  const bound = createWebgpuBindIdentity()
  let bindGroup: GPUBindGroup | undefined
  const uniData = new Uint32Array(UNIFORM_WORDS)
  return (encoder: GPUCommandEncoder, mask: GPUBuffer, maskOffset: number) => {
    const made = held()
    const groups = workgroupCount(table.length, TRANSPARENT_GROUP)
    const items = Math.max(1, table.pagedItems.length)
    // A thread a group, an item, an entry.
    const launches = [ceilDiv(groups, 64), ceilDiv(items, 64), groups]
    uniData[0] = table.length
    uniData[1] = groups
    uniData[2] = table.pagedItems.length
    uniData[3] = maskOffset
    uniData[4] = table.maxVertexWords
    bound.next[0] = mask
    bound.next[1] = made
    if (bound.moved()) bindGroup = bindTo(mask, made)
    device.queue.writeBuffer(made.uniforms, 0, uniData)
    const pass = encoder.beginComputePass({ label: TRANSPARENT_COMPACTION_PASS })
    pass.setBindGroup(0, bindGroup!)
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
 *
 * The table grows with the session (`TransparentTable.append`): `grow` writes the rows it added,
 * and the buffers a full table outgrew are made once as long, their rows written from the table's.
 */
export async function createTransparentCompaction(device: GPUDevice, table: TransparentTable) {
  let buffers: GPUBuffer[] = []
  try {
    const kernels = await compactKernels(device)
    let held = compactBuffers(device, table, buffers)
    let rows = { length: 0, items: 0 }
    /** The table's rows from `rows` on written, or all of them in the buffers just made. */
    const write = (whole: boolean) => {
      const firstEntry = whole ? 0 : rows.length,
        firstItem = whole ? 0 : rows.items
      const entries = table.length - firstEntry,
        itemWords = (table.pagedItems.length - firstItem) * 2
      if (entries > 0)
        device.queue.writeBuffer(
          held.entriesBuf,
          firstEntry * 4,
          table.entries,
          firstEntry,
          entries,
        )
      if (itemWords > 0)
        device.queue.writeBuffer(
          held.itemRangesBuf,
          firstItem * 8,
          table.itemRanges,
          firstItem * 2,
          itemWords,
        )
      if (whole) device.queue.writeBuffer(held.spanBuffer, 0, table.spans)
      rows = { length: table.length, items: table.pagedItems.length }
    }
    write(true)
    const encode = kernels && compactPasses(device, kernels, table, () => held)
    return {
      get instanceBuffer() {
        return held.instanceBuffer
      },
      get occludedBuffer() {
        return held.occludedBuffer
      },
      get spanBuffer() {
        return held.spanBuffer
      },
      get diagnosticBuffer() {
        return held.diagnosticBuffer
      },
      get indirectBuffer() {
        return held.indirectBuffer
      },
      encode,
      /** The rows the table gained written; the buffers made over when it outgrew them, which
       *  those that bind them read again (`instanceBuffer`, `indirectBuffer`, …). */
      grow() {
        const outgrown = table.capacity > held.capacity || table.itemRanges.length > held.items * 2
        if (outgrown) {
          const outgrownBuffers = buffers
          buffers = []
          held = compactBuffers(device, table, buffers)
          write(true)
          for (const buffer of outgrownBuffers) buffer.destroy()
        } else write(false)
      },
      /** Uploads the spans the last residency change rewrote, and nothing else. */
      uploadSpans(first: number, count: number) {
        device.queue.writeBuffer(
          held.spanBuffer,
          first * 16,
          table.spans.buffer,
          first * 16,
          count * 16,
        )
      },
      uploadDiagnostic(source: Uint32Array<ArrayBuffer>) {
        device.queue.writeBuffer(held.diagnosticBuffer, 0, source)
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
  const items = table.itemRanges.length / 2
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
    capacity: table.capacity,
    items,
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
