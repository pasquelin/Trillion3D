// A cut's readback, read over the range its ring mapped (`readbackSlot.ts`): a cut that dropped
// work is never adopted, what was full grows, or past the device the view coarsens. A mapping
// refused is the ring's to meet (`../core/readbackRing.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readDagSlot } from './readbackSlot.ts'
import { createDagOutputScratch } from './uniforms.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { createCoarsening } from './coarsening.ts'
import { OUT_FLAGS } from './layout.ts'
import { LIST_DROPPED, QUEUE_DROPPED } from './shader/viewsWgsl.ts'

const shape = { queueWords: 8, candCap: 2 }

const read = (range: ArrayBuffer, full = false, coarse = createCoarsening()) =>
  readDagSlot(
    range,
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

test('a cut that dropped work is never adopted: what was full doubles, or the view coarsens', () => {
  installGpuGlobals()
  /** A readout whose flag word says `dropped`, its lists empty. */
  const dropping = (dropped: number) => {
    const words = new Uint32Array(16)
    words[OUT_FLAGS] = dropped
    return words.buffer
  }
  const queue = read(dropping(QUEUE_DROPPED))
  assert.ok(queue.retried, 'not adopted')
  assert.deepEqual(queue.grownFlags, { ...shape, queueWords: 16 }, 'the queues double, alone')
  const list = read(dropping(LIST_DROPPED))
  assert.deepEqual(list.grownFlags, { ...shape, candCap: 4 }, 'the lists double, alone')
  // Every page listed already: nothing grows past the catalogue, and the view coarsens instead.
  const coarse = createCoarsening()
  const past = read(dropping(QUEUE_DROPPED), true, coarse)
  assert.ok(past.retried && !past.grownFlags && past.moved && coarse.factor > 1)
  const whole = read(dropping(0))
  assert.ok(!whole.retried && !whole.grownFlags, 'a cut that ran whole is adopted')
})
