import { createRecordTexture } from '../../gpu/core/recordTexture.ts'
import { writeRanges } from '../../gpu/dag/runWrites.ts'
import type { MaterialRecords } from './materialState.ts'
import { MATERIAL_RECORD_WORDS, MATERIAL_TABLE } from './materialLayout.ts'

/**
 * The table's record texture (`../../gpu/core/recordTexture.ts`) made or grown to hold every
 * record, and the records written since the last upload sent up by the engine's one run writer
 * (`writeRanges`): scattered records never resend every record between them. Made, it is sent
 * every record held in one write; grown, its records are copied on the GPU, in the queue's order
 * behind every write sent to it, the texture replaced retired after the frame that may name it —
 * nothing is sent again from the host. A growth the device refuses keeps the table it had, the
 * records past it still to send.
 */
export function uploadMaterials(p: MaterialRecords, device: GPUDevice) {
  if (!p.records) {
    const usage =
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
    p.records = createRecordTexture(device, MATERIAL_TABLE, p.held, usage)
    if (p.held) p.records.write('Record', 0, p.held, p.ints.buffer, p.ints.byteOffset)
    p.written.clear()
    return p.records.view
  }
  if (!p.records.hold(p.held) || !p.written.count) return p.records.view
  const ranks = p.written.take()
  writeRanges(p.records.target('Record'), ranks, ranks.length, {
    data: p.ints,
    sourceBase: 0,
    targetBase: 0,
    stride: MATERIAL_RECORD_WORDS,
  })
  return p.records.view
}
