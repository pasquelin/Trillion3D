// The time one image's field update counts for is bounded: a wait on a compile or a grant is no time of the scene.
import test from 'node:test'
import assert from 'node:assert/strict'
import { imageStep } from './frame.ts'

test('a step is the seconds between two images, never negative, never more than a tenth', () => {
  assert.equal(imageStep(1016, 1000), 0.016)
  assert.equal(imageStep(1000, 1016), 0)
  assert.equal(imageStep(1000 + 2500, 1000), 0.1, 'a wait of two seconds and a half')
  assert.equal(
    imageStep(1000 + 40_000, 1000),
    imageStep(1000 + 2500, 1000),
    'cold or warm compile, the same step',
  )
})
