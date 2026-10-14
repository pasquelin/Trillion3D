import type { TransparentTable } from './table.ts'

/** The words of the compaction's uniform: the table's length, its groups, its items, the mask's
 *  offset and the widest vertex record, padded. */
export const UNIFORM_WORDS = 8

export type CompactBuffers = ReturnType<typeof compactBuffers>

/** The compaction's buffers for `table`, each pushed into `buffers` as soon as it is made: a setup
 *  that fails part-way destroys those it made. */
export function compactBuffers(device: GPUDevice, table: TransparentTable, buffers: GPUBuffer[]) {
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
