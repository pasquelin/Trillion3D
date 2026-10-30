// The sides of a light's history an image reads and writes are pinned at the image's first encode.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readOf, type History } from './shadowDenoiseFrame.ts'

const history = (): History => ({
  pair: [{}, {}] as History['pair'],
  turn: 3,
  last: 6,
  used: 0,
  rect: [0, 0, 8, 8],
})

test('a second encoder of the image, encoded after the first was submitted, reads what the first read', () => {
  const held = history()
  const first = readOf(held, 7)
  // The first encoder is submitted: the light advanced once for image 7.
  held.turn++
  held.last = 7
  held.rect = [0, 0, 4, 4]
  const second = readOf(held, 7)
  assert.equal(second, first)
  assert.deepEqual([second.turn, second.last, second.rect], [3, 6, [0, 0, 8, 8]])
})

test('the next image reads what the submitted one wrote', () => {
  const held = history()
  readOf(held, 7)
  held.turn++
  held.last = 7
  assert.deepEqual([readOf(held, 8).turn, readOf(held, 8).last], [4, 7])
})
