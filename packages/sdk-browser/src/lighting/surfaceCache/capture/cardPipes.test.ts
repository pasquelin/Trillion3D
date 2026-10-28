import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { cardEndPipes } from './cardPipes.ts'

// The bindings each kernel of the cards' capture is bound with (`cardRaster.ts`: `encodeExport`,
// `encodeClear`, the rows' group): a group of another number of entries than its layout is refused
// by the device at creation, and the capture's session lost with it.
const BOUND = {
  rows: [0, 1],
  exportIds: [0, 1, 2, 3, 4],
  exportViews: [0, 1, 2, 3, 4],
  clearIds: [1, 2, 3],
  clearSurfaces: [1, 2, 3, 4],
} as const

test('the layout of each kernel of the capture holds the entries its group is bound with', () => {
  const f = fakeDevice()
  const pipes = cardEndPipes(f.device as unknown as GPUDevice)
  for (const [name, bindings] of Object.entries(BOUND)) {
    const layout = (pipes as Record<string, { groups: unknown[] }>)[name].groups[0] as {
      entries?: Iterable<{ binding: number }>
    }
    const declared = [...(layout.entries ?? [])].map((entry) => entry.binding)
    assert.deepEqual(declared, [...bindings], name)
  }
})
