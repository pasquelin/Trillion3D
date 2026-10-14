import { extendSpan } from '../../../../math/src/sequence/span.ts'
import { createRecordTexture } from '../../gpu/core/recordTexture.ts'
import type { MaterialRecords } from './materialState.ts'
import { MATERIAL_RECORD_WORDS, MATERIAL_TABLE } from './materialLayout.ts'

/**
 * The table's record texture (`../../gpu/core/recordTexture.ts`) made or grown to hold every
 * record, and the records written since the last upload sent up, their span alone; the view the
 * passes bind. Made, it is sent every record held; grown, its records are copied on the GPU, in the
 * queue's order behind every write sent to it, the texture replaced retired after the frame that
 * may name it — nothing is sent again from the host. A growth the device refuses keeps the table it
 * had, the records past it still to send.
 */
export function uploadMaterials(p: MaterialRecords, device: GPUDevice) {
  if (!p.records) {
    const usage =
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
    p.records = createRecordTexture(device, MATERIAL_TABLE, p.held, usage)
    if (p.held) extendSpan(p.written, 0, p.held - 1)
  } else if (!p.records.hold(p.held)) return p.records.view
  const { from: low, to: high } = p.written
  if (low > high) return p.records.view
  const recordBytes = MATERIAL_RECORD_WORDS * 4
  p.records.write(
    'Record',
    low,
    high - low + 1,
    p.ints.buffer,
    p.ints.byteOffset + low * recordBytes,
  )
  p.written.from = Infinity
  p.written.to = -1
  return p.records.view
}
