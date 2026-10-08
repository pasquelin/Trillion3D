// A slot's read meets one failure quietly, a mapping the device refused (`SlotMapRefused`): the
// next copy tries again. Any other error is the engine's and reaches the reader, never swallowed
// as if the device had refused the mapping (`dispatchRead.ts`, `asideSlots.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readDagSlot, SlotMapRefused } from './readbackSlot.ts'
import { createDagOutputScratch } from './uniforms.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

/** A slot whose mapping and range do what the test says; `unmapped` counts its unmaps. */
function slotOf(map: () => Promise<void>, range: () => ArrayBuffer) {
  const slot = { unmapped: 0, mapAsync: map, getMappedRange: range, unmap: () => slot.unmapped++ }
  return slot
}

const read = (slot: ReturnType<typeof slotOf>) =>
  readDagSlot(
    slot as unknown as GPUBuffer,
    {
      bytes: 64,
      drawnWordOffset: 8,
      listCap: 4,
      scratch: createDagOutputScratch(),
      levelsWord: 0,
    },
    { limits: {}, pageCount: 4, listFull: false, coarsen: 1 },
  )

test('a refused mapping rejects as SlotMapRefused; an error past it is the engine’s own', async () => {
  installGpuGlobals()
  const refused = slotOf(
    () => Promise.reject(new DOMException('lost', 'OperationError')),
    () => new ArrayBuffer(64),
  )
  await assert.rejects(read(refused), SlotMapRefused)
  const bug = new TypeError('a parse that reads past its words')
  const broken = slotOf(
    async () => {},
    () => {
      throw bug
    },
  )
  await assert.rejects(read(broken), (error) => error === bug)
  assert.equal(broken.unmapped, 1, 'the slot is given back whatever happens after its mapping')
})
