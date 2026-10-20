import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredView } from './view.ts'
import { VIEW_LAYOUT } from './worldAtWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

// A frame drawn below the display without the temporal resolve was composed pixel for pixel: the
// composition reads where each display pixel falls in the image drawn (`composeSource`).
test('the source words are its ratio to the display and its last pixel, written when they change', () => {
  const gpu = fakeDevice()
  const view = createDeferredView(gpu.device)
  const written = () => gpu.writes.filter((write) => write.offset === VIEW_LAYOUT.at.source * 4)
  view.writeSource([1, 1], [1, 1])
  assert.equal(written().length, 0, 'at the display size, as made: nothing to write')
  view.writeSource([496, 448], [990, 888])
  assert.deepEqual(
    [...new Float32Array(written()[0].data as ArrayLike<number>)],
    [Math.fround(496 / 990), Math.fround(448 / 888), 495, 447],
  )
  view.writeSource([496, 448], [990, 888])
  assert.equal(written().length, 1, 'the same source writes nothing')
})
