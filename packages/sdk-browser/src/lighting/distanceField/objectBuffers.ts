import { nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { grownByCopy } from '../../gpu/core/tableGrowth.ts'
import { OBJECT_BOUNDS_STRIDE, OBJECT_DATA_STRIDE } from './layout.ts'
import { recordWords, type ObjectSource, writeObjectRecord } from './objectRecords.ts'

/**
 * THE PLACEMENTS' RECORDS ON THE GPU: two storage buffers, one record to a placement, grown to a
 * power of two of placements when the scene holds more than they do, the old contents copied across
 * before the frame's writes. A frame writes the records of the placements that changed
 * (the tracker's `takeUpload`), the neighbours in one write, in runs of `RUN` records at most.
 */

/** Records written at once. */
const RUN = 1024
/** The records written in one frame at most. */
const UPLOADS_PER_FRAME = 2 << 20

const BOUNDS_BYTES = OBJECT_BOUNDS_STRIDE * 16
const DATA_BYTES = OBJECT_DATA_STRIDE * 16

/** A buffer of `bytes` that replaces `old`, which it keeps the contents of. */
function grown(device: GPUDevice, old: GPUBuffer | undefined, bytes: number, label: string) {
  const next = device.createBuffer({
    label,
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  if (old) {
    grownByCopy(
      device,
      [old],
      (encoder) => encoder.copyBufferToBuffer(old, 0, next, 0, old.size),
      label,
    )
  }
  return next
}

type RecordScratch = ReturnType<typeof recordWords>

/** Writes the `records` records in the scratch to the placements from `first` on. */
function writeRun(
  device: GPUDevice,
  boundsBuffer: GPUBuffer,
  dataBuffer: GPUBuffer,
  scratch: { bounds: RecordScratch; data: RecordScratch },
  first: number,
  records: number,
) {
  device.queue.writeBuffer(
    boundsBuffer,
    first * BOUNDS_BYTES,
    scratch.bounds.u32 as Uint32Array<ArrayBuffer>,
    0,
    records * OBJECT_BOUNDS_STRIDE * 4,
  )
  device.queue.writeBuffer(
    dataBuffer,
    first * DATA_BYTES,
    scratch.data.u32 as Uint32Array<ArrayBuffer>,
    0,
    records * OBJECT_DATA_STRIDE * 4,
  )
}

/** The buffers of the placements' records. */
export function createObjectBuffers(device: GPUDevice) {
  let capacity = 0
  let bounds: GPUBuffer | undefined
  let data: GPUBuffer | undefined
  const scratch = {
    bounds: recordWords(new ArrayBuffer(RUN * BOUNDS_BYTES)),
    data: recordWords(new ArrayBuffer(RUN * DATA_BYTES)),
  }
  return {
    get bounds() {
      return bounds!
    },
    get data() {
      return data!
    },
    /** Room for `count` placements at least. */
    ensure(count: number) {
      const wanted = nextPow2(Math.max(1, count))
      if (bounds && capacity >= wanted) return
      capacity = wanted
      bounds = grown(
        device,
        bounds,
        wanted * BOUNDS_BYTES,
        'Trillion3D distance field object bounds',
      )
      data = grown(device, data, wanted * DATA_BYTES, 'Trillion3D distance field object data')
    },
    /** Writes the records of the placements `indices` (ascending), from `sourceOf`; how many. */
    write(
      indices: readonly number[],
      sourceOf: (index: number) => ObjectSource,
      surfaceBiasExpand: number,
    ) {
      const count = Math.min(indices.length, UPLOADS_PER_FRAME)
      for (let from = 0; from < count;) {
        let to = from + 1
        while (to < count && to - from < RUN && indices[to] === indices[to - 1] + 1) to++
        for (let k = from; k < to; k++)
          writeObjectRecord(
            scratch.bounds,
            scratch.data,
            k - from,
            sourceOf(indices[k]),
            surfaceBiasExpand,
          )
        writeRun(device, bounds!, data!, scratch, indices[from], to - from)
        from = to
      }
      return count
    },
    dispose() {
      bounds?.destroy()
      data?.destroy()
    },
  }
}

export type ObjectBuffers = ReturnType<typeof createObjectBuffers>
