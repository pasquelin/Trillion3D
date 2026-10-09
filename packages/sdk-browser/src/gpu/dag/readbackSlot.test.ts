// A slot's read meets one failure quietly, a mapping the device refused (`SlotMapRefused`): the
// next copy tries again. Any other error is the engine's and reaches the reader, never swallowed
// as if the device had refused the mapping (`dispatchRead.ts`, `asideSlots.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readDagSlot, SlotMapRefused } from './readbackSlot.ts'
import { createDagOutputScratch } from './uniforms.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { createCoarsening } from './coarsening.ts'
import { OUT_FLAGS } from './layout.ts'
import { LIST_DROPPED, QUEUE_DROPPED } from './shader/viewsWgsl.ts'

/** A slot whose mapping and range do what the test says; `unmapped` counts its unmaps. */
function slotOf(map: () => Promise<void>, range: () => ArrayBuffer) {
  const slot = { unmapped: 0, mapAsync: map, getMappedRange: range, unmap: () => slot.unmapped++ }
  return slot
}

const shape = { queueWords: 8, candCap: 2, keyCount: 4 }

const read = (slot: ReturnType<typeof slotOf>, full = false, coarse = createCoarsening()) =>
  readDagSlot(
    slot as unknown as GPUBuffer,
    {
      bytes: 64,
      drawnWordOffset: 8,
      listCap: 4,
      scratch: createDagOutputScratch(),
      levelsWord: 0,
    },
    {
      limits: {},
      pageCount: 4,
      listFull: false,
      coarse,
      cutFactor: 1,
      flags: { shape, entryCount: 16, full },
    },
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

test('a cut that dropped work is never adopted: what was full doubles, or the view coarsens', async () => {
  installGpuGlobals()
  /** A readout whose flag word says `dropped`, its lists empty. */
  const dropping = (dropped: number) => {
    const words = new Uint32Array(16)
    words[OUT_FLAGS] = dropped
    return slotOf(
      async () => {},
      () => words.buffer,
    )
  }
  const queue = await read(dropping(QUEUE_DROPPED))
  assert.ok(queue.retried, 'not adopted')
  assert.deepEqual(queue.grownFlags, { ...shape, queueWords: 16 }, 'the queues double, alone')
  const list = await read(dropping(LIST_DROPPED))
  assert.deepEqual(list.grownFlags, { ...shape, candCap: 4 }, 'the lists double, alone')
  // Every page listed already: nothing grows past the catalogue, and the view coarsens instead.
  const coarse = createCoarsening()
  const past = await read(dropping(QUEUE_DROPPED), true, coarse)
  assert.ok(past.retried && !past.grownFlags && past.moved && coarse.factor > 1)
  const whole = await read(dropping(0))
  assert.ok(!whole.retried && !whole.grownFlags, 'a cut that ran whole is adopted')
})
