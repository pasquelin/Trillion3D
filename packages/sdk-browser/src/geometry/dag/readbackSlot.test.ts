// A cut's readback, read over the range its ring mapped (`readbackSlot.ts`): a cut past a list's
// cap drew what fit and is read as any; what it asked of its lists is noted against their caps, an
// overflow said once each time it raises its list's high-water mark (`lists/listFeedback.ts`). A
// mapping refused is the ring's to meet (`../../gpu/core/readbackRing.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readDagSlot } from './readbackSlot.ts'
import { createDagOutputScratch } from './uniforms.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { PEAK_CANDIDATES, PEAK_NODES } from './readoutWords.ts'
import { createListFeedback, type ListOverflow } from './lists/listFeedback.ts'

const caps = { nodes: 16, candidates: 64, visible: 32 }

test('a cut past a cap is read as any, its overflow said once a high-water mark', () => {
  installGpuGlobals()
  const said: ListOverflow[] = []
  const feedback = createListFeedback((overflow) => said.push(overflow))
  /** A readout whose drawn list's header says what the cut asked, its lists empty. */
  const asking = (nodes: number, candidates: number) => {
    const words = new Uint32Array(16)
    words[8 + PEAK_NODES] = nodes
    words[8 + PEAK_CANDIDATES] = candidates
    return words.buffer
  }
  const read = (range: ArrayBuffer) =>
    readDagSlot(
      range,
      {
        bytes: 64,
        drawnWordOffset: 8,
        priorityWordOffset: 12,
        countWordOffset: 12,
        scratch: createDagOutputScratch(),
      },
      { feedback, caps },
    )
  assert.ok(read(asking(20, 10)).parsed?.drawablePageIds, 'past a cap, read as any')
  assert.deepEqual(
    said.map(({ list, peak, cap }) => [list, peak, cap]),
    [['nodes', 20, 16]],
  )
  read(asking(18, 10))
  assert.equal(said.length, 1, 'under the mark: said no more')
  read(asking(24, 100))
  assert.deepEqual(
    said.slice(1).map(({ list, highWater }) => [list, highWater]),
    [
      ['nodes', 24],
      ['candidates', 100],
    ],
  )
})
