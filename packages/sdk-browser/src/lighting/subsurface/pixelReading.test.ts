import test from 'node:test'
import assert from 'node:assert/strict'
import { trackPixelReading } from './pixelReading.ts'

test('a reading is fresh once it is of the pixel asked, and not before any reading came back', () => {
  const track = trackPixelReading()
  assert.equal(track.fresh, false)
  assert.equal(track.ask(10, 20), true, 'the first pixel asked is a new one')
  assert.equal(track.fresh, false)
  track.landed([10, 20, 1])
  assert.equal(track.fresh, true)
  assert.equal(track.ask(10, 20), false, 'the same pixel again: nothing to take at once')
  assert.equal(track.fresh, true)
})

test('a cursor that moves drops the reading held, and a reading of the pixel left is never taken for the new one', () => {
  const track = trackPixelReading()
  track.ask(10, 20)
  track.landed([10, 20, 1])
  assert.equal(track.ask(11, 20), true)
  assert.equal(track.fresh, false)
  // A reading of the old pixel still comes back, in flight when the cursor moved.
  track.landed([10, 20, 1])
  assert.equal(track.fresh, false)
  track.landed([11, 20, 1])
  assert.equal(track.fresh, true)
})

test('a pass that does not run the kernel (half resolution) forgets the reading, and asking again takes a new one', () => {
  const track = trackPixelReading()
  track.ask(5, 5)
  track.landed([5, 5, 1])
  track.forget()
  assert.equal(track.fresh, false)
  track.landed([5, 5, 1])
  assert.equal(track.fresh, false, 'nothing asked: a reading in flight says nothing')
  assert.equal(track.ask(5, 5), true)
})
