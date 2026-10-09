// The allocation measure settles once its last three rounds read alike within the heap's own
// noise, a few kilobytes, never on rounds exactly equal, which noise never gives. On generated
// rounds of a settled and an unsettled code.
import test from 'node:test'
import assert from 'node:assert/strict'
import { settled } from './scaleControlAlloc.fixture.ts'

test('rounds a few hundred bytes apart are settled; one a lower tier boxes in is not', () => {
  assert.equal(settled([17856, 384, 656, 400, 384]), true, 'noise alone')
  assert.equal(settled([27840, 28192, 17856, 384, 384]), false, 'still settling')
  assert.equal(settled([384, 384, 384]), false, 'too few rounds')
})
