// The card upload keeps nothing of a session: once its records went up, the card buffer and the
// records are the session's alone — a session disposed lets both go, none held by the module.
// On a generated set of 64 records, 16 of them written.
import test from 'node:test'
import assert from 'node:assert/strict'
import v8 from 'node:v8'
import vm from 'node:vm'
import '../../impostor/lent.fixture.ts'
import { createCardSlots, CARD_FLOATS } from '../../impostor/cardSlots.ts'
import { uploadRecords } from './cardUpload.ts'
import type { WebgpuImpostors } from './frame.ts'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

/** One upload of 16 written records into a buffer of its own; weak views of the buffer and the
 *  records it read. */
function uploadOnce() {
  const slots = createCardSlots()
  slots.records = new Float32Array(64 * CARD_FLOATS)
  slots.used = 64
  slots.full = false
  for (let k = 0; k < 16; k++) slots.dirty.listed.add(4 * k)
  const buffer = { size: 64 * CARD_FLOATS * 4 } as GPUBuffer
  const state = { slots, uploadedTo: buffer } as unknown as WebgpuImpostors
  const device = { queue: { writeBuffer: () => {} } } as unknown as GPUDevice
  uploadRecords(device, state, buffer)
  return { buffer: new WeakRef(buffer), records: new WeakRef(slots.records) }
}

test('a disposed session’s card buffer and records are let go', async () => {
  const held = uploadOnce()
  // Twice, a task apart: the collector frees what nothing reaches.
  for (let k = 0; k < 2; k++) {
    gc()
    await new Promise((settle) => setImmediate(settle))
  }
  assert.equal(held.buffer.deref(), undefined, 'the buffer')
  assert.equal(held.records.deref(), undefined, 'the records')
})
