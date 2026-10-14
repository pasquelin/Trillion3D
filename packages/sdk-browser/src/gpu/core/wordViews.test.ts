// An upload image's word views are made once per image and offset, and read the image itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wordViews } from './wordViews.ts'

test('the views of an image and offset are made once and read the same words', () => {
  const image = new ArrayBuffer(32)
  const whole = wordViews(image),
    tail = wordViews(image, 16)
  assert.equal(wordViews(image), whole)
  assert.equal(wordViews(image, 16), tail)
  assert.notEqual(tail, whole)
  assert.deepEqual([whole.u.length, tail.u.length], [8, 4])
  tail.f[1] = 1.5
  tail.i[2] = -3
  assert.equal(whole.f[5], 1.5)
  assert.equal(whole.u[6], 2 ** 32 - 3)
})
