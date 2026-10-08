import { core } from '../../impostor/borrowed.ts'
import { CARD_FLOATS, uploaded } from '../../impostor/cardSlots.ts'
import type { WebgpuImpostors } from './frame.ts'

/** The records written since the last image, increasing, each once (`takeMovedWorlds`), through
 *  the cut's one run writer into `buffer`; all of them into a buffer just made. Nothing of the
 *  buffer or the records outlives the call: a session disposed lets both go. */
export function uploadRecords(device: GPUDevice, state: WebgpuImpostors, buffer: GPUBuffer) {
  const slots = state.slots,
    records = slots.records
  if (slots.full || state.uploadedTo !== buffer) {
    device.queue.writeBuffer(buffer, 0, records, 0, slots.used * CARD_FLOATS)
    state.uploadedTo = buffer
    return uploaded(slots)
  }
  const ranks = core.takeMovedWorlds(slots.dirty)
  if (!ranks.length) return uploaded(slots)
  const parts = { buffers: [buffer], bytes: buffer.size },
    source = { data: records, sourceBase: 0, targetBase: 0, stride: CARD_FLOATS }
  core.writeRanges(device, parts, ranks, ranks.length, source)
  uploaded(slots)
}
