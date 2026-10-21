// A cut's flags lay each section out at its list's cap (`lists/cutListCaps.ts`), within what the
// packing can ever hold, never by a storage binding: the flags are one record table
// (`cut/cutTables.ts`), its sections the kernel's, word for word.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dagFlagShape, flagSectionStart, flagShapeWords } from './flagSections.ts'

const packed = { entryCount: 1811, pageCount: 1800, worldCount: 4 }

test('the sections hold the caps within the packing: its entries, twice its pages, its pages', () => {
  // The descent array: the nodes a pass opens, beside queue 0's root slots.
  assert.deepEqual(dagFlagShape(packed), {
    queueWords: 3630,
    candCap: 3600,
    visCap: 1800,
    nodeBudget: 1811,
  })
  const caps = { nodes: 1000, candidates: 512, visible: 256 }
  assert.deepEqual(dagFlagShape(packed, caps), {
    queueWords: 2008,
    candCap: 512,
    visCap: 256,
    nodeBudget: 1000,
  })
  // Queue 0 holds its root slots whatever the node cap.
  assert.equal(dagFlagShape({ ...packed, worldCount: 3000 }, caps).queueWords, 8000)
})

test("the sections are the kernel's: the descent array, the lists and the log, the held items", () => {
  const shape = { queueWords: 14, candCap: 100, visCap: 40, nodeBudget: 7 }
  assert.equal(flagSectionStart(1, shape), 14, 'the candidates, behind the descent array')
  assert.equal(flagSectionStart(2, shape), 14 + 2 * 100, 'the live list, behind them')
  assert.equal(flagSectionStart(3, shape), 14 + 2 * 100 + 2 * 40, 'the drawn log, behind it')
  assert.equal(flagSectionStart(4, shape), 14 + 2 * 100 + 3 * 40, 'the held items, behind it')
  // Seven held items of three words each close the flags.
  assert.equal(flagShapeWords(shape), 14 + 2 * 100 + 3 * 40 + 7 * 3)
})
