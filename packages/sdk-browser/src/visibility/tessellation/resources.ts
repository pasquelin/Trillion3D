import { RASTER_PASSES } from '../raster/contract.ts'
import { DISPLACEMENT_WORDS } from '../../materials/table/displacementRecord.ts'
import type { DisplacementRecords } from '../../materials/table/displacementRecord.ts'
import { PASS_ARG_WORDS, PASS_DISPATCH_WORDS, TABLE_DATA_WORD } from './contract.ts'
import { buildTessellationTable } from './table/build.ts'
import {
  TESS_UNIFORM_BYTES,
  fitCapacity,
  tessLayout,
  type TessellationCapacity,
} from './uniform.ts'

/** The table, built the first time a displaced surface is drawn and kept for the session. */
let table: ReturnType<typeof buildTessellationTable> | undefined

/**
 * The tessellation's buffers, made once a frame draws a displaced surface and given back when none
 * is: `tess`, the table, each pass's state, the splitting queue and the visible lists in the one
 * storage buffer (`tessLayout`) — the table written once, the rest by the passes —; `dispatch`, the
 * workgroups the levels and the dicing are launched with, a buffer only the arguments' kernels write
 * and only the dispatches read; a uniform for each pass of the cut (`uniform.ts`). `asked` is the
 * capacity the settings name, the buffer's what the device lets it be (`fitCapacity`).
 */
export function createTessellationResources(device: GPUDevice, asked: TessellationCapacity) {
  table ??= buildTessellationTable()
  const tableWords = TABLE_DATA_WORD + table.data.length
  const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
  const capacity = fitCapacity(limit, tableWords, asked)
  const layout = tessLayout(tableWords, capacity.candidate, capacity.visible)
  const tess = device.createBuffer({
    label: 'Trillion3D tessellation',
    size: layout.words * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(tess, 0, table.offsets)
  device.queue.writeBuffer(tess, TABLE_DATA_WORD * 4, table.data)
  const dispatch = device.createBuffer({
    label: 'Trillion3D tessellation dispatch',
    size: RASTER_PASSES.length * PASS_DISPATCH_WORDS * 4,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const uniforms = RASTER_PASSES.map(() =>
    device.createBuffer({
      label: 'Trillion3D tessellation uniform',
      size: TESS_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  )
  return {
    capacity,
    layout,
    tess,
    dispatch,
    uniforms,
    /** The bytes of the arguments of `pass`, which the pass's seeding clears. */
    argsRange: (pass: number) => [layout.args[pass]! * 4, PASS_ARG_WORDS * 4] as const,
    dispose() {
      tess.destroy()
      dispatch.destroy()
      for (const uniform of uniforms) uniform.destroy()
    },
  }
}
export type TessellationResources = ReturnType<typeof createTessellationResources>

/**
 * The displaced surfaces' records as the GPU reads them, `disp` (`displacementRecord.ts`): sent
 * again when the table's version moved, the buffer made again — twice the size, so growth is rare —
 * when the records outgrew it. The records are by rank, a row's `material` word naming its own.
 */
export function createDisplacementBuffer(device: GPUDevice) {
  let buffer: GPUBuffer | undefined,
    version = -1
  return {
    get buffer() {
      return buffer
    },
    follow(records: Pick<DisplacementRecords, 'ints' | 'version'>) {
      if (version === records.version && buffer) return
      const bytes = Math.max(records.ints.byteLength, DISPLACEMENT_WORDS * 4)
      if (!buffer || buffer.size < bytes) {
        buffer?.destroy()
        buffer = device.createBuffer({
          label: 'Trillion3D displacement records',
          size: bytes * 2,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        })
      }
      device.queue.writeBuffer(buffer, 0, records.ints)
      version = records.version
    },
    dispose() {
      buffer?.destroy()
      buffer = undefined
    },
  }
}
